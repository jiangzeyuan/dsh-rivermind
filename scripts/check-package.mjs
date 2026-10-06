import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const temporary = mkdtempSync(join(tmpdir(), 'rivermind-package-check-'));
try {
  const env = { ...process.env, npm_config_cache: join(temporary, 'npm-cache') };
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary],
    { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const [packed] = JSON.parse(result);
  const files = new Set(packed.files.map(file => file.path));
  for (const path of ['package.json', 'dist/host/index.js', 'dist/client.js', 'cordis.patch.yml',
    'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'CHANGELOG.md', 'docs/technical-design.md',
    'docs/design-evolution.md', 'docs/publishing.md']) assert(files.has(path), 'Missing package file: ' + path);
  for (const path of files) assert(!/(^|\/)(\.data|node_modules|\.git|\.env(?:\.[^/]*)?|\.npmrc|\.idea)(\/|$)|\.(pem|key|p12|pfx)$/.test(path),
    'Local or sensitive file in package: ' + path);

  const extracted = join(temporary, 'unpacked'); mkdirSync(extracted);
  execFileSync('tar', ['-xzf', join(temporary, packed.filename), '-C', extracted]);
  const directory = join(extracted, 'package');
  const published = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  assert.equal(published.name, source.name); assert.equal(published.version, source.version);
  assert.notEqual(published.private, true, 'private: true prevents npm publication');
  assert.equal(published.publishConfig?.access, 'public');
  assert.equal(published.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.equal(published.exports['.'], './dist/host/index.js');
  assert.equal(published.exports['./client'], './dist/client.js');
  assert(readFileSync(join(directory, 'cordis.patch.yml'), 'utf8').includes("name: '" + published.name + "'"));

  // Import from the extracted tarball, without the source tree or its dev dependencies.
  const host = await import(pathToFileURL(join(directory, 'dist/host/index.js')).href);
  assert.equal(host.name, 'rivermind'); assert.equal(typeof host.apply, 'function');
  assert(Array.isArray(host.inject) && host.inject.includes('agents'));
  let client;
  vm.runInNewContext(readFileSync(join(directory, 'dist/client.js'), 'utf8'),
    { window: { __ModuleLoader__: { load(value) { client = value; } } } }, { timeout: 5000 });
  assert.equal(client?.id, published.name); assert.equal(typeof client.factory, 'function');
  console.log(`Package check passed: ${published.name}@${published.version}, ${files.size} files, ${packed.size} bytes.`);
  console.log('Prebuilt Host/client and bundle load correctly; local data is excluded. No registry publish occurred.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
