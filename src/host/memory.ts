import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HandEvent } from '../core/types.js';

export interface OpponentMemory {
  id: string;
  ownerId: 'iris';
  opponentId: 'human';
  handsObserved: number;
  handsFolded: number;
  voluntaryHands: number;
  aggressiveHands: number;
  evidenceHandIds: string[];
  summary: string;
}
export class PlayerMemory {
  #seen = new Set<string>();
  #folded = 0;
  #voluntary = 0;
  #aggressive = 0;
  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    const path = join(dataDir, 'iris-memory.json');
    if (existsSync(path)) {
      const value = JSON.parse(readFileSync(path, 'utf8'));
      if (value.version !== 1 || !Array.isArray(value.handIds) || value.handIds.some((id: unknown) => typeof id !== 'string') ||
          ![value.folded, value.voluntary, value.aggressive].every(n => Number.isSafeInteger(n) && n >= 0 && n <= value.handIds.length)) {
        throw new Error('Iris 记忆文件格式错误；请保留文件并检查 .data/iris-memory.json。');
      }
      this.#seen = new Set(value.handIds);
      this.#folded = value.folded; this.#voluntary = value.voluntary; this.#aggressive = value.aggressive;
    }
  }
  recall(): OpponentMemory {
    const n = this.#seen.size;
    return {
      id: 'iris:human:public-stats:v' + n, ownerId: 'iris', opponentId: 'human',
      handsObserved: n, handsFolded: this.#folded, voluntaryHands: this.#voluntary,
      aggressiveHands: this.#aggressive, evidenceHandIds: [...this.#seen].slice(-8),
      summary: n === 0 ? '尚无样本，请勿对对手风格下结论。' :
        '共观察 ' + n + ' 手：弃牌 ' + this.#folded + ' 手，翻牌前主动入池 ' + this.#voluntary +
        ' 手，出现主动下注或加注 ' + this.#aggressive + ' 手。' + (n < 10 ? ' 样本较少，判断应保守。' : ''),
    };
  }
  observe(handId: string, events: HandEvent[]): void {
    if (this.#seen.has(handId) || !events.some(event => event.kind === 'finished')) return;
    const actions = events.filter(event => event.kind === 'action' && event.playerId === 'human');
    this.#seen.add(handId);
    if (actions.some(event => event.action?.type === 'fold')) this.#folded++;
    if (actions.some(event => event.street === 'preflop' && ['call', 'raise'].includes(event.action?.type ?? ''))) this.#voluntary++;
    if (actions.some(event => event.action?.type === 'raise')) this.#aggressive++;
    const path = join(this.dataDir, 'iris-memory.json');
    const contents = { version: 1, handIds: [...this.#seen], folded: this.#folded, voluntary: this.#voluntary, aggressive: this.#aggressive };
    writeFileSync(path + '.tmp', JSON.stringify(contents, null, 2) + '\n', { mode: 0o600 });
    renameSync(path + '.tmp', path);
    appendFileSync(join(this.dataDir, 'memory-history.jsonl'), JSON.stringify(this.recall()) + '\n', { mode: 0o600 });
  }
}
