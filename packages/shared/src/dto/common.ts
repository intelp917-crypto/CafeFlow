import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
  };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface AuthUserDto {
  id: string;
  username: string;
  fullName: string;
  roles: string[];
  permissions: string[];
  mustChangePassword: boolean;
}

export interface ModuleStatusDto {
  key: string;
  nameFa: string;
  descriptionFa: string;
  enabled: boolean;
  configurable: boolean;
  phase: number;
}

export interface AppSettingsDto {
  restaurantNameFa: string;
  currency: string;
  digitMode: 'fa' | 'latin';
  timezone: string;
  locale: string;
  serviceChargePercent: number;
  taxPercent: number;
}
