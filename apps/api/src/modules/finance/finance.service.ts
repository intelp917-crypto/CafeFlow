import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  EXPENSE_CATEGORY_LABELS_FA,
  type CashRegisterRow,
  type CashSessionRow,
  type CashSessionsResponse,
  type CloseCashSessionInput,
  type CreateExpenseInput,
  type ExpenseCategory,
  type ExpenseRow,
  type FinanceSummaryResponse,
  type OpenCashSessionInput,
} from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';
import { AuditService } from '../audit/audit.service';
import { badRequest, conflict, notFound } from '../../common/errors';
import { resolveDayRange } from '../../common/date-range';

export interface ActingUser {
  userId: string;
  username: string;
}

interface CashSessionDbRow {
  id: string;
  cash_register_id: string;
  register_name_fa: string;
  status: 'open' | 'closed';
  opened_by_name: string | null;
  opened_at: string;
  opening_float: number;
  closed_at: string | null;
  closing_amount: number | null;
  expected_amount: number | null;
  difference: number | null;
}

interface TotalsRow {
  cash_total: number;
  card_total: number;
  payments_count: number;
  refunds_total: number;
}

const SESSION_SELECT = `
  SELECT s.id, s.cash_register_id, c.name_fa AS register_name_fa, s.status,
         u.full_name AS opened_by_name, s.opened_at, s.opening_float,
         s.closed_at, s.closing_amount, s.expected_amount, s.difference
    FROM cash_sessions s
    JOIN cash_registers c ON c.id = s.cash_register_id
    LEFT JOIN users u ON u.id = s.opened_by_user_id`;

/**
 * Cash sessions (optional finance module).
 *
 * A session is opened with a float and closed with the physically counted
 * amount. The expected amount is derived from confirmed cash payments in the
 * session window minus cash refunds — never from a client-supplied figure — so
 * the difference shown at closing is auditable.
 */
@Injectable()
export class FinanceService {
  constructor(
    @Inject(DB_SERVICE) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private totals(fromIso: string, toIso: string): TotalsRow {
    const row = this.database.get<TotalsRow>(
      `SELECT
         COALESCE(SUM(CASE WHEN method = 'cash' AND status = 'confirmed' THEN amount
                           WHEN method = 'cash' AND status = 'refunded' THEN -amount ELSE 0 END), 0) AS cash_total,
         COALESCE(SUM(CASE WHEN method <> 'cash' AND status = 'confirmed' THEN amount
                           WHEN method <> 'cash' AND status = 'refunded' THEN -amount ELSE 0 END), 0) AS card_total,
         COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) AS payments_count,
         COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount ELSE 0 END), 0) AS refunds_total
       FROM payments
      WHERE paid_at >= ? AND paid_at < ?`,
      [fromIso, toIso],
    );

    return row ?? { cash_total: 0, card_total: 0, payments_count: 0, refunds_total: 0 };
  }

  private toRow(row: CashSessionDbRow): CashSessionRow {
    const toIso = row.closed_at ?? new Date().toISOString();
    const totals = this.totals(row.opened_at, toIso);
    const expected = row.expected_amount ?? row.opening_float + totals.cash_total;

    return {
      id: row.id,
      registerId: row.cash_register_id,
      registerNameFa: row.register_name_fa,
      status: row.status,
      openedByName: row.opened_by_name,
      openedAt: row.opened_at,
      openingFloat: row.opening_float,
      cashTotal: totals.cash_total,
      cardTotal: totals.card_total,
      paymentsCount: totals.payments_count,
      refundsTotal: totals.refunds_total,
      expectedAmount: expected,
      closedAt: row.closed_at,
      closingAmount: row.closing_amount,
      difference: row.difference,
    };
  }

  private registers(): CashRegisterRow[] {
    return this.database.all<{ id: string; name_fa: string; is_active: number }>(
      'SELECT id, name_fa, is_active FROM cash_registers ORDER BY is_active DESC, name_fa ASC',
    ).map((row) => ({ id: row.id, nameFa: row.name_fa, isActive: row.is_active === 1 }));
  }

  private findSession(id: string): CashSessionDbRow | undefined {
    return this.database.get<CashSessionDbRow>(`${SESSION_SELECT} WHERE s.id = ?`, [id]);
  }

  private findOpenSession(registerId?: string): CashSessionDbRow | undefined {
    return registerId
      ? this.database.get<CashSessionDbRow>(
          `${SESSION_SELECT} WHERE s.status = 'open' AND s.cash_register_id = ? ORDER BY s.opened_at DESC LIMIT 1`,
          [registerId],
        )
      : this.database.get<CashSessionDbRow>(
          `${SESSION_SELECT} WHERE s.status = 'open' ORDER BY s.opened_at DESC LIMIT 1`,
        );
  }

  overview(registerId?: string): CashSessionsResponse {
    const current = this.findOpenSession(registerId);
    const history = this.database
      .all<CashSessionDbRow>(
        `${SESSION_SELECT} WHERE s.status = 'closed' ORDER BY s.closed_at DESC LIMIT 20`,
      )
      .map((row) => this.toRow(row));

    return {
      registers: this.registers(),
      current: current ? this.toRow(current) : null,
      history,
    };
  }

  open(input: OpenCashSessionInput, actor: ActingUser): CashSessionRow {
    const register = this.database.get<{ id: string; is_active: number }>(
      'SELECT id, is_active FROM cash_registers WHERE id = ?',
      [input.registerId],
    );
    if (!register) throw notFound('صندوق یافت نشد.', 'REGISTER_NOT_FOUND');
    if (register.is_active !== 1) throw badRequest('این صندوق غیرفعال است.', 'REGISTER_INACTIVE');

    if (this.findOpenSession(input.registerId)) {
      throw conflict('این صندوق از قبل یک جلسه باز دارد.', 'CASH_SESSION_ALREADY_OPEN');
    }

    const id = randomUUID();
    this.database.run(
      `INSERT INTO cash_sessions (id, cash_register_id, opened_by_user_id, opening_float, status)
       VALUES (?, ?, ?, ?, 'open')`,
      [id, input.registerId, actor.userId, input.openingFloat],
    );

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'cash_session.opened',
      entityType: 'cash_session',
      entityId: id,
      after: { registerId: input.registerId, openingFloat: input.openingFloat },
    });

    const created = this.findSession(id);
    if (!created) throw notFound('جلسه صندوق ایجاد نشد.', 'CASH_SESSION_NOT_CREATED');
    return this.toRow(created);
  }

  close(id: string, input: CloseCashSessionInput, actor: ActingUser): CashSessionRow {
    const session = this.findSession(id);
    if (!session) throw notFound('جلسه صندوق یافت نشد.', 'CASH_SESSION_NOT_FOUND');
    if (session.status === 'closed') {
      throw conflict('این جلسه قبلاً بسته شده است.', 'CASH_SESSION_CLOSED');
    }

    const closedAt = new Date().toISOString();
    const totals = this.totals(session.opened_at, closedAt);
    const expected = session.opening_float + totals.cash_total;
    const difference = input.closingAmount - expected;

    this.database.run(
      `UPDATE cash_sessions
          SET status = 'closed', closed_at = ?, closing_amount = ?, expected_amount = ?, difference = ?
        WHERE id = ? AND status = 'open'`,
      [closedAt, input.closingAmount, expected, difference, id],
    );

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'cash_session.closed',
      entityType: 'cash_session',
      entityId: id,
      before: { status: 'open', openingFloat: session.opening_float },
      after: {
        status: 'closed',
        expectedAmount: expected,
        closingAmount: input.closingAmount,
        difference,
        cashTotal: totals.cash_total,
        cardTotal: totals.card_total,
      },
    });

    const closed = this.findSession(id);
    if (!closed) throw notFound('جلسه صندوق یافت نشد.', 'CASH_SESSION_NOT_FOUND');
    return this.toRow(closed);
  }

  /* ------------------------------- expenses ------------------------------ */

  private expenseRows(fromIso?: string, toIso?: string, limit = 40): ExpenseRow[] {
    const rows = this.database.all<{
      id: string;
      category: ExpenseCategory;
      amount: number;
      description: string | null;
      spent_at: string;
      created_by_name: string | null;
    }>(
      `SELECT e.id, e.category, e.amount, e.description, e.spent_at, u.full_name AS created_by_name
         FROM expenses e
         LEFT JOIN users u ON u.id = e.created_by_user_id
        WHERE (? IS NULL OR (e.spent_at >= ? AND e.spent_at < ?))
        ORDER BY e.spent_at DESC
        LIMIT ?`,
      [fromIso ?? null, fromIso ?? null, toIso ?? null, limit],
    );

    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      categoryLabelFa: EXPENSE_CATEGORY_LABELS_FA[row.category] ?? row.category,
      amount: row.amount,
      description: row.description,
      spentAt: row.spent_at,
      createdByName: row.created_by_name,
    }));
  }

  expenses(limit: number): { items: ExpenseRow[] } {
    return { items: this.expenseRows(undefined, undefined, limit) };
  }

  createExpense(input: CreateExpenseInput, actor: ActingUser): ExpenseRow {
    const id = randomUUID();
    const spentAt = input.spentAt ? new Date(input.spentAt).toISOString() : new Date().toISOString();

    this.database.run(
      `INSERT INTO expenses (id, category, amount, description, spent_at, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.category, input.amount, input.description ?? null, spentAt, actor.userId],
    );

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'finance.expense_recorded',
      entityType: 'expense',
      entityId: id,
      after: { category: input.category, amount: input.amount, spentAt },
    });

    return {
      id,
      category: input.category,
      categoryLabelFa: EXPENSE_CATEGORY_LABELS_FA[input.category],
      amount: input.amount,
      description: input.description ?? null,
      spentAt,
      createdByName: actor.username,
    };
  }

  /**
   * Revenue, expenses and profit for a Tehran calendar range.
   *
   * Revenue is the confirmed payment ledger minus refunds; expenses come from
   * the expense ledger. Nothing is derived from client input.
   */
  summary(from?: string, to?: string): FinanceSummaryResponse {
    const range = resolveDayRange(from, to, 29);
    const params = [range.startIso, range.endIso];

    const revenueRow = this.database.get<{ confirmed: number; refunded: number }>(
      `SELECT COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount ELSE 0 END), 0) AS confirmed,
              COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount ELSE 0 END), 0) AS refunded
         FROM payments
        WHERE paid_at >= ? AND paid_at < ?`,
      params,
    );
    const expenseRow = this.database.get<{ total: number }>(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE spent_at >= ? AND spent_at < ?',
      params,
    );

    const revenue = revenueRow?.confirmed ?? 0;
    const refunds = revenueRow?.refunded ?? 0;
    const netRevenue = revenue - refunds;
    const expenses = expenseRow?.total ?? 0;
    const profit = netRevenue - expenses;

    const byCategory = this.database
      .all<{ category: ExpenseCategory; total: number }>(
        `SELECT category, COALESCE(SUM(amount), 0) AS total
           FROM expenses
          WHERE spent_at >= ? AND spent_at < ?
          GROUP BY category
          ORDER BY total DESC`,
        params,
      )
      .map((row) => ({
        category: row.category,
        labelFa: EXPENSE_CATEGORY_LABELS_FA[row.category] ?? row.category,
        total: row.total,
      }));

    const revenueDaily = new Map(
      this.database
        .all<{ date: string; total: number }>(
          `SELECT date(paid_at, '+210 minutes') AS date,
                  COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount WHEN status = 'refunded' THEN -amount ELSE 0 END), 0) AS total
             FROM payments
            WHERE paid_at >= ? AND paid_at < ?
            GROUP BY date`,
          params,
        )
        .map((row) => [row.date, row.total]),
    );
    const expenseDaily = new Map(
      this.database
        .all<{ date: string; total: number }>(
          `SELECT date(spent_at, '+210 minutes') AS date, COALESCE(SUM(amount), 0) AS total
             FROM expenses
            WHERE spent_at >= ? AND spent_at < ?
            GROUP BY date`,
          params,
        )
        .map((row) => [row.date, row.total]),
    );

    const dates = [...new Set([...revenueDaily.keys(), ...expenseDaily.keys()])].sort();
    const daily = dates.map((date) => {
      const dayRevenue = revenueDaily.get(date) ?? 0;
      const dayExpenses = expenseDaily.get(date) ?? 0;
      return { date, revenue: dayRevenue, expenses: dayExpenses, profit: dayRevenue - dayExpenses };
    });

    return {
      from: range.from,
      to: range.to,
      revenue,
      refunds,
      netRevenue,
      expenses,
      profit,
      marginPercent: netRevenue > 0 ? Math.round((profit / netRevenue) * 1000) / 10 : 0,
      expensesByCategory: byCategory,
      daily,
      expensesList: this.expenseRows(range.startIso, range.endIso, 60),
    };
  }
}
