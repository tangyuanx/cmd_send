import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {fileURLToPath} from 'node:url';import {_electron as electron} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-send-import-'));
const evidence=path.join(root,'test-output','schedule-import');await fs.mkdir(evidence,{recursive:true});
const text='[测试]\necho A\n# ignored\n\necho B\necho C';
const first={id:'first',name:'定时发送.txt',text},second={id:'second',name:'另一组.txt',text:'other command\nsecond command'};
let app,page;const errors=[];
async function launch(files){
 const config={platform:process.platform,window:{maximized:false,fullscreen:false},update:{phase:'idle',currentVersion:'test',supported:false},session:{activeId:files[0]?.id,files}};
 const env={...process.env,CMD_SEND_SEARCH_FIXTURE:JSON.stringify({profile:path.join(temp,'profile-'+files.length),page:path.join(root,'src','index.html'),config,schedules:true})};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({args:[...(process.platform==='linux'?['--no-sandbox','--ozone-platform=headless']:[]),path.join(root,'tests','fixtures','search-main.cjs')],env,timeout:60000});
 page=await app.firstWindow();if(process.platform==='linux')await page.setViewportSize({width:1040,height:760});page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!document.getElementById('schedulesButton'));
 await page.waitForFunction(()=>document.getElementById('updateButton').textContent==='vtest');
 if(files.length)await page.waitForFunction(()=>document.getElementById('editor').value.includes('echo C'));
}
const mod=process.platform==='darwin'?'Meta':'Control';
async function cursor(line,select=false){await page.locator('#editor').focus();await page.keyboard.press(process.platform==='darwin'?'Meta+ArrowUp':'Control+Home');for(let i=1;i<line;i++)await page.keyboard.press('ArrowDown');await page.keyboard.press(process.platform==='darwin'?'Meta+ArrowLeft':'Home');if(select)await page.keyboard.press(process.platform==='darwin'?'Meta+Shift+ArrowRight':'Shift+End');}
const open=()=>page.locator('#schedulesButton').click();
const close=()=>page.locator('[data-close="schedulesDialog"]').click();
try{
 await launch([first,second]);await cursor(2);await open();
 assert.equal(await page.locator('#scheduleCommands').inputValue(),'echo A');
 for(const removed of ['scheduleImport','scheduleImportStatus','scheduleUseTarget','scheduleChoose'])assert.equal(await page.locator('#'+removed).count(),0);
 assert.equal(await page.locator('#scheduleMode').inputValue(),'countdown');
 // Real keyboard selections become fresh drafts each time the dialog opens.
 await close();await page.locator('#editor').focus();await page.keyboard.press(mod+'+A');await open();
 assert.equal(await page.locator('#scheduleCommands').inputValue(),'echo A\necho B\necho C');
 await page.locator('#scheduleName').fill('保留的任务');await page.locator('#schedulePeriod').fill('12');await page.locator('#scheduleSave').click();await page.waitForFunction(()=>document.querySelectorAll('.schedule-job').length===1);
 await close();await cursor(5,true);await open();assert.equal(await page.locator('#scheduleCommands').inputValue(),'echo B');
 assert.deepEqual(await app.evaluate(()=>global.scheduleManager.snapshot()[0].commands),['echo A','echo B','echo C']);
 // Editing is explicit; opening a new draft does not overwrite a stored task.
 await page.locator('.schedule-job').getByRole('button',{name:'编辑',exact:true}).click();assert.equal(await page.locator('#scheduleName').inputValue(),'保留的任务');assert.equal(await page.locator('#schedulePeriod').inputValue(),'12');assert.equal(await page.locator('#scheduleCommands').inputValue(),'echo A\necho B\necho C');
 // Invalid current lines stay empty instead of silently skipping to the next command.
 for(const line of [1,3,4]){await close();await cursor(line);await open();assert.equal(await page.locator('#scheduleCommands').inputValue(),'');}
 // A partial selection preserves only the selected characters.
 await close();await cursor(2);await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press(process.platform==='darwin'?'Meta+Shift+ArrowRight':'Shift+End');await open();assert.equal(await page.locator('#scheduleCommands').inputValue(),'ho A');
 await close();await page.locator('#fileButton').click();await page.getByRole('menuitem',{name:'另一组.txt',exact:true}).click();await open();assert.equal(await page.locator('#scheduleCommands').inputValue(),'other command');
 await page.screenshot({path:path.join(evidence,'automatic-selection.png')});
 assert.deepEqual(await app.evaluate(()=>global.searchCaptures.plans),[]);assert.deepEqual(await app.evaluate(()=>global.searchCaptures.saves),[]);
 await app.close();app=null;await launch([]);await open();assert.equal(await page.locator('#scheduleCommands').inputValue(),'');
 await page.locator('#scheduleCommands').fill('manual command');await page.locator('#scheduleSave').click();await page.waitForFunction(()=>document.querySelectorAll('.schedule-job').length===1);
 assert.deepEqual(errors,[]);console.log('PASS: automatic exact caret/selection drafts, no import copy, explicit stored-task editing, partial selection and file switch');
}catch(error){console.error('Renderer errors',errors);await page?.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});throw error;}
finally{await app?.close();await fs.rm(temp,{recursive:true,force:true});}
