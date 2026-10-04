import type { TableSnapshot } from '../host/service.js';
export interface RpcResult { ok: boolean; value?: TableSnapshot; error?: { message: string; code: string } }
export type PokerApi = (endpoint: string, payload?: Record<string, unknown>) => Promise<TableSnapshot>;
export function apiFromRpc(call: (endpoint: string, payload: Record<string, unknown>) => Promise<RpcResult>): PokerApi {
  return async (endpoint, payload = {}) => {
    const result = await call(endpoint, payload);
    if (!result.ok || !result.value) throw new Error(result.error?.message ?? '无法连接牌桌。');
    return result.value;
  };
}
