import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const define = { __RIVERMIND_VERSION__: JSON.stringify(metadata.version) };
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/host/index.ts'], outfile: 'dist/host/index.js', bundle: true,
  platform: 'node', format: 'esm', target: 'node22', sourcemap: true, define });
await build({ entryPoints: ['src/client/index.tsx'], outfile: 'dist/client.js', bundle: true,
  platform: 'browser', format: 'cjs', target: 'es2022', external: ['react', 'react/jsx-runtime'],
  loader: { '.css': 'text' }, sourcemap: true, define,
  banner: { js: "window.__ModuleLoader__.load({id:'dsh-rivermind',factory:(require)=>{var module={exports:{}};var exports=module.exports;" },
  footer: { js: 'return module.exports;}});' } });
await build({ entryPoints: ['src/client/standalone.tsx'], outfile: 'dist/standalone.js', bundle: true,
  platform: 'browser', format: 'esm', target: 'es2022', loader: { '.css': 'text' }, sourcemap: true,
  define: { ...define, 'process.env.NODE_ENV': '"production"' } });
await writeFile('dist/index.html', '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#101816"><title>RiverMind · 德扑训练场</title><style>html,body,#root{margin:0;min-height:100%;background:#101816}</style></head><body><div id="root"></div><script type="module" src="/standalone.js"></script></body></html>');
console.log('Built DSH host, client plugin, and local preview.');
