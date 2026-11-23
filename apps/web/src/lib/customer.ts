import type {
  PublicMenuResponse,
  PublicOrderInput,
  PublicOrderItemsInput,
  PublicOrderItemsResponse,
  PublicOrderResponse,
  PublicOrderStatusResponse,
  PublicRequestInput,
} from '@cafeflow/shared';
import { api } from './api';

/**
 * Customer endpoints. The device cookie is sent automatically; the browser
 * never sends prices or totals — only product ids and quantities.
 */
const ORDER_TOKEN_PREFIX = 'cafeflow.orderToken.';

/**
 * The status token is returned only when the order is created, so it lives in
 * sessionStorage per tab. A shared status link therefore does not leak it.
 */
export function rememberOrderToken(code: string, token: string | null | undefined): void {
  if (!token) return;
  try {
    window.sessionStorage.setItem(`${ORDER_TOKEN_PREFIX}${code}`, token);
  } catch {
    // Private mode can refuse storage; the page then falls back to the code only.
  }
}

export function orderTokenFor(code: string): string | undefined {
  try {
    return window.sessionStorage.getItem(`${ORDER_TOKEN_PREFIX}${code}`) ?? undefined;
  } catch {
    return undefined;
  }
}

export const customerApi = {
  menu: (qrToken?: string) =>
    api.get<PublicMenuResponse>(
      qrToken ? `/public/menu?qr=${encodeURIComponent(qrToken)}` : '/public/menu',
    ),
  createOrder: (input: PublicOrderInput) => api.post<PublicOrderResponse>('/public/orders', input),
  addOrderItems: (code: string, token: string | undefined, input: PublicOrderItemsInput) =>
    api.post<PublicOrderItemsResponse>(
      `/public/orders/${encodeURIComponent(code)}/items${token ? `?token=${encodeURIComponent(token)}` : ''}`,
      input,
    ),
  orderStatus: (code: string, token?: string) =>
    api.get<PublicOrderStatusResponse>(
      `/public/orders/${encodeURIComponent(code)}${token ? `?token=${encodeURIComponent(token)}` : ''}`,
    ),
  createRequest: (input: PublicRequestInput) =>
    api.post<{ id: string; type: string }>('/public/requests', input),
  tableOverview: (qrToken: string) =>
    api.get<PublicTableOverviewResponse>(`/public/table/${encodeURIComponent(qrToken)}`),
};

export interface PublicTableOverviewOrderItem {
  nameFa: string;
  quantity: number;
  status: string;
}

export interface PublicTableOverviewOrder {
  code: string;
  status: string;
  statusLabelFa: string;
  total: number;
  createdAt: string;
  items: PublicTableOverviewOrderItem[];
}

export interface PublicTableOverviewResponse {
  tableNameFa: string;
  orders: PublicTableOverviewOrder[];
}
