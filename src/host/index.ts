import { resolve } from 'node:path';
import { PokerError } from '../core/types.js';
import { DshOpponent, type DshHostContext } from './dsh.js';
import { PokerService } from './service.js';

export const name = 'rivermind';
export const inject = ['agents', 'tools', 'systemPrompt', 'connection', 'agentDefaultModel'];
export function apply(ctx: DshHostContext, config: { dataDir?: string } = {}): void {
  const service = new PokerService(resolve(config.dataDir ?? '.data'), new DshOpponent(ctx));
  // Exact routes join DSH's authenticated /api transport, including the desktop
  // local carrier, without creating a second generic RPC channel.
  for (const endpoint of ['state', 'deal', 'action', 'mode', 'reset']) {
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
