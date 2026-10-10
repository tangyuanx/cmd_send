// Real MobaXterm Home Edition; test traffic stays in its local cat process.
// Its official portable download is kept in a temporary directory, never redistributed.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';import {setTimeout as delay} from 'node:timers/promises';
import {createInterface} from 'node:readline';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),koffi=require('koffi');
if(process.platform!=='win32')throw new Error('MobaXterm integration test requires Windows');
const probe=process.env.CMD_SEND_MOBAX_PROBE==='1';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-send-mobax-'));
const evidence=path.resolve('test-output/mobaxterm');await fs.mkdir(evidence,{recursive:true});
const output=path.join(evidence,'received.txt'),report={version:'26.5',probe};
const user=koffi.load('user32.dll'),kernel=koffi.load('kernel32.dll');
const POINT=koffi.struct('MobaTestPoint',{x:'int32_t',y:'int32_t'}),RECT=koffi.struct('MobaTestRect',{left:'int32_t',top:'int32_t',right:'int32_t',bottom:'int32_t'});
const GUI=koffi.struct('MobaTestGui',{cbSize:'uint32_t',flags:'uint32_t',active:'void *',focus:'void *',capture:'void *',menuOwner:'void *',moveSize:'void *',caret:'void *',caretRect:RECT});
const ENUM=koffi.proto('int __stdcall MobaTestEnum(void *window, intptr_t param)');
const enumerate=user.func('int __stdcall EnumWindows(MobaTestEnum *callback, intptr_t param)'),children=user.func('int __stdcall EnumChildWindows(void *parent, MobaTestEnum *callback, intptr_t param)');
const className=user.func('int __stdcall GetClassNameW(void *window, _Out_ uint16_t *text, int length)'),title=user.func('int __stdcall GetWindowTextW(void *window, _Out_ uint16_t *text, int length)');
const windowPid=user.func('uint32_t __stdcall GetWindowThreadProcessId(void *window, _Out_ uint32_t *pid)'),rect=user.func('int __stdcall GetWindowRect(void *window, _Out_ MobaTestRect *rect)'),visible=user.func('int __stdcall IsWindowVisible(void *window)');
const open=kernel.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),image=kernel.func('int __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, _Out_ uint16_t *name, _Inout_ uint32_t *size)'),close=kernel.func('int __stdcall CloseHandle(void *process)');
const gui=user.func('int __stdcall GetGUIThreadInfo(uint32_t thread, _Inout_ MobaTestGui *info)'),ancestor=user.func('void * __stdcall GetAncestor(void *window, uint32_t flags)'),foreground=user.func('void * __stdcall GetForegroundWindow()');
const activate=user.func('int __stdcall SetForegroundWindow(void *window)'),cursor=user.func('int __stdcall SetCursorPos(int x, int y)'),fromPoint=user.func('void * __stdcall WindowFromPoint(MobaTestPoint point)');
const post=user.func('intptr_t __stdcall SendMessageTimeoutW(void *window, uint32_t message, uintptr_t wp, intptr_t lp, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *result)');
const pointer=p=>p?String(koffi.address(p)):'0';
function text(h,fn){const b=Buffer.alloc(4096),n=fn(h,b,2048);return b.subarray(0,n*2).toString('utf16le');}
function info(h){const pid=[0],thread=windowPid(h,pid),b=Buffer.alloc(65536),size=[32768],p=open(0x1000,0,pid[0]);let name='';if(p){try{if(image(p,0,b,size))name=b.subarray(0,size[0]*2).toString('utf16le');}finally{close(p);}}const r={};rect(h,r);return {handle:pointer(h),pid:pid[0],thread,className:text(h,className),title:text(h,title),name,visible:!!visible(h),rect:r};}
function windows(parent=null){const items=[],callback=koffi.register(h=>{items.push(info(h));return 1;},koffi.pointer(ENUM));try{if(parent)children(parent,callback,0);else enumerate(callback,0);}finally{koffi.unregister(callback);}return items;}
function focus(thread){const g={cbSize:koffi.sizeof(GUI)};return gui(thread,g)?{active:pointer(g.active),focus:pointer(g.focus)}:null;}
function handle(value){return BigInt(value);}
async function screen(name){const file=path.join(evidence,name).replaceAll("'","''");execFileSync('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $r=[Windows.Forms.SystemInformation]::VirtualScreen; $b=New-Object Drawing.Bitmap($r.Width,$r.Height); $g=[Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($r.Left,$r.Top,0,0,$b.Size); $b.Save('${file}'); $g.Dispose(); $b.Dispose()`]);}
async function read(){try{return await fs.readFile(output,'utf8');}catch{return '';}}
function message(h,msg,wp,lp=1){const result=[0];assert.ok(post(h,msg,wp,lp,0x22,1000,result),`Message ${msg} failed`);}
let child,otherChild,backend;
try{
  const response=await fetch('https://download.mobatek.net/2652026082870834/MobaXterm_Portable_v26.5.zip');assert.ok(response.ok);
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),'a26e7e4e2f7bd47a13fbc6d93d08a2d946f21c3e0d135b9e4f55149842c09ef6');
  const archive=path.join(temp,'moba.zip');await fs.writeFile(archive,bytes);
  execFileSync('powershell.exe',['-NoProfile','-Command',`Expand-Archive -LiteralPath '${archive.replaceAll("'","''")}' -DestinationPath '${temp.replaceAll("'","''")}'`]);
  const exe=(await fs.readdir(temp)).find(n=>/^MobaXterm.*\.exe$/i.test(n));assert.ok(exe);
  const unix='/drives/'+output[0].toLowerCase()+output.slice(2).replaceAll('\\','/');
  child=spawn(path.join(temp,exe),['-noX','-exec',`cat > '${unix}'`],{stdio:'ignore'});
  let terminal,host;
  for(let i=0;i<240;i++){
    const roots=windows().filter(w=>/MobaXterm/i.test(w.name)&&w.visible&&w.rect.right-w.rect.left>500);
    for(const candidate of roots){const list=windows(handle(candidate.handle));terminal=list.find(w=>/MoTTY/i.test(w.name)&&w.visible&&w.rect.right-w.rect.left>200);if(terminal){host=candidate;report.children=list;break;}}
    if(terminal&&await fs.stat(output).then(()=>true,()=>false))break;await delay(250);
  }
  report.roots=windows();assert.ok(terminal,'No embedded MoTTY terminal found');assert.ok(host);
  const hostHandle=handle(host.handle),terminalHandle=handle(terminal.handle);
  activate(hostHandle);await delay(250);
  const point={x:Math.round((terminal.rect.left+terminal.rect.right)/2),y:Math.round((terminal.rect.top+terminal.rect.bottom)/2)};
  cursor(point.x,point.y);report.host=host;report.terminal=terminal;report.hit=info(fromPoint(point));
  report.focusBefore={foreground:info(foreground()),global:focus(0),host:focus(host.thread),terminal:focus(terminal.thread),root:info(ancestor(terminalHandle,2))};
  backend=require('../electron/native/windows.cjs').createBackend();const target=await backend.pick();report.target=target;console.log('TARGET:',JSON.stringify({host,terminal,target,focus:report.focusBefore}));
  if(probe){
    try{const context=await backend.prepare(target.id);await backend.character(target.id,'A');await backend.enter(target.id);backend.finish(target.id,context);report.existing='success';}catch(e){report.existing=e.message;}
    report.focusAfter={global:focus(0),host:focus(host.thread),terminal:focus(terminal.thread)};
    console.log('EXISTING:',JSON.stringify({result:report.existing,focus:report.focusAfter}));
    const marker='BACKGROUND_中😀';for(let i=0;i<marker.length;i++)message(terminalHandle,0x102,marker.charCodeAt(i));
    message(terminalHandle,0x102,13);await delay(800);report.charEnter=await read();console.log('WM_CHAR:',JSON.stringify(report.charEnter));
    message(terminalHandle,0x100,13,1|(0x1c<<16));message(terminalHandle,0x101,13,(1|(0x1c<<16))>>>0|0xc0000000);await delay(800);report.keyEnter=await read();console.log('WM_KEYDOWN:',JSON.stringify(report.keyEnter));
  }else{
    assert.equal(target.name,'MobaXterm');assert.equal(target.strategy,'后台终端输入');
    // Cover the terminal with another application's focused Edit control.
    const fixture=await fs.readFile(new URL('../tests/fixtures/windows-input.ps1',import.meta.url),'utf8');
    const wrongOutput=path.join(evidence,'wrong-window.txt');
    otherChild=spawn('powershell.exe',['-NoProfile','-STA','-EncodedCommand',Buffer.from(fixture,'utf16le').toString('base64')],{stdio:['ignore','pipe','pipe'],env:{...process.env,CMD_SEND_FIXTURE_OUTPUT:path.join(evidence,'other.txt'),CMD_SEND_FIXTURE_EDIT:wrongOutput}});
    const other=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Foreground fixture did not start')),15000);const lines=createInterface({input:otherChild.stdout});lines.on('line',line=>{try{const value=JSON.parse(line);if(value.ready){clearTimeout(timer);resolve(value);}}catch{}});otherChild.once('error',e=>{clearTimeout(timer);reject(e);});});
    activate(BigInt(other.window));await delay(200);assert.equal(pointer(foreground()),String(other.window));
    const before=pointer(foreground()),context=await backend.prepare(target.id);
    for(const character of 'CMD_SEND_中😀')await backend.character(target.id,character);await backend.enter(target.id);backend.finish(target.id,context);
    for(let i=0;i<80;i++){if((await read()).includes('CMD_SEND_中😀'))break;await delay(50);}
    assert.equal((await read()).replaceAll('\r',''),'CMD_SEND_中😀\n');assert.equal(pointer(foreground()),before);
    assert.equal(await fs.readFile(wrongOutput,'utf8').catch(()=>''),'');
    console.log('PASS: actual MobaXterm 26.5 embedded MoTTY receives ASCII/Chinese/emoji/Enter while another app keeps focus and receives no text');
    execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});await delay(150);
    await assert.rejects(backend.character(target.id,'X'),/关闭|替换|失效/);
    console.log('PASS: closing the actual MobaXterm rejects subsequent delivery, with no retargeting');
  }
  await screen('terminal.png');console.log('RECEIVED:',JSON.stringify(await read()));
}catch(error){report.error=error.stack;await screen('failure.png').catch(()=>{});throw error;}
finally{
  await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));backend?.dispose();
  if(child?.pid)try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});}catch{}
  if(otherChild?.pid)try{execFileSync('taskkill',['/PID',String(otherChild.pid),'/T','/F'],{stdio:'ignore'});}catch{}
  await fs.rm(temp,{recursive:true,force:true}).catch(()=>{});
}
