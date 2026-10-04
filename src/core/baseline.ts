import { estimateEquity } from './cards.js';
import { betSizeBucket } from './facts.js';
import type { OpponentMemory } from './memory.js';
import type { Card, Decision, GameView } from './types.js';

export type MemoryMode = 'none' | 'aggregate' | 'conditional';
export function baselineDecision(view: GameView, memory: OpponentMemory,
  options: { random?: () => number; memoryMode?: MemoryMode; trials?: number } = {}): Decision {
  const started = performance.now();
  const hero = view.players.find(player => player.id === 'iris')!;
  const other = view.players.find(player => player.id === 'human')!;
  const trials = options.trials ?? 100;
  const equity = estimateEquity(hero.cards as Card[], view.board, trials, options.random ?? Math.random);
  const legal = view.legal;
  const toCall = view.facts.toCall;
  const mode = options.memoryMode ?? 'conditional';
  const amount = legal.raise ? Math.max(legal.raise.min, Math.min(legal.raise.max,
    hero.streetBet + toCall + Math.max(view.bigBlind, Math.round(view.pot * 0.6)))) : 0;
  const size = betSizeBucket((amount - hero.streetBet) / Math.max(1, view.pot));
  const relevant = memory.conditions.find(c => c.street === view.street && c.position === (other.dealer ? 'button' : 'big-blind') && c.betSize === size);
  const supported = mode === 'aggregate'
    ? memory.handsObserved >= 10 && memory.handsFolded / memory.handsObserved > 0.55
    : mode === 'conditional' && !!relevant?.usable && relevant.foldRateInterval[0] > 0.55;
  const adjustment = supported ? 0.04 : 0;
  const trace = { facts: structuredClone(view.facts), durationMs: performance.now() - started, tools: [],
    equity: { value: equity, trials, assumption: 'random opponent range' } };
  const prefix = '随机对手范围下约 ' + Math.round(equity * 100) + '% 胜率（' + trials + ' 次抽样）。';
  if (toCall > 0 && equity < view.facts.potOdds + 0.07) {
    return { action: { type: 'fold' }, reason: prefix + ' 可争夺底池对应的跟注赔率不足。', source: 'baseline', memoryIds: [], trace };
  }
  if (legal.raise && equity > 0.67 - adjustment) {
    return { action: { type: 'raise', amount }, source: 'baseline', trace, memoryIds: adjustment ? [memory.id] : [],
      reason: prefix + ' 倾向价值下注。' + (adjustment ? mode === 'aggregate'
        ? ' 对手累计弃牌记录支持小幅扩大施压范围。'
        : ' 同位置、同下注轮和同尺度的回应记录支持小幅扩大施压范围。' : '') };
  }
  return { action: legal.check ? { type: 'check' } : { type: 'call' }, source: 'baseline', memoryIds: [], trace,
    reason: prefix + (legal.check ? ' 保留底池控制，选择过牌。' : ' 可争夺底池对应的赔率支持跟注。') };
}
