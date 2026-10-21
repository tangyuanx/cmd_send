import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(import.meta.url);
const {DeliveryBroker}=require('../electron/delivery.cjs');
const {ScheduleManager,configuration}=require('../electron/schedules.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(fn){const end=Date.now()+4000;while(!fn()){if(Date.now()>end)assert.fail('Timed out');await delay(5);}}
function fixture(background=true){
 const writes=[],refs=new Map(),dead=new Set();let active=new Set();
 const backend={hasTarget:id=>!dead.has(id),retain:id=>refs.set(id,(refs.get(id)||0)+1),release:id=>refs.set(id,refs.get(id)-1),deliveryInfo:id=>{if(dead.has(id))throw Error('目标已关闭');return {key:id.replace(/-alias$/,''),background};},
  async prepare(id){if(dead.has(id))throw Error('目标已关闭');active.add(id);return {id};},character(id,c){if(dead.has(id))throw Error('目标已关闭');writes.push([id,c]);},enter:id=>writes.push([id,'\n']),finish:id=>{active.delete(id);}};
 const broker=new DeliveryBroker(backend),manager=new ScheduleManager({backend,broker});
 const save=async(name,target=name,extra={})=>{const before=new Set(manager.jobs.keys());await manager.save({name,commands:[name],periodMs:80,characterInterval:0,start:true,...extra},{id:target,name:target});return manager.snapshot().find(j=>!before.has(j.id)).id;};
 return {backend,broker,manager,save,writes,refs,dead,active};
}

test('background targets are concurrent; foreground and aliases own a complete command',async()=>{
 for(const background of [true,false]){
  const f=fixture(background),a=f.broker.channel(),b=f.broker.channel(),c=f.broker.channel();
  const ca=await a.prepare('A');let ready=false;const pb=b.prepare('B').then(x=>{ready=true;return x;});await delay(10);assert.equal(ready,background);
  let aliasReady=false;const pc=c.prepare('A-alias').then(x=>{aliasReady=true;return x;});await delay(10);assert.equal(aliasReady,false);
  await a.finish('A',ca);const cb=await pb;await b.finish('B',cb);const cc=await pc;await c.finish('A-alias',cc);assert.equal(f.broker.held.size,0);
 }
});
test('cancel a waiting channel leaves the active target untouched and unlocks later waiters',async()=>{
 const f=fixture(false),a=f.broker.channel(),b=f.broker.channel(),c=f.broker.channel();const context=await a.prepare('A');
 const waiting=b.prepare('A-alias');const rejected=assert.rejects(waiting,/取消/);await delay(2);await b.finish('A-alias');await rejected;assert.ok(f.active.has('A'));
 let ready=false;const pending=c.prepare('B').then(x=>{ready=true;return x;});await delay(5);assert.equal(ready,false);await a.finish('A',context);await c.finish('B',await pending);assert.equal(f.broker.held.size,0);
});
test('cancelling pending prepare waits for it and restores before granting foreground',async()=>{
 const f=fixture(false),gate=deferred();const calls=[];f.backend.prepare=async id=>{calls.push('prepare '+id);if(id==='A')await gate.promise;return {id};};f.backend.finish=(id,context)=>calls.push('finish '+id+' '+!!context);
 const a=f.broker.channel(),b=f.broker.channel();const pa=a.prepare('A');const rejected=assert.rejects(pa,/取消/);await delay(2);let stopped=false;const stop=a.finish('A').then(()=>stopped=true);let next=false;const pb=b.prepare('B').then(v=>{next=true;return v;});await delay(5);assert.equal(stopped,false);assert.equal(next,false);gate.resolve();await stop;await rejected;const context=await pb;assert.ok(calls.indexOf('finish A true')<calls.indexOf('prepare B'));await b.finish('B',context);
});
test('finish failure still waits for native cleanup before another command',async()=>{
 const f=fixture(false),gate=deferred();f.backend.prepare=async()=>{await gate.promise;return {};};let count=0;f.backend.finish=()=>{if(count++===0)throw Error('finish failed');};const a=f.broker.channel();const p=a.prepare('A');const rejected=assert.rejects(p,/取消/);await delay(2);const finish=a.finish('A');const finishError=assert.rejects(finish,/finish failed/);await delay(5);assert.equal(f.broker.held.size,2);gate.resolve();await rejected;await finishError;assert.equal(f.broker.held.size,0);
});
test('multiple schedules freeze commands, pause/delete only their own task, and release refs',async()=>{
 const f=fixture(),{manager:m}=f;try{
  const commands=['alpha'];const a=await f.save('A','A',{commands,periodMs:60});commands[0]='mutated';const b=await f.save('B','B',{periodMs:95});
  await until(()=>m.get(a).count>=2&&m.get(b).count>=2);await m.action(a,'pause');const count=m.get(a).count,bc=m.get(b).count,writes=f.writes.filter(x=>x[0]==='A').length;
  await until(()=>m.get(b).count>bc);assert.equal(m.get(a).count,count);assert.equal(f.writes.filter(x=>x[0]==='A').length,writes);assert.ok(!f.writes.some(x=>x[1]==='m'));
  await m.action(a,'delete');assert.equal(f.refs.get('A'),0);assert.equal(f.refs.get('B'),1);await m.action(b,'pause');await m.action(b,'start');await until(()=>m.get(b).count>bc+1);
 }finally{await m.stopAll();}
});
test('a failed/closed target stops only its own task and never retries delivered input',async()=>{
 const f=fixture(),m=f.manager;try{const a=await f.save('A'),b=await f.save('B');await until(()=>m.get(a).count&&m.get(b).count);f.dead.add('A');await until(()=>m.get(a).status==='failed');const writes=f.writes.filter(x=>x[0]==='A').length,bc=m.get(b).count;await until(()=>m.get(b).count>bc);assert.equal(f.writes.filter(x=>x[0]==='A').length,writes);assert.match(m.get(a).error,/关闭|有效/);assert.equal(m.get(a).enabled,false);}finally{await m.stopAll();}
});
test('one-shot fires once, late timers skip missed rounds instead of bursting',async()=>{
 const f=fixture(),m=f.manager;try{const once=await f.save('once','A',{mode:'once',at:Date.now()+60});await until(()=>m.get(once).status==='completed');await delay(100);assert.equal(m.get(once).count,1);}finally{await m.stopAll();}
 let now=10000;const f2=fixture();const m2=new ScheduleManager({backend:f2.backend,broker:f2.broker,clock:()=>now,setTimer:()=>1,clearTimer:()=>{}});
 try{await m2.save({commands:['A'],periodMs:100,start:true},{id:'A',name:'A'});const j=[...m2.jobs.values()][0];now+=20000;await m2.tick(j);assert.equal(j.count,0);assert.ok(j.nextAt>now);assert.equal(f2.writes.length,0);
 await m2.save({commands:['B'],mode:'once',at:now+100,start:true},{id:'B',name:'B'});const once=[...m2.jobs.values()][1];now+=5000;await m2.tick(once);assert.equal(once.status,'missed');assert.equal(f2.writes.length,0);}finally{await m2.stopAll();}
});
test('persist configurations only: restart never restores native handles or armed tasks',async()=>{
 const f=fixture(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-schedule-')),file=path.join(dir,'schedules.json');const m=new ScheduleManager({backend:f.backend,broker:f.broker,file});
 try{await m.save({name:'saved',commands:['echo test'],start:true},{id:'NEVER-PERSIST-HWND',name:'串口一'});const text=await fs.readFile(file,'utf8');assert.ok(!text.includes('NEVER-PERSIST'));const restored=new ScheduleManager({backend:f.backend,broker:f.broker,file});await restored.load();const [j]=restored.snapshot();assert.equal(j.target,null);assert.equal(j.enabled,false);assert.equal(j.status,'unbound');assert.deepEqual(j.commands,['echo test']);await assert.rejects(restored.action(j.id,'start'),/重新绑定/);}finally{await m.stopAll();await fs.rm(dir,{recursive:true,force:true});}
});
test('edits stop old queue, snapshot replacement and independent target references',async()=>{
 const f=fixture(),m=f.manager;try{const a=await f.save('AAA','A',{characterInterval:30});const b=await f.save('B','A',{periodMs:200});assert.equal(f.refs.get('A'),2);await until(()=>m.get(a).status==='running');await m.save({id:a,name:'changed',commands:['C'],start:false},{id:'C',name:'C'});assert.equal(f.refs.get('A'),1);assert.equal(f.refs.get('C'),1);assert.equal(m.get(a).status,'paused');assert.equal(m.get(b).enabled,true);assert.equal(f.broker.waiters.length,0);}finally{await m.stopAll();}
});
test('configuration rejects malformed/unsafe commands and schedule ranges',async()=>{
 for(const value of [{commands:[]},{commands:['a\nb']},{commands:['a\0']},{commands:['a'],periodMs:0},{commands:['a'],mode:'bad'},{commands:['a'],mode:'once',at:NaN},{commands:['a'],characterInterval:-1}])assert.throws(()=>configuration(value));
 const f=fixture();await assert.rejects(f.manager.save({id:{},commands:['A']}),/标识/);await assert.rejects(f.save('past','A',{mode:'once',at:1}),/晚于/);assert.equal(f.manager.jobs.size,0);
});

test('foreground schedules serialize full commands and never overlap slow rounds',async()=>{
 const f=fixture(false),m=f.manager;try{const a=await f.save('AAAA','A',{periodMs:50,characterInterval:15});const b=await f.save('BBBB','B',{periodMs:50,characterInterval:15});await until(()=>m.get(a).count>=2&&m.get(b).count>=2);await m.action(a,'pause');await m.action(b,'pause');
 let target=null,line='';for(const [id,c] of f.writes){if(target===null)target=id;assert.equal(id,target,'a command must keep its foreground resource');if(c==='\n'){assert.equal(line,target.repeat(4));target=null;line='';}else line+=c;}assert.equal(f.broker.held.size,0);assert.equal(f.broker.waiters.length,0);
 }finally{await m.stopAll();}
});
test('failed persistence rolls back an edit safely; close still stops all tasks',async()=>{
 const f=fixture(),m=f.manager;const a=await f.save('A');const before=m.snapshot();m.persist=()=>Promise.reject(Error('disk full'));
 await assert.rejects(m.save({id:a,commands:['changed']},{id:'B',name:'B'}),/未保存/);assert.deepEqual(m.get(a).config.commands,before[0].commands);assert.equal(m.get(a).enabled,false);assert.equal(f.refs.get('A'),1);assert.equal(f.refs.get('B'),0);await m.stopAll();assert.equal(f.broker.held.size,0);
});
