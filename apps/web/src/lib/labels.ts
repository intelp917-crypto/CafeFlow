import {
  ORDER_STATUS_LABELS_FA,
  PREP_STATUS_LABELS_FA,
  SERVICE_REQUEST_STATUS_LABELS_FA,
  TABLE_STATUS_LABELS_FA,
  type OrderStatus,
  type PrepStatus,
} from '@cafeflow/shared';

export function auditActionFa(action: string): string {
  const map: Record<string, string> = {
    'auth.login_success': 'ورود موفق',
    'auth.login_failed': 'تلاش ناموفق ورود',
    'auth.logout': 'خروج از حساب',
    'auth.password_changed': 'تغییر گذرواژه',
    'auth.session_revoked': 'بستن نشست',
    'settings.updated': 'تغییر تنظیمات',
    'catalog.category.create': 'افزودن دستهٔ منو',
    'catalog.category.update': 'ویرایش دستهٔ منو',
    'catalog.category.delete': 'حذف دستهٔ منو',
    'catalog.product.create': 'افزودن محصول',
    'catalog.product.update': 'ویرایش محصول',
    'catalog.product.options': 'تغییر گزینه‌های محصول',
    'module.enabled': 'فعال‌سازی ماژول',
    'module.disabled': 'غیرفعال‌سازی ماژول',
    'approval.requested': 'ثبت درخواست تأیید',
    'approval.approved': 'تأیید درخواست',
    'approval.rejected': 'رد درخواست',
    'system.seed': 'نصب اولیه سیستم',
  };
  return map[action] ?? action;
}

export function entityLabelFa(entity: string): string {
  const map: Record<string, string> = {
    user: 'کاربر',
    session: 'نشست',
    settings: 'تنظیمات',
    module: 'ماژول',
    approval_request: 'درخواست تأیید',
    product: 'محصول',
    category: 'دستهٔ منو',
    order: 'سفارش',
    system: 'سیستم',
  };
  return map[entity] ?? entity;
}

export function orderStatusFa(status: string): string {
  return ORDER_STATUS_LABELS_FA[status as OrderStatus] ?? status;
}

export function orderStatusTone(status: string): 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'paid':
      return 'success';
    case 'cancelled':
      return 'danger';
    case 'preparing':
    case 'partially_ready':
      return 'warning';
    case 'ready':
    case 'served':
      return 'info';
    case 'awaiting_payment':
      return 'brand';
    default:
      return 'neutral';
  }
}

export function prepStatusFa(status: string): string {
  return PREP_STATUS_LABELS_FA[status as PrepStatus] ?? status;
}

export function prepStatusTone(status: string): 'neutral' | 'brand' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'ready':
      return 'success';
    case 'in_progress':
      return 'brand';
    case 'delayed':
      return 'danger';
    case 'cancelled':
      return 'neutral';
    default:
      return 'warning';
  }
}

export function tableStatusFa(status: string): string {
  return TABLE_STATUS_LABELS_FA[status] ?? status;
}

export function tableStatusTone(status: string): 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'available':
      return 'success';
    case 'occupied':
      return 'brand';
    case 'waiting_payment':
      return 'warning';
    case 'waiting_service':
      return 'info';
    case 'reserved':
      return 'info';
    default:
      return 'neutral';
  }
}

export function requestStatusFa(status: string): string {
  return SERVICE_REQUEST_STATUS_LABELS_FA[status] ?? status;
}

export function requestStatusTone(status: string): 'neutral' | 'brand' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'done':
      return 'success';
    case 'accepted':
      return 'brand';
    case 'cancelled':
      return 'neutral';
    default:
      return 'warning';
  }
}

export function approvalStatusFa(status: string): string {
  const map: Record<string, string> = {
    pending: 'در انتظار تصمیم',
    approved: 'تأیید شده',
    rejected: 'رد شده',
    cancelled: 'لغو شده',
  };
  return map[status] ?? status;
}
