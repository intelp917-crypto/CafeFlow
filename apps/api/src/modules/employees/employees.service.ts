import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  EMPLOYEE_STATUS_LABELS_FA,
  SHIFT_STATUS_LABELS_FA,
  type CreateEmployeeInput,
  type CreateShiftInput,
  type EmployeeRow,
  type EmployeesResponse,
  type ShiftRow,
  type ShiftsResponse,
  type StaffPerformanceResponse,
  type UpdateEmployeeInput,
} from '@cafeflow/shared';
import { DayRange, resolveDayRange } from '../../common/date-range';
import { badRequest, conflict, notFound } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { EmployeesRepository, type EmployeeDbRow, type ShiftDbRow } from './employees.repository';

export interface ActingUser {
  userId: string;
  username: string;
}

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const hoursBetween = (fromIso: string, toIso: string): number =>
  Math.max(0, round((Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000));

/**
 * Employee profiles, shift scheduling and attendance.
 *
 * Shifts never overlap for the same employee; the check is done in SQL so two
 * concurrent requests cannot both pass. Attendance is recorded as timestamps on
 * the shift row, and performance is aggregated from those timestamps plus the
 * real order and payment ledgers — never from client-supplied figures.
 */
@Injectable()
export class EmployeesService {
  constructor(
    @Inject(EmployeesRepository) private readonly repository: EmployeesRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private toEmployee(row: EmployeeDbRow): EmployeeRow {
    return {
      id: row.id,
      userId: row.user_id,
      fullName: row.full_name,
      username: row.username,
      employeeCode: row.employee_code,
      departmentId: row.department_id,
      departmentNameFa: row.department_name_fa,
      floorId: row.floor_id,
      floorNameFa: row.floor_name_fa,
      positionFa: row.position_fa,
      hiredAt: row.hired_at,
      status: row.status,
      statusLabelFa: EMPLOYEE_STATUS_LABELS_FA[row.status] ?? row.status,
      isUserActive: row.is_user_active === 1,
      shiftsThisWeek: row.shifts_this_week,
    };
  }

  private toShift(row: ShiftDbRow): ShiftRow {
    const worked =
      row.checked_in_at && row.checked_out_at ? hoursBetween(row.checked_in_at, row.checked_out_at) : 0;
    return {
      id: row.id,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      departmentNameFa: row.department_name_fa,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      durationHours: hoursBetween(row.starts_at, row.ends_at),
      status: row.status,
      statusLabelFa: SHIFT_STATUS_LABELS_FA[row.status] ?? row.status,
      note: row.note,
      checkedInAt: row.checked_in_at,
      checkedOutAt: row.checked_out_at,
      workedHours: worked,
    };
  }

  employees(): EmployeesResponse {
    const now = new Date();
    const weekStart = now.toISOString();
    const weekEnd = new Date(now.getTime() + 7 * 24 * 3_600_000).toISOString();
    const items = this.repository.employees(weekStart, weekEnd).map((row) => this.toEmployee(row));

    return {
      items,
      summary: {
        total: items.length,
        active: items.filter((item) => item.status === 'active').length,
        onLeave: items.filter((item) => item.status === 'on_leave').length,
      },
      candidates: this.repository.candidates().map((row) => ({
        id: row.id,
        fullName: row.full_name,
        username: row.username,
      })),
      departments: this.repository.departments().map((row) => ({ id: row.id, nameFa: row.name_fa })),
      floors: this.repository.floors().map((row) => ({ id: row.id, nameFa: row.name_fa })),
    };
  }

  create(input: CreateEmployeeInput, actor: ActingUser): EmployeeRow {
    if (!this.repository.userExists(input.userId)) {
      throw notFound('کاربر انتخاب‌شده یافت نشد.', 'USER_NOT_FOUND');
    }
    if (this.repository.findByUser(input.userId)) {
      throw conflict('برای این کاربر قبلاً پروفایل کارمند ساخته شده است.', 'EMPLOYEE_EXISTS');
    }
    if (input.employeeCode && this.repository.employeeCodeTaken(input.employeeCode)) {
      throw conflict('این کد پرسنلی قبلاً ثبت شده است.', 'EMPLOYEE_CODE_TAKEN');
    }

    const id = randomUUID();
    this.repository.insertEmployee({
      id,
      userId: input.userId,
      employeeCode: input.employeeCode ?? null,
      departmentId: input.departmentId ?? null,
      floorId: input.floorId ?? null,
      positionFa: input.positionFa ?? null,
      hiredAt: input.hiredAt ?? null,
      status: input.status,
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'employee.created',
      entityType: 'employee',
      entityId: id,
      after: { userId: input.userId, positionFa: input.positionFa ?? null, status: input.status },
    });

    const created = this.repository.findEmployee(id);
    if (!created) throw notFound('پروفایل کارمند ساخته نشد.', 'EMPLOYEE_NOT_CREATED');
    return this.toEmployee(created);
  }

  update(id: string, input: UpdateEmployeeInput, actor: ActingUser): EmployeeRow {
    const before = this.repository.findEmployee(id);
    if (!before) throw notFound('کارمند یافت نشد.', 'EMPLOYEE_NOT_FOUND');

    if (input.employeeCode && this.repository.employeeCodeTaken(input.employeeCode, id)) {
      throw conflict('این کد پرسنلی قبلاً ثبت شده است.', 'EMPLOYEE_CODE_TAKEN');
    }

    this.repository.updateEmployee(id, input);

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'employee.updated',
      entityType: 'employee',
      entityId: id,
      before: {
        status: before.status,
        positionFa: before.position_fa,
        departmentId: before.department_id,
        employeeCode: before.employee_code,
      },
      after: input,
    });

    const updated = this.repository.findEmployee(id);
    if (!updated) throw notFound('کارمند یافت نشد.', 'EMPLOYEE_NOT_FOUND');
    return this.toEmployee(updated);
  }

  shifts(from?: string, to?: string): ShiftsResponse {
    const range: DayRange = resolveDayRange(from, to, 14);
    const items = this.repository.shifts(range.startIso, range.endIso).map((row) => this.toShift(row));

    return {
      from: range.from,
      to: range.to,
      items,
      summary: {
        scheduled: items.filter((item) => item.status === 'scheduled').length,
        completed: items.filter((item) => item.status === 'completed').length,
        hours: round(items.reduce((sum, item) => sum + item.durationHours, 0)),
      },
    };
  }

  createShift(input: CreateShiftInput, actor: ActingUser): ShiftRow {
    const employee = this.repository.findEmployee(input.employeeId);
    if (!employee) throw notFound('کارمند یافت نشد.', 'EMPLOYEE_NOT_FOUND');
    if (employee.status === 'inactive') {
      throw badRequest('برای کارمند غیرفعال نمی‌توان شیفت ثبت کرد.', 'EMPLOYEE_INACTIVE');
    }

    const startsAt = new Date(input.startsAt).toISOString();
    const endsAt = new Date(input.endsAt).toISOString();

    if (this.repository.overlappingShift(input.employeeId, startsAt, endsAt)) {
      throw conflict('این کارمند در این بازه شیفت دیگری دارد.', 'SHIFT_CONFLICT');
    }

    const id = randomUUID();
    this.repository.insertShift({
      id,
      employeeId: input.employeeId,
      startsAt,
      endsAt,
      note: input.note ?? null,
      createdByUserId: actor.userId,
    });

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'shift.created',
      entityType: 'shift',
      entityId: id,
      after: { employeeId: input.employeeId, startsAt, endsAt },
    });

    const created = this.repository.findShift(id);
    if (!created) throw notFound('شیفت ثبت نشد.', 'SHIFT_NOT_CREATED');
    return this.toShift(created);
  }

  checkIn(id: string, actor: ActingUser): ShiftRow {
    const shift = this.repository.findShift(id);
    if (!shift) throw notFound('شیفت یافت نشد.', 'SHIFT_NOT_FOUND');
    if (shift.status === 'cancelled') throw badRequest('شیفت لغو‌شده قابل ثبت حضور نیست.', 'SHIFT_CANCELLED');
    if (shift.checked_in_at) throw conflict('حضور این شیفت قبلاً ثبت شده است.', 'SHIFT_ALREADY_CHECKED_IN');

    this.repository.checkIn(id, new Date().toISOString());

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'shift.checked_in',
      entityType: 'shift',
      entityId: id,
    });

    const updated = this.repository.findShift(id);
    if (!updated) throw notFound('شیفت یافت نشد.', 'SHIFT_NOT_FOUND');
    return this.toShift(updated);
  }

  checkOut(id: string, actor: ActingUser): ShiftRow {
    const shift = this.repository.findShift(id);
    if (!shift) throw notFound('شیفت یافت نشد.', 'SHIFT_NOT_FOUND');
    if (!shift.checked_in_at) throw badRequest('ابتدا حضور را ثبت کنید.', 'SHIFT_NOT_CHECKED_IN');
    if (shift.checked_out_at) throw conflict('خروج این شیفت قبلاً ثبت شده است.', 'SHIFT_ALREADY_CHECKED_OUT');

    this.repository.checkOut(id, new Date().toISOString());

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'shift.checked_out',
      entityType: 'shift',
      entityId: id,
    });

    const updated = this.repository.findShift(id);
    if (!updated) throw notFound('شیفت یافت نشد.', 'SHIFT_NOT_FOUND');
    return this.toShift(updated);
  }

  cancelShift(id: string, actor: ActingUser): ShiftRow {
    const shift = this.repository.findShift(id);
    if (!shift) throw notFound('شیفت یافت نشد.', 'SHIFT_NOT_FOUND');
    if (shift.status !== 'scheduled') {
      throw badRequest('فقط شیفت برنامه‌ریزی‌شده قابل لغو است.', 'SHIFT_NOT_CANCELLABLE');
    }

    this.repository.cancelShift(id);

    this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action: 'shift.cancelled',
      entityType: 'shift',
      entityId: id,
      before: { status: shift.status },
    });

    const updated = this.repository.findShift(id);
    if (!updated) throw notFound('شیفت یافت نشد.', 'SHIFT_NOT_FOUND');
    return this.toShift(updated);
  }

  performance(from?: string, to?: string): StaffPerformanceResponse {
    const range = resolveDayRange(from, to, 0);
    const shifts = new Map(this.repository.shiftStats(range.startIso, range.endIso).map((row) => [row.employee_id, row]));
    const orders = new Map(this.repository.orderStats(range.startIso, range.endIso).map((row) => [row.user_id, row.orders]));
    const revenue = new Map(this.repository.revenueStats(range.startIso, range.endIso).map((row) => [row.user_id, row]));

    const items = this.repository.performanceEmployees().map((employee) => {
      const shift = shifts.get(employee.employee_id);
      const sale = revenue.get(employee.user_id);
      return {
        employeeId: employee.employee_id,
        fullName: employee.full_name,
        positionFa: employee.position_fa,
        departmentNameFa: employee.department_name_fa,
        shifts: shift?.shifts ?? 0,
        scheduledHours: round(shift?.scheduled_hours ?? 0),
        workedHours: round(shift?.worked_hours ?? 0),
        ordersServed: orders.get(employee.user_id) ?? 0,
        paymentsCount: sale?.count ?? 0,
        revenue: sale?.total ?? 0,
      };
    });

    return {
      from: range.from,
      to: range.to,
      items,
      totals: {
        workedHours: round(items.reduce((sum, item) => sum + item.workedHours, 0)),
        ordersServed: items.reduce((sum, item) => sum + item.ordersServed, 0),
        revenue: items.reduce((sum, item) => sum + item.revenue, 0),
      },
    };
  }
}
