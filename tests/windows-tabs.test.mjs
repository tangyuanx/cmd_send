import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('Windows UIA restores the bound tab on a shared control and rejects a same-name replacement',{skip:process.platform!=='win32',timeout:45000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-send-tabs-')),output=path.join(dir,'output.json'),command=path.join(dir,'command.txt');
 const source=await fs.readFile(new URL('./fixtures/windows-tabs.ps1',import.meta.url),'utf8');
 const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-STA','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],{stdio:['ignore','pipe','pipe'],env:{...process.env,CMD_SEND_TABS_OUTPUT:output,CMD_SEND_TABS_COMMAND:command}});
 const messages=[];let stderr='',backend;child.stderr.on('data',b=>stderr+=b);createInterface({input:child.stdout}).on('line',line=>{try{messages.push(JSON.parse(line));}catch{}});
 async function waitFor(predicate){for(let i=0;i<120;i++){const value=messages.find(predicate);if(value)return value;if(child.exitCode!==null)throw new Error(stderr||'Fixture exited');await delay(50);}throw new Error(stderr||'Fixture response timed out');}
 async function change(value){await fs.writeFile(command,value);await waitFor(m=>m.done===value);await delay(100);}
 try{
  const ready=await waitFor(m=>m.ready),koffi=require('koffi'),user=koffi.load('user32.dll'),cursor=user.func('int __stdcall SetCursorPos(int x, int y)');
  cursor(ready.x,ready.y);backend=require('../electron/native/windows.cjs').createBackend();const target=await backend.pick();
  assert.equal(target.sessionName,'Session One');assert.equal(target.strategy,'固定页签聚焦输入');
  await change('second');let context=await backend.prepare(target.id);await backend.character(target.id,'A');await backend.character(target.id,'中');backend.finish(target.id,context);
  for(let i=0;i<100;i++){const received=JSON.parse(await fs.readFile(output,'utf8'));if(received['Session One']==='A中')break;await delay(25);}
  assert.deepEqual(JSON.parse(await fs.readFile(output,'utf8')),{'Session One':'A中','Session Two':''});
  await change('second');await assert.rejects(backend.character(target.id,'X'),/会话已切换/);
  await change('replace-first');await assert.rejects(backend.prepare(target.id),/关闭|替换|会话|不可用|元素|available|element|Exception/i);
  assert.deepEqual(JSON.parse(await fs.readFile(output,'utf8')),{'Session One':'A中','Session Two':''});
 }finally{backend?.dispose();child.kill();await fs.rm(dir,{recursive:true,force:true});}
});
