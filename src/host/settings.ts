import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DEFAULT_AGENT_BUDGET, validateAgentBudget, type AgentBudget } from '../core/budget.js';

export class AgentSettings {
  #budget: AgentBudget;
  readonly path: string;
  readonly warning: string | null;
  constructor(dataDir: string, defaults: Partial<AgentBudget> = {}) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.path = join(dataDir, 'agent-settings.json');
    this.#budget = validateAgentBudget({ ...DEFAULT_AGENT_BUDGET, ...defaults });
    this.warning = null;
    if (existsSync(this.path)) {
      try {
        const saved = JSON.parse(readFileSync(this.path, 'utf8'));
        if (saved.version !== 1) throw new Error('Unknown settings version.');
        this.#budget = validateAgentBudget(saved.budget);
      } catch {
        this.warning = 'Iris 设置文件无法读取，本次使用启动默认值；保存设置后可修复。';
      }
    }
  }
  get budget(): AgentBudget { return { ...this.#budget }; }
  save(value: unknown): void {
    const budget = validateAgentBudget(value);
    const temporary = this.path + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, budget }, null, 2) + '\n', { mode: 0o600 });
      renameSync(temporary, this.path);
      this.#budget = budget;
    } finally { rmSync(temporary, { force: true }); }
  }
}
