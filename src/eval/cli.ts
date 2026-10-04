import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runEvaluation } from './runner.js';
const args = new Map<string,string>();
for (const arg of process.argv.slice(2)) {
  const match = /^--(pairs|seeds|trials|out)=(.+)$/.exec(arg);
  if (!match || args.has(match[1]!)) throw new Error('参数格式：--pairs=30 --seeds=7,17,29 --trials=40 --out=.data/evaluations/heads-up.json');
  args.set(match[1]!,match[2]!);
}
const report = runEvaluation({ pairs: Number(args.get('pairs') ?? 30), seeds: (args.get('seeds') ?? '7,17,29').split(',').map(Number), trials: Number(args.get('trials') ?? 40) });
const output = resolve(args.get('out') ?? '.data/evaluations/heads-up.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.table(report.results.map(r => ({ opponent:r.opponent, memory:r.memoryMode, hands:r.hands, 'bb/100':r.bbPer100.toFixed(2), legal:(r.legalSubmissionRate*100).toFixed(1)+'%', fallback:(r.fallbackRate*100).toFixed(1)+'%', refs:r.memoryReferences })));
console.log('Report saved:', output);
console.log(report.limitations[0]);
