import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

test('Windows desktop: bind a control without TextPattern, deliver Unicode/Enter, stop on focus loss; Edit stays in background',
  {skip:process.platform!=='win32',timeout:30000},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-send-desktop-'));
  const rawOutput=path.join(directory,'raw.txt'),editOutput=path.join(directory,'edit.txt');
  const source=await fs.readFile(new URL('./fixtures/windows-input.ps1',import.meta.url),'utf8');
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-STA','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],
    {windowsHide:false,stdio:['ignore','pipe','pipe'],env:{...process.env,CMD_SEND_FIXTURE_OUTPUT:rawOutput,CMD_SEND_FIXTURE_EDIT:editOutput}});
  let stderr='';child.stderr.on('data',b=>stderr+=b);
  let backend;
  try{
    const ready=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error(`Fixture did not start: ${stderr}`)),10000);
      const lines=createInterface({input:child.stdout});
      lines.on('line',line=>{try{const value=JSON.parse(line);if(value.ready){clearTimeout(timer);resolve(value);}}catch{}});
      child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(new Error(stderr));});
    });
    const koffi=require('koffi'),user=koffi.load('user32.dll');
    const cursor=user.func('int __stdcall SetCursorPos(int x, int y)');
    const metrics=user.func('int __stdcall GetSystemMetrics(int index)');
    backend=require('../electron/native/windows.cjs').createBackend();
    cursor(ready.raw.x,ready.raw.y);const raw=await backend.pick();
    assert.equal(raw.strategy,'所选区域聚焦输入','fixture must exercise the no-TextPattern path');
    const context=await backend.prepare(raw.id);
    for(const char of 'A中😀')await backend.character(raw.id,char);await backend.enter(raw.id);
    for(let i=0;i<40;i++){try{if((await fs.readFile(rawOutput,'utf8'))==='A中😀\r')break;}catch{}await delay(25);}
    assert.equal(await fs.readFile(rawOutput,'utf8'),'A中😀\r');
    // Change the actual focused child by a real click, without changing foreground window.
    cursor(ready.edit.x,ready.edit.y);
    const input=user.func('uint32_t __stdcall SendInput(uint32_t count, const void *inputs, int size)');
    const clicks=Buffer.alloc(120);
    const x=Math.round((ready.edit.x-metrics(76))*65535/(metrics(78)-1));
    const y=Math.round((ready.edit.y-metrics(77))*65535/(metrics(79)-1));
    for(let i=0;i<3;i++){clicks.writeInt32LE(x,i*40+8);clicks.writeInt32LE(y,i*40+12);clicks.writeUInt32LE(0x8000|0x4000|[1,2,4][i],i*40+24);}
    assert.equal(input(3,clicks,40),3);
    await delay(100);await assert.rejects(backend.character(raw.id,'X'),/焦点/);
    backend.finish(raw.id,context);
    cursor(ready.edit.x,ready.edit.y);const edit=await backend.pick();assert.equal(edit.strategy,'后台文本输入');
    const before=await backend.prepare(edit.id);await backend.character(edit.id,'B');backend.finish(edit.id,before);
    for(let i=0;i<40;i++){try{if((await fs.readFile(editOutput,'utf8'))==='B')break;}catch{}await delay(25);}
    assert.equal(await fs.readFile(editOutput,'utf8'),'B');
    assert.equal(await fs.readFile(rawOutput,'utf8'),'A中😀\r');
    // Kill the bound process and confirm its HWND cannot be reused for delivery.
    child.kill();await once(child,'exit');await assert.rejects(backend.character(edit.id,'C'),/关闭|替换|失效/);
  }finally{backend?.dispose();if(child.exitCode===null&&child.signalCode===null){child.kill();await once(child,'exit');}await fs.rm(directory,{recursive:true,force:true});}
});
