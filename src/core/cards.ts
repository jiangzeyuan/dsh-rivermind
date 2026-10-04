import type { Card } from './types.js';

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';
export const HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
export function fullDeck(): Card[] {
  return [...RANKS].flatMap(rank => [...SUITS].map(suit => rank + suit));
}
export function shuffledDeck(): Card[] {
  const deck = fullDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const range = i + 1;
    const limit = 2 ** 32 - (2 ** 32 % range);
    let value: number;
    do { value = crypto.getRandomValues(new Uint32Array(1))[0]!; } while (value >= limit);
    const j = value % range;
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}
export function assertDeck(deck: Card[]): void {
  if (deck.length !== 52 || new Set(deck).size !== 52 || deck.some(card => !fullDeck().includes(card))) {
    throw new Error('牌组必须包含 52 张不重复的标准扑克牌。');
  }
}
export function compareRanks(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}
function rankFive(cards: Card[]): number[] {
  const ranks = cards.map(card => RANKS.indexOf(card[0]!) + 2).sort((a, b) => b - a);
  const count = new Map<number, number>();
  for (const rank of ranks) count.set(rank, (count.get(rank) ?? 0) + 1);
  const groups = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every(card => card[1] === cards[0]![1]);
  const unique = [...new Set(ranks)];
  const straight = unique.length === 5 && unique[0]! - unique[4]! === 4
    ? unique[0]!
    : unique.join(',') === '14,5,4,3,2' ? 5 : 0;
  if (flush && straight) return [8, straight];
  if (groups[0]![1] === 4) return [7, groups[0]![0], groups[1]![0]];
  if (groups[0]![1] === 3 && groups[1]![1] === 2) return [6, groups[0]![0], groups[1]![0]];
  if (flush) return [5, ...ranks];
  if (straight) return [4, straight];
  if (groups[0]![1] === 3) return [3, groups[0]![0], ...groups.slice(1).map(group => group[0])];
  if (groups[0]![1] === 2 && groups[1]![1] === 2) {
    return [2, ...groups.slice(0, 2).map(group => group[0]).sort((a, b) => b - a), groups[2]![0]];
  }
  if (groups[0]![1] === 2) return [1, groups[0]![0], ...groups.slice(1).map(group => group[0])];
  return [0, ...ranks];
}
export function evaluate(cards: Card[]): number[] {
  if (cards.length < 5 || cards.length > 7 || new Set(cards).size !== cards.length ||
      cards.some(card => card.length !== 2 || !RANKS.includes(card[0]!) || !SUITS.includes(card[1]!))) {
    throw new Error('牌力评估需要 5–7 张合法且不重复的牌。');
  }
  let best: number[] = [-1];
  for (let a = 0; a < cards.length - 4; a++)
    for (let b = a + 1; b < cards.length - 3; b++)
      for (let c = b + 1; c < cards.length - 2; c++)
        for (let d = c + 1; d < cards.length - 1; d++)
          for (let e = d + 1; e < cards.length; e++) {
            const rank = rankFive([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
            if (compareRanks(rank, best) > 0) best = rank;
          }
  return best;
}
// Samples only unseen cards. The authoritative shuffled deck is never an input.
export function estimateEquity(hole: Card[], board: Card[], trials = 120, random = Math.random): number {
  if (hole.length !== 2 || board.length > 5 || new Set([...hole, ...board]).size !== hole.length + board.length ||
      [...hole, ...board].some(card => !fullDeck().includes(card))) throw new Error('非法的可见牌。');
  if (!Number.isInteger(trials) || trials < 1 || trials > 240) throw new Error('模拟次数须为 1–240。');
  const remaining = fullDeck().filter(card => !hole.includes(card) && !board.includes(card));
  let wins = 0;
  for (let i = 0; i < trials; i++) {
    const sample = [...remaining];
    const needed = 2 + 5 - board.length;
    for (let j = 0; j < needed; j++) {
      const k = j + Math.floor(random() * (sample.length - j));
      [sample[j], sample[k]] = [sample[k]!, sample[j]!];
    }
    const runout = [...board, ...sample.slice(2, needed)];
    const comparison = compareRanks(evaluate([...hole, ...runout]), evaluate([...sample.slice(0, 2), ...runout]));
    wins += comparison > 0 ? 1 : comparison === 0 ? 0.5 : 0;
  }
  return wins / trials;
}
