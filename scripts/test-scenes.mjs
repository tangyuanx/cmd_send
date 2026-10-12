// Shipped renderer: directory parsing, editing, file switching and session labels.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {_electron as electron} from 'playwright';
const root=path.resolve(import.meta.dirname,'..'),temp=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-send-scenes-'));
const evidence=path.join(root,'test-output','scenes');await fs.mkdir(evidence,{recursive:true});
const text='[串口]\necho first\n［网络］ # 说明\necho second\n【空场景】\n# ignored\n【版本】\necho [abc]\n[串口]\necho last';
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
const config={platform:process.platform,window:{maximized:false,fullscreen:false},update:{phase:'idle',currentVersion:version,supported:false},session:{activeId:'scenes',files:[{id:'scenes',name:'场景.txt',text},{id:'plain',name:'普通命令.txt',text:'version\nversion --all'}]}};
const target={id:'bound-session-one',name:'MobaXterm',sessionName:'会话一 · UART 调试',sessionKey:'PID 123 · 输入区 456',detail:'CMoTTY',strategy:'后台终端输入'};
const env={...process.env,CMD_SEND_SEARCH_FIXTURE:JSON.stringify({profile:path.join(temp,'profile'),page:path.join(root,'src','index.html'),config,target})};delete env.ELECTRON_RUN_AS_NODE;
const checks=[],errors=[];let application,page;
function passed(message){checks.push(message);console.log('PASS:',message);}
async function cursor(){return page.locator('#editor').evaluate(el=>el.selectionStart);}
try{
 application=await electron.launch({args:[path.join(root,'tests','fixtures','search-main.cjs')],env,timeout:60000});page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>document.querySelectorAll('.scene-button').length===5);
 assert.deepEqual(await page.locator('.scene-name').allTextContents(),['串口','网络','空场景','版本','串口']);
 assert.equal(await page.locator('.section-line').count(),5);
 await page.locator('.scene-button').nth(1).click();assert.equal(await cursor(),text.indexOf('echo second'));
 await page.locator('.scene-button').nth(2).click();assert.equal(await cursor(),text.indexOf('【空场景】'),'empty scene cannot jump into the next scene');
 await page.locator('.scene-button').nth(4).click();assert.equal(await cursor(),text.indexOf('echo last'));
 assert.equal(await page.locator('.scene-button[aria-current="location"]').count(),1);passed('all bracket formats render, highlight, navigate and distinguish repeated headings');
 await page.locator('#fileButton').click();await page.locator('[data-file="plain"]').click();assert.equal(await page.locator('.scene-button').count(),0);assert.equal(await page.locator('#sceneEmpty').isVisible(),true);
 await page.locator('#editor').fill('【新场景】\necho new');assert.equal(await page.locator('.scene-name').textContent(),'新场景');assert.equal(await page.locator('#sceneEmpty').isHidden(),true);
 await page.locator('#fileButton').click();await page.locator('[data-file="scenes"]').click();assert.equal(await page.locator('.scene-button').count(),5);passed('no-heading files show the required format; edits and file switches rebuild the directory');
 await page.locator('#targetButton').dispatchEvent('pointerdown',{button:0});await page.waitForFunction(()=>document.getElementById('targetLabel').textContent==='MobaXterm');
 assert.equal(await page.locator('#targetSession').textContent(),'会话一 · UART 调试 · PID 123 · 输入区 456');
 assert.match(await page.locator('#targetButton').getAttribute('aria-label'),/会话一.*输入区 456/);
 await page.locator('#targetButton').click();await page.locator('#targetAlias').fill('会话1 · UART');await page.locator('[data-close="targetDialog"]').last().click();assert.equal(await page.locator('#targetSession').textContent(),'会话1 · UART · PID 123 · 输入区 456');passed('optional session notes change only the displayed name, retaining the immutable input identity');
 await page.screenshot({path:path.join(evidence,'directory-session.png')});
 await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(680,440));await page.waitForFunction(()=>window.innerWidth===680);
 const geometry=await page.evaluate(()=>{const target=document.getElementById('targetButton').getBoundingClientRect(),file=document.getElementById('fileButton').getBoundingClientRect(),pin=document.getElementById('pinButton').getBoundingClientRect();return {targetEnd:target.right,fileStart:file.left,fileEnd:file.right,pinStart:pin.left,overflow:document.documentElement.scrollWidth>innerWidth};});
 assert.equal(geometry.overflow,false);assert.ok(geometry.targetEnd<=geometry.fileStart&&geometry.fileEnd<=geometry.pinStart,JSON.stringify(geometry));await page.screenshot({path:path.join(evidence,'compact-session.png')});passed('session title and fixed input identity remain distinct and fit the minimum window');
 await page.locator('#editor').evaluate(el=>{el.setSelectionRange(0,el.value.length);el.dispatchEvent(new Event('select'));});await page.locator('#sendButton').click();
 const plans=await application.evaluate(()=>global.searchCaptures.plans);assert.equal(plans.length,1);assert.equal(plans[0].targetId,target.id);assert.deepEqual(plans[0].commands,['echo first','echo second','echo [abc]','echo last']);passed('sending filters all heading formats without changing commands or the fixed target');
 assert.deepEqual(errors,[]);
}catch(error){await page?.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});throw error;}
finally{await application?.close().catch(()=>{});await fs.writeFile(path.join(evidence,'checks.json'),JSON.stringify({version,checks,errors},null,2));await fs.rm(temp,{recursive:true,force:true});}
