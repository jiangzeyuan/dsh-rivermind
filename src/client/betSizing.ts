import type { GameView } from '../core/types.js';

export type BetUnit = 'bb' | 'chips';
export function formatBet(amount: number, bigBlind: number, unit: BetUnit): string {
  return String(unit === 'bb' ? amount / bigBlind : amount);
}
export function parseBet(text: string, unit: BetUnit, bigBlind: number,
  bounds: { min: number; max: number } | null): { amount: number | null; error: string | null } {
  if (!bounds) return { amount: null, error: null };
  if (!text.trim()) return { amount: null, error: '请输入下注金额。' };
  const raw = Number(text) * (unit === 'bb' ? bigBlind : 1);
  const amount = Math.round(raw);
  if (!Number.isFinite(raw) || !Number.isSafeInteger(amount) || Math.abs(raw - amount) > 1e-7) {
    return { amount: null, error: '最小单位为 1 筹码（' + formatBet(1, bigBlind, 'bb') + ' BB）。' };
  }
  if (amount < bounds.min || amount > bounds.max) {
    return { amount: null, error: '本轮可下注至 ' + bounds.min + '～' + bounds.max + ' 筹码。' };
  }
  return { amount, error: null };
}
export interface BetPreset { key: string; label: string; amount: number; available: boolean; description: string }
export function betPresets(view: GameView): { blinds: BetPreset[]; pot: BetPreset[] } {
  const legal = view.legal.raise;
  const preset = (key: string, label: string, amount: number, description: string): BetPreset => ({
    key, label, amount,
    available: !!legal && Number.isSafeInteger(amount) && amount >= legal.min && amount <= legal.max,
    description: description + '；本轮下注至 ' + amount + ' 筹码',
  });
  const blinds = [2, 2.5, 3, 5, 10].map(bb => preset('bb:' + bb, bb + ' BB', bb * view.bigBlind, '本轮累计 ' + bb + ' 个大盲'));
  if (legal) blinds.push(preset('all-in', '全下', legal.max, '投入全部剩余筹码'));
  const human = view.players.find(player => player.id === 'human')!;
  const calledTotal = human.streetBet + (view.legal.call ?? 0);
  const pot = view.street === 'preflop' || view.street === 'idle' || view.street === 'complete' ? []
    : [[1 / 3, '1/3 底池'], [.5, '1/2 底池'], [.75, '3/4 底池'], [1, '满池']].map(([fraction, label]) =>
      preset('pot:' + fraction, label as string, calledTotal + Math.round(view.facts.contestablePotAfterCall * (fraction as number)),
        '跟注后，再加注 ' + label));
  return { blinds, pot };
}
