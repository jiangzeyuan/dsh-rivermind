import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PokerTable } from '../src/core/engine.js';
import { OpponentProfile } from '../src/core/memory.js';
import { DshOpponent, DecisionFailure, type DshHostContext, type Opponent } from '../src/host/dsh.js';
import { PokerService } from '../src/host/service.js';

type Behavior = 'error' | 'provider-timeout' | 'max-tokens' | 'token-budget' | 'empty' | 'reject-input' | 'hang' | 'submit';
function runtime(behaviors: Behavior[], cancelThrows = false) {
  let onError: (event: { error: unknown }) => void = () => {};
  let onSessionEvent: (session: { id: string }, event: any) => void = () => {};
  let selection = { provider: 'test-provider', model: 'deepseek-flash', reasoningEffort: 'high' };
  const tools = new Map<string, any>();
  let activity = Promise.resolve(), finish = () => {}, creations = 0;
  const ctx = {
    sessions: { create: (id: string) => ({ id }) },
    agentDefaultModel: { currentSelection: () => ({ ...selection }) },
    agents: { async create(options: any) {
      creations++;
      let headerLogged = false;
      const agent = { id: options.sessionId, whenIdle: () => activity,
        cancel() { finish(); if (cancelThrows) throw new Error('cleanup failed'); },
        followup(message: any) {
          let behavior = behaviors.shift();
          if (behavior === 'token-budget') behavior = (options.agentOptions.maxTokens ?? 8192) < 4096 ? 'max-tokens' : 'submit';
          if (behavior === 'reject-input') throw new Error('input not accepted');
          activity = new Promise(resolve => { finish = resolve; });
          if (behavior === 'hang') return;
          queueMicrotask(() => {
            try {
              onSessionEvent({ id: 'another-agent' }, { type: 'request/header', data: { header: { config: { provider: 'foreign', model: 'secret-model' } } } });
              if (!headerLogged) {
                onSessionEvent({ id: options.sessionId }, { type: 'request/header', data: { header: { config: { ...options.agentOptions, model: options.agentOptions.model + '-resolved', maxTokens: 8192, apiKey: 'secret-header-key' } } } });
                headerLogged = true;
              } else onSessionEvent({ id: options.sessionId }, { type: 'assistant/attempt', data: {} });
              if (behavior === 'error') onError({ error: Object.assign(new Error('private provider payload'), { code: 'TRANSPORT' }) });
              if (behavior === 'provider-timeout') onError({ error: Object.assign(new Error('private timeout endpoint'), { code: 'TIMEOUT' }) });
              if (behavior === 'max-tokens') {
                onSessionEvent({ id: options.sessionId }, { type: 'turn/end', data: { reason: { kind: 'max-tokens' } } });
              }
              if (behavior === 'submit') {
                const view = JSON.parse(message.content[0].text.split('Observation:\n')[1].split('\nCurrent public')[0]);
                tools.get('submit_action').execute({ handId: view.handId, revision: view.revision,
                  type: 'check', rationale: '过牌观察。' }, { signal: new AbortController().signal, concludeTurn() {} });
              }
            } finally { finish(); }
          });
        },
      };
      options.setup({ on(name: string, handler: any) { if (name === 'agent/error') onError = handler; else if (name === 'session/event') onSessionEvent = handler; },
        tools: { restrict() {}, presentAs() {}, register(tool: any) { tools.set(tool.name, tool); } },
        systemPrompt: { section() {}, suppressRuntimeContext() {} } }, agent);
      return { agent, dispose: async () => {} };
    } },
  } as unknown as DshHostContext;
  return { ctx, setSelection(next: typeof selection) { selection = next; }, get creations() { return creations; } };
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

test('reasoning can exceed the old response cap and still submit inside the independent decision deadline', async () => {
  const mock = runtime(['token-budget']), opponent = new DshOpponent(mock.ctx);
  try {
    const result = await opponent.decide(observation(), new OpponentProfile().recall(), new AbortController().signal);
    assert.deepEqual(result.action, { type: 'check' });
    assert.equal(result.trace?.budget?.timeoutSeconds, 60);
    assert.equal(result.trace?.failure, undefined);
  } finally { await opponent.dispose(); }
});
for (const [behavior, kind, code] of [['max-tokens', 'no-action', 'MAX_TOKENS'], ['provider-timeout', 'agent-error', 'TIMEOUT']] as const) {
  test(behavior + ' remains a model failure while the 60s decision deadline has not expired', async () => {
    const opponent = new DshOpponent(runtime([behavior]).ctx), controller = new AbortController();
    try {
      await assert.rejects(opponent.decide(observation(), new OpponentProfile().recall(), controller.signal), (error: unknown) => {
        assert(error instanceof DecisionFailure);
        assert.equal(controller.signal.aborted, false);
        assert.equal(error.trace.budget?.timeoutSeconds, 60);
        assert.equal(error.trace.failure, 'runtime');
        assert.deepEqual(error.trace.runtimeError, { kind, code });
        assert(!JSON.stringify(error.trace).includes('private timeout endpoint'));
        return true;
      });
    } finally { await opponent.dispose(); }
  });
}
for (const [code, description] of [['MAX_TOKENS', '模型输出额度耗尽'], ['TIMEOUT', '模型请求超时']] as const) {
  test('finished fallback preserves distinct ' + code + ' diagnostics without claiming the 60s budget expired', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rivermind-model-limit-'));
    const opponent: Opponent = { async decide(_view, _memory, _signal, budget) {
      throw new DecisionFailure({ budget, tools: [], durationMs: 20000, failure: 'runtime',
        runtimeError: { kind: code === 'MAX_TOKENS' ? 'no-action' : 'agent-error', code } });
    }, dispose: async () => {} };
    const service = new PokerService(dir, opponent);
    try {
      let view = service.dispatch('deal', { revision: 0 });
      service.dispatch('action', { revision: view.revision, handId: view.handId, action: { type: 'call' } });
      await new Promise(resolve => setImmediate(resolve)); view = service.snapshot();
      assert(view.runtime.issue?.includes(description)); assert(!view.runtime.issue?.includes('超过 60 秒'));
      assert(!view.runtime.issue?.includes('调整 Iris 预算'));
      service.dispatch('action', { revision: view.revision, handId: view.handId, action: { type: 'fold' } });
      const fallback = service.dispatch('review', { handId: view.handId }).view.events.find(event => event.source === 'fallback');
      assert.equal(fallback?.trace?.runtimeError?.code, code);
      assert.equal(fallback?.trace?.durationMs, 20000);
      assert.equal(fallback?.trace?.budget?.timeoutSeconds, 60);
    } finally { await service.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
}

test('diagnostics distinguish the captured selection from the actual request model across Agent reuse', async () => {
  const mock = runtime(['submit', 'submit']), opponent = new DshOpponent(mock.ctx);
  try {
    const first = await opponent.decide(observation(), new OpponentProfile().recall(), new AbortController().signal);
    assert.equal(first.trace!.model!.selected!.model, 'deepseek-flash');
    assert.equal(first.trace!.model!.resolved!.model, 'deepseek-flash-resolved');
    assert.equal(first.trace!.model!.resolved!.maxTokens, 8192);
    assert.equal(first.trace!.sessionId, opponent.sessionId);
    assert(first.trace!.decisionId); assert(first.trace!.startedAt);
    assert(!JSON.stringify(first.trace).includes('secret-'));
    mock.setSelection({ provider: 'test-provider', model: 'deepseek-pro', reasoningEffort: 'high' });
    const second = await opponent.decide(observation(), new OpponentProfile().recall(), new AbortController().signal);
    assert.deepEqual(second.trace!.model, first.trace!.model);
    assert.notEqual(second.trace!.decisionId, first.trace!.decisionId);
    assert.equal(mock.creations, 1);
  } finally { await opponent.dispose(); }
});

test('diagnostic metadata validation does not change the configured model route', async () => {
  const mock = runtime(['submit']);
  mock.setSelection({ provider: 'test-provider', model: 'custom model v2', reasoningEffort: 'high' });
  const opponent = new DshOpponent(mock.ctx);
  try {
    const result = await opponent.decide(observation(), new OpponentProfile().recall(), new AbortController().signal);
    assert.equal(result.source, 'dsh');
    assert.equal(result.trace!.model!.selected, undefined);
    assert.equal(result.trace!.model!.resolved, undefined);
  } finally { await opponent.dispose(); }
});
