import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  EmployeeRow,
  EmployeeStatus,
  ShiftRow,
  ShiftStatus,
  StaffPerformanceRow,
} from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';

interface EmployeeDbRow {
  id: string;
  user_id: string;
  full_name: string;
  username: string;
  is_user_active: number;
  employee_code: string | null;
  department_id: string | null;
  department_name_fa: string | null;
  floor_id: string | null;
  floor_name_fa: string | null;
  position_fa: string | null;
  hired_at: string | null;
  status: EmployeeStatus;
  shifts_this_week: number;
}

interface ShiftDbRow {
  id: string;
  employee_id: string;
  employee_name: string;
  department_name_fa: string | null;
  starts_at: string;
  ends_at: string;
  status: ShiftStatus;
  note: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
}

const EMPLOYEE_SELECT = `
  SELECT e.id, e.user_id, u.full_name, u.username, u.is_active AS is_user_active,
         e.employee_code, e.department_id, d.name_fa AS department_name_fa,
         e.floor_id, f.name_fa AS floor_name_fa, e.position_fa, e.hired_at, e.status,
         (SELECT COUNT(*) FROM shifts s
           WHERE s.employee_id = e.id AND s.status <> 'cancelled'
             AND s.starts_at >= ? AND s.starts_at < ?) AS shifts_this_week
    FROM employees e
    JOIN users u ON u.id = e.user_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN floors f ON f.id = e.floor_id`;

/** Data access for employee profiles, shifts and attendance. */
@Injectable()
export class EmployeesRepository {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  employees(weekStart: string, weekEnd: string): EmployeeDbRow[] {
    return this.database.all<EmployeeDbRow>(
      `${EMPLOYEE_SELECT}
        WHERE u.deleted_at IS NULL
        ORDER BY CASE e.status WHEN 'active' THEN 0 WHEN 'on_leave' THEN 1 ELSE 2 END, u.full_name ASC`,
      [weekStart, weekEnd],
    );
  }

  findEmployee(id: string): EmployeeDbRow | undefined {
    const now = Date.now();
    const weekStart = new Date(now).toISOString();
    const weekEnd = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    return this.database.get<EmployeeDbRow>(`${EMPLOYEE_SELECT} WHERE e.id = ?`, [weekStart, weekEnd, id]);
  }

  findByUser(userId: string): { id: string } | undefined {
    return this.database.get<{ id: string }>('SELECT id FROM employees WHERE user_id = ?', [userId]);
  }

  candidates(): Array<{ id: string; full_name: string; username: string }> {
    return this.database.all<{ id: string; full_name: string; username: string }>(
      `SELECT u.id, u.full_name, u.username
         FROM users u
         LEFT JOIN employees e ON e.user_id = u.id
        WHERE u.deleted_at IS NULL AND e.id IS NULL
        ORDER BY u.full_name ASC`,
    );
  }

  departments(): Array<{ id: string; name_fa: string }> {
    return this.database.all<{ id: string; name_fa: string }>('SELECT id, name_fa FROM departments ORDER BY name_fa ASC');
  }

  floors(): Array<{ id: string; name_fa: string }> {
    return this.database.all<{ id: string; name_fa: string }>('SELECT id, name_fa FROM floors ORDER BY sort_order ASC');
  }

  userExists(userId: string): boolean {
    return (
      this.database.count('SELECT COUNT(*) AS n FROM users WHERE id = ? AND deleted_at IS NULL', [userId]) > 0
    );
  }

  employeeCodeTaken(code: string, exceptId?: string): boolean {
    const row = this.database.get<{ id: string }>('SELECT id FROM employees WHERE employee_code = ?', [code]);
    return Boolean(row && row.id !== exceptId);
  }

  insertEmployee(input: {
    id: string;
    userId: string;
    employeeCode: string | null;
    departmentId: string | null;
    floorId: string | null;
    positionFa: string | null;
    hiredAt: string | null;
    status: EmployeeStatus;
  }): void {
    this.database.run(
      `INSERT INTO employees (id, user_id, employee_code, department_id, floor_id, position_fa, hired_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.userId,
        input.employeeCode,
        input.departmentId,
        input.floorId,
        input.positionFa,
        input.hiredAt,
        input.status,
      ],
    );
  }

  updateEmployee(
    id: string,
    input: {
      employeeCode?: string | null;
      departmentId?: string | null;
      floorId?: string | null;
      positionFa?: string | null;
      hiredAt?: string | null;
      status?: EmployeeStatus;
    },
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (column: string, value: unknown) => {
      sets.push(`${column} = ?`);
      params.push(value ?? null);
    };

    if (input.employeeCode !== undefined) push('employee_code', input.employeeCode);
    if (input.departmentId !== undefined) push('department_id', input.departmentId);
    if (input.floorId !== undefined) push('floor_id', input.floorId);
    if (input.positionFa !== undefined) push('position_fa', input.positionFa);
    if (input.hiredAt !== undefined) push('hired_at', input.hiredAt);
    if (input.status !== undefined) push('status', input.status);

    if (sets.length === 0) return;
    params.push(id);
    this.database.run(`UPDATE employees SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  shifts(fromIso: string, toIso: string): ShiftDbRow[] {
    return this.database.all<ShiftDbRow>(
      `SELECT s.id, s.employee_id, u.full_name AS employee_name, d.name_fa AS department_name_fa,
              s.starts_at, s.ends_at, s.status, s.note, s.checked_in_at, s.checked_out_at
         FROM shifts s
         JOIN employees e ON e.id = s.employee_id
         JOIN users u ON u.id = e.user_id
         LEFT JOIN departments d ON d.id = e.department_id
        WHERE s.starts_at >= ? AND s.starts_at < ?
        ORDER BY s.starts_at ASC`,
      [fromIso, toIso],
    );
  }

  findShift(id: string): ShiftDbRow | undefined {
    return this.database.get<ShiftDbRow>(
      `SELECT s.id, s.employee_id, u.full_name AS employee_name, d.name_fa AS department_name_fa,
              s.starts_at, s.ends_at, s.status, s.note, s.checked_in_at, s.checked_out_at
         FROM shifts s
         JOIN employees e ON e.id = s.employee_id
         JOIN users u ON u.id = e.user_id
         LEFT JOIN departments d ON d.id = e.department_id
        WHERE s.id = ?`,
      [id],
    );
  }

  overlappingShift(employeeId: string, startsAt: string, endsAt: string): { id: string } | undefined {
    return this.database.get<{ id: string }>(
      `SELECT id FROM shifts
        WHERE employee_id = ? AND status <> 'cancelled'
          AND starts_at < ? AND ends_at > ?
        LIMIT 1`,
      [employeeId, endsAt, startsAt],
    );
  }

  insertShift(input: {
    id: string;
    employeeId: string;
    startsAt: string;
    endsAt: string;
    note: string | null;
    createdByUserId: string;
  }): void {
    this.database.run(
      `INSERT INTO shifts (id, employee_id, starts_at, ends_at, note, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.id, input.employeeId, input.startsAt, input.endsAt, input.note, input.createdByUserId],
    );
  }

  checkIn(id: string, atIso: string): void {
    this.database.run('UPDATE shifts SET checked_in_at = ? WHERE id = ?', [atIso, id]);
  }

  checkOut(id: string, atIso: string): void {
    this.database.run("UPDATE shifts SET checked_out_at = ?, status = 'completed' WHERE id = ?", [atIso, id]);
  }

  cancelShift(id: string): void {
    this.database.run("UPDATE shifts SET status = 'cancelled' WHERE id = ?", [id]);
  }

  shiftStats(fromIso: string, toIso: string): Array<{
    employee_id: string;
    shifts: number;
    scheduled_hours: number;
    worked_hours: number;
  }> {
    return this.database.all<{
      employee_id: string;
      shifts: number;
      scheduled_hours: number;
      worked_hours: number;
    }>(
      `SELECT employee_id,
              COUNT(*) AS shifts,
              COALESCE(SUM((julianday(ends_at) - julianday(starts_at)) * 24), 0) AS scheduled_hours,
              COALESCE(SUM(CASE WHEN checked_in_at IS NOT NULL AND checked_out_at IS NOT NULL
                                THEN (julianday(checked_out_at) - julianday(checked_in_at)) * 24
                                ELSE 0 END), 0) AS worked_hours
         FROM shifts
        WHERE status <> 'cancelled' AND starts_at >= ? AND starts_at < ?
        GROUP BY employee_id`,
      [fromIso, toIso],
    );
  }

  /** Paid orders per staff member, attributed by waiter or creator. */
  orderStats(fromIso: string, toIso: string): Array<{ user_id: string; orders: number }> {
    return this.database.all<{ user_id: string; orders: number }>(
      `SELECT user_id, COUNT(DISTINCT id) AS orders
         FROM (
           SELECT id, waiter_user_id AS user_id FROM orders
            WHERE status = 'paid' AND paid_at >= ? AND paid_at < ? AND waiter_user_id IS NOT NULL
           UNION ALL
           SELECT id, created_by_user_id AS user_id FROM orders
            WHERE status = 'paid' AND paid_at >= ? AND paid_at < ? AND created_by_user_id IS NOT NULL
         )
        GROUP BY user_id`,
      [fromIso, toIso, fromIso, toIso],
    );
  }

  /** Net collected revenue per staff member, from the payment ledger. */
  revenueStats(fromIso: string, toIso: string): Array<{ user_id: string; total: number; count: number }> {
    return this.database.all<{ user_id: string; total: number; count: number }>(
      `SELECT received_by_user_id AS user_id,
              COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount WHEN status = 'refunded' THEN -amount ELSE 0 END), 0) AS total,
              COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) AS count
         FROM payments
        WHERE paid_at >= ? AND paid_at < ? AND received_by_user_id IS NOT NULL
        GROUP BY received_by_user_id`,
      [fromIso, toIso],
    );
  }

  performanceEmployees(): Array<{
    employee_id: string;
    user_id: string;
    full_name: string;
    position_fa: string | null;
    department_name_fa: string | null;
  }> {
    return this.database.all(
      `SELECT e.id AS employee_id, e.user_id, u.full_name, e.position_fa, d.name_fa AS department_name_fa
         FROM employees e
         JOIN users u ON u.id = e.user_id
         LEFT JOIN departments d ON d.id = e.department_id
        WHERE u.deleted_at IS NULL
        ORDER BY u.full_name ASC`,
    );
  }

  nextEmployeeId(): string {
    return randomUUID();
  }
}

export type { EmployeeDbRow, ShiftDbRow };
export type { EmployeeRow, ShiftRow, StaffPerformanceRow };
