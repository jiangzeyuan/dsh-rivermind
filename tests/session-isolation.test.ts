import test from 'node:test';
import assert from 'node:assert/strict';
import { PokerTable } from '../src/core/engine.js';
import { DshOpponent, type DshHostContext } from '../src/host/dsh.js';
import { OpponentProfile } from '../src/core/memory.js';

test('Iris is a private child of one blank table Session, reused across hands', async () => {
  const parents: { id: string }[] = [], creations: any[] = [], messages: any[] = [];
  const tools = new Map<string, any>(); let disposals = 0;
  const ctx = {
    sessions: { create(id: string) { const session = { id }; parents.push(session); return session; } },
    agentDefaultModel: { currentSelection: () => ({}) },
    agents: { async create(options: any) {
      creations.push(options);
      assert.equal(parents.length, 1, 'parent exists before child publication');
      assert.equal(options.meta.parentSession, parents[0]!.id);
      const agent = { id: options.sessionId, whenIdle: async () => {}, cancel() {}, followup(message: any) {
        messages.push(message);
        const exec = { signal: new AbortController().signal, concludeTurn() {} };
        const view = tools.get('get_observation').execute({}, exec);
        assert.deepEqual(view.players[0].cards, [null, null]);
        tools.get('submit_action').execute({ handId: view.handId, revision: view.revision,
          type: 'check', rationale: '无需额外投入，过牌观察。' }, exec);
      } };
      options.setup({ on() {}, tools: { restrict() {}, presentAs() {}, register(tool: any) { tools.set(tool.name, tool); } },
        systemPrompt: { section() {}, suppressRuntimeContext() {} } }, agent);
      return { agent, dispose: async () => { disposals++; } };
    } },
  } as unknown as DshHostContext;
  const opponent = new DshOpponent(ctx);
  try {
    for (let hand = 0; hand < 2; hand++) {
      const table = new PokerTable(); table.newHand(0);
      table.apply('human', { action: { type: 'call' }, source: 'baseline', reason: 'test', memoryIds: [] }, table.revision);
      const decision = await opponent.decide(table.viewFor('iris'), new OpponentProfile().recall(), new AbortController().signal);
      assert.deepEqual(decision.action, { type: 'check' });
    }
    assert.equal(parents.length, 1); assert.equal(creations.length, 1); assert.equal(messages.length, 2);
    const child = creations[0];
    assert.equal(child.meta.origin, 'subagent', 'DSH excludes internal children from ordinary chat rows');
    assert(!Object.hasOwn(child.meta, 'cwd'), 'ordinary history must not expose poker observations');
    assert(!Object.hasOwn(child, 'seed'), 'Iris must not inherit a user chat or its hidden information');
    assert.notEqual(child.sessionId, parents[0]!.id);
    for (const message of messages) assert.deepEqual(message.source, { kind: 'rivermind' });
  } finally { await opponent.dispose(); }
  assert.equal(disposals, 1);
});
