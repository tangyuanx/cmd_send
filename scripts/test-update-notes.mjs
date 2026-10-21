// Verify the shipped update dialog with both GitHub HTML and Markdown notes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {fileURLToPath} from 'node:url';import {_electron as electron} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-send-update-notes-'));
const evidence=path.join(root,'test-output','update-notes');await fs.mkdir(evidence,{recursive:true});
const html='<p>新增多目标独立定时发送。</p>\n<ul>\n<li>右侧新增「定时发送」，支持<strong>按间隔循环</strong>和指定时间发送一次。</li>\n<li>每个任务单独绑定目标，可分别启动、暂停、编辑、删除。</li>\n<li>显示状态、成功轮数、上次 / 下次时间。</li>\n<li>一个目标失败不影响其他任务。</li>\n<li>重启后需重新绑定并启动。</li>\n<li>可在顶部版本号检查更新，下载并安装重启。</li></ul><p>Windows &amp; macOS</p>';
const base={phase:'available',currentVersion:'0.1.16',availableVersion:'0.1.17',supported:true,progress:0,releaseNotes:html};
const config={platform:process.platform,window:{maximized:false,fullscreen:false},update:base,session:{files:[]}};
let app,page;const errors=[];
try{
 const env={...process.env,CMD_SEND_SEARCH_FIXTURE:JSON.stringify({profile:path.join(temp,'profile'),page:path.join(root,'src','index.html'),config})};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({args:[...(process.platform==='linux'?['--no-sandbox','--ozone-platform=headless']:[]),path.join(root,'tests','fixtures','search-main.cjs')],env,timeout:60000});
 page=await app.firstWindow();if(process.platform==='linux')await page.setViewportSize({width:1040,height:760});page.on('pageerror',error=>errors.push(error.message));
 await page.locator('#updateButton').click();const notes=page.locator('#updateNotes');await notes.locator('li').first().waitFor();
 assert.equal(await notes.locator('li').count(),6);assert.equal(await notes.locator('strong').innerText(),'按间隔循环');assert.ok((await notes.innerText()).includes('Windows & macOS'));assert.ok(!(await notes.innerText()).includes('<li>'));
 assert.equal(await notes.evaluate(el=>getComputedStyle(el).whiteSpace),'normal');
 await page.screenshot({path:path.join(evidence,'html-light.png')});
 // Download progress must not rebuild the note DOM or reset a user's scroll.
 await notes.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dataset.scroll=String(el.scrollTop);el.firstChild.noteIdentity=true;});
 await app.evaluate((_electron,value)=>global.setUpdateFixture(value),{...base,phase:'downloading',progress:37});
 await page.waitForFunction(()=>document.getElementById('updateProgress').value===37);
 assert.equal(await notes.evaluate(el=>el.firstChild.noteIdentity),true);assert.equal(await notes.evaluate(el=>el.scrollTop),Number(await notes.getAttribute('data-scroll')));assert.ok((await page.locator('#updateStatus').innerText()).includes('37%'));
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:path.join(evidence,'html-downloading-dark.png')});
 const markdown='# 更新说明\n\n新增 **独立定时**，支持 `echo status`。\n\n- 多目标\n  - 各自启停\n- 状态显示\n\n1. 下载\n2. 重启\n\n> 请保持应用运行\n\n```sh\necho "<p>保留指令</p>"\n```\n\n普通文本第一行\n普通文本第二行';
 await app.evaluate((_electron,value)=>global.setUpdateFixture(value),{...base,releaseNotes:markdown});await notes.locator('h1').waitFor();
 assert.equal(await notes.locator('h1').innerText(),'更新说明');assert.equal(await notes.locator('ul>li').count(),3);assert.equal(await notes.locator('ul ul li').innerText(),'各自启停');assert.equal(await notes.locator('ol>li').count(),2);assert.equal(await notes.locator('pre code').textContent(),'echo "<p>保留指令</p>"');assert.equal(await notes.locator('blockquote').innerText(),'请保持应用运行');assert.ok(await notes.locator('br').count());
 await notes.evaluate(el=>el.scrollTop=0);await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:path.join(evidence,'markdown-light.png')});
 // Remote release HTML cannot run scripts, inject styles, load images or navigate.
 const unsafe='<p style="color:red" onclick="window.notesExecuted=1">安全内容</p><script>window.notesExecuted=1</script><img src="https://example.invalid/pixel" onerror="window.notesExecuted=1"><iframe srcdoc="<script>parent.notesExecuted=1</script>"></iframe><style>body{display:none}</style><a href="javascript:window.notesExecuted=1">链接文字</a><ul><li data-secret="discard">保留列表</li></ul><ol start="3"><li>序号</li></ol>';
 const requests=[];page.on('request',request=>{if(request.url().includes('example.invalid'))requests.push(request.url());});
 await app.evaluate((_electron,value)=>global.setUpdateFixture(value),{...base,releaseNotes:unsafe});await page.waitForFunction(()=>document.getElementById('updateNotes').textContent.includes('安全内容'));
 assert.equal(await notes.locator('script,style,img,iframe,a,[onclick],[style],[data-secret]').count(),0);assert.equal(await page.evaluate(()=>window.notesExecuted),undefined);assert.equal(await notes.locator('ol').getAttribute('start'),'3');assert.ok((await notes.innerText()).includes('链接文字'));assert.deepEqual(requests,[]);
 await app.evaluate((_electron,value)=>global.setUpdateFixture(value),{...base,releaseNotes:'普通更新说明\n第二行'});await page.waitForFunction(()=>document.getElementById('updateNotes').textContent.includes('第二行'));assert.equal(await notes.locator('br').count(),1);
 await app.evaluate((_electron,value)=>global.setUpdateFixture(value),{...base,releaseNotes:''});await notes.waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);console.log('PASS: HTML/Markdown formatting, nested lists, code/entities, plain text, download scroll preservation and inert remote content');
}catch(error){await page?.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});throw error;}
finally{await app?.close();await fs.rm(temp,{recursive:true,force:true});}
