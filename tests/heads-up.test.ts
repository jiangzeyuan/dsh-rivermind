import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PokerTable } from '../src/core/engine.js';
import { fullDeck } from '../src/core/cards.js';
import { OpponentProfile, parseMemory, foldInterval } from '../src/core/memory.js';
import { PlayerMemory } from '../src/host/memory.js';
import { PokerService } from '../src/host/service.js';
import { DecisionFailure, DshOpponent, type DshHostContext } from '../src/host/dsh.js';
import { runEvaluation } from '../src/eval/runner.js';
import { seededDeck } from '../src/eval/random.js';
import { replayFrame } from '../src/client/replay.js';
import type { Action, Decision } from '../src/core/types.js';
function act(table: PokerTable, action: Action) {
  table.apply(table.actingPlayer!, {action,source:'baseline',reason:'test',memoryIds:[]},table.revision);
}
function postflopFold(): PokerTable {
  const table=new PokerTable();table.newHand(0);act(table,{type:'call'});act(table,{type:'check'});
  act(table,{type:'raise',amount:40});act(table,{type:'fold'});return table;
}

test('fold returns unmatched bets and records the actual awarded pot',()=>{
  const table=new PokerTable();table.newHand(0);act(table,{type:'raise',amount:1000});act(table,{type:'fold'});
  const view=table.viewFor('human',true);
  assert.equal(view.pot,40);assert.deepEqual(view.result!.net,{human:20,iris:-20});
  assert.equal(view.events.find(e=>e.kind==='refund')!.amount,980);
  assert.deepEqual(view.players.map(p=>p.contributed),[20,20]);
  assert(view.events.at(-1)!.message.includes('底池 40'));
});
test('unequal all-in facts exclude the uncallable excess before the decision',()=>{
  const table=new PokerTable({stacks:[100,40]});table.newHand(0);act(table,{type:'raise',amount:100});
  const view=table.viewFor('iris');
  assert.equal(view.pot,120);assert.equal(view.facts.toCall,20);
  assert.equal(view.facts.contestablePotAfterCall,80);assert.equal(view.facts.uncalledReturnAfterCall,60);
  assert.equal(view.facts.potOdds,.25);assert.equal(view.facts.effectiveStack,20);assert.equal(view.facts.stackToPotRatioAfterCall,0);
  act(table,{type:'call'});assert.equal(table.viewFor('human').pot,80);
});
test('button receives the last hole card; paired deals exchange private hands',()=>{
  const a=new PokerTable({initialButton:0,deckFactory:fullDeck}),b=new PokerTable({initialButton:1,deckFactory:fullDeck});
  a.newHand(0);b.newHand(0);
  assert.deepEqual(a.viewFor('iris').players[1]!.cards,['2s','2d']);
  assert.deepEqual(a.viewFor('human').players[0]!.cards,['2h','2c']);
  assert.deepEqual(a.viewFor('iris').players[1]!.cards,b.viewFor('human').players[0]!.cards);
  assert.equal(a.actingPlayer,'human');assert.equal(b.actingPlayer,'iris');
});
test('condition denominator is actual responses to voluntary bets; blinds are excluded',()=>{
  const profile=new OpponentProfile();const blindFold=new PokerTable();blindFold.newHand(0);act(blindFold,{type:'fold'});
  profile.observe(blindFold.handId,blindFold.publicHistory());assert.equal(profile.recall().conditions.length,0);
  const table=postflopFold();profile.observe(table.handId,table.publicHistory());profile.observe(table.handId,table.publicHistory());
  const memory=profile.recall(),c=memory.conditions[0]!;
  assert.equal(memory.handsObserved,2);assert.equal(c.key,'flop:button:large');
  assert.equal(c.opportunities,1);assert.equal(c.folds,1);assert.equal(c.foldRate,1);assert.equal(c.usable,false);
  assert.deepEqual(c.evidenceHandIds,[table.handId]);
  assert(!JSON.stringify(memory).includes('cards'));
});
test('multiple responses in one hand stay separate from hand-level counts',()=>{
  const table=new PokerTable();table.newHand(0);act(table,{type:'call'});act(table,{type:'check'});
  act(table,{type:'raise',amount:40});act(table,{type:'raise',amount:100});act(table,{type:'raise',amount:160});act(table,{type:'fold'});
  const profile=new OpponentProfile();profile.observe(table.handId,table.publicHistory());
  const memory=profile.recall();assert.equal(memory.handsObserved,1);assert.equal(memory.aggressiveHands,1);
  assert.equal(memory.conditions.reduce((n,c)=>n+c.opportunities,0),2);
  assert.equal(memory.conditions.find(c=>c.betSize==='large')!.raises,1);
  assert.equal(memory.conditions.find(c=>c.betSize==='medium')!.folds,1);
});
test('condition uncertainty and evidence remain bounded as public samples accumulate',()=>{
  const profile=new OpponentProfile();
  for(let i=0;i<20;i++){const table=postflopFold();profile.observe(table.handId,table.publicHistory());}
  const c=profile.recall().conditions[0]!;assert.equal(c.opportunities,20);assert.equal(c.usable,true);
  assert.equal(c.evidenceHandIds.length,8);assert(c.foldRateInterval[0]>.55);assert.equal(c.foldRateInterval[1],1);
  assert.deepEqual(foldInterval(0,0),[0,1]);
});
test('v1 files retain totals while v2 condition samples begin with new hands',()=>{
  const dir=mkdtempSync(join(tmpdir(),'rivermind-migration-'));
  try{
    writeFileSync(join(dir,'iris-memory.json'),JSON.stringify({version:1,handIds:['old:1','old:2'],folded:1,voluntary:1,aggressive:0}));
    const memory=new PlayerMemory(dir);assert.equal(memory.recall().handsObserved,2);assert.equal(memory.recall().conditions.length,0);
    const table=postflopFold();memory.observe(table.handId,table.publicHistory());
    const stored=JSON.parse(readFileSync(join(dir,'iris-memory.json'),'utf8'));assert.equal(stored.version,2);assert.equal(stored.folded,2);
    assert.equal(new PlayerMemory(dir).recall().conditions[0]!.opportunities,1);
    assert.throws(()=>parseMemory({...stored,contexts:{bad:{opportunities:1}}}));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('finished reviews survive restart and read-only history cannot expose an active hand',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'rivermind-reviews-'));let service=new PokerService(dir,undefined,10000);
  try{
    let view=service.dispatch('deal',{revision:0});
    assert.throws(()=>service.dispatch('review',{handId:view.handId}));
    view=service.dispatch('action',{revision:view.revision,handId:view.handId,action:{type:'fold'}});
    assert.equal(service.dispatch('history',{}).hands.length,1);
    const saved=service.dispatch('review',{handId:view.handId});assert.equal(saved.memoryBeforeUpdate.handsObserved,0);
    assert.deepEqual(saved.view.players[1]!.cards,[null,null]);
    await service.dispose();service=new PokerService(dir,undefined,10000);
    assert.equal(service.dispatch('history',{}).hands[0]!.handId,view.handId);
    assert.equal(service.dispatch('review',{handId:view.handId}).view.result!.net.human,-10);
    assert.throws(()=>service.dispatch('history',{limit:101}));
  }finally{await service.dispose();rmSync(dir,{recursive:true,force:true});}
});
test('replay restores historical amounts without showing future board or folded hole cards',()=>{
  const table=postflopFold();const view=table.viewFor('human',true);
  const beginning=replayFrame(view,1);assert.equal(beginning.board.length,0);assert.equal(beginning.pot,0);
  assert.deepEqual(beginning.players.map(p=>p.stack),[2000,2000]);
  const flopStep=view.events.findIndex(e=>e.kind==='street')+1;
  assert.equal(replayFrame(view,flopStep).board.length,3);
  const complete=replayFrame(view,view.events.length);assert.equal(complete.pot,40);
  assert.deepEqual(complete.players.map(p=>p.stack),view.players.map(p=>p.stack));
  assert.deepEqual(complete.players[1]!.cards,[null,null]);
});
test('decision trace is only available in the human finished-hand review',()=>{
  const table=new PokerTable();table.newHand(0);act(table,{type:'call'});
  const d:Decision={action:{type:'check'},source:'dsh',reason:'test',memoryIds:[],trace:{durationMs:12,tools:[{name:'private-tool-marker',status:'ok',durationMs:1}]}};
  table.apply('iris',d,table.revision);assert(!JSON.stringify(table.viewFor('human',true)).includes('private-tool-marker'));
  while(!table.complete)act(table,{type:'check'});
  assert(JSON.stringify(table.viewFor('human',true)).includes('private-tool-marker'));
  assert(!JSON.stringify(table.viewFor('iris',true)).includes('private-tool-marker'));
  assert(!JSON.stringify(table.publicHistory()).includes('private-tool-marker'));
});
function mockDsh(mode:'never-create'|'budget'|'valid'){
  const tools=new Map<string,any>();let cancelled=0;
  const context={sessions:{create:(id:string)=>({id})},agentDefaultModel:{currentSelection:()=>({})},agents:{create:async(options:any)=>{
    if(mode==='never-create')return await new Promise(()=>{});
    const agent={id:options.sessionId,whenIdle:async()=>{},cancel:()=>{cancelled++;},followup:()=>{
      if(mode==='budget'){for(let i=0;i<7;i++)tools.get('get_observation').execute({}, {signal:new AbortController().signal,concludeTurn(){}});}
      else {
        const view=tools.get('get_observation').execute({}, {signal:new AbortController().signal,concludeTurn(){}});
        tools.get('submit_action').execute({handId:view.handId,revision:view.revision,type:'check',rationale:'过牌'}, {signal:new AbortController().signal,concludeTurn(){}});
      }
    }};
    options.setup({on() {}, tools:{restrict(){},presentAs(){},register(t:any){tools.set(t.name,t);}},systemPrompt:{section(){},suppressRuntimeContext(){}}},agent);
    return {agent,dispose:async()=>{}};
  }}} as unknown as DshHostContext;
  return {context,tools,cancelled:()=>cancelled};
}
test('agent creation is bounded by deadline even if a runtime promise never resolves',async()=>{
  const table=new PokerTable();table.newHand(0);act(table,{type:'call'});const mock=mockDsh('never-create');
  const opponent=new DshOpponent(mock.context),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(new DOMException('deadline','TimeoutError')),10);
  try{await assert.rejects(opponent.decide(table.viewFor('iris'),new OpponentProfile().recall(),controller.signal),e=>e instanceof DecisionFailure && e.trace.failure==='timeout');}
  finally{clearTimeout(timer);await opponent.dispose();}
});
test('tool budget failure is diagnosed and successful submissions include their tool trace',async()=>{
  const table=new PokerTable();table.newHand(0);act(table,{type:'call'});
  for(const mode of ['budget','valid'] as const){
    const mock=mockDsh(mode),opponent=new DshOpponent(mock.context);
    try{
      if(mode==='budget')await assert.rejects(opponent.decide(table.viewFor('iris'),new OpponentProfile().recall(),new AbortController().signal,{timeoutSeconds:25,maxToolCalls:6}),e=>e instanceof DecisionFailure && e.trace.failure==='tool-budget' && e.trace.tools.length===7);
      else {const result=await opponent.decide(table.viewFor('iris'),new OpponentProfile().recall(),new AbortController().signal);assert.deepEqual(result.trace!.tools.map(t=>t.name),['get_observation','submit_action']);assert(result.trace!.durationMs>=0);}
      assert.throws(()=>mock.tools.get('get_observation').execute({}, {signal:new AbortController().signal,concludeTurn(){}}));
    }finally{await opponent.dispose();}
  }
});
test('seeded evaluation is isolated and its financial outcomes repeat across memory arms',()=>{
  const config={pairs:3,seeds:[7,17],trials:4};
  const first=runEvaluation(config),second=runEvaluation(config);
  const outcomes=(report:typeof first)=>report.results.map(({opponent,memoryMode,hands,bbPer100,winRate,legalSubmissionRate,fallbackRate,memoryReferences})=>({opponent,memoryMode,hands,bbPer100,winRate,legalSubmissionRate,fallbackRate,memoryReferences}));
  assert.deepEqual(outcomes(first),outcomes(second));assert.equal(first.results.length,9);assert.equal(first.comparisons.length,6);
  assert(first.results.every(r=>r.hands===12&&r.legalSubmissionRate===1&&r.fallbackRate===0));
  assert.deepEqual(seededDeck('x'),seededDeck('x'));assert.notDeepEqual(seededDeck('x'),seededDeck('y'));
  assert.throws(()=>runEvaluation({...config,seeds:[7,7]}));
});

test('DSH history routes preserve the RPC envelope and only expose finished human views',async()=>{
  const {apply}=await import('../src/host/index.js');
  const dir=mkdtempSync(join(tmpdir(),'rivermind-host-routes-'));
  const routes=new Map<string,any>();let cleanup:()=>void|Promise<void>=()=>{};
  const context={...mockDsh('valid').context,connection:{fetch:{register(route:any){routes.set(route.path,route);}}},
    effect(callback:()=>()=>void|Promise<void>){cleanup=callback();},logger:{info(){},warn(){}}} as unknown as DshHostContext;
  apply(context,{dataDir:dir});
  async function call(endpoint:string,payload:unknown){
    const response=await routes.get('/api/rivermind/'+endpoint).fetch(new Request('http://localhost/api/rivermind/'+endpoint,
      {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'test-rpc',method:'rivermind/'+endpoint,payload})}));
    const body=await response.json();assert.equal(body.type,'server-response');assert.equal(body.rpcId,'test-rpc');return body.result;
  }
  try{
    const settings=await call('settings',{revision:0,budget:{timeoutSeconds:90,maxToolCalls:12}});
    assert.equal(settings.ok,true);assert.deepEqual(settings.value.runtime.budget,{timeoutSeconds:90,maxToolCalls:12});
    assert.equal((await call('settings',{revision:0,budget:{timeoutSeconds:900,maxToolCalls:12}})).ok,false);
    await call('mode',{mode:'baseline'});let view=(await call('deal',{revision:0})).value;
    assert.equal((await call('settings',{revision:view.revision,budget:{timeoutSeconds:60,maxToolCalls:10}})).error.code,'HAND_ACTIVE');
    assert.equal((await call('review',{handId:view.handId})).ok,false);
    view=(await call('action',{revision:view.revision,handId:view.handId,action:{type:'fold'}})).value;
    const history=await call('history',{});assert.equal(history.ok,true);assert.equal(history.value.hands.length,1);
    assert(!JSON.stringify(history.value).includes('cards'));
    const review=await call('review',{handId:view.handId});assert.equal(review.ok,true);
    assert.deepEqual(review.value.view.players[1].cards,[null,null]);assert.equal(review.value.memoryBeforeUpdate.handsObserved,0);
  }finally{await cleanup();rmSync(dir,{recursive:true,force:true});}
});
