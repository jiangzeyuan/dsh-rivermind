import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { baselineDecision } from '../core/baseline.js';
import { PokerTable } from '../core/engine.js';
import { PokerError, type Action, type Decision, type GameView } from '../core/types.js';
import { DecisionFailure, type Opponent } from './dsh.js';
import { ReviewStore, type HistoryPage, type SavedReview } from './reviews.js';
import { PlayerMemory, type OpponentMemory } from './memory.js';
import type { AgentBudget } from '../core/budget.js';
import { AgentSettings } from './settings.js';

export type Mode = 'baseline' | 'dsh';
export interface TableSnapshot extends GameView {
  runtime: { mode: Mode; dshAvailable: boolean; busy: boolean; sessionId: string | null; issue: string | null;
    budget: AgentBudget; thinking: { startedAt: number; budget: AgentBudget } | null };
  memory: OpponentMemory;
}
export class PokerService {
  #table = new PokerTable();
  #memory: PlayerMemory;
  #reviews: ReviewStore;
  #settings: AgentSettings;
  #thinking: { startedAt: number; budget: AgentBudget } | null = null;
  #busy = false;
  #issue: string | null = null;
  #recorded = new Set<string>();
  #mode: Mode;
  #disposed = false;
  #abort?: AbortController;
  constructor(dataDir: string, private readonly opponent?: Opponent, private readonly baselineDelay = 450,
    options: { agentBudget?: Partial<AgentBudget> } = {}) {
    this.#memory = new PlayerMemory(dataDir);
    this.#reviews = new ReviewStore(dataDir);
    this.#settings = new AgentSettings(dataDir, options.agentBudget);
    this.#issue = this.#settings.warning;
    this.#mode = opponent ? 'dsh' : 'baseline';
  }
  snapshot(): TableSnapshot {
    return { ...this.#table.viewFor('human', true), runtime: { mode: this.#mode, dshAvailable: !!this.opponent,
      busy: this.#busy, sessionId: this.opponent?.sessionId ?? null, issue: this.#issue,
      budget: this.#settings.budget, thinking: this.#thinking ? structuredClone(this.#thinking) : null }, memory: this.#memory.recall() };
  }
  dispatch(endpoint: 'history', payload: unknown): HistoryPage;
  dispatch(endpoint: 'review', payload: unknown): SavedReview;
  dispatch(endpoint: string, payload: unknown): TableSnapshot;
  dispatch(endpoint: string, payload: unknown): TableSnapshot | HistoryPage | SavedReview {
    if (this.#disposed) throw new PokerError('DISPOSED', '训练场已关闭。');
    if (endpoint === 'state') return this.snapshot();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new PokerError('BAD_REQUEST', '请求格式错误。', 400);
    const body = payload as Record<string, unknown>;
    if (endpoint === 'history') return this.#reviews.list(body.limit === undefined ? 50 : body.limit as number);
    if (endpoint === 'review') return this.#reviews.get(body.handId);
    if (this.#busy) throw new PokerError('AI_BUSY', 'Iris 正在行动，请稍候。');
    if (endpoint === 'mode') {
      if (body.mode !== 'baseline' && body.mode !== 'dsh') throw new PokerError('BAD_MODE', '未知对手模式。', 400);
      if (body.mode === 'dsh' && !this.opponent) throw new PokerError('DSH_UNAVAILABLE', '请从 DSH 插件启动，才能调用真实 Agent。', 400);
      if (this.#table.actingPlayer !== null) throw new PokerError('HAND_ACTIVE', '请在两手牌之间切换模式。');
      this.#mode = body.mode; this.#issue = null; return this.snapshot();
    }
    if (typeof body.revision !== 'number') throw new PokerError('BAD_REVISION', '缺少牌局版本。', 400);
    if (endpoint === 'settings') {
      this.#table.assertRevision(body.revision);
      if (this.#table.actingPlayer !== null) throw new PokerError('HAND_ACTIVE', '请在两手牌之间调整 Iris 预算。');
      this.#settings.save(body.budget); this.#issue = null; return this.snapshot();
    }
    if (endpoint === 'deal') {
      this.#table.newHand(body.revision); this.#issue = null;
    } else if (endpoint === 'action') {
      if (body.handId !== this.#table.handId) throw new PokerError('STALE_HAND', '手牌编号已过期。');
      if (!body.action || typeof body.action !== 'object' || Array.isArray(body.action)) throw new PokerError('BAD_ACTION', '缺少行动。', 400);
      // The HTTP caller is always the human seat. A supplied playerId has no authority.
      this.#table.apply('human', { action: body.action as Action, reason: '用户操作', source: 'human', memoryIds: [] }, body.revision);
    } else if (endpoint === 'reset') {
      this.#table.assertRevision(body.revision);
      if (this.#table.actingPlayer !== null) throw new PokerError('HAND_ACTIVE', '请在手牌结束后重新开始。');
      this.#table = new PokerTable(); this.#issue = null;
    } else throw new PokerError('NOT_FOUND', '未知牌桌操作。', 404);
    this.recordCompletedHand();
    void this.advanceAi();
    return this.snapshot();
  }
  private recordCompletedHand(): void {
    if (!this.#table.complete || this.#recorded.has(this.#table.handId)) return;
    const publicEvents = this.#table.publicHistory();
    appendFileSync(join(this.#memory.dataDir, 'hands.jsonl'), JSON.stringify({
      handId: this.#table.handId, result: this.#table.viewFor('human').result, events: publicEvents,
    }) + '\n', { mode: 0o600 });
    this.#reviews.append({ view: this.#table.viewFor('human', true), memoryBeforeUpdate: this.#memory.recall() });
    this.#memory.observe(this.#table.handId, publicEvents);
    this.#recorded.add(this.#table.handId);
  }
  private async advanceAi(): Promise<void> {
    if (this.#busy || this.#disposed || this.#table.actingPlayer !== 'iris') return;
    this.#busy = true;
    const controller = new AbortController();
    this.#abort = controller;
    try {
      while (!this.#disposed && this.#table.actingPlayer === 'iris') {
        const view = this.#table.viewFor('iris');
        const memory = this.#memory.recall();
        let decision: Decision;
        if (this.#mode === 'baseline') {
          await delay(this.baselineDelay, undefined, { signal: controller.signal });
          decision = baselineDecision(view, memory);
        } else {
          const budget = this.#settings.budget;
          this.#thinking = { startedAt: Date.now(), budget };
          try {
            decision = await this.opponent!.decide(view, memory,
              AbortSignal.any([controller.signal, AbortSignal.timeout(budget.timeoutSeconds * 1000)]), budget);
          } catch (error) {
            if (controller.signal.aborted) return;
            const failure = error instanceof DecisionFailure ? error.trace.failure : 'runtime';
            this.#issue = (failure === 'timeout' ? 'Iris 超过 ' + budget.timeoutSeconds + ' 秒思考时限'
              : failure === 'tool-budget' ? 'Iris 超过 ' + budget.maxToolCalls + ' 次工具调用上限' : 'DSH 未完成合法行动') +
              '，已执行安全兜底。可在手牌结束后调整 Iris 预算或切换为规则陪练。';
            decision = { action: view.legal.check ? { type: 'check' } : { type: 'fold' },
              source: 'fallback', reason: '模型调用未完成；无需新增筹码时过牌，否则弃牌。', memoryIds: [],
              trace: error instanceof DecisionFailure ? error.trace : { durationMs: 0, tools: [], failure: 'runtime', budget } };
          }
        }
        if (controller.signal.aborted || this.#disposed) return;
        this.#table.apply('iris', decision, view.revision);
        this.recordCompletedHand();
      }
    } catch {
      if (!this.#disposed) this.#issue = '牌局处理失败。请查看服务日志后重新启动。';
    } finally {
      this.#busy = false;
      this.#thinking = null;
      this.#abort = undefined;
    }
  }
  async dispose(): Promise<void> {
    this.#disposed = true; this.#abort?.abort();
    await this.opponent?.dispose();
  }
}
