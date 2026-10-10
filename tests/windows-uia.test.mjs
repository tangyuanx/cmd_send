import {test} from 'node:test';import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';import {PassThrough,Writable} from 'node:stream';
import {createRequire} from 'node:module';
const {AutomationWorker}=createRequire(import.meta.url)('../electron/native/windows-uia.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t){
  t.mock.timers.enable({apis:['setTimeout']});
  const children=[];
  const worker=new AutomationWorker({spawnProcess:()=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.requests=[];
    child.stdin=new Writable({write(bytes,encoding,callback){child.requests.push(JSON.parse(bytes.toString()));callback();}});
    child.reply=response=>child.stdout.write(JSON.stringify(response)+'\n');
    child.kill=()=>{child.killed=true;child.emit('exit',null);};children.push(child);return child;
  }});
  t.after(()=>worker.dispose());return {worker,children};
}
test('UIA waits for cold startup readiness without spending the request deadline',async t=>{
  const {worker,children}=fixture(t),first=worker.call('verify',{targetId:'one'}),second=worker.call('verify',{targetId:'two'});
  assert.equal(children.length,1);const child=children[0];
  t.mock.timers.tick(6000);await flush();assert.deepEqual(child.requests,[]);assert.equal(child.killed,undefined);
  child.reply({type:'ready'});await flush();assert.equal(child.requests.length,2);
  child.reply({id:child.requests[0].id,ok:true,value:true});child.reply({id:child.requests[1].id,ok:false,error:'目标输入区已失效',code:'UIA_UNAVAILABLE'});
  assert.equal(await first,true);await assert.rejects(second,{message:'目标输入区已失效',code:'UIA_UNAVAILABLE'});
});
test('UIA request timeout stops all delivery without retries and reports timeout',async t=>{
  const {worker,children}=fixture(t),one=worker.call('focus'),two=worker.call('verify');
  const rejected=[assert.rejects(one,/响应超时/),assert.rejects(two,/响应超时/)];
  children[0].reply({type:'ready'});await flush();t.mock.timers.tick(5000);await Promise.all(rejected);
  assert.equal(children[0].killed,true);assert.equal(children[0].requests.length,2);assert.equal(children.length,1);
});
test('UIA startup deadline fails without submitting a request',async t=>{
  const {worker,children}=fixture(t),rejected=assert.rejects(worker.call('pick'),/启动超时/);
  t.mock.timers.tick(20000);await rejected;
  assert.deepEqual(children[0].requests,[]);assert.equal(children[0].killed,true);
});
test('cancelled startup cannot send late requests or revive an old worker',async t=>{
  const {worker,children}=fixture(t),rejected=assert.rejects(worker.call('pick'),/已取消/);
  worker.dispose();await rejected;
  const next=worker.call('verify');const old=children[0],current=children[1];
  old.reply({type:'ready'});old.emit('error',new Error('late old process error'));await flush();
  assert.deepEqual(old.requests,[]);assert.deepEqual(current.requests,[]);assert.equal(current.killed,undefined);
  current.reply({type:'ready'});await flush();current.reply({id:current.requests[0].id,ok:true,value:true});
  assert.equal(await next,true);
});
test('UIA process failure during startup rejects every waiting caller',async t=>{
  const {worker,children}=fixture(t),one=worker.call('pick'),two=worker.call('verify');
  const rejected=[assert.rejects(one,/服务已停止/),assert.rejects(two,/服务已停止/)];
  children[0].emit('error',new Error('cannot start'));await Promise.all(rejected);
  assert.deepEqual(children[0].requests,[]);assert.equal(children[0].killed,true);
});
