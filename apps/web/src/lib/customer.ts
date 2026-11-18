import type {
  PublicMenuResponse,
  PublicOrderInput,
  PublicOrderResponse,
  PublicOrderStatusResponse,
  PublicRequestInput,
} from '@cafeflow/shared';
import { api } from './api';

/**
 * Customer endpoints. The device cookie is sent automatically; the browser
 * never sends prices or totals — only product ids and quantities.
 */
export const customerApi = {
  menu: (qrToken?: string) =>
    api.get<PublicMenuResponse>(
      qrToken ? `/public/menu?qr=${encodeURIComponent(qrToken)}` : '/public/menu',
    ),
  createOrder: (input: PublicOrderInput) => api.post<PublicOrderResponse>('/public/orders', input),
  orderStatus: (code: string) =>
    api.get<PublicOrderStatusResponse>(`/public/orders/${encodeURIComponent(code)}`),
  createRequest: (input: PublicRequestInput) =>
    api.post<{ id: string; type: string }>('/public/requests', input),
};
