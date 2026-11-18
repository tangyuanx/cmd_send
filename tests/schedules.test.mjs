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
test('countdowns send one frozen round to each independent target, pause and restart reset the wait',async()=>{
 const f=fixture(),m=f.manager;
 try{
  const commands=['alpha'];const a=await f.save('A','A',{commands,periodMs:60});commands[0]='mutated';const b=await f.save('B','B',{periodMs:160});
  await m.action(b,'pause');await until(()=>m.get(a).status==='completed');
  await delay(180);assert.equal(m.get(a).count,1);assert.equal(m.get(a).enabled,false);assert.equal(m.get(b).count,0);
  assert.equal(f.writes.filter(x=>x[0]==='A').map(x=>x[1]).join(''),'alpha\n');
  await m.action(b,'start');assert.ok(m.get(b).nextAt>Date.now());await until(()=>m.get(b).status==='completed');await delay(200);assert.equal(m.get(b).count,1);
  await m.action(a,'delete');assert.equal(f.refs.get('A'),0);assert.equal(f.refs.get('B'),1);
 }finally{await m.stopAll();}
});
test('a closed target stops only its own countdown and never retries',async()=>{
 const f=fixture(),m=f.manager;try{
  const a=await f.save('A'),b=await f.save('B');f.dead.add('A');await until(()=>m.get(a).status==='failed'&&m.get(b).status==='completed');
  await delay(100);assert.equal(m.get(a).count,0);assert.equal(m.get(b).count,1);assert.equal(m.get(a).enabled,false);assert.match(m.get(a).error,/关闭|有效/);
 }finally{await m.stopAll();}
});
test('absolute and countdown schedules fire once and both reject missed times without catch-up',async()=>{
 const f=fixture(),m=f.manager;try{const once=await f.save('once','A',{mode:'once',at:Date.now()+60});await until(()=>m.get(once).status==='completed');await delay(100);assert.equal(m.get(once).count,1);}finally{await m.stopAll();}
 let now=10000;const f2=fixture();const m2=new ScheduleManager({backend:f2.backend,broker:f2.broker,clock:()=>now,setTimer:()=>1,clearTimer:()=>{}});
 try{
  for(const mode of ['countdown','once']){await m2.save({commands:[mode],mode,periodMs:100,at:now+100,start:true},{id:mode,name:mode});}
  now+=20000;for(const j of m2.jobs.values()){await m2.tick(j);assert.equal(j.count,0);assert.equal(j.nextAt,null);assert.equal(j.enabled,false);assert.equal(j.status,'missed');}assert.equal(f2.writes.length,0);
 }finally{await m2.stopAll();}
});
test('restart migrates old intervals to paused one-shot countdowns, never restoring target handles',async()=>{
 const f=fixture(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-schedule-')),file=path.join(dir,'schedules.json');const m=new ScheduleManager({backend:f.backend,broker:f.broker,file});
 try{
  await m.save({name:'saved',commands:['echo test'],start:true},{id:'NEVER-PERSIST-HWND',name:'串口一'});const text=await fs.readFile(file,'utf8');assert.ok(!text.includes('NEVER-PERSIST'));
  const saved=JSON.parse(text);assert.equal(saved.version,2);const old=saved.jobs;old[0].mode='interval';old[0].periodMs=12000;await fs.writeFile(file,JSON.stringify(old));
  const restored=new ScheduleManager({backend:f.backend,broker:f.broker,file});await restored.load();const [j]=restored.snapshot();assert.equal(j.target,null);assert.equal(j.enabled,false);assert.equal(j.status,'unbound');assert.equal(j.mode,'countdown');assert.equal(j.periodMs,12000);assert.deepEqual(j.commands,['echo test']);await assert.rejects(restored.action(j.id,'start'),/重新绑定/);
 }finally{await m.stopAll();await fs.rm(dir,{recursive:true,force:true});}
});
test('edits stop old queues and retain independent target references',async()=>{
 const f=fixture(),m=f.manager;try{const a=await f.save('AAA','A',{characterInterval:30});const b=await f.save('B','A',{periodMs:200});assert.equal(f.refs.get('A'),2);await until(()=>m.get(a).status==='running');await m.save({id:a,name:'changed',commands:['C'],start:false},{id:'C',name:'C'});assert.equal(f.refs.get('A'),1);assert.equal(f.refs.get('C'),1);assert.equal(m.get(a).status,'paused');assert.equal(m.get(b).enabled,true);assert.equal(f.broker.waiters.length,0);}finally{await m.stopAll();}
});
test('configuration rejects malformed commands, recurring mode and invalid schedule ranges',async()=>{
 for(const value of [{commands:[]},{commands:['a\nb']},{commands:['a\0']},{commands:['a'],periodMs:0},{commands:['a'],mode:'interval'},{commands:['a'],mode:'bad'},{commands:['a'],mode:'once',at:NaN},{commands:['a'],characterInterval:-1}])assert.throws(()=>configuration(value));
 const f=fixture();await assert.rejects(f.manager.save({id:{},commands:['A']}),/标识/);await assert.rejects(f.save('past','A',{mode:'once',at:1}),/晚于/);assert.equal(f.manager.jobs.size,0);
});
test('foreground countdowns serialize full commands and complete without repeating',async()=>{
 const f=fixture(false),m=f.manager;try{const a=await f.save('AAAA','A',{periodMs:50,characterInterval:15});const b=await f.save('BBBB','B',{periodMs:50,characterInterval:15});await until(()=>m.get(a).status==='completed'&&m.get(b).status==='completed');await delay(120);
 let target=null,line='';for(const [id,c] of f.writes){if(target===null)target=id;assert.equal(id,target,'a command must keep its foreground resource');if(c==='\n'){assert.equal(line,target.repeat(4));target=null;line='';}else line+=c;}assert.equal(m.get(a).count,1);assert.equal(m.get(b).count,1);assert.equal(f.broker.held.size,0);assert.equal(f.broker.waiters.length,0);
 }finally{await m.stopAll();}
});
test('failed persistence rolls back an edit safely; close still stops all tasks',async()=>{
 const f=fixture(),m=f.manager;const a=await f.save('A');const before=m.snapshot();m.persist=()=>Promise.reject(Error('disk full'));
 await assert.rejects(m.save({id:a,commands:['changed']},{id:'B',name:'B'}),/未保存/);assert.deepEqual(m.get(a).config.commands,before[0].commands);assert.equal(m.get(a).enabled,false);assert.equal(f.refs.get('A'),1);assert.equal(f.refs.get('B'),0);await m.stopAll();assert.equal(f.broker.held.size,0);
});

test('reordering and cross-group moves survive restart without persisting targets or armed state',async()=>{
 const f=fixture(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-order-')),file=path.join(dir,'schedules.json'),m=new ScheduleManager({backend:f.backend,broker:f.broker,file});
 try{
  const [group]=await m.saveGroup({name:'设备组'});
  for(const id of ['A','B','C'])await m.save({id:undefined,name:id,commands:[id]},{id,name:id});
  const [a,b,c]=m.snapshot();await m.move(c.id,{beforeId:a.id});assert.deepEqual(m.snapshot().map(j=>j.name),['C','A','B']);
  await m.move(c.id,{groupId:group.id});await m.move(a.id,{groupId:group.id,beforeId:c.id});
  const restored=new ScheduleManager({backend:f.backend,broker:f.broker,file});await restored.load();
  assert.deepEqual(restored.groupSnapshot(),[group]);assert.deepEqual(restored.snapshot().map(j=>[j.name,j.groupId]),[['B',null],['A',group.id],['C',group.id]]);
  assert.ok(restored.snapshot().every(j=>!j.target&&!j.enabled));
  const text=await fs.readFile(file,'utf8');assert.ok(!text.includes('"target":'));assert.ok(!text.includes('"enabled":'));
  await m.save({id:b.id,name:'B edited',commands:['B']});assert.deepEqual(m.snapshot().map(j=>j.id),[b.id,a.id,c.id]);
 }finally{await m.stopAll();await fs.rm(dir,{recursive:true,force:true});}
});
test('moving and deleting a group preserve an in-flight command, target references and deadline',async()=>{
 const f=fixture(),m=f.manager;
 try{
  const [group]=await m.saveGroup({name:'发送组'}),a=await f.save('ABCDE','A',{periodMs:50,characterInterval:25,groupId:group.id});
  await until(()=>f.writes.length>0);const job=m.get(a),queue=job.queue,generation=job.generation,refs=f.refs.get('A');
  await m.move(a,{groupId:null});assert.equal(m.get(a),job);assert.equal(job.queue,queue);assert.equal(job.generation,generation);assert.equal(f.refs.get('A'),refs);
  await m.move(a,{groupId:group.id});await m.groupAction(group.id,'delete');assert.equal(job.queue,queue);assert.equal(job.config.groupId,null);
  await until(()=>job.status==='completed');assert.equal(job.count,1);assert.equal(f.writes.map(x=>x[1]).join(''),'ABCDE\n');
 }finally{await m.stopAll();}
});
test('invalid moves and failed metadata writes preserve order, group membership and references',async()=>{
 const f=fixture(),m=f.manager;
 try{
  const [group]=await m.saveGroup({name:'原组'}),a=await f.save('A','A',{start:false}),b=await f.save('B','B',{start:false,groupId:group.id});const before=m.snapshot(),groups=m.groupSnapshot();
  await assert.rejects(m.move(a,{groupId:group.id,beforeId:a}),/不属于/);await assert.rejects(m.move('missing'),/不存在/);await assert.rejects(m.move(a,{groupId:'missing'}),/不存在/);
  await assert.rejects(m.saveGroup({name:'原组'}),/已存在/);await assert.rejects(m.saveGroup({name:' '}),/组名/);
  m.persist=async()=>{throw Error('disk full');};
  await assert.rejects(m.move(a,{groupId:group.id,beforeId:b}),/未保存/);assert.deepEqual(m.snapshot(),before);
  await assert.rejects(m.saveGroup({id:group.id,name:'新名'}),/未保存/);assert.deepEqual(m.groupSnapshot(),groups);
  await assert.rejects(m.groupAction(group.id,'delete'),/未保存/);assert.deepEqual(m.snapshot(),before);assert.deepEqual(m.groupSnapshot(),groups);
  await assert.rejects(m.action(a,'delete'),/未保存/);assert.equal(f.refs.get('A'),1);assert.equal(f.refs.get('B'),1);assert.equal(m.jobs.size,2);
 }finally{await m.stopAll();}
});
test('group start preflights every pending member and shares one countdown origin without restarting active jobs',async()=>{
 const f=fixture();let now=10000;const m=new ScheduleManager({backend:f.backend,broker:f.broker,clock:()=>now++,setTimer:()=>1,clearTimer:()=>{}});
 try{
  const [group]=await m.saveGroup({name:'统一开启'});
  await m.save({name:'A',commands:['A'],periodMs:5000,groupId:group.id},{id:'A'});await m.save({name:'B',commands:['B'],periodMs:8000,groupId:group.id});
  const [a,b]=m.snapshot();await assert.rejects(m.groupAction(group.id,'start'),/B.*重新绑定/);assert.ok(m.snapshot().every(j=>!j.enabled));
  await m.save({id:b.id,name:'B',commands:['B'],periodMs:8000,groupId:group.id},{id:'B'});
  await m.groupAction(group.id,'start');assert.equal(m.get(b.id).nextAt-m.get(a.id).nextAt,3000);
  const deadline=m.get(a.id).nextAt,generation=m.get(a.id).generation;await m.action(b.id,'pause');await m.groupAction(group.id,'start');assert.equal(m.get(a.id).nextAt,deadline);assert.equal(m.get(a.id).generation,generation);
  await m.groupAction(group.id,'pause');assert.ok(m.snapshot().every(j=>!j.enabled&&j.nextAt===null));
  f.dead.add('B');await assert.rejects(m.groupAction(group.id,'start'),/B.*重新绑定/);assert.ok(m.snapshot().every(j=>!j.enabled));
 }finally{await m.stopAll();}
});
test('group start refuses stale native targets and expired absolute times before arming other members',async()=>{
 const f=fixture();let now=1000;const m=new ScheduleManager({backend:f.backend,broker:f.broker,clock:()=>now,setTimer:()=>1,clearTimer:()=>{}});
 try{
  const [group]=await m.saveGroup({name:'校验组'});await m.save({name:'A',commands:['A'],groupId:group.id},{id:'A'});await m.save({name:'过期',commands:['B'],groupId:group.id,mode:'once',at:2000},{id:'B'});
  now=3000;await assert.rejects(m.groupAction(group.id,'start'),/过期.*时间已过/);assert.ok(m.snapshot().every(j=>!j.enabled));
  now=1000;f.backend.deliveryInfo=id=>{if(id==='B')throw Error('窗口已被替换');return {key:id,background:true};};
  await assert.rejects(m.groupAction(group.id,'start'),/过期.*替换/);assert.ok(m.snapshot().every(j=>!j.enabled));
 }finally{await m.stopAll();}
});
test('group delivery fires one round on independent targets and can stop all queued foreground work',async()=>{
 for(const background of [true,false]){
  const f=fixture(background),m=f.manager;
  try{
   const [group]=await m.saveGroup({name:'批量'});for(const name of ['AAA','BBB'])await f.save(name,name,{start:false,periodMs:50,characterInterval:15,groupId:group.id});
   await m.groupAction(group.id,'start');await until(()=>m.snapshot().every(j=>j.status==='completed'));assert.ok(m.snapshot().every(j=>j.count===1));
   await m.groupAction(group.id,'start');await until(()=>f.writes.length>8);await m.groupAction(group.id,'pause');const delivered=f.writes.length;await delay(80);assert.equal(f.writes.length,delivered);assert.equal(f.broker.held.size,0);assert.equal(f.broker.waiters.length,0);
  }finally{await m.stopAll();}
 }
});
test('concurrent organization operations serialize with edits and shutdown rejects new starts',async()=>{
 const f=fixture(),m=f.manager;
 const [group]=await m.saveGroup({name:'并发'}),a=await f.save('A','A',{start:false}),b=await f.save('B','B',{start:false});
 await Promise.all([m.move(b,{beforeId:a}),m.save({id:a,name:'A changed',commands:['A'],groupId:group.id}),m.groupAction(group.id,'delete')]);
 assert.deepEqual(m.snapshot().map(j=>j.id),[b,a]);assert.equal(m.get(a).config.name,'A changed');assert.ok(m.snapshot().every(j=>j.groupId===null));assert.equal(f.refs.get('A'),1);
 await m.stopAll();await assert.rejects(m.saveGroup({name:'退出后'}),/退出/);await assert.rejects(m.action(a,'start'),/退出/);await assert.rejects(m.move(a),/退出/);
});
test('empty and long-named groups remain editable; missing group metadata never discards valid legacy tasks',async()=>{
 const f=fixture(),m=f.manager,dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-groups-')),file=path.join(dir,'schedules.json');
 try{
  const name='设备'.repeat(40),[group]=await m.saveGroup({name});await assert.rejects(m.groupAction(group.id,'start'),/没有任务/);
  await m.saveGroup({id:group.id,name:'已重命名'});assert.equal(m.groupSnapshot()[0].name,'已重命名');await assert.rejects(m.saveGroup({name:name+'多'}),/组名/);
  await fs.writeFile(file,JSON.stringify({version:2,groups:[{id:'good',name:'组'},null,{id:'bad',name:''}],jobs:[{id:'saved',name:'旧任务',commands:['echo A'],groupId:'missing'}]}));
  const restored=new ScheduleManager({backend:f.backend,broker:f.broker,file});await restored.load();assert.deepEqual(restored.groupSnapshot(),[{id:'good',name:'组'}]);assert.equal(restored.snapshot().length,1);assert.equal(restored.get('saved').config.groupId,null);
  await m.groupAction(group.id,'delete');assert.equal(m.groups.size,0);
 }finally{await m.stopAll();await fs.rm(dir,{recursive:true,force:true});}
});
