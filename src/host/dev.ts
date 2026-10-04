import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PokerError } from '../core/types.js';
import { PokerService } from './service.js';

const port = Number(process.env.RIVERMIND_PORT ?? 4317);
const service = new PokerService(resolve('.data'));
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1:' + port);
    if (url.pathname.startsWith('/rivermind/')) {
      if (req.method !== 'POST' || req.headers['content-type']?.split(';')[0] !== 'application/json') {
        res.writeHead(415); res.end('JSON POST required'); return;
      }
      if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:' + port && req.headers.origin !== 'http://localhost:' + port) {
        res.writeHead(403); res.end('Untrusted origin'); return;
      }
      let text = '';
      for await (const chunk of req) {
        text += chunk.toString();
        if (Buffer.byteLength(text) > 16384) { res.writeHead(413); res.end(); return; }
      }
      const body = JSON.parse(text);
      const endpoint = url.pathname.slice('/rivermind/'.length);
      if (body.type !== 'client-request' || body.method !== endpoint || typeof body.rpcId !== 'string') {
        throw new PokerError('BAD_REQUEST', '请求格式错误。', 400);
      }
      let result;
      try { result = { ok: true, value: service.dispatch(endpoint, body.payload) }; }
      catch (error) { result = { ok: false, error: { code: error instanceof PokerError ? error.code : 'INTERNAL',
        message: error instanceof Error ? error.message : '服务错误' } }; }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result })); return;
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname === '/standalone.js' ? 'standalone.js' : null;
    if (!file || req.method !== 'GET') { res.writeHead(404); res.end(); return; }
    const contents = await readFile(resolve('dist', file));
    res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' });
    res.end(contents);
  } catch { if (!res.headersSent) res.writeHead(400); res.end('Bad request'); }
});
server.listen(port, '127.0.0.1', () => console.log('RiverMind preview: http://127.0.0.1:' + port + ' (规则陪练；此模式不调用 DSH)'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => {
  await service.dispose(); server.closeAllConnections(); server.close(() => process.exit(0));
});
