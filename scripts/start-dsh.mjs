import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const entry = resolve('dist/host/index.js');
if (!existsSync(entry)) throw new Error('请先运行 npm run build。');
mkdirSync('.data', { recursive: true });
const patch = resolve('.data/rivermind.patch.yml');
// JSON is valid YAML. Absolute paths prevent profile-relative resolution mistakes.
writeFileSync(patch, JSON.stringify([{ insert: [{ id: 'rivermind', name: entry, config: { dataDir: resolve('.data') } }] }], null, 2));
const args = ['web', '--patch', patch, '--no-open', '--port', process.env.RIVERMIND_DSH_PORT ?? '3080'];
const child = spawn('dsh', args, { stdio: 'inherit', cwd: process.cwd() });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
