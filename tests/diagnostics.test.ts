import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { decisionDiagnostics, handDiagnostics, memoryDiagnostics, traceError } from '../src/core/diagnostics.js';
import type { DecisionTrace, GameView, HandEvent } from '../src/core/types.js';
import { DecisionFailure, type Opponent } from '../src/host/dsh.js';
import { PokerService } from '../src/host/service.js';
import { OpponentProfile } from '../src/core/memory.js';

const trace: DecisionTrace = {
  decisionId: 'decision-test', startedAt: '2026-10-06T01:00:00.000Z', sessionId: 'iris-test', pluginVersion: '0.3.2',
  model: { selected: { provider: 'deepseek-account', model: 'deepseek-flash' },
    resolved: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high', maxTokens: 8192 } },
  budget: { timeoutSeconds: 60, maxToolCalls: 10 }, durationMs: 13000,
  tools: [{ name: 'estimate_equity', status: 'ok', durationMs: 8 }],
  failure: 'runtime', runtimeError: { kind: 'agent-error', code: 'TIMEOUT', status: 504, requestId: 'req-123',
    providerRetryAfterMs: 1000, causes: [{ code: 'ETIMEDOUT' }] },
  facts: { position: 'big-blind', toCall: 0, contestablePotAfterCall: 40, uncalledReturnAfterCall: 0, potOdds: 0, effectiveStack: 1980, stackToPotRatioAfterCall: 49.5 },
  equity: { value: .9, trials: 120, assumption: 'random opponent range' },
  memory: { id: 'memory-test', handsObserved: 3, provided: true, retrieved: false, cited: false },
};
const event: HandEvent = { id: 4, handId: 'test:1', street: 'preflop', kind: 'action', playerId: 'iris',
  message: 'Iris 过牌', source: 'fallback', action: { type: 'check' }, reason: 'private-free-text', trace };
const hand = { handId: 'test:1', handNumber: 1, smallBlind: 10, bigBlind: 20, street: 'complete' as const };

test('completed diagnostic export retains every supported trace field and excludes raw or unknown payloads', () => {
  const hostile = structuredClone(event);
  Object.assign(hostile, { cards: ['As', 'Ah'], apiKey: 'secret-event' });
  Object.assign(hostile.trace!, { prompt: 'secret-prompt', stack: '/private/secret-stack' });
  Object.assign(hostile.trace!.model!.resolved!, { apiKey: 'secret-model' });
  Object.assign(hostile.trace!.tools[0]!, { arguments: 'secret-tool' });
  Object.assign(hostile.trace!.runtimeError!, { message: 'secret-error', headers: { authorization: 'secret-token' } });
  const report = decisionDiagnostics(hand, hostile);
  assert.equal(report.scope, 'completed-hand');
  assert.deepEqual(report.trace, trace);
  assert.deepEqual(report.coverage, { trace: 'recorded', model: 'resolved-request' });
  assert(!JSON.stringify(report).includes('secret-'));
  assert(!JSON.stringify(report).includes('private-free-text'));
  report.trace!.tools[0]!.status = 'error';
  assert.equal(hostile.trace!.tools[0]!.status, 'ok');
});

test('in-hand diagnostics expose runtime metadata while withholding decision evidence until completion', () => {
  const report = decisionDiagnostics({ ...hand, street: 'flop' }, event);
  assert.equal(report.scope, 'runtime-only');
  for (const field of ['facts', 'equity', 'memory']) assert(!(field in report.trace!));
  assert.deepEqual(report.trace!.model, trace.model);
  assert.deepEqual(report.trace!.runtimeError, trace.runtimeError);
  assert.deepEqual(report.trace!.tools, trace.tools);
  assert.equal(decisionDiagnostics(hand, event).trace!.equity!.value, .9);
});

test('legacy reviews report missing trace or model rather than fabricating defaults', () => {
  const legacy = decisionDiagnostics(hand, { ...event, trace: undefined });
  assert.equal(legacy.trace, null);
  assert.deepEqual(legacy.coverage, { trace: 'not-recorded', model: 'not-recorded' });
  const selected = decisionDiagnostics(hand, { ...event, trace: { durationMs: 0, tools: [], model: { selected: trace.model!.selected } } });
  assert.equal(selected.coverage.model, 'selected-only');
  assert.equal(selected.trace!.model!.resolved, undefined);
});

test('structured provider error diagnostics retain HTTP and bounded cause codes without messages or credentials', () => {
  const cause = Object.assign(new Error('secret endpoint'), { code: 'ETIMEDOUT' });
  Object.assign(cause, { cause });
  const error = Object.assign(new Error('secret body'), { cause,
    failure: { code: 'TIMEOUT', message: 'secret failure', status: 504, requestId: 'req-123', providerRetryAfterMs: 500 } });
  assert.deepEqual(traceError(error), { code: 'TIMEOUT', status: 504, requestId: 'req-123', providerRetryAfterMs: 500, causes: [{ code: 'ETIMEDOUT' }] });
  assert.deepEqual(traceError({ code: 'url with secret', status: 700, requestId: 'Authorization: secret', providerRetryAfterMs: -1 }), {});
});

test('fallback report is available immediately, gains completed evidence, and survives review storage reload', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rivermind-diagnostics-'));
  const opponent: Opponent = { decide: async () => { throw new DecisionFailure(structuredClone(trace)); }, dispose: async () => {} };
  let service = new PokerService(root, opponent);
  try {
    let state = service.dispatch('deal', { revision: 0 });
    state = service.dispatch('action', { handId: state.handId, revision: state.revision, action: { type: 'call' } });
    await new Promise(resolve => setImmediate(resolve));
    state = service.snapshot();
    const live = state.runtime.lastFallback!;
    assert.equal(state.street, 'flop');
    assert.equal(live.scope, 'runtime-only');
    assert.equal(live.trace!.runtimeError!.code, 'TIMEOUT');
    assert.equal(live.trace!.equity, undefined);
    assert(state.players.find(player => player.id === 'iris')!.cards.every(card => card === null));
    assert(state.events.every(event => event.trace === undefined));
    state = service.dispatch('action', { handId: state.handId, revision: state.revision, action: { type: 'fold' } });
    assert.equal(state.runtime.lastFallback!.scope, 'completed-hand');
    assert.deepEqual(state.runtime.lastFallback!.trace, trace);
    await service.dispose(); service = new PokerService(root, undefined, 0);
    const review = service.dispatch('review', { handId: state.handId });
    const saved = review.view.events.find(event => event.id === live.decision.eventId)!;
    const restored = decisionDiagnostics(review.view, saved);
    assert.equal(restored.scope, 'completed-hand');
    assert.deepEqual(restored.trace, trace);
    assert.equal(restored.decision.source, 'fallback');
  } finally { await service.dispose(); rmSync(root, { recursive: true, force: true }); }
});

test('unexpected adapter errors retain measured elapsed time and structured diagnostics in the immediate report', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rivermind-unexpected-diagnostics-'));
  const service = new PokerService(root, { sessionId: 'unexpected-iris', decide: async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    throw Object.assign(new Error('secret endpoint details'), { code: 'TRANSPORT', failure: { code: 'TRANSPORT', status: 503 } });
  }, dispose: async () => {} });
  try {
    const state = service.dispatch('deal', { revision: 0 });
    service.dispatch('action', { handId: state.handId, revision: state.revision, action: { type: 'call' } });
    for (let i = 0; i < 50 && service.snapshot().runtime.busy; i++) await new Promise(resolve => setTimeout(resolve, 5));
    const report = service.snapshot().runtime.lastFallback!;
    assert(report.trace!.durationMs >= 5);
    assert.equal(report.trace!.sessionId, 'unexpected-iris');
    assert.deepEqual(report.trace!.runtimeError, { kind: 'agent-error', code: 'TRANSPORT', status: 503 });
    assert(!JSON.stringify(report).includes('secret endpoint'));
  } finally { await service.dispose(); rmSync(root, { recursive: true, force: true }); }
});

test('evidence hand export includes successful, baseline and fallback diagnostics without leaking hand or raw events', () => {
  const view = { ...hand, players: [{ cards: ['As', 'Ah'] }],
    events: [{ ...event, id: 1, source: 'dsh', trace: { ...trace, failure: undefined, runtimeError: undefined } },
      { ...event, id: 2, source: 'baseline' }, { ...event, id: 3, trace: undefined },
      { ...event, id: 4, playerId: 'human', source: 'human' }] } as unknown as GameView;
  const report = handDiagnostics(view);
  assert.equal(report.schema, 'rivermind.hand-diagnostics/v1');
  assert.deepEqual(report.coverage, { recorded: 2, missing: 1 });
  assert.deepEqual(report.decisions.map(item => item.decision.source), ['dsh', 'baseline', 'fallback']);
  assert.equal(report.decisions[2]!.coverage.trace, 'not-recorded');
  assert(!JSON.stringify(report).includes('cards'));
  assert(!JSON.stringify(report).includes('private-free-text'));
  const live = handDiagnostics({ ...view, street: 'flop' });
  assert(live.decisions.every(item => item.scope === 'runtime-only' && !item.trace?.equity));
});

test('memory exports keep only public counters and selected evidence, preserve absent legacy conditions, and detach snapshots', () => {
  const memory = new OpponentProfile({ version: 2, handIds: ['test:1', 'test:2'], folded: 1, voluntary: 1, aggressive: 1,
    contexts: { 'flop:button:small': { opportunities: 1, folds: 1, calls: 0, raises: 0, evidenceHandIds: ['test:1'] },
      'turn:button:large': { opportunities: 1, folds: 0, calls: 1, raises: 0, evidenceHandIds: ['test:2'] } } }).recall();
  Object.assign(memory, { cards: 'secret-card', apiKey: 'secret-token' });
  Object.assign(memory.conditions[0]!, { rawPrompt: 'secret-prompt' });
  const profile = memoryDiagnostics(memory);
  assert.equal(profile.scope, 'profile');
  assert.equal(profile.memory.conditions!.length, 2);
  assert(!JSON.stringify(profile).includes('secret-'));
  const selected = memoryDiagnostics(memory, memory.conditions[0]);
  assert.equal(selected.scope, 'condition');
  assert.equal(selected.memory.conditions!.length, 1);
  assert.deepEqual(selected.memory.evidenceHandIds, ['test:1']);
  selected.memory.conditions![0]!.foldRateInterval[0] = .123;
  assert.notEqual(memory.conditions[0]!.foldRateInterval[0], .123);
  const legacy = structuredClone(memory);
  Reflect.deleteProperty(legacy, 'conditions'); Reflect.deleteProperty(legacy, 'schemaVersion');
  const old = memoryDiagnostics(legacy);
  assert.equal(old.memory.conditions, undefined);
  assert.equal(old.memory.schemaVersion, undefined);
});
