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
async function setAt(offset){await page.evaluate(offset=>{const d=new Date(Date.now()+offset),pad=n=>String(n).padStart(2,'0');document.getElementById('scheduleDate').value=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;for(const [id,value] of [['scheduleHour',d.getHours()],['scheduleMinute',d.getMinutes()],['scheduleSecond',d.getSeconds()]])document.getElementById(id).value=pad(value);},offset);}
try{
 await launch();await dragTarget(page);await page.waitForFunction(()=>document.getElementById('targetLabel').textContent==='测试目标 1');
 await page.locator('#editor').evaluate(el=>{el.setSelectionRange(0,el.value.length);el.dispatchEvent(new Event('select'));});
 await page.locator('#schedulesButton').click();assert.equal(await page.locator('#scheduleCommands').inputValue(),'echo A\necho B');assert.equal(await page.locator('#scheduleTargetLabel').textContent(),'测试目标 1');
 assert.deepEqual(await page.locator('#scheduleMode option').evaluateAll(nodes=>nodes.map(n=>n.value)),['countdown','once']);
 await page.getByRole('button',{name:'1 分钟',exact:true}).click();assert.equal(await page.locator('#schedulePeriod').inputValue(),'1');assert.equal(await page.locator('#scheduleUnit').inputValue(),'60000');
 await page.locator('#scheduleMode').selectOption('once');assert.equal(await page.locator('#schedulePeriod').isDisabled(),true);assert.equal(await page.locator('#scheduleSecond').isEnabled(),true);
 await page.getByRole('button',{name:'5 分钟后',exact:true}).click();const planned=await page.locator('#scheduleMinute').inputValue();assert.ok(planned.length>0);
 await setAt(-5000);await page.locator('#scheduleStart').click();assert.match(await page.locator('#scheduleError').textContent(),/晚于/);assert.equal((await jobs()).length,0);
 await page.locator('#scheduleMode').selectOption('countdown');assert.equal(await page.locator('#scheduleSecond').isDisabled(),true);
 await page.locator('#scheduleName').fill('目标 A');await page.locator('#scheduleCommands').fill('A');await page.getByRole('button',{name:'5 秒',exact:true}).click();await page.locator('#schedulePeriod').fill('1');await page.locator('#scheduleStart').click();
 await page.locator('#scheduleNew').click();await dragTarget(page,'#scheduleTarget');await page.waitForFunction(()=>document.getElementById('scheduleTargetLabel').textContent==='测试目标 2');
 await page.locator('#scheduleName').fill('目标 B');await page.locator('#scheduleCommands').fill('B');await page.locator('#schedulePeriod').fill('5');await page.locator('#scheduleStart').click();
 await page.waitForFunction(()=>document.querySelector('[data-next-at]')?.textContent.includes('后发送'));
 const before=await row('目标 B').locator('.schedule-next').textContent();await page.waitForFunction(previous=>[...document.querySelectorAll('.schedule-job')].find(n=>n.querySelector('strong').textContent==='目标 B').querySelector('.schedule-next').textContent!==previous,before);
 assert.equal(await row('目标 B').getByRole('switch').getAttribute('aria-checked'),'true');
 await row('目标 B').getByRole('switch').click();assert.equal(await row('目标 B').getByRole('switch').getAttribute('aria-checked'),'false');
 await waitJob('目标 A',j=>j.status==='completed');assert.equal((await jobs()).find(j=>j.name==='目标 A').count,1);assert.equal((await jobs()).find(j=>j.name==='目标 B').count,0);
 // A restarted countdown sends one complete round, still to its own target.
 await row('目标 B').getByRole('button',{name:'编辑',exact:true}).click();await page.locator('#schedulePeriod').fill('1');await page.locator('#scheduleStart').click();await waitJob('目标 B',j=>j.status==='completed');
 const deliveries=await app.evaluate(()=>global.searchCaptures.deliveries);assert.deepEqual(deliveries,[['target-1','A'],['target-1','\n'],['target-2','B'],['target-2','\n']]);
 assert.equal(await page.locator('#targetLabel').textContent(),'测试目标 1');
 // A long countdown provides stable visual evidence and an active status.
 await row('目标 B').getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'5 分钟',exact:true}).click();await page.locator('#scheduleStart').click();
 await page.screenshot({animations:'disabled',path:path.join(evidence,'countdown-light.png')});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({animations:'disabled',path:path.join(evidence,'countdown-dark.png')});
 await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.locator('#scheduleMode').selectOption('once');await page.locator('#scheduleHour').fill('23');await page.locator('#scheduleMinute').fill('45');await page.locator('#scheduleSecond').fill('30');assert.equal(await page.locator('#scheduleSecond').inputValue(),'30');
 await page.screenshot({animations:'disabled',path:path.join(evidence,'specified-time.png')});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(680,440));if(process.platform==='linux')await page.setViewportSize({width:680,height:440});await page.screenshot({animations:'disabled',path:path.join(evidence,'minimum-window.png')});
 assert.ok(await page.locator('#scheduleStart').evaluate(el=>{const dialog=el.closest('dialog');return dialog.scrollWidth<=dialog.clientWidth+2;}));
 await page.locator('#scheduleStart').scrollIntoViewIfNeeded();assert.ok(await page.locator('#scheduleStart').evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('dialog').getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom;}),'save action remains reachable in a minimum-size window');
 await app.close();app=null;await launch();await page.locator('#schedulesButton').click();const restored=await jobs();assert.equal(restored.length,2);assert.ok(restored.every(j=>!j.target&&!j.enabled&&j.status==='unbound'));assert.equal(await page.locator('.schedule-job [role=switch]:disabled').count(),2);
 await row('目标 A').getByRole('button',{name:'编辑',exact:true}).click();await dragTarget(page,'#scheduleTarget');await page.waitForFunction(()=>document.getElementById('scheduleTargetLabel').textContent==='测试目标 1');
 await page.locator('#scheduleMode').selectOption('once');await setAt(2500);await page.locator('#scheduleStart').click();await waitJob('目标 A',j=>j.status==='completed');assert.equal((await jobs()).find(j=>j.name==='目标 A').count,1);
 await row('目标 B').getByRole('button',{name:'删除',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.schedule-job').length===1);await page.screenshot({animations:'disabled',path:path.join(evidence,'one-shot-complete.png')});
 assert.deepEqual(errors,[]);console.log('PASS: countdown and absolute one-shot delivery, independent targets, live remaining time, presets, direct seconds, pause, persistence and minimum window');
}catch(error){console.error('RENDERER ERRORS',errors);if(app)console.error('CAPTURES',await app.evaluate(()=>global.searchCaptures));await page?.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});throw error;}finally{await app?.close();await fs.rm(temp,{recursive:true,force:true});}
