import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PokerTable } from '../src/core/engine.js';
import { OpponentProfile } from '../src/core/memory.js';
import { DEFAULT_AGENT_BUDGET } from '../src/core/budget.js';
import { PokerError, type Action, type Decision } from '../src/core/types.js';
import { parseBet, formatBet, betPresets } from '../src/client/betSizing.js';
import { AgentSettings } from '../src/host/settings.js';
import { PokerService } from '../src/host/service.js';
import { DecisionFailure, DshOpponent, type DshHostContext, type Opponent } from '../src/host/dsh.js';

function act(table: PokerTable, action: Action) {
  table.apply(table.actingPlayer!, { action, source: 'baseline', reason: 'test', memoryIds: [] }, table.revision);
}
test('fractional BB inputs preserve exact chips and reject fractional chips without clamping', () => {
  const bounds = { min: 40, max: 2000 };
  assert.equal(parseBet('2.5', 'bb', 20, bounds).amount, 50);
  assert.equal(parseBet('2.35', 'bb', 20, bounds).amount, 47);
  assert.equal(parseBet('47', 'chips', 20, bounds).amount, 47);
  for (const text of ['', '2.333', '-1', '101', 'Infinity']) assert.equal(parseBet(text, 'bb', 20, bounds).amount, null);
  assert.equal(parseBet('47.5', 'chips', 20, bounds).amount, null);
  assert.equal(parseBet('1', 'bb', 20, bounds).amount, null);
  assert.equal(parseBet('50', 'chips', 20, null).amount, null);
  assert.equal(parseBet(formatBet(41, 3, 'bb'), 'bb', 3, bounds).amount, 41);
});
test('BB presets are total street contributions and illegal presets remain unavailable', () => {
  const table = new PokerTable(); table.newHand(0);
  let choices = betPresets(table.viewFor('human')).blinds;
  assert.equal(choices.find(p => p.label === '2.5 BB')!.amount, 50);
  assert.equal(choices.find(p => p.label === '10 BB')!.amount, 200);
  assert.equal(choices.find(p => p.key === 'all-in')!.amount, 2000);
  act(table, { type: 'raise', amount: 200 }); act(table, { type: 'raise', amount: 600 });
  choices = betPresets(table.viewFor('human')).blinds;
  assert(choices.filter(p => p.key !== 'all-in').every(p => !p.available));
  assert(choices.find(p => p.key === 'all-in')!.available);
  const short = new PokerTable({ stacks: [35, 100] }); short.newHand(0);
  choices = betPresets(short.viewFor('human')).blinds;
  assert.equal(choices.filter(p => p.available).length, 1);
  assert.equal(choices.find(p => p.available)!.amount, 35);
});
test('postflop pot shortcuts add the chosen fraction after calling, rounded to one chip', () => {
  const table = new PokerTable(); table.newHand(0); act(table, { type: 'call' }); act(table, { type: 'check' });
  act(table, { type: 'raise', amount: 40 });
  const view = table.viewFor('human');
  const half = betPresets(view).pot.find(p => p.label === '1/2 底池')!;
  // Pot is 80 before calling 40, then raise 60 more: total 100, not 60.
  assert.equal(half.amount, 100); assert(half.available);
  const third = betPresets(view).pot.find(p => p.label === '1/3 底池')!;
  assert.equal(third.amount, 80);
});
test('budget persistence overrides startup defaults, isolates snapshots and preserves memory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rivermind-settings-'));
  try {
    writeFileSync(join(dir, 'iris-memory.json'), 'existing-memory-marker');
    let settings = new AgentSettings(dir, { timeoutSeconds: 75 });
    assert.deepEqual(settings.budget, { timeoutSeconds: 75, maxToolCalls: 10 });
    const copy = settings.budget; copy.timeoutSeconds = 5;
    assert.equal(settings.budget.timeoutSeconds, 75);
    settings.save({ timeoutSeconds: 120, maxToolCalls: 16 });
    settings = new AgentSettings(dir, { timeoutSeconds: 90 });
    assert.deepEqual(settings.budget, { timeoutSeconds: 120, maxToolCalls: 16 });
    assert.equal(readFileSync(join(dir, 'iris-memory.json'), 'utf8'), 'existing-memory-marker');
    const before = readFileSync(settings.path, 'utf8');
    for (const budget of [{ timeoutSeconds: 301, maxToolCalls: 10 }, { timeoutSeconds: 60, maxToolCalls: 0 },
      { timeoutSeconds: 60.5, maxToolCalls: 10 }, { timeoutSeconds: '60', maxToolCalls: 10 },
      { timeoutSeconds: 60 }, { timeoutSeconds: 60, maxToolCalls: 10, extra: true }]) {
      assert.throws(() => settings.save(budget), (e: unknown) => e instanceof PokerError && e.code === 'BAD_BUDGET');
    }
    assert.equal(readFileSync(settings.path, 'utf8'), before);
    writeFileSync(settings.path, '{broken');
    settings = new AgentSettings(dir);
    assert.deepEqual(settings.budget, DEFAULT_AGENT_BUDGET); assert(settings.warning);
    assert.equal(readFileSync(settings.path, 'utf8'), '{broken');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('service applies saved budgets to the deadline and rejects settings during play or AI work', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'rivermind-budget-service-'));
  let captured: unknown, deadline = 0;
  const timeout = t.mock.method(AbortSignal, 'timeout', (ms: number) => { deadline = ms; return new AbortController().signal; });
  let finish: (decision: Decision) => void = () => {};
  const opponent: Opponent = { decide: async (_view, _memory, _signal, budget) => {
    captured = budget; return new Promise<Decision>(resolve => { finish = resolve; });
  }, dispose: async () => {} };
  const service = new PokerService(dir, opponent);
  try {
    let view = service.dispatch('settings', { revision: 0, budget: { timeoutSeconds: 90, maxToolCalls: 12 } });
    assert.deepEqual(view.runtime.budget, { timeoutSeconds: 90, maxToolCalls: 12 });
    assert.throws(() => service.dispatch('settings', { revision: 99, budget: DEFAULT_AGENT_BUDGET }));
    view = service.dispatch('deal', { revision: 0 });
    assert.throws(() => service.dispatch('settings', { revision: view.revision, budget: DEFAULT_AGENT_BUDGET }),
      (e: unknown) => e instanceof PokerError && e.code === 'HAND_ACTIVE');
    view = service.dispatch('action', { revision: view.revision, handId: view.handId, action: { type: 'call' } });
    assert.equal(view.runtime.busy, true); assert.equal(deadline, 90000);
    assert.deepEqual(captured, { timeoutSeconds: 90, maxToolCalls: 12 });
    assert.deepEqual(view.runtime.thinking!.budget, captured);
    assert.throws(() => service.dispatch('settings', { revision: view.revision, budget: DEFAULT_AGENT_BUDGET }),
      (e: unknown) => e instanceof PokerError && e.code === 'AI_BUSY');
    finish({ action: { type: 'fold' }, source: 'dsh', reason: 'test', memoryIds: [] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.snapshot().runtime.thinking, null);
    view = service.dispatch('reset', { revision: service.snapshot().revision });
    assert.deepEqual(view.runtime.budget, captured);
  } finally { timeout.mock.restore(); await service.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

function budgetContext(observations: number) {
  const tools = new Map<string, any>(); const prompts: string[] = [];
  const context = { sessions: { create: (id: string) => ({ id }) }, agentDefaultModel: { currentSelection: () => ({}) }, agents: { create: async (options: any) => {
    const agent = { id: options.sessionId, whenIdle: async () => {}, cancel() {}, followup(message: any) {
      prompts.push(message.content[0].text);
      const execution = { signal: new AbortController().signal, concludeTurn() {} };
      let view: any;
      for (let i = 0; i < observations; i++) view = tools.get('get_observation').execute({}, execution);
      tools.get('submit_action').execute({ handId: view.handId, revision: view.revision, type: 'check', rationale: '过牌' }, execution);
    } };
    options.setup({ on() {}, tools: { restrict() {}, presentAs() {}, register(tool: any) { tools.set(tool.name, tool); } },
      systemPrompt: { section(section: any) { prompts.push(section.text); }, suppressRuntimeContext() {} } }, agent);
    return { agent, dispose: async () => {} };
  } } } as unknown as DshHostContext;
  return { context, prompts };
}
test('tool limit includes submitting and changes on the same reused Agent with each decision', async () => {
  const table = new PokerTable(); table.newHand(0); act(table, { type: 'call' });
  const mock = budgetContext(7), opponent = new DshOpponent(mock.context);
  const memory = new OpponentProfile().recall();
  try {
    let decision = await opponent.decide(table.viewFor('iris'), memory, new AbortController().signal, { timeoutSeconds: 90, maxToolCalls: 8 });
    assert.equal(decision.trace!.tools.length, 8);
    assert.deepEqual(decision.trace!.budget, { timeoutSeconds: 90, maxToolCalls: 8 });
    await assert.rejects(opponent.decide(table.viewFor('iris'), memory, new AbortController().signal, { timeoutSeconds: 30, maxToolCalls: 7 }),
      (e: unknown) => e instanceof DecisionFailure && e.trace.failure === 'tool-budget' && e.trace.budget!.maxToolCalls === 7);
    decision = await opponent.decide(table.viewFor('iris'), memory, new AbortController().signal, { timeoutSeconds: 120, maxToolCalls: 10 });
    assert.equal(decision.source, 'dsh');
    assert(mock.prompts.some(p => p.includes('90 seconds, at most 8')));
    assert(mock.prompts.some(p => p.includes('30 seconds, at most 7')));
    assert(mock.prompts.some(p => p.includes('120 seconds, at most 10')));
    assert(!mock.prompts.some(p => p.includes('at most six')));
  } finally { await opponent.dispose(); }
});

test('river timeout falls back legally and preserves the applied budget in the saved review', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rivermind-river-timeout-'));
  const budget = { timeoutSeconds: 90, maxToolCalls: 12 };
  const opponent: Opponent = { decide: async (view, _memory, _signal, applied) => {
    if (view.street === 'river') throw new DecisionFailure({ budget: applied, durationMs: 90000, tools: [], failure: 'timeout' });
    return { action: { type: 'check' }, source: 'dsh', reason: '过牌', memoryIds: [] };
  }, dispose: async () => {} };
  const service = new PokerService(dir, opponent);
  try {
    service.dispatch('settings', { revision: 0, budget });
    service.dispatch('deal', { revision: 0 });
    for (let i = 0; i < 15 && service.snapshot().street !== 'complete'; i++) {
      await new Promise(resolve => setImmediate(resolve));
      const view = service.snapshot();
      if (view.actingPlayer === 'human') service.dispatch('action', { revision: view.revision, handId: view.handId,
        action: view.legal.call !== null ? { type: 'call' } : { type: 'check' } });
    }
    const view = service.snapshot();
    assert.equal(view.street, 'complete'); assert.equal(view.runtime.busy, false);
    assert(view.runtime.issue!.includes('90 秒思考时限'));
    const fallback = service.dispatch('review', { handId: view.handId }).view.events.find(event => event.source === 'fallback')!;
    assert.equal(fallback.street, 'river'); assert.equal(fallback.action!.type, 'check');
    assert.equal(fallback.trace!.failure, 'timeout'); assert.deepEqual(fallback.trace!.budget, budget);
    service.dispatch('settings', { revision: view.revision, budget: DEFAULT_AGENT_BUDGET });
    assert.deepEqual(service.dispatch('review', { handId: view.handId }).view.events.find(event => event.source === 'fallback')!.trace!.budget, budget);
  } finally { await service.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test('each reused Agent turn receives fresh public memory and validates citations separately from retrieval', async () => {
  const table = new PokerTable(); table.newHand(0); act(table, { type: 'call' });
  const profile = new OpponentProfile(), tools = new Map<string, any>();
  const supplied: any[] = []; const system: string[] = [];
  let strategy: 'none' | 'summary' | 'retrieve' | 'details' = 'none';
  let creates = 0;
  const context = { sessions: { create: (id: string) => ({ id }) }, agentDefaultModel: { currentSelection: () => ({}) }, agents: { create: async (options: any) => {
    creates++;
    const agent = { id: options.sessionId, whenIdle: async () => {}, cancel() {}, followup(message: any) {
      const text = message.content[0].text;
      const memory = JSON.parse(text.split('\n').at(-1)); supplied.push(memory);
      const observation = JSON.parse(text.split('Observation:\n')[1].split('\nCurrent public')[0]);
      const exec = { signal: new AbortController().signal, concludeTurn() {} };
      const args = { handId: observation.handId, revision: observation.revision, type: 'check', rationale: '本手牌面下选择过牌。' };
      assert.throws(() => tools.get('submit_action').execute({ ...args, memoryIds: ['invented-memory'] }, exec));
      if (memory.handsObserved === 0) assert.throws(() => tools.get('submit_action').execute({ ...args, memoryIds: [memory.id] }, exec));
      if (supplied.length > 1 && supplied.at(-2).id !== memory.id) {
        assert.throws(() => tools.get('submit_action').execute({ ...args, memoryIds: [supplied.at(-2).id] }, exec));
      }
      if (strategy === 'retrieve' || strategy === 'details') {
        const recalled = tools.get('recall_opponent').execute({}, exec);
        assert.equal(recalled.id, memory.id); assert.equal(recalled.handsObserved, memory.handsObserved);
      }
      tools.get('submit_action').execute({ ...args, memoryIds: strategy === 'summary' || strategy === 'details' ? [memory.id] : [] }, exec);
    } };
    options.setup({ on() {}, tools: { restrict() {}, presentAs() {}, register(tool: any) { tools.set(tool.name, tool); } },
      systemPrompt: { section(section: any) { system.push(section.text); }, suppressRuntimeContext() {} } }, agent);
    return { agent, dispose: async () => {} };
  } } } as unknown as DshHostContext;
  const opponent = new DshOpponent(context);
  const observe = () => { const hand = new PokerTable(); hand.newHand(0); act(hand, { type: 'fold' }); profile.observe(hand.handId, hand.publicHistory()); };
  try {
    let decision = await opponent.decide(table.viewFor('iris'), profile.recall(), new AbortController().signal);
    assert.deepEqual(decision.trace!.memory, { id: profile.recall().id, handsObserved: 0, provided: true, retrieved: false, cited: false });
    assert.equal(decision.memoryIds.length, 0);
    observe(); strategy = 'summary';
    decision = await opponent.decide(table.viewFor('iris'), profile.recall(), new AbortController().signal);
    assert.deepEqual(decision.memoryIds, [profile.recall().id]);
    assert.deepEqual(decision.trace!.memory, { id: profile.recall().id, handsObserved: 1, provided: true, retrieved: false, cited: true });
    observe(); strategy = 'retrieve';
    decision = await opponent.decide(table.viewFor('iris'), profile.recall(), new AbortController().signal);
    assert.deepEqual(decision.trace!.memory, { id: profile.recall().id, handsObserved: 2, provided: true, retrieved: true, cited: false });
    strategy = 'details';
    decision = await opponent.decide(table.viewFor('iris'), profile.recall(), new AbortController().signal);
    assert.equal(decision.trace!.memory!.cited, true); assert.equal(decision.trace!.memory!.retrieved, true);
    assert.equal(creates, 1); assert.deepEqual(supplied.map(memory => memory.handsObserved), [0, 1, 2, 2]);
    assert(supplied.every(memory => !JSON.stringify(memory).includes('cards')));
    assert(system[0]!.includes('A range estimate from the board or current bets is a hypothesis'));
  } finally { await opponent.dispose(); }
});
