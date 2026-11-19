import type { ModuleKey } from '@cafeflow/shared';

export type {
  StaffOrderSummary,
  StaffOrderDetail,
  StaffOrderItem,
  StaffOrderEvent,
  PrepQueueItem,
  StaffTableRow,
  StaffTablesResponse,
  ServiceRequestRow,
  TerminalRequestRow,
} from '@cafeflow/shared';

export interface MeResponse {
  user: {
    id: string;
    username: string;
    fullName: string;
    roles: string[];
    permissions: string[];
    mustChangePassword: boolean;
    mfaEnabled: boolean;
  };
  modules: ModuleKey[];
}

export interface DashboardOverview {
  today: { jalaliLabel: string; weekdayFa: string; salesTotal: number; paymentCount: number };
  orders: { active: number; preparing: number; delayed: number; awaitingPayment: number };
  tables: { total: number; occupied: number; available: number; reserved: number };
  requests: { pending: number };
  reservations: { upcoming: number; pendingApproval: number };
  catalog: { products: number; categories: number };
  staff: { activeUsers: number };
  paymentsByMethod: Array<{ method: string; total: number; count: number }>;
  recentOrders: Array<{
    id: string;
    code: string;
    status: string;
    total: number;
    tableCode: string | null;
    createdAt: string;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    actorUsername: string | null;
    entityType: string;
    createdAt: string;
  }>;
}

export interface ModuleStatus {
  key: ModuleKey;
  nameFa: string;
  descriptionFa: string;
  enabled: boolean;
  configurable: boolean;
  phase: number;
}

export interface StaffMember {
  id: string;
  username: string;
  fullName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: string[];
  roleNamesFa: string[];
}

export interface RoleSummary {
  id: string;
  key: string;
  nameFa: string;
  descriptionFa: string | null;
  isSystem: boolean;
  permissionCount: number;
  userCount: number;
}

export interface PermissionSummary {
  key: string;
  nameFa: string;
  group: string;
  groupLabelFa: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  actorUsername: string | null;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApprovalItem {
  id: string;
  type: string;
  titleFa: string;
  payload: unknown;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requesterName: string | null;
  deciderName: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface SettingsResponse {
  restaurantNameFa: string;
  logoUrl: string;
  addressFa: string;
  phone: string;
  email: string;
  currency: string;
  digitMode: 'fa' | 'latin';
  timezone: string;
  locale: string;
  serviceChargePercent: number;
  taxPercent: number;
}
