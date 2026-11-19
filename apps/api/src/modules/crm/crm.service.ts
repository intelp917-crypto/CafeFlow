import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  LOYALTY_TIER_LABELS_FA,
  normalizePhone,
  tierForPoints,
  type AdjustLoyaltyInput,
  type CreateCustomerInput,
  type CustomerDetail,
  type CustomerRow,
  type CustomersResponse,
  type LoyaltyLedgerEntry,
  type LoyaltyTier,
} from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';
import { AuditService } from '../audit/audit.service';
import { badRequest, conflict, notFound } from '../../common/errors';

export interface ActingUser {
  userId: string;
  username: string;
}

interface CustomerDbRow {
  id: string;
  name: string | null;
  phone: string;
  birth_date: string | null;
  notes: string | null;
  consent_marketing: number;
  created_at: string;
  points: number;
  tier: LoyaltyTier;
  wallet_balance: number;
}

const CUSTOMER_SELECT = `
  SELECT c.id, c.name, c.phone, c.birth_date, c.notes, c.consent_marketing, c.created_at,
         COALESCE(l.points, 0) AS points,
         COALESCE(l.tier, 'regular') AS tier,
         COALESCE(l.wallet_balance, 0) AS wallet_balance
    FROM customers c
    LEFT JOIN loyalty_accounts l ON l.customer_id = c.id`;

/**
 * Customer club (optional CRM module, OFF by default).
 *
 * Phone numbers are normalised to Latin digits before storage, so a number
 * typed with Persian digits cannot create a duplicate profile. Points and
 * wallet balances change only through the ledger-backed adjustment endpoint.
 */
@Injectable()
export class CrmService {
  constructor(
    @Inject(DB_SERVICE) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private toRow(row: CustomerDbRow): CustomerRow {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      birthDate: row.birth_date,
      notes: row.notes,
      consentMarketing: row.consent_marketing === 1,
      points: row.points,
      tier: row.tier,
      tierLabelFa: LOYALTY_TIER_LABELS_FA[row.tier] ?? row.tier,
      walletBalance: row.wallet_balance,
      createdAt: row.created_at,
    };
  }

  list(query: string | undefined, limit: number): CustomersResponse {
    const term = (query ?? '').trim();
    const like = `%${term}%`;
    const rows = this.database.all<CustomerDbRow>(
      `${CUSTOMER_SELECT}
        WHERE c.deleted_at IS NULL
          AND (? = '' OR c.name LIKE ? OR c.phone LIKE ?)
        ORDER BY c.created_at DESC
        LIMIT ?`,
      [term, like, like, limit],
    );

    return { items: rows.map((row) => this.toRow(row)), total: rows.length };
  }

  private findRow(id: string): CustomerDbRow | undefined {
    return this.database.get<CustomerDbRow>(`${CUSTOMER_SELECT} WHERE c.id = ? AND c.deleted_at IS NULL`, [id]);
  }

  detail(id: string): CustomerDetail {
    const row = this.findRow(id);
    if (!row) throw notFound('مشتری یافت نشد.', 'CUSTOMER_NOT_FOUND');

    const ledger = this.database.all<{ id: string; kind: 'points' | 'wallet'; delta: number; reason: string; created_at: string }>(
      `SELECT id, 'points' AS kind, delta, reason, created_at FROM loyalty_ledger WHERE customer_id = ?
       UNION ALL
       SELECT id, 'wallet' AS kind, delta, reason, created_at FROM wallet_ledger WHERE customer_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [id, id],
    );

    const entries: LoyaltyLedgerEntry[] = ledger.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      delta: entry.delta,
      reason: entry.reason,
      createdAt: entry.created_at,
    }));

    return { ...this.toRow(row), ledger: entries };
  }

  create(input: CreateCustomerInput, actor: ActingUser): CustomerRow {
    const phone = normalizePhone(input.phone);
    const existing = this.database.get<{ id: string }>(
      'SELECT id FROM customers WHERE phone = ? AND deleted_at IS NULL',
      [phone],
    );
    if (existing) {
      throw conflict('مشتری با این شماره تماس قبلاً ثبت شده است.', 'CUSTOMER_EXISTS', { customerId: existing.id });
    }

    const id = randomUUID();
    this.database.transaction(() => {
      this.database.run(
        `INSERT INTO customers (id, name, phone, birth_date, notes, consent_marketing)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.name ?? null,
          phone,
          input.birthDate ?? null,
          input.notes ?? null,
          input.consentMarketing ? 1 : 0,
        ],
      );
      this.database.run('INSERT INTO loyalty_accounts (customer_id, points, tier, wallet_balance) VALUES (?, 0, ?, 0)', [
        id,
        'regular',
      ]);
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'crm.customer_created',
      entityType: 'customer',
      entityId: id,
      after: { phone, name: input.name ?? null, consentMarketing: input.consentMarketing },
    });

    const created = this.findRow(id);
    if (!created) throw notFound('مشتری ثبت نشد.', 'CUSTOMER_NOT_CREATED');
    return this.toRow(created);
  }

  adjust(id: string, input: AdjustLoyaltyInput, actor: ActingUser): CustomerDetail {
    const customer = this.findRow(id);
    if (!customer) throw notFound('مشتری یافت نشد.', 'CUSTOMER_NOT_FOUND');

    const pointsDelta = input.points ?? 0;
    const walletDelta = input.wallet ?? 0;
    const nextPoints = customer.points + pointsDelta;
    const nextWallet = customer.wallet_balance + walletDelta;

    if (nextPoints < 0) {
      throw badRequest('امتیاز مشتری نمی‌تواند منفی شود.', 'INSUFFICIENT_POINTS', {
        current: customer.points,
        delta: pointsDelta,
      });
    }
    if (nextWallet < 0) {
      throw badRequest('موجودی کیف پول مشتری کافی نیست.', 'INSUFFICIENT_WALLET', {
        current: customer.wallet_balance,
        delta: walletDelta,
      });
    }

    const tier = tierForPoints(nextPoints);

    this.database.transaction(() => {
      this.database.run(
        `UPDATE loyalty_accounts SET points = ?, tier = ?, wallet_balance = ?, updated_at = ? WHERE customer_id = ?`,
        [nextPoints, tier, nextWallet, new Date().toISOString(), id],
      );

      if (pointsDelta !== 0) {
        this.database.run(
          'INSERT INTO loyalty_ledger (id, customer_id, delta, reason) VALUES (?, ?, ?, ?)',
          [randomUUID(), id, pointsDelta, input.reason],
        );
      }
      if (walletDelta !== 0) {
        this.database.run('INSERT INTO wallet_ledger (id, customer_id, delta, reason) VALUES (?, ?, ?, ?)', [
          randomUUID(),
          id,
          walletDelta,
          input.reason,
        ]);
      }
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'crm.loyalty_adjusted',
      entityType: 'customer',
      entityId: id,
      before: { points: customer.points, walletBalance: customer.wallet_balance, tier: customer.tier },
      after: { points: nextPoints, walletBalance: nextWallet, tier, reason: input.reason },
    });

    return this.detail(id);
  }
}
