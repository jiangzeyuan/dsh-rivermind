import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { PokerError } from '../core/types.js';
import { DshOpponent, type DshHostContext } from './dsh.js';
import { PokerService } from './service.js';
import type { AgentBudget } from '../core/budget.js';

export const name = 'rivermind';
export const inject = ['agents', 'sessions', 'tools', 'systemPrompt', 'connection', 'agentDefaultModel'];
export function apply(ctx: DshHostContext, config: { dataDir?: string; agentBudget?: Partial<AgentBudget> } = {}): void {
  // Installed plugins need a stable writable directory even when Desktop starts
  // from a different working directory. Explicit development config takes priority.
  const configuredHome = process.env.DSH_HOME ?? '';
  const selectedHome = configuredHome.trim() ? configuredHome : resolve(homedir(), '.dsh');
  const expandedHome = selectedHome === '~' ? homedir()
    : /^~[\\/]/.test(selectedHome) ? resolve(homedir(), selectedHome.slice(2)) : selectedHome;
  const dataDir = config.dataDir ?? resolve(expandedHome, 'data', 'rivermind');
  const service = new PokerService(resolve(dataDir), new DshOpponent(ctx), 450, { agentBudget: config.agentBudget });
  // Exact routes join DSH's authenticated /api transport, including the desktop
  // local carrier, without creating a second generic RPC channel.
  for (const endpoint of ['state', 'deal', 'action', 'mode', 'reset', 'history', 'review', 'settings']) {
    ctx.connection.fetch.register({
      path: '/api/rivermind/' + endpoint, methods: ['POST'], requestBody: 'buffered',
      fetch: async request => {
        if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return new Response('JSON required', { status: 415 });
        const text = await request.text();
        if (text.length > 16384) return new Response('Request too large', { status: 413 });
        let body;
        try { body = JSON.parse(text); } catch { return new Response('Invalid JSON', { status: 400 }); }
        if (!body || body.type !== 'client-request' || typeof body.rpcId !== 'string' || body.method !== 'rivermind/' + endpoint) {
          return new Response('Invalid RPC envelope', { status: 400 });
        }
        let result;
        try { result = { ok: true, value: service.dispatch(endpoint, body.payload) }; }
        catch (error) { result = { ok: false, error: { code: error instanceof PokerError ? error.code : 'INTERNAL',
          message: error instanceof PokerError ? error.message : '牌桌服务发生错误。' } }; }
        return Response.json({ type: 'server-response', rpcId: body.rpcId, result }, { headers: { 'cache-control': 'no-store' } });
      },
    });
  }
  ctx.effect(() => () => service.dispose(), 'rivermind: table and opponent');
  ctx.logger.info('RiverMind loaded. Open the RiverMind panel to start a training hand.');
}
