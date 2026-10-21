// Exercise real keyboard selections and the shipped scheduling form. In
// particular, replace its prefilled value before testing the Read action.
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
const read=()=>page.locator('#scheduleImport').click();
const status=()=>page.locator('#scheduleImportStatus').innerText();
try{
 await launch([first,second]);await cursor(2);await open();
 assert.equal(await page.locator('#scheduleCommands').inputValue(),'echo A');assert.match(await status(),/已自动读取 1 条指令/);
 await page.locator('#scheduleCommands').fill('replace this draft');await read();assert.equal(await page.locator('#scheduleCommands').inputValue(),'echo A');assert.match(await status(),/已读取 1 条指令.*定时发送.txt.*第 2 行/);
 await read();assert.match(await status(),/已重新读取 1 条指令/);assert.ok((await page.locator('#toast').innerText()).includes('已重新读取'));
 // Selecting the real editor via keyboard must import the current range,
 // ignoring headings/comments/blank lines rather than reading an old caret.
 await close();await page.locator('#editor').focus();await page.keyboard.press(mod+'+A');await open();await page.locator('#scheduleCommands').fill('sentinel');await read();assert.equal(await page.locator('#scheduleCommands').inputValue(),'echo A\necho B\necho C');assert.match(await status(),/已读取 3 条指令.*第 2–6 行（选区）/);
 // Choose non-adjacent workspace lines explicitly, including another open file.
 await page.locator('#scheduleChoose').click();
 await page.locator('#scheduleSourceLines input').nth(1).check();
 await page.locator('#scheduleSourceLines input').nth(5).check();
 assert.equal(await page.locator('#scheduleSourceLines input').nth(0).isDisabled(),true);
 await page.locator('#scheduleSourceFile').selectOption('second');
 await page.locator('#scheduleSourceLines input').nth(1).check();
 await page.locator('#scheduleSourceFile').selectOption('first');
 assert.equal(await page.locator('#scheduleSourceLines input').nth(5).isChecked(),true);
 await page.locator('#scheduleChooseConfirm').click();
 assert.equal(await page.locator('#scheduleCommands').inputValue(),'echo A\necho C\nsecond command');
 await page.locator('#scheduleChoose').click();await page.locator('#scheduleSourceLines input').nth(4).check();await page.locator('#scheduleChooseCancel').click();
 assert.equal(await page.locator('#scheduleCommands').inputValue(),'echo A\necho C\nsecond command');
 await page.screenshot({path:path.join(evidence,'workspace-choice.png')});
 await read();
 await page.locator('#scheduleName').fill('保留的任务');await page.locator('#schedulePeriod').fill('12');await page.locator('#scheduleSave').click();await page.waitForFunction(()=>document.querySelectorAll('.schedule-job').length===1);
 await page.screenshot({path:path.join(evidence,'selection-read.png')});
 // A new read changes the draft, not the saved task or unrelated fields.
 await close();await cursor(5,true);await open();await page.locator('#scheduleCommands').fill('another sentinel');await read();assert.equal(await page.locator('#scheduleCommands').inputValue(),'echo B');assert.equal(await page.locator('#scheduleName').inputValue(),'保留的任务');assert.equal(await page.locator('#schedulePeriod').inputValue(),'12');
 assert.deepEqual(await app.evaluate(()=>global.scheduleManager.snapshot()[0].commands),['echo A','echo B','echo C']);
 // A comment-only selection must report the problem next to the commands and
 // preserve any manually entered draft rather than silently clearing it.
 await close();await cursor(3,true);await open();await page.locator('#scheduleCommands').fill('keep manual command');await read();assert.equal(await page.locator('#scheduleCommands').inputValue(),'keep manual command');assert.match(await status(),/选区中没有有效指令.*原指令已保留/);
 assert.equal(await page.locator('#scheduleImportStatus').evaluate(el=>el.classList.contains('is-error')),true);
 // Switching files changes the import source; no stale file content survives.
 await close();await page.locator('#fileButton').click();await page.getByRole('menuitem',{name:'另一组.txt',exact:true}).click();await open();await read();assert.equal(await page.locator('#scheduleCommands').inputValue(),'other command');assert.match(await status(),/另一组.txt.*第 1 行/);
 assert.deepEqual(await app.evaluate(()=>global.searchCaptures.plans),[]);assert.deepEqual(await app.evaluate(()=>global.searchCaptures.saves),[]);
 await app.close();app=null;await launch([]);await open();await page.locator('#scheduleCommands').fill('manual command');await read();assert.equal(await page.locator('#scheduleCommands').inputValue(),'manual command');assert.match(await status(),/先在主界面打开 TXT/);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(680,440));if(process.platform==='linux')await page.setViewportSize({width:680,height:440});await read();
 assert.equal(await page.locator('#scheduleImportStatus').evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('.schedules-layout').getBoundingClientRect();return a.top>=b.top-2&&a.bottom<=b.bottom+2;}),true);
 await page.screenshot({path:path.join(evidence,'no-file-feedback.png')});assert.deepEqual(errors,[]);
 console.log('PASS: Read replaces a changed draft from the actual current line/selection/file, confirms identical rereads and preserves input on failure');
}catch(error){console.error('Renderer errors',errors);await page?.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});throw error;}
finally{await app?.close();await fs.rm(temp,{recursive:true,force:true});}
