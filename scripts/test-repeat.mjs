// Exercise the shipped buttons/settings and their actual queue requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {_electron as electron} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-send-repeat-'));
const text='[测试]\necho A\n# ignore\necho B\necho C';
const config={platform:process.platform,window:{maximized:false,fullscreen:false},update:{phase:'idle',currentVersion:'test',supported:false},session:{activeId:'first',files:[{id:'first',name:'重复发送.txt',text}]}};
let app,page;
const errors=[];
try{
  const env={...process.env,CMD_SEND_SEARCH_FIXTURE:JSON.stringify({profile:path.join(temp,'profile'),page:path.join(root,'src','index.html'),config})};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.join(root,'tests','fixtures','search-main.cjs')],env,timeout:60000});
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
 await page.waitForFunction(()=>document.getElementById('editor').value.includes('echo C'));
 const plans=()=>app.evaluate(()=>global.searchCaptures.plans);
 const emit=event=>app.evaluate(({BrowserWindow},event)=>BrowserWindow.getAllWindows()[0].webContents.send('fixture:queue',event),event);
 const choose=async(start,end=start)=>page.locator('#editor').evaluate((el,{start,end})=>{el.setSelectionRange(start,end);el.dispatchEvent(new Event('select'));},{start,end});
 const finish=async(total=1)=>{await emit({id:'search-run',type:'completed',total});await page.waitForFunction(()=>!document.getElementById('sendButton').disabled);};
 const settings=async(mode)=>{await page.locator('#settingsButton').click();await page.locator('#repeatSelect').selectOption(mode);if(mode==='count')await page.locator('#roundsInput').fill('3');await page.locator('#settingsForm button[type="submit"]').click();};
 const start=async(button)=>{const count=(await plans()).length;await page.locator(button).click();await page.waitForFunction(()=>document.getElementById('sendButton').disabled);const sent=await plans();assert.equal(sent.length,count+1);return sent.at(-1);};
 await page.locator('#targetButton').dispatchEvent('pointerdown',{button:0});await page.waitForFunction(()=>document.getElementById('targetLabel').textContent==='测试目标');
 // The removed legacy "once" setting migrates to the repeat button's old loop behavior.
 await page.evaluate(()=>localStorage.setItem('courier-settings',JSON.stringify({repeat:'once',rounds:7,interval:800})));
 await page.reload();await page.waitForFunction(()=>document.getElementById('editor').value.includes('echo C'));
 await page.locator('#settingsButton').click();assert.equal(await page.locator('#repeatSelect').inputValue(),'loop');assert.equal(await page.locator('#repeatSelect option').count(),2);assert.equal(await page.locator('#intervalInput').inputValue(),'800');assert.equal(await page.locator('#roundsInput').inputValue(),'7');await page.locator('#settingsForm button[type="submit"]').click();
 await page.locator('#targetButton').dispatchEvent('pointerdown',{button:0});await page.waitForFunction(()=>document.getElementById('targetLabel').textContent==='测试目标');
 await settings('count');assert.equal(await page.locator('#repeatModeHint').textContent(),'共 3 轮后停止');
 const a=text.indexOf('echo A');await choose(a);
 let sent=await start('#sendButton');assert.equal(sent.rounds,1);assert.deepEqual(sent.commands,['echo A']);await finish();assert.equal(await page.locator('#editor').evaluate(el=>el.selectionStart),text.indexOf('echo B'));
 await choose(a);sent=await start('#repeatButton');assert.equal(sent.rounds,3);assert.equal(await page.locator('#repeatLabel').textContent(),'重复发送中');assert.equal(await page.locator('#repeatButton').evaluate(el=>el.classList.contains('is-running')),true);await finish(3);assert.equal(await page.locator('#editor').evaluate(el=>el.selectionStart),a);
 await choose(a,text.length);sent=await start('#repeatButton');assert.deepEqual(sent.commands,['echo A','echo B','echo C']);assert.equal(sent.rounds,3);assert.equal(sent.interval,800);await finish(9);assert.deepEqual(await page.locator('#editor').evaluate(el=>[el.selectionStart,el.selectionEnd]),[a,text.length]);
 // Persisted count mode still controls only Repeat after reopening the app.
 await page.reload();await page.waitForFunction(()=>document.getElementById('repeatModeHint').textContent==='共 3 轮后停止');
 await page.locator('#targetButton').dispatchEvent('pointerdown',{button:0});await page.waitForFunction(()=>document.getElementById('targetLabel').textContent==='测试目标');
 await settings('loop');assert.equal(await page.locator('#repeatModeHint').textContent(),'持续循环，直到手动停止');
 await choose(a,text.length);sent=await start('#sendButton');assert.equal(sent.rounds,1);assert.deepEqual(sent.commands,['echo A','echo B','echo C']);await finish(3);
 sent=await start('#repeatButton');assert.equal(sent.rounds,'loop');await emit({id:'search-run',type:'paused',paused:true,index:0,commandCount:3,round:1,total:0});await page.waitForFunction(()=>document.getElementById('repeatLabel').textContent==='重复已暂停');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.getElementById('repeatButton').disabled);
 await settings('count');await page.locator('#settingsButton').click();
 const evidence=path.join(root,'test-output','repeat');await fs.mkdir(evidence,{recursive:true});
 await page.screenshot({path:path.join(evidence,'settings.png')});await page.locator('#settingsForm button[type="submit"]').click();await page.screenshot({path:path.join(evidence,'count-mode.png')});
 assert.deepEqual(errors,[]);console.log('PASS: ordinary send, counted repeat, loop, cursor/selection, stop, hints and legacy settings');
}finally{
 await app?.close();await fs.rm(temp,{recursive:true,force:true});
}
