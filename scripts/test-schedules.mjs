// Real shipped Electron renderer + real scheduler; controlled native receiver.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {fileURLToPath} from 'node:url';import {_electron as electron} from 'playwright';
import {dragTarget} from '../tests/fixtures/drag-target.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-send-schedules-'));
const evidence=path.join(root,'test-output','schedules');await fs.mkdir(evidence,{recursive:true});
const config={platform:process.platform,window:{maximized:false,fullscreen:false},update:{phase:'idle',currentVersion:'test',supported:false},session:{activeId:'first',files:[{id:'first',name:'定时发送.txt',text:'[测试]\necho A\n# ignored\necho B'}]}};
let app,page;const errors=[];
const env={...process.env,CMD_SEND_SEARCH_FIXTURE:JSON.stringify({profile:path.join(temp,'profile'),page:path.join(root,'src','index.html'),config,schedules:true})};delete env.ELECTRON_RUN_AS_NODE;
async function launch(){app=await electron.launch({args:[...(process.platform==='linux'?['--no-sandbox','--ozone-platform=headless']:[]),path.join(root,'tests','fixtures','search-main.cjs')],env,timeout:60000});page=await app.firstWindow();if(process.platform==='linux')await page.setViewportSize({width:1040,height:760});page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>document.getElementById('editor').value.includes('echo B'));}
const jobs=()=>app.evaluate(()=>global.scheduleManager.snapshot());
async function waitJob(name,predicate){const end=Date.now()+6000;while(Date.now()<end){const job=(await jobs()).find(j=>j.name===name);if(job&&predicate(job))return job;await new Promise(r=>setTimeout(r,25));}assert.fail('Timed out waiting for '+name);}
const row=name=>page.locator('.schedule-job').filter({has:page.locator('strong',{hasText:name})});
try{
 await launch();await dragTarget(page);await page.waitForFunction(()=>document.getElementById('targetLabel').textContent==='测试目标 1');
 await page.locator('#editor').evaluate(el=>{el.setSelectionRange(0,el.value.length);el.dispatchEvent(new Event('select'));});
 await page.locator('#schedulesButton').click();await page.locator('#scheduleImport').click();assert.equal(await page.locator('#scheduleCommands').inputValue(),'echo A\necho B');
 await page.locator('#scheduleName').fill('目标 A');await page.locator('#scheduleCommands').fill('A');await page.locator('#schedulePeriod').fill('0.16');await page.locator('#scheduleStart').click();await waitJob('目标 A',j=>j.count>=2);
 await page.locator('#scheduleNew').click();await dragTarget(page,'#scheduleTarget');await page.waitForFunction(()=>document.getElementById('scheduleTargetLabel').textContent.includes('Renderer fixture 2'));
 // Verify a new pick really completed instead of reading the previous binding.
 await page.waitForFunction(()=>!document.getElementById('scheduleTargetLabel').textContent.includes('Esc'));
 await page.locator('#scheduleName').fill('目标 B');await page.locator('#scheduleCommands').fill('B');await page.locator('#schedulePeriod').fill('0.22');await page.locator('#scheduleStart').click();await waitJob('目标 B',j=>j.count>=2);
 assert.equal(await page.locator('#targetLabel').textContent(),'测试目标 1');assert.equal((await jobs()).find(j=>j.name==='目标 B').target.id,'target-2');
 await row('目标 A').getByRole('button',{name:'暂停',exact:true}).click();const paused=await waitJob('目标 A',j=>!j.enabled),b=(await jobs()).find(j=>j.name==='目标 B');await waitJob('目标 B',j=>j.count>b.count);assert.equal((await jobs()).find(j=>j.name==='目标 A').count,paused.count);
 const deliveries=await app.evaluate(()=>global.searchCaptures.deliveries);assert.ok(deliveries.some(([id,c])=>id==='target-1'&&c==='A'));assert.ok(deliveries.some(([id,c])=>id==='target-2'&&c==='B'));assert.ok(!deliveries.some(([id,c])=>id==='target-1'&&c==='B'||id==='target-2'&&c==='A'));
 await page.screenshot({path:path.join(evidence,'two-targets-light.png')});
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:path.join(evidence,'two-targets-dark.png')});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(680,440));if(process.platform==='linux')await page.setViewportSize({width:680,height:440});await page.screenshot({path:path.join(evidence,'minimum-window.png')});
 assert.ok(await page.locator('#scheduleStart').evaluate(el=>{const dialog=el.closest('dialog');return dialog.scrollWidth<=dialog.clientWidth+2;}));
 // Reloading from disk restores configuration, never old native handles/running state.
 await app.close();app=null;await launch();await page.locator('#schedulesButton').click();const restored=await jobs();assert.equal(restored.length,2);assert.ok(restored.every(j=>!j.target&&!j.enabled&&j.status==='unbound'));assert.equal(await page.locator('.schedule-job button[data-action="start"]:disabled').count(),2);
 await row('目标 A').getByRole('button',{name:'编辑',exact:true}).click();await dragTarget(page,'#scheduleTarget');await page.waitForFunction(()=>document.getElementById('scheduleTargetLabel').textContent.includes('Renderer fixture'));
 await page.locator('#scheduleMode').selectOption('once');await page.locator('#scheduleAt').evaluate(el=>{const d=new Date(Date.now()+3500);el.value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,19);});await page.locator('#scheduleStart').click();await waitJob('目标 A',j=>j.status==='completed');assert.equal((await jobs()).find(j=>j.name==='目标 A').count,1);
 await row('目标 B').getByRole('button',{name:'删除',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.schedule-job').length===1);await page.screenshot({path:path.join(evidence,'one-shot-complete.png')});
 assert.deepEqual(errors,[]);console.log('PASS: real renderer creates two independent tasks, binds separately, pauses one, persists safely, sends once and deletes');
}catch(error){console.error('RENDERER ERRORS',errors);if(app)console.error('CAPTURES',await app.evaluate(()=>global.searchCaptures));await page?.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});throw error;}finally{await app?.close();await fs.rm(temp,{recursive:true,force:true});}
