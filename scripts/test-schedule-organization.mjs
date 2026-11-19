// Shipped renderer, preload IPC and scheduler; isolated profile and native receiver.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {fileURLToPath} from 'node:url';import {_electron as electron} from 'playwright';
import {dragTarget} from '../tests/fixtures/drag-target.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-organization-')),evidence=path.join(root,'test-output','schedule-organization');await fs.mkdir(evidence,{recursive:true});
const config={platform:process.platform,window:{},update:{phase:'idle',currentVersion:'test',supported:false},session:{activeId:'first',files:[{id:'first',name:'分组测试.txt',text:'echo test'}]}};
const env={...process.env,CMD_SEND_SEARCH_FIXTURE:JSON.stringify({profile:path.join(temp,'profile'),page:path.join(root,'src','index.html'),config,schedules:true})};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[];
async function launch(){app=await electron.launch({args:[...(process.platform==='linux'?['--no-sandbox','--ozone-platform=headless']:[]),path.join(root,'tests','fixtures','search-main.cjs')],env,timeout:60000});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.evaluate(()=>{globalThis.scheduleDragEvents=[];for(const type of ['dragstart','dragover','drop','dragend'])document.addEventListener(type,event=>{const node=event.target;globalThis.scheduleDragEvents.push({type,job:node.closest?.('[data-job]')?.dataset.job,group:node.closest?.('[data-group]')?.dataset.group,x:event.clientX,y:event.clientY});},true);});await page.locator('#schedulesButton').click();}
const row=name=>page.locator('.schedule-job').filter({has:page.locator('strong',{hasText:new RegExp('^'+name+'$')})});
const groupMore=name=>page.getByRole('button',{name:`${name}：更多操作`,exact:true});
const order=()=>page.locator('.schedule-job strong').allTextContents();
const state=()=>app.evaluate(()=>({jobs:global.scheduleManager.snapshot(),groups:global.scheduleManager.groupSnapshot(),writes:global.searchCaptures.deliveries}));
async function settled(){await page.waitForFunction(()=>!document.getElementById('scheduleNew').disabled);}
async function dragTaskTo(source,destination,before=false){
 // Start dragging before any target auto-scroll. A single dragTo jump can
 // scroll a Windows dialog after mouse-down without producing dragstart.
 await settled();await destination.scrollIntoViewIfNeeded();await source.scrollIntoViewIfNeeded();
 assert.equal(await source.isEnabled(),true);assert.equal(await source.evaluate(el=>el.draggable),true);
 const a=await source.boundingBox(),offset=await page.evaluate(()=>globalThis.scheduleDragEvents.length);
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2+14,a.y+a.height/2,{steps:4});
 await page.waitForFunction(offset=>globalThis.scheduleDragEvents.slice(offset).some(event=>event.type==='dragstart'),offset);
 await destination.scrollIntoViewIfNeeded();const b=await destination.boundingBox(),x=b.x+b.width/2,y=b.y+(before?3:b.height/2);
 await page.mouse.move(x,y,{steps:16});await page.mouse.move(x+1,y);await page.mouse.up();
}
async function createGroup(name){await page.locator('#scheduleGroupNew').click();await page.locator('#scheduleGroupName').fill(name);await page.getByRole('button',{name:'保存组名',exact:true}).click();await page.locator('#scheduleGroupForm').waitFor({state:'hidden'});}
async function saveTask(name,group='',period='60'){
 await page.locator('#scheduleNew').click();const picks=await app.evaluate(()=>global.searchCaptures.picks);await dragTarget(page,'#scheduleTarget');await page.waitForFunction(expected=>document.getElementById('scheduleTargetLabel').textContent===expected,`测试目标 ${picks+1}`);
 await page.locator('#scheduleName').fill(name);await page.locator('#scheduleCommands').fill(name);await page.locator('#scheduleGroup').selectOption(group);await page.locator('#schedulePeriod').fill(period);await page.locator('#scheduleSave').click();await settled();await row(name).waitFor();
}
try{
 await launch();await saveTask('A');await saveTask('B');await saveTask('C');assert.deepEqual(await order(),['A','B','C']);
 const handleOpacity=name=>row(name).locator('[data-drag-handle]').evaluate(el=>getComputedStyle(el).opacity);
 await page.locator('#schedulesTitle').hover();assert.equal(await handleOpacity('C'),'0');
 await row('C').hover();assert.equal(await handleOpacity('C'),'1');assert.equal(await handleOpacity('A'),'0');
 await dragTaskTo(row('C').locator('[data-drag-handle]'),row('A'),true);await settled();assert.deepEqual(await order(),['C','A','B']);
 await row('B').locator('[data-drag-handle]').focus();await page.keyboard.press('Alt+ArrowUp');await settled();assert.deepEqual(await order(),['C','B','A']);
 assert.equal(await row('B').locator('[data-drag-handle]').evaluate(el=>el===document.activeElement),true);assert.equal(await handleOpacity('B'),'1');
 console.log('PASS: native drag and keyboard reorder preserve keyboard focus');
 // Escape/outside release does not commit a drag.
 const before=await order(),handle=await row('A').locator('[data-drag-handle]').boundingBox(),target=await row('C').boundingBox(),traceOffset=await page.evaluate(()=>globalThis.scheduleDragEvents.length);
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(target.x+50,target.y+5,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();await page.waitForFunction(offset=>globalThis.scheduleDragEvents.slice(offset).some(event=>event.type==='dragend'),traceOffset);assert.deepEqual(await order(),before);
 console.log('PASS: cancelled drag preserves order');
 await createGroup('设备组');const group=(await state()).groups[0],section=page.locator(`[data-group="${group.id}"]`);
 await dragTaskTo(row('A').locator('[data-drag-handle]'),section.locator('.schedule-group-empty'));await page.waitForFunction(groupId=>[...document.querySelectorAll('.schedule-job')].find(node=>node.querySelector('strong').textContent==='A')?.closest('[data-group]')?.dataset.group===groupId,group.id);await settled();assert.equal((await state()).jobs.find(j=>j.name==='A').groupId,group.id);
 await row('B').getByRole('button',{name:/^编辑 /}).click();await page.locator('#scheduleGroup').selectOption(group.id);await page.locator('#scheduleSave').click();await settled();assert.equal(await section.locator('.schedule-job').count(),2);
 await groupMore('设备组').click();await page.getByRole('button',{name:'编辑分组 设备组',exact:true}).click();await page.locator('#scheduleGroupName').fill('设备联测');await page.getByRole('button',{name:'保存组名',exact:true}).click();await page.locator('#scheduleGroupForm').waitFor({state:'hidden'});
 assert.equal(await page.locator('#scheduleGroup option:checked').textContent(),'设备联测');
 const fold=section.locator('.schedule-group-fold'),groupStart=section.locator('.schedule-group-heading').getByRole('button',{name:'设备联测：全组启动',exact:true});
 await fold.click();assert.equal(await fold.getAttribute('aria-expanded'),'false');assert.equal(await row('A').isVisible(),false);assert.equal(await groupStart.isVisible(),true);
 await fold.click();assert.equal(await fold.getAttribute('aria-expanded'),'true');assert.equal(await row('A').isVisible(),true);
 assert.equal(await groupStart.textContent(),'');await groupStart.locator('svg').waitFor();
 await groupStart.click();await settled();let data=await state();const members=data.jobs.filter(j=>j.groupId===group.id);assert.ok(members.every(j=>j.enabled));assert.equal(members[0].nextAt,members[1].nextAt);
 const deadline=members.find(j=>j.name==='A').nextAt;
 await row('B').getByRole('switch').click();await settled();await page.getByRole('button',{name:'设备联测：全组启动',exact:true}).click();await settled();assert.equal((await state()).jobs.find(j=>j.name==='A').nextAt,deadline);
 await page.getByRole('button',{name:'设备联测：全组暂停',exact:true}).click();await settled();assert.ok((await state()).jobs.every(j=>!j.enabled));
 await groupStart.click();await settled();await row('B').getByRole('switch').click();await settled();
 await groupMore('设备联测').click();await section.locator('.schedule-group-menu').getByRole('button',{name:'全组暂停',exact:true}).click();await settled();assert.ok((await state()).jobs.every(j=>!j.enabled));
 for(const name of ['A','B']){await row(name).getByRole('button',{name:/^编辑 /}).click();await page.locator('#scheduleUnit').selectOption('1000');await page.locator('#schedulePeriod').fill('1');await page.locator('#scheduleSave').click();await settled();}
 console.log('PASS: group creation, cross-group drag, rename, shared deadline, mixed start and pause');
 await page.getByRole('button',{name:'设备联测：全组启动',exact:true}).click();await settled();
 await page.waitForFunction(()=>globalThis.document.querySelectorAll('.schedule-job-state[data-status="completed"]').length===2);
 data=await state();assert.ok(data.jobs.filter(j=>j.groupId===group.id).every(j=>j.count===1));assert.deepEqual(data.writes.map(([,c])=>c).sort(),['A','B','\n','\n'].sort());assert.equal(new Set(data.writes.map(([id])=>id)).size,2);
 // Save a useful, paused example before visual inspection and restart.
 await row('C').getByRole('button',{name:/^编辑 /}).click();
 await page.screenshot({animations:'disabled',path:path.join(evidence,'groups-light.png')});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({animations:'disabled',path:path.join(evidence,'groups-dark.png')});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(680,440));if(process.platform==='linux')await page.setViewportSize({width:680,height:440});
 await page.locator('#scheduleSave').scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:path.join(evidence,'minimum-window.png')});
 assert.ok(await page.locator('#schedulesDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+2));assert.ok(await page.locator('#scheduleSave').evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('dialog').getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom;}));
 const savedOrder=await order();await app.close();app=null;await launch();assert.deepEqual(await order(),savedOrder);assert.deepEqual((await state()).groups,[{id:group.id,name:'设备联测'}]);assert.ok((await state()).jobs.every(j=>!j.target&&!j.enabled));
 await page.getByRole('button',{name:'设备联测：全组启动',exact:true}).click();await settled();assert.match(await page.locator('#scheduleError').textContent(),/重新绑定/);assert.ok((await state()).jobs.every(j=>!j.enabled));
 await groupMore('设备联测').click();await page.getByRole('button',{name:'编辑分组 设备联测',exact:true}).click();await page.locator('#scheduleGroupDelete').click();await settled();assert.equal((await state()).groups.length,0);assert.equal((await state()).jobs.length,3);assert.ok((await state()).jobs.every(j=>j.groupId===null));
 assert.deepEqual(errors,[]);console.log('PASS: drag, keyboard, cancellation, cross-group move, group editing, shared start, pause, one-shot delivery, persistence, invalid group start, deletion and minimum window');
 await app.close();app=null;
 // Exercise the production main process, sender validation and preload too.
 // Set userData before loading main; never read or modify the user's profile.
 const profile=path.join(temp,'production-profile'),bootstrap=path.join(temp,'production.cjs');
 await fs.mkdir(profile);
 const legacyJobs=['IPC-A','IPC-B'].map(name=>({id:name,name,commands:[name]}));
 await fs.writeFile(path.join(profile,'schedules.json'),JSON.stringify({version:2,groups:[],jobs:legacyJobs}));
 await fs.writeFile(bootstrap,`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root,'electron','main.cjs'))});`);
 app=await electron.launch({args:[...(process.platform==='linux'?['--no-sandbox','--ozone-platform=headless']:[]),bootstrap],env,timeout:60000});page=await app.firstWindow();
 assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>document.body.dataset.platform);await page.locator('#schedulesButton').click();
 await createGroup('IPC组');const [realGroup]=(await page.evaluate(()=>window.desktop.config())).scheduleGroups;
 const unboundError=await page.evaluate(async()=>{try{await window.desktop.saveSchedule({name:'新任务',commands:['test']});return '';}catch(e){return e.message;}});
 assert.match(unboundError,/新任务拖动选择/);
 for(const name of ['IPC-A','IPC-B']){
   await row(name).getByRole('button',{name:`编辑 ${name}`,exact:true}).click();
   await page.locator('#scheduleGroup').selectOption(realGroup.id);await page.locator('#scheduleSave').click();await settled();
 }
 assert.ok((await page.evaluate(()=>window.desktop.config())).schedules.every(j=>j.groupId===realGroup.id));
 const [a,b]=(await page.evaluate(()=>window.desktop.config())).schedules;
 await page.evaluate(({id,beforeId,groupId})=>window.desktop.moveSchedule(id,{beforeId,groupId}),{id:b.id,beforeId:a.id,groupId:realGroup.id});
 assert.deepEqual((await page.evaluate(()=>window.desktop.config())).schedules.map(j=>j.name),['IPC-B','IPC-A']);
 const error=await page.evaluate(async id=>{try{await window.desktop.scheduleGroupAction(id,'start');return '';}catch(e){return e.message;}},realGroup.id);assert.match(error,/重新绑定/);
 await page.evaluate(id=>window.desktop.scheduleGroupAction(id,'delete'),realGroup.id);assert.ok((await page.evaluate(()=>window.desktop.config())).schedules.every(j=>j.groupId===null));
 await app.evaluate(({app})=>app.exit(0));await app.close().catch(()=>{});app=null;assert.deepEqual(errors,[]);console.log('PASS: production main/preload IPC, isolated profile, group save, move, validation and deletion');
}catch(error){console.error('RENDERER ERRORS',errors);if(app){console.error('STATE',await state().catch(()=>({})));console.error('DRAG EVENTS',await page.evaluate(()=>globalThis.scheduleDragEvents?.slice(-40)).catch(()=>[]));}await page?.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});throw error;}
finally{await app?.close();await fs.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
