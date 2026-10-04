import type { TableSnapshot } from '../host/service.js';
import type { HistoryPage, SavedReview } from '../host/reviews.js';
export type ApiValue = TableSnapshot | HistoryPage | SavedReview;
export interface RpcResult { ok: boolean; value?: ApiValue; error?: { message: string; code: string } }
export interface PokerApi {
  (endpoint: 'history', payload?: Record<string, unknown>): Promise<HistoryPage>;
  (endpoint: 'review', payload?: Record<string, unknown>): Promise<SavedReview>;
  (endpoint: string, payload?: Record<string, unknown>): Promise<TableSnapshot>;
}
export function apiFromRpc(call: (endpoint: string, payload: Record<string, unknown>) => Promise<RpcResult>): PokerApi {
  return (async (endpoint: string, payload: Record<string, unknown> = {}) => {
    const result = await call(endpoint, payload);
    if (!result.ok || !result.value) throw new Error(result.error?.message ?? '无法连接牌桌。');
    return result.value;
  }) as PokerApi;
}
