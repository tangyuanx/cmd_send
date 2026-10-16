import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createBackend}=require('../electron/native/windows.cjs');

function fixture(){
  const nodes=new Map([
    [1,{parent:0,rect:[0,0,1000,800],cls:'MobaHost',pid:456}],
    [2,{parent:1,rect:[0,50,1000,800],cls:'Workspace',pid:456}],
    [3,{parent:2,rect:[0,50,200,800],cls:'Navigation',pid:456}],
    [10,{parent:2,rect:[200,100,1000,800],cls:'SerialPage',pid:456}],
    [11,{parent:10,rect:[200,100,1000,700],cls:'Static',pid:456}],
    [100,{parent:10,rect:[200,700,1000,800],cls:'CMoTTY',pid:123}],
    [101,{parent:100,rect:[200,750,1000,800],cls:'Edit',pid:123}],
  ]);
  const s={nodes,point:{x:400,y:300},hit:11,messages:[],clicks:0,alive:true};
  const bounds=(h,r)=>{const [left,top,right,bottom]=nodes.get(h).rect;Object.assign(r,{left,top,right,bottom});return 1;};
  const parent=h=>nodes.get(h)?.parent||0;
  const child=(a,b)=>{for(let h=parent(b);h;h=parent(h))if(h===a)return 1;return 0;};
  const visible=h=>{for(;h;h=parent(h))if(nodes.get(h).hidden)return 0;return 1;};
  const f={
    GetCursorPos:p=>(Object.assign(p,s.point),1),SetCursorPos:()=>{throw Error('must not move cursor');},
    WindowFromPoint:()=>s.hit,GetAncestor:()=>1,GetParent:parent,
    GetWindowThreadProcessId:(h,out)=>(out[0]=nodes.get(h).pid,out[0]===456?8:7),
    IsWindow:h=>+(s.alive&&nodes.has(h)),IsWindowEnabled:()=>1,IsWindowVisible:visible,IsChild:child,
    GetClassNameW:(h,b)=>{const value=nodes.get(h).cls;b.write(value,'utf16le');return value.length;},
    GetWindowTextW:(h,b)=>{const value=h===1?'MobaXterm':nodes.get(h).pid===123?'COM3':'COM4';b.write(value,'utf16le');return value.length;},
    GetWindowLongPtrW:h=>nodes.get(h).readonly?0x800n:0n,
    GetWindowRect:bounds,GetClientRect:(h,r)=>{const [l,t,rgt,b]=nodes.get(h).rect;Object.assign(r,{left:0,top:0,right:rgt-l,bottom:b-t});return 1;},
    ScreenToClient:(h,p)=>{p.x-=nodes.get(h).rect[0];p.y-=nodes.get(h).rect[1];return 1;},
    ClientToScreen:(h,p)=>{p.x+=nodes.get(h).rect[0];p.y+=nodes.get(h).rect[1];return 1;},
    ChildWindowFromPointEx:(h,p)=>{const x=p.x+nodes.get(h).rect[0],y=p.y+nodes.get(h).rect[1];for(const [k,n] of [...nodes].reverse()){const [l,t,r,b]=n.rect;if(n.parent===h&&visible(k)&&l<=x&&x<r&&t<=y&&y<b)return k;}return h;},
    EnumChildWindows:(h,cb)=>{for(const k of nodes.keys())if(child(h,k))cb(k,0);return 1;},
    SendMessageTimeoutW:(h,msg,wp)=>(s.messages.push({h,msg,wp}),1),
    OpenProcess:(_a,_b,pid)=>pid,GetProcessTimes:(_h,out)=>(out[0]=42n,1),
    QueryFullProcessImageNameW:(h,_flags,b,size)=>{const v=`C:\\${h===456?'MobaXterm':'MoTTY'}.exe`;b.write(v,'utf16le');size[0]=v.length;return 1;},CloseHandle:()=>1,
    GetForegroundWindow:()=>99,GetAsyncKeyState:()=>0,GetLastError:()=>0,
  };
  const koffi={struct:()=>({}),proto:()=>({}),sizeof:()=>72,address:p=>p,pointer:p=>p,register:f=>f,unregister:()=>{},load:()=>({func:sig=>{const name=sig.match(/__stdcall (\w+)\(/)[1];return f[name]||(()=>{s.clicks++;throw Error('unexpected focus/input API: '+name);});}})};
  s.backend=createBackend({koffi,worker:{call:()=>{throw Error('page binding must use native terminal');},dispose(){}},sessionAddress:()=>null});
  s.drop=async(hit=11,x=400,y=300)=>{s.hit=hit;s.point={x,y};return s.backend.pick();};
  return s;
}

test('serial display, input descendant and same-page whitespace resolve to the same native session',async()=>{
  const s=fixture(),display=await s.drop();assert.equal(display.strategy,'后台终端输入');
  const input=await s.drop(101,400,760);assert.equal(input.sessionKey,display.sessionKey);
  s.nodes.get(11).rect=[200,100,800,600];const blank=await s.drop(10,950,650);assert.equal(blank.sessionKey,display.sessionKey);
  await s.backend.prepare(blank.id);await s.backend.character(blank.id,'中');await s.backend.enter(blank.id);
  assert.deepEqual(s.messages,[{h:100,msg:0x102,wp:0x4e2d},{h:100,msg:0x102,wp:13}]);assert.equal(s.clicks,0);
});
test('page lookup works when the system hit skips readonly output and returns its host',async()=>{
  const s=fixture();assert.equal((await s.drop(1)).sessionKey,'PID 123 · 输入区 100');
});
test('readonly Edit output associates with its page instead of rejecting readonly text input',async()=>{
  const s=fixture();Object.assign(s.nodes.get(11),{cls:'Edit',readonly:true});assert.equal((await s.drop()).strategy,'后台终端输入');
});
test('hidden overlapping tab is ignored and later tab changes keep the bound HWND',async()=>{
  const s=fixture();s.nodes.set(20,{parent:2,rect:[200,100,1000,800],cls:'Page',pid:456,hidden:true});s.nodes.set(200,{parent:20,rect:[200,100,1000,800],cls:'CMoTTY',pid:124});
  const target=await s.drop();s.nodes.get(10).hidden=true;s.nodes.get(20).hidden=false;
  await s.backend.prepare(target.id);await s.backend.character(target.id,'A');assert.equal(s.messages[0].h,100);
});
function split(s){for(const h of [10,11,100,101])s.nodes.get(h).rect[2]=600;s.nodes.set(20,{parent:2,rect:[600,100,1000,800],cls:'Page',pid:456});s.nodes.set(21,{parent:20,rect:[600,100,1000,700],cls:'Static',pid:456});s.nodes.set(200,{parent:20,rect:[600,700,1000,800],cls:'CMoTTY',pid:124});}
test('split page drops select the matching terminal and ambiguous shared space is refused',async()=>{
  const s=fixture();split(s);assert.equal((await s.drop()).sessionKey,'PID 123 · 输入区 100');assert.equal((await s.drop(21,800,300)).sessionKey,'PID 124 · 输入区 200');await assert.rejects(s.drop(2,400,70),/多个会话/);
});
test('sidebar and empty page cannot borrow another session; clipped terminals are ignored',async()=>{
  const s=fixture();await assert.rejects(s.drop(3,100,300));s.nodes.get(100).rect=[200,850,1000,950];await assert.rejects(s.drop());assert.deepEqual(s.messages,[]);
});
test('negative monitor coordinates resolve the same page without coordinate assumptions',async()=>{
  const s=fixture();for(const n of s.nodes.values())n.rect=n.rect.map((v,i)=>v-(i%2?900:1600));assert.equal((await s.drop(11,-1200,-600)).sessionKey,'PID 123 · 输入区 100');
});
