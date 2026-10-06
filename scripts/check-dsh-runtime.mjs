import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
// Run with the installed DSH Node runtime so app.asar modules are readable.
// No credentials, user settings, live sessions or network providers are loaded.
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sdkArg=process.argv.indexOf('--sdk-root');
const sdkRoot=sdkArg>=0 ? process.argv[sdkArg+1] : '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai';
if(!sdkRoot || !existsSync(join(sdkRoot,'dsh-agent-loop/lib/index.js')))throw new Error('DSH SDK unavailable; use its Node runtime and optionally --sdk-root.');
const prefix=resolve(sdkRoot)+'/';
const root=mkdtempSync(join(tmpdir(),'rivermind-sdk-runtime-'));
const bundles={opponent:'src/host/dsh.ts',engine:'src/core/engine.ts',memory:'src/core/memory.ts'};
for(const [name,entry] of Object.entries(bundles))await build({entryPoints:[join(project,entry)],bundle:true,platform:'node',format:'esm',outfile:join(root,name+'.mjs')});
const {DshOpponent,DecisionFailure}=await import(pathToFileURL(join(root,'opponent.mjs')).href);
const {PokerTable}=await import(pathToFileURL(join(root,'engine.mjs')).href);
const {OpponentProfile}=await import(pathToFileURL(join(root,'memory.mjs')).href);
const load=n=>import(prefix+n+'/lib/index.js');
const {Context}=await load('cordis'),{LlmAdapter,LlmError}=await load('dsh-llm');
const keepAlive=setInterval(()=>{},1000);
const ctx=new Context(),fibers=[];let opponent,calls=0,mode='submit';
try {
for(const name of ['dsh-session-projection','dsh-session','dsh-agent','dsh-llm','dsh-tools','dsh-system-prompt','dsh-session-persistence-jsonl','dsh-agent-loop']){
 fibers.push(ctx.plugin((await load(name)).default,name==='dsh-session-persistence-jsonl'?{root:join(root,'sessions'),compression:'none'}:{}));
 await new Promise(resolve=>setTimeout(resolve,20));
}
const {assertV4RowAdmission}=await load('dsh-session-format-v3-to-v4');
const {KNOWN_SESSION_EVENT_TYPES}=await load('dsh-session');
const legacyInput={type:'agent/inbox/spliced',seq:0,time:Date.now(),data:{target:'next-turn',start:0,inserted:[{id:'legacy-check',role:'user',source:{kind:'plugin',plugin:'rivermind'},content:[{type:'text',text:'synthetic'}]}]}};
assert.throws(()=>assertV4RowAdmission(legacyInput,KNOWN_SESSION_EVENT_TYPES),/producer-owned source kind/);
const admissionErrors=[];let errors=0;const issued=[];
ctx.on('session/event',(session,event)=>{try{assertV4RowAdmission(event,KNOWN_SESSION_EVENT_TYPES)}catch(e){admissionErrors.push(e.message)}});
ctx.on('agent/error',()=>{errors++;});
class Adapter extends LlmAdapter {async *stream(options){
 calls++;assert.deepEqual(options.tools.map(t=>t.name).sort(),['estimate_equity','get_observation','recall_opponent','submit_action']);
 if(mode==='limit'){yield {type:'reasoning-delta',index:0,text:'synthetic capped reasoning'};yield {type:'finish',reason:{kind:'max-tokens'}};return;}
 if(mode==='provider-timeout')throw new LlmError('synthetic provider timeout','TIMEOUT',{status:504,requestId:'synthetic-request'});
 if(mode==='reasoning'){if((options.maxTokens??8192)<4096){yield {type:'finish',reason:{kind:'max-tokens'}};return;}await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,21000);options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(options.signal.reason)},{once:true})});}
 if(mode==='error')throw Object.assign(new Error('synthetic provider failure'),{code:'TRANSPORT'});
 if(mode==='empty'){yield {type:'text-delta',index:0,text:'没有提交动作的测试响应。'};yield {type:'finish',reason:{kind:'stop'}};return;}
 if(mode==='hang'){await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));return;}
 const message=options.messages.filter(m=>m.source?.kind==='rivermind').at(-1);assert(message);
 const text=message.content[0].text;
 const view=JSON.parse(text.split('Observation:\n')[1].split('\nCurrent public')[0]);
 const argumentsJson=JSON.stringify({handId:view.handId,revision:view.revision,type:'check',rationale:'无需额外投入，过牌观察。'});
 issued.push({handId:view.handId,revision:view.revision});
 yield {type:'tool-call-delta',index:0,id:'check-'+calls,name:'submit_action',argumentsDelta:argumentsJson};
 yield {type:'finish',reason:{kind:'tool-calls'}};
}}
ctx.llm.registerAdapter(['rivermind-test'],new Adapter());
opponent=new DshOpponent({sessions:ctx.sessions,agents:ctx.agents,agentDefaultModel:{currentSelection:()=>({provider:'rivermind-test',model:'stub'})}});
const memory=new OpponentProfile().recall();
function view(){const table=new PokerTable();table.newHand(0);table.apply('human',{action:{type:'call'},source:'human',reason:'test',memoryIds:[]},table.revision);return table.viewFor('iris');}
 for(let i=0;i<2;i++){const result=await opponent.decide(view(),memory,AbortSignal.timeout(2000));assert.equal(result.source,'dsh');assert.equal(result.trace.tools[0].name,'submit_action');assert.equal(result.trace.model.resolved.provider,'rivermind-test');assert.equal(result.trace.model.resolved.model,'stub');}
 mode='error';let at=performance.now();await assert.rejects(opponent.decide(view(),memory,AbortSignal.timeout(2000)),e=>e instanceof DecisionFailure&&e.trace.failure==='runtime'&&e.trace.runtimeError.kind==='agent-error');assert(performance.now()-at<1000);
 mode='empty';at=performance.now();await assert.rejects(opponent.decide(view(),memory,AbortSignal.timeout(2000)),e=>e.trace.failure==='runtime'&&e.trace.runtimeError.kind==='no-action');assert(performance.now()-at<1000);
 mode='limit';await assert.rejects(opponent.decide(view(),memory,AbortSignal.timeout(2000)),e=>e.trace.failure==='runtime'&&e.trace.runtimeError.kind==='no-action'&&e.trace.runtimeError.code==='MAX_TOKENS');
 mode='provider-timeout';await assert.rejects(opponent.decide(view(),memory,AbortSignal.timeout(2000)),e=>e.trace.failure==='runtime'&&e.trace.runtimeError.code==='TIMEOUT'&&e.trace.runtimeError.status===504&&e.trace.runtimeError.requestId==='synthetic-request');
 mode='hang';await assert.rejects(opponent.decide(view(),memory,AbortSignal.timeout(80)),e=>e.trace.failure==='timeout');
 mode='submit';const result=await opponent.decide(view(),memory,AbortSignal.timeout(2000));assert.equal(result.source,'dsh');
 mode='reasoning';const extended=await opponent.decide(view(),memory,AbortSignal.timeout(60000));assert.equal(extended.source,'dsh');assert(extended.trace.durationMs>=20000&&extended.trace.durationMs<60000);assert.equal(extended.trace.budget.timeoutSeconds,60);
 const child=ctx.sessions.get(opponent.sessionId);assert.equal(child.header.origin,'subagent');assert(!child.header.cwd);
 await ctx.sessionPersistence.flush();
 assert.deepEqual(admissionErrors,[]);
 const file=root+'/sessions/_no-cwd/'+opponent.sessionId+'/session.v4.jsonl';
 const lines=readFileSync(file,'utf8').trim().split('\n').map(l=>JSON.parse(l));
 const inputs=lines.filter(e=>e.type==='agent/inbox/spliced'&&e.data.inserted?.length);
 assert.equal(inputs.length,9);assert(inputs.every(e=>e.data.inserted[0].source.kind==='rivermind'));
 assert(lines.filter(e=>e.type==='turn/end').length>=8);
 console.log(JSON.stringify({verified:'installed DSH AgentLoop + V4 JSONL persistence, synthetic LLM only',calls,successfulSubmissions:issued.length,errorEvents:errors,persistedInputs:inputs.length,v4AdmissionErrors:admissionErrors.length,privateChild:true,extendedDecisionMs:Math.round(extended.trace.durationMs),modelLimitDistinguished:true}));
 } finally {
  const cleanupErrors=[];
  try { await opponent?.dispose(); } catch (error) { cleanupErrors.push(error); }
  for (const fiber of fibers.reverse()) {
    try { await fiber.dispose(); } catch (error) { cleanupErrors.push(error); }
  }
  clearInterval(keepAlive); rmSync(root,{recursive:true,force:true});
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors,'DSH runtime check cleanup failed');
}
