import { estimateEquity } from './cards.js';
import type { Card, Decision, GameView } from './types.js';
import type { OpponentMemory } from '../host/memory.js';

export function baselineDecision(view: GameView, memory: OpponentMemory): Decision {
  const hero = view.players.find(player => player.id === 'iris')!;
  const equity = estimateEquity(hero.cards as Card[], view.board, 100);
  const legal = view.legal;
  const toCall = legal.call ?? 0;
  const potOdds = toCall / Math.max(1, view.pot + toCall);
  const observed = memory.handsObserved;
  const foldRate = observed > 0 ? memory.handsFolded / observed : 0;
  const pressureAdjustment = observed >= 10 && foldRate > 0.55 ? 0.04 : 0;
  const memoryIds = pressureAdjustment ? [memory.id] : [];
  const prefix = '随机对手范围下约 ' + Math.round(equity * 100) + '% 胜率（100 次抽样）。';
  if (toCall > 0 && equity < potOdds + 0.07) {
    return { action: { type: 'fold' }, reason: prefix + ' 跟注赔率不足，控制损失。', source: 'baseline', memoryIds };
  }
  if (legal.raise && equity > 0.67 - pressureAdjustment) {
    const amount = Math.max(legal.raise.min, Math.min(legal.raise.max,
      hero.streetBet + toCall + Math.max(view.bigBlind, Math.round(view.pot * 0.6))));
    return { action: { type: 'raise', amount }, reason: prefix + ' 倾向价值下注。' +
      (pressureAdjustment ? ' 对手的公开弃牌记录支持稍微扩大施压范围。' : ''), source: 'baseline', memoryIds };
  }
  return { action: legal.check ? { type: 'check' } : { type: 'call' },
    reason: prefix + (legal.check ? ' 保留底池控制，选择过牌。' : ' 当前赔率支持跟注。'), source: 'baseline', memoryIds };
}
