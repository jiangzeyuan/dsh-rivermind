import { randomUUID } from 'node:crypto';
import { estimateEquity } from '../core/cards.js';
import { PokerError, type Action, type Card, type Decision, type DecisionTrace, type GameView } from '../core/types.js';
import type { OpponentMemory } from './memory.js';

// Minimal, verified 0.2.0-rc.2 SDK boundary. Runtime services are supplied by DSH;
// this plugin never bundles a second Cordis instance.
interface ToolExecution { signal: AbortSignal; concludeTurn(): void }
interface ToolDefinition {
  name: string; description: string; parameters: Record<string, unknown>;
  output: { schema: Record<string, unknown>; render(args: unknown, value: unknown): { type: 'text'; text: string }[] };
  isConcurrencySafe(): boolean;
  execute(args: Record<string, unknown>, exec: ToolExecution): unknown;
}
interface ScopedContext {
  tools: { register(tool: ToolDefinition): unknown; restrict(filter: { allow: string[] }): unknown; presentAs(mode: 'native'): unknown };
  systemPrompt: { section(section: { name: string; order: number; text: string; complete: boolean; interpolate: boolean }): unknown; suppressRuntimeContext(): unknown };
}
export interface AgentHandle {
  agent: { id: string; followup(message: unknown): void; whenIdle(): Promise<void>; cancel(cause: Error): void };
  dispose(): Promise<void>;
}
export interface DshHostContext {
  agents: { create(options: { sessionId: string; signal?: AbortSignal; agentOptions: Record<string, unknown>;
    setup(ctx: ScopedContext, agent: AgentHandle['agent']): void }): Promise<AgentHandle> };
  agentDefaultModel: { currentSelection(): Record<string, unknown> };
  connection: { fetch: { register(route: { path: string; methods: string[]; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }): unknown } };
  effect(callback: () => (() => void | Promise<void>), label?: string): unknown;
  logger: { info(message: string): void; warn(message: string): void };
}
interface Pending {
  view: GameView; memory: OpponentMemory; signal: AbortSignal; calls: number; recalled: boolean;
  trace: DecisionTrace;
  resolve(decision: Decision): void; reject(error: Error): void;
}
export class DecisionFailure extends Error {
  constructor(readonly trace: DecisionTrace) { super('Poker agent decision failed: ' + trace.failure); }
}
async function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', onAbort); }
}
export interface Opponent {
  readonly sessionId?: string;
  decide(view: GameView, memory: OpponentMemory, signal: AbortSignal): Promise<Decision>;
  dispose(): Promise<void>;
}
export function validateSubmittedAction(view: GameView, args: Record<string, unknown>): Action {
  if (args.handId !== view.handId || args.revision !== view.revision) throw new PokerError('STALE_TURN', '行动令牌已过期。');
  if (args.type === 'fold' && view.legal.fold) return { type: 'fold' };
  if (args.type === 'check' && view.legal.check) return { type: 'check' };
  if (args.type === 'call' && view.legal.call !== null) return { type: 'call' };
  if (args.type === 'raise' && typeof args.amount === 'number' && Number.isSafeInteger(args.amount) &&
      view.legal.raise && args.amount >= view.legal.raise.min && args.amount <= view.legal.raise.max) {
    return { type: 'raise', amount: args.amount };
  }
  throw new PokerError('ILLEGAL_ACTION', '该行动不符合当前规则。', 400);
}
export class DshOpponent implements Opponent {
  readonly sessionId = 'rivermind-iris-' + randomUUID();
  #handle?: AgentHandle;
  #pending?: Pending;
  #creating?: Promise<AgentHandle>;
  #disposed = false;
  constructor(private readonly ctx: DshHostContext) {}
  private async handle(signal: AbortSignal): Promise<AgentHandle> {
    this.#creating ??= this.ctx.agents.create({
      sessionId: this.sessionId, signal,
      agentOptions: { ...this.ctx.agentDefaultModel.currentSelection(), maxTokens: 2048 },
      setup: scoped => {
        scoped.tools.restrict({ allow: [] }); // Zero global tools; only these local capabilities remain.
        scoped.tools.presentAs('native'); // Avoid inheriting the coding-agent PTC executor.
        scoped.systemPrompt.suppressRuntimeContext();
        scoped.systemPrompt.section({
          name: 'rivermind.player', order: 0, complete: true, interpolate: false,
          text: 'You are Iris, a tight-aggressive heads-up Texas Holdem training opponent. ' +
            'Your observation contains only your cards and public information. Do not invent hidden cards. ' +
            'Use the supplied legal actions. Raise amounts are TOTAL contributions in the current street. ' +
            'You may use at most six tool calls per decision. You have no coding or file tools. ' +
            'Recall public opponent statistics when useful; use conditions matching street, position and bet size. ' +
            'Condition opportunities, not total hands, are the denominator; fewer than ten opportunities is weak evidence. ' +
            'Use observation.facts for contestable pot odds and effective stacks, excluding uncalled returns. ' +
            'Submit exactly one action with submit_action, copying handId and revision from the observation. ' +
            'Give a concise Chinese justification citing odds or public behavior, not a private reasoning transcript; ' +
            'do not disclose your exact hole cards in the justification. Only cite memoryIds returned by recall_opponent. ' +
            'Use estimate_equity if useful; it assumes a random opponent range and is not a poker solver. ' +
            'After submitting, this turn ends. Your personality is calm, disciplined, and willing to apply pressure with strong evidence.',
        });
        this.registerTool(scoped, 'get_observation', 'Return only your own cards, public board, public actions, and legal choices.', {}, true,
          (_args, pending) => pending.view);
        this.registerTool(scoped, 'recall_opponent', 'Recall your own evidence-backed memory of the human opponent; never contains private cards.', {}, true,
          (_args, pending) => { pending.recalled = true; return pending.memory; });
        this.registerTool(scoped, 'estimate_equity', 'Estimate equity against a random opponent using only visible cards. At most 200 trials.', {
          trials: { type: 'integer', minimum: 1, maximum: 200 },
        }, true, (args, pending) => {
          const trials = args.trials === undefined ? 120 : args.trials;
          if (typeof trials !== 'number' || !Number.isInteger(trials) || trials < 1 || trials > 200) throw new Error('trials must be 1–200.');
          const hero = pending.view.players.find(player => player.id === 'iris')!;
          return { equity: estimateEquity(hero.cards as Card[], pending.view.board, trials), trials,
            assumption: 'random opponent range; unseen cards sampled independently of the actual deck' };
        });
        this.registerTool(scoped, 'submit_action', 'Submit your legal action for the exact handId and revision. Ends this agent turn.', {
          handId: { type: 'string' }, revision: { type: 'integer' },
          type: { type: 'string', enum: ['fold', 'check', 'call', 'raise'] }, amount: { type: 'integer', minimum: 1 },
          rationale: { type: 'string', minLength: 1, maxLength: 500 },
          memoryIds: { type: 'array', items: { type: 'string' }, maxItems: 1 },
        }, false, (args, pending, exec) => {
          const action = validateSubmittedAction(pending.view, args);
          if (typeof args.rationale !== 'string' || args.rationale.trim().length === 0 || args.rationale.length > 500) throw new Error('Provide a concise rationale.');
          const memoryIds = args.memoryIds ?? [];
          if (!Array.isArray(memoryIds) || memoryIds.length > 1 || (memoryIds.length > 0 && !pending.recalled) ||
              memoryIds.some(id => id !== pending.memory.id || pending.memory.handsObserved === 0)) throw new Error('Unknown memory evidence.');
          exec.concludeTurn();
          this.#pending = undefined; // Reject duplicate or late tool submissions immediately.
          pending.resolve({ action, reason: args.rationale, source: 'dsh', memoryIds, trace: pending.trace });
          return { accepted: true, handId: pending.view.handId, revision: pending.view.revision };
        }, ['handId', 'revision', 'type', 'rationale']);
      },
    });
    try {
      const handle = await this.#creating;
      if (this.#disposed) { await handle.dispose(); throw new Error('Poker opponent disposed.'); }
      this.#handle = handle; return handle;
    } catch (error) { this.#creating = undefined; throw error; }
  }
  private registerTool(scoped: ScopedContext, name: string, description: string, properties: Record<string, unknown>,
    safe: boolean, execute: (args: Record<string, unknown>, pending: Pending, exec: ToolExecution) => unknown,
    required: string[] = []): void {
    scoped.tools.register({
      name, description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
      output: { schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      isConcurrencySafe: () => safe,
      execute: (args, exec) => {
        const pending = this.#pending;
        if (!pending || pending.signal.aborted || exec.signal.aborted) throw new Error('No live poker decision.');
        const started = performance.now();
        const record = { name, status: 'ok' as 'ok' | 'error', durationMs: 0 };
        pending.trace.tools.push(record);
        pending.calls++;
        if (pending.calls > 6) {
          const error = new Error('Poker tool budget exhausted.');
          record.status = 'error';
          pending.reject(error);
          throw error;
        }
        try {
          const value = execute(args, pending, exec);
          if (name === 'estimate_equity') {
            const estimate = value as { equity: number; trials: number; assumption: string };
            pending.trace.equity = { value: estimate.equity, trials: estimate.trials, assumption: estimate.assumption };
          }
          return value;
        } catch (error) { record.status = 'error'; throw error; }
        finally { record.durationMs = performance.now() - started; }
      },
    });
  }
  async decide(view: GameView, memory: OpponentMemory, signal: AbortSignal): Promise<Decision> {
    if (this.#disposed) throw new Error('Poker opponent disposed.');
    const started = performance.now();
    const trace: DecisionTrace = { facts: structuredClone(view.facts), durationMs: 0, tools: [] };
    try {
      signal.throwIfAborted();
      const handle = await withSignal(this.handle(signal), signal);
      // Idle alone is not a decision correlation; the bound submit tool resolves the exact request.
      await withSignal(handle.agent.whenIdle(), signal);
      signal.throwIfAborted();
      const decision = await new Promise<Decision>((resolve, reject) => {
        const onAbort = () => {
          this.#pending = undefined;
          handle.agent.cancel(new Error('Poker decision deadline exceeded.'));
          reject(signal.reason);
        };
        const cleanup = () => signal.removeEventListener('abort', onAbort);
        this.#pending = { view: structuredClone(view), memory: structuredClone(memory), signal, calls: 0, recalled: false, trace,
          resolve: decision => { cleanup(); resolve(decision); },
          reject: error => { cleanup(); this.#pending = undefined; handle.agent.cancel(error); reject(error); } };
        signal.addEventListener('abort', onAbort, { once: true });
        try {
          handle.agent.followup({ id: randomUUID(), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Your turn. Observation:\n' + JSON.stringify(view) }] });
        } catch (error) { this.#pending?.reject(error instanceof Error ? error : new Error('Agent input failed.')); }
      });
      trace.durationMs = performance.now() - started;
      return decision;
    } catch (error) {
      this.#handle?.agent.cancel(new Error('Poker decision failed.'));
      trace.durationMs = performance.now() - started;
      trace.failure = signal.aborted && signal.reason?.name === 'TimeoutError' ? 'timeout'
        : error instanceof Error && error.message === 'Poker tool budget exhausted.' ? 'tool-budget' : 'runtime';
      throw new DecisionFailure(trace);
    }
  }
  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#pending?.reject(new Error('Poker opponent disposed.'));
    this.#pending = undefined;
    await this.#handle?.dispose();
    this.#handle = undefined; this.#creating = undefined;
  }
}
