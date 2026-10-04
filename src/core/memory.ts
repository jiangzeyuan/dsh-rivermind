import type { BetSize, HandEvent, Position, Street } from './types.js';

export interface ConditionMemory {
  key: string;
  street: Exclude<Street, 'idle' | 'complete'>;
  position: Position;
  betSize: BetSize;
  opportunities: number;
  folds: number;
  calls: number;
  raises: number;
  foldRate: number;
  foldRateInterval: [number, number];
  usable: boolean;
  evidenceHandIds: string[];
}
export interface OpponentMemory {
  id: string;
  schemaVersion: 2;
  ownerId: 'iris';
  opponentId: 'human';
  handsObserved: number;
  handsFolded: number;
  voluntaryHands: number;
  aggressiveHands: number;
  evidenceHandIds: string[];
  conditions: ConditionMemory[];
  summary: string;
}
interface ConditionCounts {
  opportunities: number; folds: number; calls: number; raises: number; evidenceHandIds: string[];
}
export interface StoredMemory {
  version: 2;
  handIds: string[];
  folded: number;
  voluntary: number;
  aggressive: number;
  contexts: Record<string, ConditionCounts>;
}
export function emptyMemory(): StoredMemory {
  return { version: 2, handIds: [], folded: 0, voluntary: 0, aggressive: 0, contexts: {} };
}
export function parseMemory(value: unknown): StoredMemory {
  const bad = () => { throw new Error('Iris 记忆文件格式错误；请保留文件并检查数据目录中的 iris-memory.json。'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad();
  const v = value as Record<string, any>;
  if (![1, 2].includes(v.version) || !Array.isArray(v.handIds) || v.handIds.some((id: unknown) => typeof id !== 'string') ||
      new Set(v.handIds).size !== v.handIds.length ||
      ![v.folded, v.voluntary, v.aggressive].every(n => Number.isSafeInteger(n) && n >= 0 && n <= v.handIds.length)) return bad();
  if (v.version === 1) return { ...emptyMemory(), handIds: [...v.handIds], folded: v.folded, voluntary: v.voluntary, aggressive: v.aggressive };
  if (!v.contexts || typeof v.contexts !== 'object' || Array.isArray(v.contexts)) return bad();
  for (const [key, raw] of Object.entries(v.contexts)) {
    if (!/^(preflop|flop|turn|river):(button|big-blind):(small|medium|large)$/.test(key) || !raw || typeof raw !== 'object') return bad();
    const c = raw as ConditionCounts;
    if (![c.opportunities, c.folds, c.calls, c.raises].every(n => Number.isSafeInteger(n) && n >= 0) ||
        c.opportunities !== c.folds + c.calls + c.raises ||
        !Array.isArray(c.evidenceHandIds) || c.evidenceHandIds.length > 8 ||
        c.evidenceHandIds.some(id => typeof id !== 'string' || !v.handIds.includes(id))) return bad();
  }
  return structuredClone(v as StoredMemory);
}
// Wilson interval for a binomial proportion, with z=1.96 (approximate 95%).
export function foldInterval(folds: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const p = folds / n, z2 = 1.96 ** 2, denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const half = 1.96 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denominator;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
export function updatedMemory(state: StoredMemory, handId: string, events: HandEvent[]): StoredMemory {
  if (state.handIds.includes(handId) || !events.some(event => event.kind === 'finished' && event.handId === handId)) return state;
  const next = structuredClone(state);
  const actions = events.filter(event => event.handId === handId && event.kind === 'action' && event.playerId === 'human');
  next.handIds.push(handId);
  if (actions.some(event => event.action?.type === 'fold')) next.folded++;
  if (actions.some(event => event.street === 'preflop' && ['call', 'raise'].includes(event.action?.type ?? ''))) next.voluntary++;
  if (actions.some(event => event.action?.type === 'raise')) next.aggressive++;
  for (const event of actions) {
    const context = event.context;
    if (!context?.facingBet || !context.facingBetSize || event.street === 'idle' || event.street === 'complete') continue;
    const key = event.street + ':' + context.position + ':' + context.facingBetSize;
    const counts = next.contexts[key] ??= { opportunities: 0, folds: 0, calls: 0, raises: 0, evidenceHandIds: [] };
    const type = event.action?.type;
    if (type !== 'fold' && type !== 'call' && type !== 'raise') continue;
    counts.opportunities++;
    counts[type === 'fold' ? 'folds' : type === 'call' ? 'calls' : 'raises']++;
    counts.evidenceHandIds = [...counts.evidenceHandIds.filter(id => id !== handId), handId].slice(-8);
  }
  return next;
}
export class OpponentProfile {
  protected state: StoredMemory;
  constructor(state: StoredMemory = emptyMemory()) { this.state = structuredClone(state); }
  recall(): OpponentMemory {
    const n = this.state.handIds.length;
    const conditions = Object.entries(this.state.contexts).sort(([a], [b]) => a.localeCompare(b)).map(([key, c]) => {
      const [street, position, betSize] = key.split(':') as [ConditionMemory['street'], Position, BetSize];
      return { key, street, position, betSize, ...structuredClone(c), foldRate: c.folds / Math.max(1, c.opportunities),
        foldRateInterval: foldInterval(c.folds, c.opportunities), usable: c.opportunities >= 10 };
    });
    return {
      id: 'iris:human:public-stats:s2:v' + n, schemaVersion: 2, ownerId: 'iris', opponentId: 'human',
      handsObserved: n, handsFolded: this.state.folded, voluntaryHands: this.state.voluntary,
      aggressiveHands: this.state.aggressive, evidenceHandIds: this.state.handIds.slice(-8), conditions,
      summary: n === 0 ? '尚无样本，请勿对对手风格下结论。' : '共观察 ' + n + ' 手：弃牌 ' + this.state.folded +
        ' 手，翻牌前主动入池 ' + this.state.voluntary + ' 手，出现主动下注或加注 ' + this.state.aggressive +
        ' 手。' + (n < 10 ? ' 样本较少，判断应保守。' : '') + ' 条件统计以实际面对主动下注的回应次数为分母。',
    };
  }
  observe(handId: string, events: HandEvent[]): void { this.state = updatedMemory(this.state, handId, events); }
}
