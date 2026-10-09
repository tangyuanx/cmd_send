import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {SendQueue}=require('../electron/queue.cjs');
function setup(overrides={}){
 let now=0,id=0;const tasks=new Map(),output=[],states=[],waits=[];
 const backend={hasTarget:id=>id==='target',prepare:async()=>({restore:true}),character:async(_id,c)=>output.push(c),enter:async()=>output.push('\n'),finish:async()=>{},...overrides};
 const queue=new SendQueue(backend,{clock:()=>now,setTimer:(fn,ms)=>{const key=++id;tasks.set(key,{fn,at:now+ms});waits.push(ms);return key;},clearTimer:id=>tasks.delete(id)});
 queue.on('state',s=>states.push(s));
 async function step(){const [key,t]=[...tasks.entries()].sort((a,b)=>a[1].at-b[1].at)[0]||[];if(!t)return false;tasks.delete(key);now=t.at;t.fn();for(let i=0;i<8;i++)await Promise.resolve();return true;}
 async function drain(limit=300){while(limit--&&await step()){}assert.ok(limit>0,'queue must finish');}
 return {queue,output,states,tasks,waits,step,drain};
}
const options={commands:['A','B','C'],targetId:'target',interval:70,rounds:2,enter:true};
test('groups repeat in order, first immediately, once between commands',async()=>{const s=setup();s.queue.start(options);await s.drain();assert.equal(s.output.join(''),'A\nB\nC\nA\nB\nC\n');assert.equal(s.waits[0],0);assert.equal(s.waits.filter(x=>x===70).length,5);assert.equal(s.states.at(-1).type,'completed');assert.equal(s.states.at(-1).total,6);});
test('pause and resume keep exact character progress without duplicate delivery',async()=>{const s=setup();s.queue.start({...options,commands:['甲😀乙'],rounds:1});await s.step();await s.step();s.queue.pause();assert.equal(s.tasks.size,0);assert.equal(s.output.join(''),'甲');s.queue.resume();await s.drain();assert.equal(s.output.join(''),'甲😀乙\n');});
test('loop stops immediately and has no residual timer',async()=>{const s=setup();s.queue.start({...options,commands:['X'],rounds:'loop'});for(let i=0;i<8;i++)await s.step();await s.queue.stop();const text=s.output.join('');await s.drain();assert.equal(s.output.join(''),text);assert.equal(s.tasks.size,0);assert.equal(s.states.at(-1).type,'stopped');});
test('ambiguous failure after a delivered character is never retried',async()=>{const output=[];const s=setup({character:async(_id,c)=>{output.push(c);throw new Error('ambiguous');}});s.queue.start({...options,commands:['ABC']});await s.drain();assert.deepEqual(output,['A']);assert.equal(s.states.at(-1).type,'failed');assert.equal(s.queue.run,null);});
test('stop during pending Enter cannot emit a late completion',async()=>{let resolve;const s=setup({enter:()=>new Promise(r=>resolve=r)});s.queue.start({...options,commands:['A'],rounds:1});await s.step();await s.step();await s.step();assert.equal(typeof resolve,'function');const stopped=s.queue.stop();resolve();await stopped;for(let i=0;i<8;i++)await Promise.resolve();assert.equal(s.states.at(-1).type,'stopped');assert.equal(s.states.filter(x=>x?.type==='completed').length,0);assert.ok(s.states.every(Boolean));});
test('stop during prepare restores context, never sends text',async()=>{let resolve;let restored=0;const s=setup({prepare:()=>new Promise(r=>resolve=r),finish:async(_id,c)=>{if(c)restored++;}});s.queue.start(options);await s.step();const stopped=s.queue.stop();resolve({restore:true});await stopped;for(let i=0;i<8;i++)await Promise.resolve();assert.equal(restored,1);assert.equal(s.output.length,0);assert.equal(s.tasks.size,0);});
test('snapshot survives caller changes, rejects malformed parameters and overlapping tasks',async()=>{const s=setup(),commands=['A'];s.queue.start({...options,commands,rounds:1,enter:false});commands[0]='WRONG';assert.throws(()=>s.queue.start(options));await s.drain();assert.equal(s.output.join(''),'A');for(const change of [{commands:['\n']},{commands:['A\0B']},{targetId:'missing'},{interval:0},{rounds:0}])assert.throws(()=>s.queue.start({...options,...change}));});

test('closing waits for outstanding native calls and repeated stop joins the same cleanup',async()=>{let resolve;const s=setup({prepare:()=>new Promise(r=>resolve=r)});s.queue.start(options);await s.step();let settled=false;const one=s.queue.stop();const two=s.queue.stop();assert.equal(one,two);one.then(()=>settled=true);await Promise.resolve();assert.equal(settled,false);assert.throws(()=>s.queue.start(options));resolve({restore:true});await one;assert.equal(settled,true);assert.equal(s.queue.activeSteps.size,0);});
