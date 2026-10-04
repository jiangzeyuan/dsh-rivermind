import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareRanks, evaluate, fullDeck } from '../src/core/cards.js';
import { PokerTable } from '../src/core/engine.js';
import { PokerError, type Action, type Decision, type GameView } from '../src/core/types.js';
import { PlayerMemory } from '../src/host/memory.js';
import { PokerService } from '../src/host/service.js';
import { DshOpponent, validateSubmittedAction, type DshHostContext } from '../src/host/dsh.js';

const decision = (action: Action): Decision => ({ action, reason: 'test decision', source: 'baseline', memoryIds: [] });
function act(table: PokerTable, action: Action): void { table.apply(table.actingPlayer!, decision(action), table.revision); }
function deck(prefix: string[]): string[] { return [...prefix, ...fullDeck().filter(card => !prefix.includes(card))]; }

test('seven-card evaluator compares wheel, kickers, full houses, and board ties', () => {
  assert.deepEqual(evaluate(['As','2h','3d','4c','5s','Kd','Qc']), [4,5]);
  assert(compareRanks(evaluate(['As','Ah','Kc','Qd','9s']), evaluate(['Ad','Ac','Kh','Jd','9c'])) > 0);
  assert.deepEqual(evaluate(['As','Ah','Ad','Ks','Kh','Kd','2c']), [6,14,13]);
  assert.deepEqual(evaluate(['As','Ks','Qs','Js','Ts','2h','3d']), [8,14]);
  assert(compareRanks(evaluate(['2c','3d','As','Ks','Qs','Js','Ts']), evaluate(['8h','9h','As','Ks','Qs','Js','Ts'])) === 0);
  assert.throws(() => evaluate(['As','As','Qs','Js','Ts']));
});

test('heads-up button acts first preflop; big blind acts first on all later streets', () => {
  const table = new PokerTable();
  table.newHand(0);
  assert.equal(table.actingPlayer, 'human');
  act(table, {type:'call'});
  assert.equal(table.actingPlayer, 'iris');
  act(table, {type:'check'});
  assert.equal(table.viewFor('human').street, 'flop');
  assert.equal(table.actingPlayer, 'iris');
  for (let i=0;i<6;i++) act(table, {type:'check'});
  assert(table.complete);
  assert.equal(table.viewFor('human').board.length, 5);
  assert.equal(table.viewFor('human').players.reduce((n,p)=>n+p.stack,0), 4000);
  table.newHand(table.revision);
  assert.equal(table.actingPlayer, 'iris');
});

test('invalid, out-of-turn, and stale actions do not mutate state', () => {
  const table = new PokerTable(); table.newHand(0);
  const before = table.viewFor('human');
  assert.throws(() => table.apply('iris', decision({type:'fold'}), table.revision), e => e instanceof PokerError && e.code === 'NOT_YOUR_TURN');
  assert.throws(() => act(table,{type:'raise',amount:39}));
  assert.throws(() => act(table,{type:'raise',amount:NaN}));
  assert.throws(() => act(table,{type:'check'}));
  assert.deepEqual(table.viewFor('human'), before);
  act(table,{type:'call'});
  assert.throws(() => table.apply('iris',decision({type:'check'}),before.revision), e => e instanceof PokerError && e.code === 'STALE_TURN');
});

test('both observations hide the other hole cards and all future community cards', () => {
  const table = new PokerTable({deckFactory:()=>deck(['As','Kh','Ad','Kc'])}); table.newHand(0);
  const human = table.viewFor('human'), iris = table.viewFor('iris');
  assert.deepEqual(human.players[0]!.cards,['As','Ad']);
  assert.deepEqual(human.players[1]!.cards,[null,null]);
  assert.deepEqual(iris.players[0]!.cards,[null,null]);
  assert.deepEqual(iris.players[1]!.cards,['Kh','Kc']);
  assert.deepEqual(iris.board,[]);
  assert(!JSON.stringify(iris).includes('As'));
  act(table,{type:'fold'});
  assert.deepEqual(table.viewFor('human',true).players[1]!.cards,[null,null]);
  assert.deepEqual(table.viewFor('iris',true).players[0]!.cards,[null,null]);
});

test('decision explanations are withheld during a hand and from opponent tools after it', () => {
  const table = new PokerTable(); table.newHand(0); act(table,{type:'call'});
  table.apply('iris',{action:{type:'check'},reason:'private decision evidence',source:'dsh',memoryIds:['memory:1']},table.revision);
  assert(!JSON.stringify(table.viewFor('human',true)).includes('private decision evidence'));
  while(!table.complete) act(table,table.viewFor(table.actingPlayer!).legal.check ? {type:'check'} : {type:'call'});
  assert(JSON.stringify(table.viewFor('human',true)).includes('private decision evidence'));
  assert(!JSON.stringify(table.viewFor('iris',true)).includes('private decision evidence'));
  assert(!JSON.stringify(table.publicHistory()).includes('private decision evidence'));
});

test('unequal all-in contributions are refunded and the deck runs out exactly once', () => {
  const table = new PokerTable({stacks:[100,40]}); table.newHand(0);
  act(table,{type:'raise',amount:100});
  assert.equal(table.legalFor('iris').call,20);
  act(table,{type:'call'});
  const view=table.viewFor('human');
  assert(table.complete); assert.equal(view.board.length,5); assert.equal(view.pot,80);
  assert.equal(view.players.reduce((n,p)=>n+p.stack,0),140);
  assert(view.players.every(p=>p.stack>=0));
  assert(view.players[1]!.cards.every(Boolean));
});

test('a short all-in raise permits only call or fold by the remaining player', () => {
  const table = new PokerTable({stacks:[55,50]}); table.newHand(0);
  act(table,{type:'raise',amount:40});
  assert.deepEqual(table.legalFor('iris').raise,{min:50,max:50,shortAllIn:true});
  act(table,{type:'raise',amount:50});
  assert.equal(table.legalFor('human').raise,null);
  assert.equal(table.legalFor('human').call,10);
  act(table,{type:'call'});
  assert(table.complete);
  assert.equal(table.viewFor('human').players.reduce((n,p)=>n+p.stack,0),105);
});

test('shared royal flush board splits the pot independently of hole-card ordering', () => {
  const table = new PokerTable({deckFactory:()=>deck(['2c','4h','3d','5h','6c','As','Ks','Qs','7c','Js','8c','Ts'])});
  table.newHand(0); act(table,{type:'call'}); act(table,{type:'check'});
  while(!table.complete) act(table,{type:'check'});
  const view=table.viewFor('human');
  assert.equal(view.result?.winners.length,2);
  assert.deepEqual(view.result?.net,{human:0,iris:0});
});

test('random legal play conserves chips across 300 independent hands', () => {
  let seed=91723;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
  for(let n=0;n<300;n++){
    const table=new PokerTable({stacks:[200,200]});table.newHand(0);
    let turns=0;
    while(!table.complete){
      assert(++turns<100,'hand must terminate');
      const view=table.viewFor(table.actingPlayer!);
      const choices:Action[]=[{type:'fold'}];
      if(view.legal.check)choices.push({type:'check'});
      if(view.legal.call!==null)choices.push({type:'call'});
      if(view.legal.raise)choices.push({type:'raise',amount:random()<.5?view.legal.raise.min:view.legal.raise.max});
      act(table,choices[Math.floor(random()*choices.length)]!);
      const next=table.viewFor('human');
      assert(next.players.every(p=>p.stack>=0 && p.streetBet>=0 && p.contributed>=0));
      assert.equal(next.players.reduce((sum,p)=>sum+p.stack,0)+(table.complete?0:next.pot),400);
    }
  }
});

test('persistent memory is idempotent, evidence-backed, and contains no private cards', () => {
  const dir=mkdtempSync(join(tmpdir(),'rivermind-memory-'));
  try{
    const table=new PokerTable();table.newHand(0);act(table,{type:'fold'});
    const memory=new PlayerMemory(dir);
    memory.observe(table.handId,table.publicHistory());memory.observe(table.handId,table.publicHistory());
    assert.equal(memory.recall().handsObserved,1);
    assert.equal(memory.recall().handsFolded,1);
    assert.deepEqual(new PlayerMemory(dir).recall(),memory.recall());
    const persisted=readFileSync(join(dir,'iris-memory.json'),'utf8');
    assert(!persisted.includes('cards'));
    assert.equal(memory.recall().evidenceHandIds[0],table.handId);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('service cannot impersonate an AI seat through a forged playerId', async () => {
  const dir=mkdtempSync(join(tmpdir(),'rivermind-service-'));
  const service=new PokerService(dir,undefined,10000);
  try {
    service.dispatch('deal',{revision:0});
    const view=service.snapshot();
    const next=service.dispatch('action',{revision:view.revision,handId:view.handId,playerId:'iris',action:{type:'fold'}});
    assert(next.players.find(p=>p.id==='human')!.folded);
    assert.equal(next.result?.winners[0],'iris');
    const review=JSON.parse(readFileSync(join(dir,'reviews.jsonl'),'utf8').trim());
    assert.equal(review.memoryBeforeUpdate.handsObserved,0);
    assert.equal(service.snapshot().memory.handsObserved,1);
    assert.deepEqual(review.view.players[1].cards,[null,null]);
    assert.throws(()=>service.dispatch('mode',{mode:'dsh'}));
  }finally{await service.dispose();rmSync(dir,{recursive:true,force:true});}
});

test('DSH action submission validates the exact turn token and legal raise bounds', () => {
  const table=new PokerTable();table.newHand(0);act(table,{type:'call'});
  const view=table.viewFor('iris');
  assert.deepEqual(validateSubmittedAction(view,{handId:view.handId,revision:view.revision,type:'check'}),{type:'check'});
  assert.throws(()=>validateSubmittedAction(view,{handId:'other',revision:view.revision,type:'check'}));
  assert.throws(()=>validateSubmittedAction(view,{handId:view.handId,revision:view.revision,type:'raise',amount:999999}));
});

test('DSH adapter supplies only local poker tools and correlates submission, not idle status', async () => {
  const table=new PokerTable();table.newHand(0);act(table,{type:'call'});
  const dir=mkdtempSync(join(tmpdir(),'rivermind-agent-'));
  const memory={...new PlayerMemory(dir).recall(),id:'iris:human:public-stats:v1',handsObserved:1,evidenceHandIds:['public-hand-1']};
  const tools=new Map<string,any>();
  let restrictions:unknown,mode:unknown,prompt:unknown,concluded=false;
  let sent:unknown;
  const fakeContext={
    agentDefaultModel:{currentSelection:()=>({provider:'test',model:'test-model'})},
    agents:{create:async(options:any)=>{
      const agent={id:options.sessionId,whenIdle:async()=>{},cancel:()=>{},followup:(message:unknown)=>{sent=message;queueMicrotask(()=>{
        const observation=tools.get('get_observation').execute({}, {signal:new AbortController().signal,concludeTurn:()=>{}});
        assert.deepEqual(observation.players[0].cards,[null,null]);
        assert.throws(()=>tools.get('submit_action').execute({handId:observation.handId,revision:observation.revision,type:'check',rationale:'过牌。',memoryIds:[memory.id]}, {signal:new AbortController().signal,concludeTurn:()=>{}}));
        tools.get('recall_opponent').execute({}, {signal:new AbortController().signal,concludeTurn:()=>{}});
        tools.get('submit_action').execute({handId:observation.handId,revision:observation.revision,type:'check',rationale:'无需额外投入，过牌观察。',memoryIds:[memory.id]},
          {signal:new AbortController().signal,concludeTurn:()=>{concluded=true;}});
      });}};
      options.setup({tools:{restrict:(value:unknown)=>{restrictions=value;},presentAs:(value:unknown)=>{mode=value;},register:(tool:any)=>{tools.set(tool.name,tool);}},
        systemPrompt:{section:(value:unknown)=>{prompt=value;},suppressRuntimeContext:()=>{}}},agent);
      return {agent,dispose:async()=>{}};
    }},
  } as unknown as DshHostContext;
  const opponent=new DshOpponent(fakeContext);
  try {
    const result=await opponent.decide(table.viewFor('iris'),memory,AbortSignal.timeout(2000));
    assert.equal(result.source,'dsh');assert.deepEqual(result.action,{type:'check'});assert.deepEqual(result.memoryIds,[memory.id]);assert(concluded);
    assert.deepEqual(restrictions,{allow:[]});assert.equal(mode,'native');
    assert.equal((prompt as {complete:boolean}).complete,true);
    assert.deepEqual([...tools.keys()],['get_observation','recall_opponent','estimate_equity','submit_action']);
    assert(sent);
    assert.throws(()=>tools.get('submit_action').execute({}, {signal:new AbortController().signal,concludeTurn:()=>{}}));
  }finally{await opponent.dispose();rmSync(dir,{recursive:true,force:true});}
});
