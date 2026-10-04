import { baselineDecision, type MemoryMode } from '../core/baseline.js';
import { evaluate, RANKS } from '../core/cards.js';
import { PokerTable } from '../core/engine.js';
import { OpponentProfile } from '../core/memory.js';
import type { Decision, GameView } from '../core/types.js';
import { seededDeck, seededRandom } from './random.js';

export const OPPONENTS = ['fold-heavy', 'calling-station', 'pressure'] as const;
export type EvalOpponent = typeof OPPONENTS[number];
export interface EvaluationConfig { pairs: number; seeds: number[]; trials: number }
export interface EvaluationRow {
  opponent: EvalOpponent; memoryMode: MemoryMode; hands: number; bbPer100: number; winRate: number;
  legalSubmissionRate: number; fallbackRate: number; decisions: number; memoryReferences: number;
  meanDecisionMs: number; p95DecisionMs: number;
  seedRuns: { seed: number; bbPer100: number }[];
}
export interface EvaluationReport {
  schemaVersion: 1; runtime: 'rule-baseline'; config: EvaluationConfig; modelTokens: null;
  results: EvaluationRow[];
  comparisons: { opponent: EvalOpponent; memoryMode: MemoryMode; deltaBbPer100: number; seedDeltaRange: [number, number] }[];
  limitations: string[];
}
function scriptedOpponent(view: GameView, opponent: EvalOpponent): Decision {
  const hero = view.players.find(p => p.id === 'human')!;
  const cards = hero.cards as string[];
  const pair = cards.length === 2 && cards[0]![0] === cards[1]![0];
  const strong = view.board.length >= 3 ? evaluate([...cards, ...view.board])[0]! >= 2
    : pair || cards.every(card => RANKS.indexOf(card[0]!) >= 9);
  const call = view.legal.call ?? 0;
  let action: Decision['action'];
  if (opponent === 'fold-heavy' && call > 0 && !strong) action = { type: 'fold' };
  else if (opponent === 'pressure' && view.legal.raise &&
      !view.events.some(e => e.street === view.street && e.playerId === 'human' && e.action?.type === 'raise')) {
    action = { type: 'raise', amount: Math.max(view.legal.raise.min, Math.min(view.legal.raise.max,
      hero.streetBet + call + Math.round(view.pot * 0.75))) };
  } else if (opponent === 'pressure' && call > hero.stack / 2 && !strong) action = { type: 'fold' };
  else action = view.legal.check ? { type: 'check' } : { type: 'call' };
  return { action, source: 'baseline', reason: '评估用固定规则对手：' + opponent, memoryIds: [] };
}
export function runEvaluation(config: EvaluationConfig): EvaluationReport {
  if (!Number.isSafeInteger(config.pairs) || config.pairs < 1 || config.pairs > 10000 ||
      !Array.isArray(config.seeds) || config.seeds.length < 2 || config.seeds.length > 30 ||
      new Set(config.seeds).size !== config.seeds.length || config.seeds.some(n => !Number.isSafeInteger(n)) ||
      !Number.isSafeInteger(config.trials) || config.trials < 1 || config.trials > 240) throw new Error('无效的评估参数。');
  const results: EvaluationRow[] = [];
  for (const opponent of OPPONENTS) for (const memoryMode of ['none', 'aggregate', 'conditional'] as MemoryMode[]) {
    let net = 0, wins = 0, decisions = 0, legal = 0, fallbacks = 0, references = 0;
    const latencies: number[] = [], seedRuns: EvaluationRow['seedRuns'] = [];
    for (const seed of config.seeds) {
      // Each arm/seed has an isolated profile; no live training directory or DSH session is used.
      const profile = new OpponentProfile(), blank = new OpponentProfile();
      let runNet = 0;
      for (let pair = 0; pair < config.pairs; pair++) for (const button of [0, 1] as const) {
        const table = new PokerTable({ initialButton: button, deckFactory: () => seededDeck('deck:' + seed + ':' + pair) });
        table.newHand(0);
        const snapshot = memoryMode === 'none' ? blank.recall() : profile.recall();
        const memory = memoryMode === 'aggregate' ? { ...snapshot, conditions: [] } : snapshot;
        let steps = 0, irisSteps = 0;
        while (!table.complete) {
          if (++steps > 128) throw new Error('评估手牌未在行动预算内结束。');
          const player = table.actingPlayer!;
          const view = table.viewFor(player);
          const started = performance.now();
          const decision = player === 'human' ? scriptedOpponent(view, opponent) : baselineDecision(view, memory, {
            memoryMode, trials: config.trials,
            random: seededRandom('equity:' + seed + ':' + pair + ':' + button + ':' + view.street + ':' + irisSteps++),
          });
          if (player === 'iris') { decisions++; latencies.push(performance.now() - started); }
          try { table.apply(player, decision, view.revision); if (player === 'iris') { legal++; references += decision.memoryIds.length > 0 ? 1 : 0; } }
          catch (error) {
            if (player === 'human') throw error;
            fallbacks++;
            table.apply(player, { action: view.legal.check ? { type: 'check' } : { type: 'fold' }, source: 'fallback', reason: '评估兜底', memoryIds: [] }, view.revision);
          }
        }
        const done = table.viewFor('human');
        if (done.players.reduce((sum, p) => sum + p.stack, 0) !== 4000) throw new Error('评估发现筹码不守恒。');
        const earned = done.result!.net.iris / table.bigBlind;
        net += earned; runNet += earned;
        wins += done.result!.winners.length === 2 ? 0.5 : done.result!.winners[0] === 'iris' ? 1 : 0;
        profile.observe(table.handId, table.publicHistory());
      }
      seedRuns.push({ seed, bbPer100: runNet / (config.pairs * 2) * 100 });
    }
    latencies.sort((a, b) => a - b);
    const hands = config.pairs * 2 * config.seeds.length;
    results.push({ opponent, memoryMode, hands, bbPer100: net / hands * 100, winRate: wins / hands,
      legalSubmissionRate: legal / Math.max(1, decisions), fallbackRate: fallbacks / Math.max(1, decisions),
      decisions, memoryReferences: references, meanDecisionMs: latencies.reduce((a,b)=>a+b,0) / Math.max(1,latencies.length),
      p95DecisionMs: latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? 0, seedRuns });
  }
  const comparisons = results.filter(row => row.memoryMode !== 'none').map(row => {
    const control = results.find(r => r.opponent === row.opponent && r.memoryMode === 'none')!;
    const deltas = row.seedRuns.map((run, i) => run.bbPer100 - control.seedRuns[i]!.bbPer100);
    return { opponent: row.opponent, memoryMode: row.memoryMode, deltaBbPer100: row.bbPer100 - control.bbPer100,
      seedDeltaRange: [Math.min(...deltas), Math.max(...deltas)] as [number,number] };
  });
  return { schemaVersion: 1, runtime: 'rule-baseline', config: structuredClone(config), modelTokens: null, results, comparisons,
    limitations: ['无模型规则策略评估，不代表 DSH 模型表现或职业水平。', '每手重置为 100BB；配对发牌并交换庄位，画像在单个实验组/seed 内累计。',
      '第二手可使用第一手公开动作；所有实验组顺序一致，不交换私有底牌或未来牌面。', '收益可复现，耗时随机器负载变化；seed 差值范围不是置信区间。', '对手均为固定教学规则，尚无范围求解、token 用量或模型成本评估。'] };
}
