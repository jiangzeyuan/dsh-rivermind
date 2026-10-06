import type { ConditionMemory, OpponentMemory } from './memory.js';
import type { DecisionTrace, GameView, HandEvent, TraceModel } from './types.js';
import { PLUGIN_VERSION } from './metadata.js';

export function traceModel(value: unknown): TraceModel | undefined {
  if (!value || typeof value !== 'object') return;
  const model = value as Record<string, unknown>;
  const identifier = (v: unknown): v is string => typeof v === 'string' && /^[\w./:@+-]{1,200}$/.test(v);
  if (!identifier(model.provider) || !identifier(model.model)) return;
  return { provider: model.provider, model: model.model,
    ...(identifier(model.reasoningEffort) ? { reasoningEffort: model.reasoningEffort } : {}),
    ...(Number.isSafeInteger(model.maxTokens) && (model.maxTokens as number) > 0 ? { maxTokens: model.maxTokens as number } : {}) };
}

type ErrorDetails = Omit<NonNullable<DecisionTrace['runtimeError']>, 'kind'>;
export function traceError(error: unknown): ErrorDetails {
  const result: ErrorDetails = {};
  const seen = new Set<unknown>();
  let current = error;
  for (let i = 0; i < 5 && current && typeof current === 'object' && !seen.has(current); i++) {
    seen.add(current);
    const candidate = current as Record<string, unknown>;
    const failure = candidate.failure && typeof candidate.failure === 'object' ? candidate.failure as Record<string, unknown> : candidate;
    const code = failure.code ?? candidate.code;
    const status = failure.status;
    const safeCode = typeof code === 'string' && /^[A-Z][A-Z0-9_-]{0,39}$/.test(code) ? code : undefined;
    const safeStatus = Number.isInteger(status) && (status as number) >= 100 && (status as number) <= 599 ? status as number : undefined;
    if (i === 0) {
      if (safeCode) result.code = safeCode;
      if (safeStatus) result.status = safeStatus;
      if (typeof failure.requestId === 'string' && /^[\w.:/-]{1,160}$/.test(failure.requestId)) result.requestId = failure.requestId;
      if (typeof failure.providerRetryAfterMs === 'number' && Number.isFinite(failure.providerRetryAfterMs) && failure.providerRetryAfterMs > 0) {
        result.providerRetryAfterMs = failure.providerRetryAfterMs;
      }
    } else if (safeCode || safeStatus) {
      (result.causes ??= []).push({ ...(safeCode ? { code: safeCode } : {}), ...(safeStatus ? { status: safeStatus } : {}) });
    }
    current = candidate.cause;
  }
  return result;
}

// Project every supported trace field explicitly. Never serialize arbitrary
// provider objects, model messages, raw tool arguments or unknown legacy fields.
export function diagnosticTrace(trace: DecisionTrace | undefined, completed: boolean): DecisionTrace | null {
  if (!trace) return null;
  const { decisionId, startedAt, sessionId, pluginVersion, durationMs, budget, model, failure, runtimeError } = trace;
  return {
    ...(decisionId ? { decisionId } : {}), ...(startedAt ? { startedAt } : {}),
    ...(sessionId ? { sessionId } : {}), ...(pluginVersion ? { pluginVersion } : {}), durationMs,
    ...(budget ? { budget: { timeoutSeconds: budget.timeoutSeconds, maxToolCalls: budget.maxToolCalls } } : {}),
    ...(model ? { model: {
      ...(traceModel(model.selected) ? { selected: traceModel(model.selected) } : {}),
      ...(traceModel(model.resolved) ? { resolved: traceModel(model.resolved) } : {}),
    } } : {}),
    tools: trace.tools.map(({ name, status, durationMs }) => ({ name, status, durationMs })),
    ...(failure ? { failure } : {}),
    ...(runtimeError ? { runtimeError: { kind: runtimeError.kind, ...traceError(runtimeError),
      ...(runtimeError.causes?.length ? { causes: runtimeError.causes.map(({ code, status }) => traceError({ code, status })) } : {}) } } : {}),
    ...(completed && trace.facts ? { facts: { position: trace.facts.position, toCall: trace.facts.toCall,
      contestablePotAfterCall: trace.facts.contestablePotAfterCall, uncalledReturnAfterCall: trace.facts.uncalledReturnAfterCall,
      potOdds: trace.facts.potOdds, effectiveStack: trace.facts.effectiveStack, stackToPotRatioAfterCall: trace.facts.stackToPotRatioAfterCall } } : {}),
    ...(completed && trace.equity ? { equity: { value: trace.equity.value, trials: trace.equity.trials, assumption: trace.equity.assumption } } : {}),
    ...(completed && trace.memory ? { memory: { id: trace.memory.id, handsObserved: trace.memory.handsObserved,
      provided: trace.memory.provided, retrieved: trace.memory.retrieved, cited: trace.memory.cited } } : {}),
  };
}

export interface DecisionDiagnostics {
  schema: 'rivermind.decision-diagnostics/v1';
  exporterVersion: string;
  scope: 'runtime-only' | 'completed-hand';
  coverage: { trace: 'recorded' | 'not-recorded'; model: 'resolved-request' | 'selected-only' | 'not-recorded' };
  hand: { handId: string; handNumber: number; smallBlind: number; bigBlind: number };
  decision: { eventId: number; street: HandEvent['street']; source: HandEvent['source']; action: HandEvent['action'] };
  trace: DecisionTrace | null;
}
export function decisionDiagnostics(view: Pick<GameView, 'handId' | 'handNumber' | 'smallBlind' | 'bigBlind' | 'street'>,
  event: HandEvent): DecisionDiagnostics {
  const completed = view.street === 'complete';
  const trace = diagnosticTrace(event.trace, completed);
  return { schema: 'rivermind.decision-diagnostics/v1', exporterVersion: PLUGIN_VERSION,
    scope: completed ? 'completed-hand' : 'runtime-only',
    coverage: { trace: trace ? 'recorded' : 'not-recorded',
      model: trace?.model?.resolved ? 'resolved-request' : trace?.model?.selected ? 'selected-only' : 'not-recorded' },
    hand: { handId: view.handId, handNumber: view.handNumber, smallBlind: view.smallBlind, bigBlind: view.bigBlind },
    decision: { eventId: event.id, street: event.street, source: event.source,
      action: event.action?.type === 'raise' ? { type: 'raise', amount: event.action.amount } : event.action ? { type: event.action.type } : undefined },
    trace };
}

export interface HandDiagnostics {
  schema: 'rivermind.hand-diagnostics/v1';
  exporterVersion: string;
  hand: DecisionDiagnostics['hand'];
  coverage: { recorded: number; missing: number };
  decisions: DecisionDiagnostics[];
}
export function handDiagnostics(view: GameView): HandDiagnostics {
  const decisions = view.events.filter(event => event.playerId === 'iris' && event.kind === 'action')
    .map(event => decisionDiagnostics(view, event));
  return { schema: 'rivermind.hand-diagnostics/v1', exporterVersion: PLUGIN_VERSION,
    hand: { handId: view.handId, handNumber: view.handNumber, smallBlind: view.smallBlind, bigBlind: view.bigBlind },
    coverage: { recorded: decisions.filter(decision => decision.trace !== null).length,
      missing: decisions.filter(decision => decision.trace === null).length }, decisions };
}

export interface MemoryDiagnostics {
  schema: 'rivermind.memory-diagnostics/v1';
  exporterVersion: string;
  scope: 'profile' | 'condition';
  memory: Omit<OpponentMemory, 'schemaVersion' | 'conditions'> & { schemaVersion?: 2; conditions?: ConditionMemory[] };
}
export function memoryDiagnostics(memory: OpponentMemory, condition?: ConditionMemory): MemoryDiagnostics {
  return { schema: 'rivermind.memory-diagnostics/v1', exporterVersion: PLUGIN_VERSION,
    scope: condition ? 'condition' : 'profile',
    memory: { id: memory.id, schemaVersion: memory.schemaVersion, ownerId: memory.ownerId, opponentId: memory.opponentId,
      handsObserved: memory.handsObserved, handsFolded: memory.handsFolded, voluntaryHands: memory.voluntaryHands,
      aggressiveHands: memory.aggressiveHands, summary: memory.summary,
      evidenceHandIds: [...(condition ? condition.evidenceHandIds : memory.evidenceHandIds)],
      ...(condition || memory.conditions ? { conditions: (condition ? [condition] : memory.conditions).map(item => ({ key: item.key, street: item.street,
        position: item.position, betSize: item.betSize, opportunities: item.opportunities, folds: item.folds,
        calls: item.calls, raises: item.raises, foldRate: item.foldRate, foldRateInterval: [...item.foldRateInterval],
        usable: item.usable, evidenceHandIds: [...item.evidenceHandIds] })) } : {}) } };
}

export type DiagnosticReport = DecisionDiagnostics | HandDiagnostics | MemoryDiagnostics;
