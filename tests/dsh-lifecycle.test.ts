import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PokerTable } from '../src/core/engine.js';
import { OpponentProfile } from '../src/core/memory.js';
import { DshOpponent, DecisionFailure, type DshHostContext, type Opponent } from '../src/host/dsh.js';
import { PokerService } from '../src/host/service.js';

type Behavior = 'error' | 'empty' | 'reject-input' | 'hang' | 'submit';
function runtime(behaviors: Behavior[], cancelThrows = false) {
  let onError: (event: { error: unknown }) => void = () => {};
  const tools = new Map<string, any>();
  let activity = Promise.resolve(), finish = () => {}, creations = 0;
  const ctx = {
    sessions: { create: (id: string) => ({ id }) },
    agentDefaultModel: { currentSelection: () => ({}) },
    agents: { async create(options: any) {
      creations++;
      const agent = { id: options.sessionId, whenIdle: () => activity,
        cancel() { finish(); if (cancelThrows) throw new Error('cleanup failed'); },
        followup(message: any) {
          const behavior = behaviors.shift();
          if (behavior === 'reject-input') throw new Error('input not accepted');
          activity = new Promise(resolve => { finish = resolve; });
          if (behavior === 'hang') return;
          queueMicrotask(() => {
            try {
              if (behavior === 'error') onError({ error: Object.assign(new Error('private provider payload'), { code: 'TRANSPORT' }) });
              if (behavior === 'submit') {
                const view = JSON.parse(message.content[0].text.split('Observation:\n')[1].split('\nCurrent public')[0]);
                tools.get('submit_action').execute({ handId: view.handId, revision: view.revision,
                  type: 'check', rationale: '过牌观察。' }, { signal: new AbortController().signal, concludeTurn() {} });
              }
            } finally { finish(); }
          });
        },
      };
      options.setup({ on(_name: string, handler: typeof onError) { onError = handler; },
        tools: { restrict() {}, presentAs() {}, register(tool: any) { tools.set(tool.name, tool); } },
        systemPrompt: { section() {}, suppressRuntimeContext() {} } }, agent);
      return { agent, dispose: async () => {} };
    } },
  } as unknown as DshHostContext;
  return { ctx, get creations() { return creations; } };
}
function observation() {
  const table = new PokerTable(); table.newHand(0);
  table.apply('human', { action: { type: 'call' }, source: 'human', reason: 'test', memoryIds: [] }, table.revision);
  return table.viewFor('iris');
}
for (const [behavior, kind] of [['error', 'agent-error'], ['empty', 'no-action'], ['reject-input', 'input-rejected']] as const) {
  test('DSH ' + behavior + ' fails immediately with a distinct diagnostic rather than waiting for timeout', async () => {
    const opponent = new DshOpponent(runtime([behavior]).ctx);
    const controller = new AbortController();
    try {
      await assert.rejects(opponent.decide(observation(), new OpponentProfile().recall(), controller.signal), (error: unknown) => {
        assert(error instanceof DecisionFailure);
        assert.equal(error.trace.failure, 'runtime'); assert.equal(error.trace.runtimeError?.kind, kind);
        assert.equal(controller.signal.aborted, false);
        if (behavior === 'error') assert.equal(error.trace.runtimeError?.code, 'TRANSPORT');
        assert(!JSON.stringify(error.trace).includes('private provider payload'));
        if (behavior === 'reject-input') assert.equal(error.trace.memory?.provided, false);
        return true;
      });
    } finally { await opponent.dispose(); }
  });
}
test('cancellation failure does not hide a model error; a later turn can submit on the same Agent', async () => {
  const mock = runtime(['error', 'submit'], true), opponent = new DshOpponent(mock.ctx);
  try {
    await assert.rejects(opponent.decide(observation(), new OpponentProfile().recall(), new AbortController().signal),
      (error: unknown) => error instanceof DecisionFailure && error.trace.runtimeError?.kind === 'agent-error');
    const decision = await opponent.decide(observation(), new OpponentProfile().recall(), new AbortController().signal);
    assert.deepEqual(decision.action, { type: 'check' }); assert.equal(mock.creations, 1);
    assert.equal(decision.trace?.runtimeError, undefined);
  } finally { await opponent.dispose(); }
});
test('a genuinely running Agent remains bounded by the deadline', async () => {
  const opponent = new DshOpponent(runtime(['hang']).ctx), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('deadline', 'TimeoutError')), 20);
  try {
    await assert.rejects(opponent.decide(observation(), new OpponentProfile().recall(), controller.signal),
      (error: unknown) => error instanceof DecisionFailure && error.trace.failure === 'timeout' && !error.trace.runtimeError);
  } finally { clearTimeout(timer); await opponent.dispose(); }
});
test('service reports runtime failure separately and saves its diagnostic with the fallback', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rivermind-runtime-error-'));
  const opponent: Opponent = { async decide(_view, _memory, _signal, budget) {
    throw new DecisionFailure({ budget, tools: [], durationMs: 3, failure: 'runtime', runtimeError: { kind: 'agent-error', code: 'TRANSPORT' } });
  }, dispose: async () => {} };
  const service = new PokerService(dir, opponent);
  try {
    let view = service.dispatch('deal', { revision: 0 });
    service.dispatch('action', { revision: view.revision, handId: view.handId, action: { type: 'call' } });
    await new Promise(resolve => setImmediate(resolve)); view = service.snapshot();
    assert(view.runtime.issue?.includes('TRANSPORT')); assert(!view.runtime.issue?.includes('调整 Iris 预算'));
    assert.deepEqual(view.runtime.budget, { timeoutSeconds: 60, maxToolCalls: 10 });
    service.dispatch('action', { revision: view.revision, handId: view.handId, action: { type: 'fold' } });
    const fallback = service.dispatch('review', { handId: view.handId }).view.events.find(event => event.source === 'fallback');
    assert.deepEqual(fallback?.trace?.runtimeError, { kind: 'agent-error', code: 'TRANSPORT' });
  } finally { await service.dispose(); rmSync(dir, { recursive: true, force: true }); }
});
