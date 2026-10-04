import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyMemory, OpponentProfile, parseMemory, updatedMemory } from '../core/memory.js';
import type { HandEvent } from '../core/types.js';
export type { OpponentMemory } from '../core/memory.js';

export class PlayerMemory extends OpponentProfile {
  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    const path = join(dataDir, 'iris-memory.json');
    super(existsSync(path) ? parseMemory(JSON.parse(readFileSync(path, 'utf8'))) : emptyMemory());
  }
  override observe(handId: string, events: HandEvent[]): void {
    const next = updatedMemory(this.state, handId, events);
    if (next === this.state) return;
    const path = join(this.dataDir, 'iris-memory.json');
    writeFileSync(path + '.tmp', JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    renameSync(path + '.tmp', path);
    this.state = next;
    appendFileSync(join(this.dataDir, 'memory-history.jsonl'), JSON.stringify(this.recall()) + '\n', { mode: 0o600 });
  }
}
