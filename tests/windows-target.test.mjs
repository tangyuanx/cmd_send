import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createBackend}=require('../electron/native/windows.cjs');

function setup({className='CustomTerminal',automation=null,pickError=null,processName='Fixture',hostName=processName,hostPid=123,sessionAddress=()=>null}={}){
  const state={foreground:99,cursor:{x:140,y:260},focus:10,alive:true,enabled:true,readonly:false,covered:false,clicks:0,keys:[],shortInput:false,calls:[],verify:null,onFocus:null,activate:true,failClick:false,messages:[],postSuccess:true,visible:true,parent:1,hostPid,hostReplaced:false,element:10,elementTitle:'会话一',hostTitle:'终端窗口'};
  const functions={
    GetCursorPos:p=>{Object.assign(p,state.cursor);return 1;},SetCursorPos:(x,y)=>{state.cursor={x,y};return 1;},
    WindowFromPoint:()=>state.covered?88:state.element,GetAncestor:()=>state.parent,GetWindowThreadProcessId:(hwnd,pid)=>{pid[0]=hwnd===99?999:hwnd===1?state.hostPid:123;return hwnd===1&&hostPid!==123?8:7;},
    IsWindow:h=>h&&state.alive?1:0,IsWindowEnabled:()=>+state.enabled,IsWindowVisible:()=>+state.visible,
    GetClassNameW:(h,b)=>{const text=h===10||h===20?className:'CustomTerminal';b.write(text,'utf16le');return text.length;},
    GetWindowTextW:(h,b)=>{const value=h===1?state.hostTitle:state.elementTitle;b.write(value,'utf16le');return value.length;},GetWindowLongPtrW:()=>state.readonly?0x800:0,
    GetGUIThreadInfo:(_thread,info)=>{info.focus=state.focus;return 1;},
    GetForegroundWindow:()=>state.foreground,SetForegroundWindow:h=>{if(state.activate)state.foreground=h;return +state.activate;},
    SetFocus:()=>10,AttachThreadInput:()=>1,IsChild:(parent,child)=>+(parent===1&&child===10),ShowWindow:()=>1,IsIconic:()=>0,
    ScreenToClient:(_h,p)=>{p.x-=100;p.y-=200;return 1;},ClientToScreen:(_h,p)=>{p.x+=100;p.y+=200;return 1;},
    GetClientRect:(_h,r)=>{Object.assign(r,{left:0,top:0,right:400,bottom:300});return 1;},GetAsyncKeyState:()=>0,GetSystemMetrics:index=>({76:0,77:0,78:1920,79:1080})[index],
    SendMessageTimeoutW:(h,msg,wp)=>{state.messages.push({h,msg,wp});return +state.postSuccess;},
    SendInput:(n,b)=>{
      if(b.readUInt32LE(0)===0){
        assert.equal(n,3);assert.equal(b.length,120);
        for(let i=0;i<3;i++){assert.equal(b.readUInt32LE(i*40+20),0x8000|0x4000|[1,2,4][i]);assert.equal(b.readUInt32LE(i*40+24),0,'MOUSEINPUT time must not contain flags');}
        state.clicks++;if(state.failClick)return 0;state.focus=10;
      }
      else{state.keys.push(b.readUInt16LE(10)||b.readUInt16LE(8));if(state.shortInput)return 1;}
      return n;
    },
    OpenProcess:(_a,_i,pid)=>pid,GetProcessTimes:(h,created)=>{created[0]=h===hostPid&&state.hostReplaced?43n:42n;return 1;},
    QueryFullProcessImageNameW:(h,_flags,b,size)=>{const value=`C:\\${h===hostPid?hostName:processName}.exe`;b.write(value,'utf16le');size[0]=value.length;return 1;},
    CloseHandle:()=>1,GetCurrentThreadId:()=>6,GetLastError:()=>5,
  };
  const koffi={struct:()=>({}),sizeof:()=>72,address:p=>p,load:()=>({func:signature=>{
    const name=signature.match(/__stdcall (\w+)\(/)[1];assert.ok(functions[name],name);return functions[name];
  }})};
  const worker={async call(method){state.calls.push(method);if(method==='pick'){if(pickError)throw pickError;return automation||{supported:false};}if(method==='focus'&&state.onFocus)return state.onFocus();if(method==='verify'&&state.verify)return state.verify();return true;},dispose(){}};
  const backend=createBackend({koffi,worker,sleep:async()=>{},sessionAddress});
  return {state,backend};
}

test('terminal without UIA text patterns binds the selected HWND and client position',async()=>{
  const {backend,state}=setup();const t=await backend.pick();assert.equal(t.strategy,'所选区域聚焦输入');
  assert.deepEqual(state.calls,['pick']);const context=await backend.prepare(t.id);
  assert.equal(state.clicks,1);assert.deepEqual(state.cursor,{x:140,y:260});
  await backend.character(t.id,'中');await backend.character(t.id,'😀');await backend.enter(t.id);
  assert.deepEqual(state.keys,[0x4e2d,0xd83d,0xde00,13]);backend.finish(t.id,context);assert.equal(state.foreground,99);
});
test('UIA provider failure uses native fallback, explicit non-input/readonly rejection is preserved',async()=>{
  const fallback=setup({pickError:new Error('provider unavailable')});assert.equal((await fallback.backend.pick()).strategy,'所选区域聚焦输入');
  const rejected=setup({pickError:Object.assign(new Error('此输入区为只读'),{code:'UIA_REJECTED'})});await assert.rejects(rejected.backend.pick(),/只读/);
});
test('native standard Edit remains a background target and readonly binding is refused',async()=>{
  const {backend,state}=setup({className:'Edit'});const t=await backend.pick();assert.equal(t.strategy,'后台文本输入');
  await backend.prepare(t.id);await backend.character(t.id,'A');assert.equal(state.clicks,0);assert.deepEqual(state.calls,[]);
  const readonly=setup({className:'Edit'});readonly.state.readonly=true;await assert.rejects(readonly.backend.pick(),/只读/);
});
test('buttons and tools own processes cannot become fallback targets',async()=>{
  const button=setup({className:'Button'});await assert.rejects(button.backend.pick(),/不是文本输入区/);
  const own=setup();own.backend.setExcludedPids([123]);await assert.rejects(own.backend.pick(),/自身/);
});
test('a covering window prevents the focus click and text delivery',async()=>{
  const {backend,state}=setup();const t=await backend.pick();state.covered=true;
  await assert.rejects(backend.prepare(t.id),/遮挡/);assert.equal(state.clicks,0);assert.equal(state.keys.length,0);assert.equal(state.foreground,99);
});
test('foreground activation and native click failures do not send text',async()=>{
  for(const flag of ['activate','failClick']){const {backend,state}=setup();const t=await backend.pick();state[flag]=flag==='failClick';
    await assert.rejects(backend.prepare(t.id),/无法/);assert.equal(state.keys.length,0);}
});
test('focus changes or target closure stop native fallback before the next character',async()=>{
  const {backend,state}=setup();const t=await backend.pick();await backend.prepare(t.id);await backend.character(t.id,'A');
  state.focus=88;await assert.rejects(backend.character(t.id,'B'),/焦点/);assert.deepEqual(state.keys,[65]);
  state.alive=false;await assert.rejects(backend.enter(t.id),/关闭|替换/);assert.deepEqual(state.keys,[65]);
});
test('UIA character and Enter calls return promises and propagate verification failures',async()=>{
  const {backend,state}=setup({automation:{targetId:'uia',detail:'输入区'}});const t=await backend.pick();await backend.prepare(t.id);
  let complete;state.verify=()=>new Promise(resolve=>complete=resolve);const pending=backend.character(t.id,'A');assert.equal(typeof pending.then,'function');
  assert.deepEqual(state.keys,[]);complete(true);await pending;assert.deepEqual(state.keys,[65]);
  state.verify=async()=>{throw new Error('焦点已改变');};await assert.rejects(backend.enter(t.id),/焦点/);assert.deepEqual(state.keys,[65]);
});
test('stop while UIA verification is pending cancels delivery without a late character',async()=>{
  const {backend,state}=setup({automation:{targetId:'uia'}});const t=await backend.pick();const context=await backend.prepare(t.id);
  let complete;state.verify=()=>new Promise(resolve=>complete=resolve);const pending=backend.character(t.id,'A');backend.finish(t.id,context);complete(true);
  await assert.rejects(pending,/取消/);assert.deepEqual(state.keys,[]);
});
test('a partial SendInput result rejects the awaited character instead of reporting success',async()=>{
  const {backend,state}=setup();const t=await backend.pick();await backend.prepare(t.id);state.shortInput=true;
  await assert.rejects(backend.character(t.id,'A'),/投递未完成/);assert.equal(state.keys.length,1);
});
test('MobaXterm embedded CMoTTY sends to the exact terminal in the background despite unrelated host focus',async()=>{
  const {backend,state}=setup({className:'CMoTTY',processName:'MoTTY',hostName:'MobaXterm_Personal_26.5',hostPid:456});
  state.focus=88;state.activate=false;state.readonly=true;const target=await backend.pick();
  assert.equal(target.name,'MobaXterm');assert.equal(target.strategy,'后台终端输入');assert.deepEqual(state.calls,[]);
  const context=await backend.prepare(target.id);for(const c of 'A中😀')await backend.character(target.id,c);await backend.enter(target.id);backend.finish(target.id,context);
  assert.deepEqual(state.messages.map(m=>[m.h,m.msg,m.wp]),[[10,0x102,65],[10,0x102,0x4e2d],[10,0x102,0xd83d],[10,0x102,0xde00],[10,0x102,13]]);
  assert.equal(state.foreground,99);assert.equal(state.clicks,0);assert.deepEqual(state.keys,[]);
});
test('CMoTTY class alone cannot opt an unrelated process into terminal background delivery',async()=>{
  const {backend}=setup({className:'CMoTTY',processName:'Unrelated'});assert.equal((await backend.pick()).strategy,'所选区域聚焦输入');
});
test('background terminal refuses host replacement and reparenting before any text',async()=>{
  for(const mutation of [s=>s.hostReplaced=true,s=>s.hostPid=457,s=>s.parent=2]){
    const {backend,state}=setup({className:'CMoTTY',processName:'MoTTY',hostName:'MobaXterm',hostPid:456});const target=await backend.pick();mutation(state);
    await assert.rejects(backend.character(target.id,'X'),/隐藏|关闭|替换/);assert.equal(state.messages.length,0);
  }
});
test('hidden MobaXterm session remains bound while another session is visible; labels stay distinct and immutable',async()=>{
  const {backend,state}=setup({className:'CMoTTY',processName:'MoTTY',hostName:'MobaXterm',hostPid:456});
  const first=await backend.pick();assert.equal(first.sessionName,'会话一');state.visible=false;state.element=20;state.elementTitle='会话二';state.hostTitle='会话二窗口';state.focus=20;
  const context=await backend.prepare(first.id);await backend.character(first.id,'A');await backend.enter(first.id);backend.finish(first.id,context);
  assert.deepEqual(state.messages.map(m=>m.h),[10,10]);assert.equal(state.foreground,99);assert.equal(state.clicks,0);assert.equal(first.sessionName,'会话一');
  const second=await backend.pick();assert.notEqual(second.sessionKey,first.sessionKey);assert.equal(second.sessionName,'会话二');
  assert.equal(backend.hasTarget(first.id),false);assert.equal(backend.hasTarget(second.id),true);
});
test('MobaXterm address metadata uses only the bound terminal identity and stays fixed on tab switches',async()=>{
  const lookups=[];
  const {backend,state}=setup({className:'CMoTTY',processName:'MoTTY',hostName:'MobaXterm_Personal_26.5',hostPid:456,sessionAddress:root=>{lookups.push(root);return {address:'192.168.1.10',port:2222};}});
  const t=await backend.pick();assert.deepEqual(lookups,[{pid:123,created:'42'}]);assert.equal(t.sessionAddress,'192.168.1.10');assert.equal(t.sessionPort,2222);
  state.visible=false;state.element=20;state.elementTitle='192.168.1.20';await backend.prepare(t.id);await backend.character(t.id,'A');
  assert.equal(t.sessionAddress,'192.168.1.10');assert.equal(lookups.length,1);assert.equal(state.messages[0].h,10);
});
test('address lookup failures preserve native session binding and its original label',async()=>{
  const {backend}=setup({className:'CMoTTY',processName:'MoTTY',hostName:'MobaXterm',hostPid:456,sessionAddress:()=>{throw new Error('Access denied');}});
  const t=await backend.pick();assert.equal(t.sessionAddress,undefined);assert.equal(t.sessionName,'会话一');await backend.prepare(t.id);await backend.character(t.id,'A');
});
test('multi-tab shared input restores the bound session and verifies it before each character',async()=>{
  const {backend,state}=setup({processName:'WindowsTerminal',automation:{targetId:'tab-one',sessionBound:true,sessionName:'会话一',requiresNativeFocus:true}});
  const t=await backend.pick();state.calls=[];let selected='two';state.onFocus=()=>{selected='one';return true;};state.verify=()=>{if(selected!=='one')throw new Error('会话已切换');return true;};
  await backend.prepare(t.id);assert.equal(selected,'one');assert.equal(state.clicks,1);await backend.character(t.id,'A');
  selected='two';await assert.rejects(backend.character(t.id,'B'),/会话已切换/);assert.deepEqual(state.keys,[65]);assert.equal(t.sessionName,'会话一');
});
test('shared terminal without stable tab identity refuses binding rather than sending to the active session',async()=>{
  for(const processName of ['WindowsTerminal','Xshell','SecureCRT','MobaXterm_Personal_26.5']){
    const {backend,state}=setup({processName});await assert.rejects(backend.pick(),/会话身份.*独立窗口/);assert.deepEqual(state.keys,[]);
  }
});
test('cross-process terminals embedded in the tool itself are excluded by their host PID',async()=>{
  const {backend}=setup({className:'CMoTTY',processName:'MoTTY',hostPid:456});backend.setExcludedPids([456]);await assert.rejects(backend.pick(),/自身/);
});
test('background terminal permission failures propagate without foreground fallback or retry',async()=>{
  const {backend,state}=setup({className:'CMoTTY',processName:'MoTTY'});const target=await backend.pick();state.postSuccess=false;
  await assert.rejects(backend.character(target.id,'X'),/权限.*停止.*不会重试/);assert.equal(state.messages.length,1);assert.equal(state.clicks,0);assert.deepEqual(state.keys,[]);
});
