// Exercise the shipped renderer in Chromium with an isolated desktop bridge.
// No native input is sent. Fixture data is used only for tests and screenshots.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import {dragTarget} from '../tests/fixtures/drag-target.mjs';
const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'test-output','ui');await fs.mkdir(output,{recursive:true});
import {desktopFixture,text} from '../tests/fixtures/ui-desktop.mjs';
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
const fixture={text,version};
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
 try{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep))throw new Error('path');res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 browser=await chromium.launch({headless:true,...(process.env.CMD_SEND_CHROMIUM?{executablePath:process.env.CMD_SEND_CHROMIUM}:{}) ,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1280,height:820},deviceScaleFactor:1,colorScheme:'light'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(desktopFixture,fixture);
 await page.goto(`http://127.0.0.1:${server.address().port}/src/index.html`);
 await page.waitForFunction(()=>document.querySelectorAll('.scene-button').length===4);
 await dragTarget(page);
 await page.locator('.scene-button').nth(1).click();
 await page.mouse.move(900,80);await page.waitForTimeout(2800);await page.screenshot({animations:'disabled',path:path.join(output,'light.png')});
 assert.equal(await page.locator('#pendingCommand').textContent(),'ip addr show eth0');
 assert.equal(await page.locator('#pendingScope').textContent(),'第 9 行');
 assert.equal(await page.locator('#commandCount').textContent(),'9 条指令');
 await page.locator('#sendButton').click();
 assert.deepEqual(await page.evaluate(()=>window.uiCaptures.plans[0].commands),['ip addr show eth0']);
 await page.evaluate(()=>window.uiQueue({id:'ui-run',type:'completed',total:1}));
 await page.waitForFunction(()=>document.getElementById('pendingCommand').textContent==='ethtool eth0');
 // Selection previews match the payload, including selected command fragments.
 await page.locator('#editor').evaluate(el=>{const start=el.value.indexOf('ip addr'),end=el.value.indexOf('ip -s');el.setSelectionRange(start,end);el.dispatchEvent(new Event('select'));});
 assert.equal(await page.locator('#pendingCount').textContent(),'2 条');
 assert.equal(await page.locator('#pendingCommand').textContent(),'ip addr show eth0\nethtool eth0');
 await page.locator('#schedulesButton').click();
 assert.equal(await page.locator('#scheduleCommands').inputValue(),'ip addr show eth0\nethtool eth0');
 await page.locator('#scheduleName').fill('链路状态检查');
 await page.locator('#schedulePeriod').fill('5');await page.locator('#scheduleUnit').selectOption('60000');
 await page.locator('#scheduleStart').click();
 await page.waitForFunction(()=>document.querySelectorAll('.schedule-job').length===1);
 await page.locator('#scheduleOptionsToggle').click();
 await page.waitForFunction(()=>!document.getElementById('scheduleOptionsContent').inert);
 await page.waitForTimeout(300);
 assert.equal(await page.locator('#scheduleEnter').isVisible(),true);
 await page.screenshot({animations:'disabled',path:path.join(output,'schedules.png')});
 await page.locator('#scheduleOptionsToggle').click();await page.waitForTimeout(280);
 assert.equal(await page.locator('#scheduleOptionsContent').evaluate(el=>el.inert),true);
 assert.equal(await page.locator('#scheduleOptionsContent').evaluate(el=>el.getBoundingClientRect().height),0);
 await page.locator('#scheduleOptionsToggle').click();await page.locator('#scheduleCommandInterval').fill('0');await page.locator('#scheduleOptionsToggle').click();
 await page.locator('#scheduleSave').click();
 assert.equal(await page.locator('#scheduleOptionsToggle').getAttribute('aria-expanded'),'true');
 assert.equal(await page.locator('#scheduleOptionsContent').evaluate(el=>el.inert),false);
 await page.locator('#scheduleCommandInterval').fill('500');
 await page.locator('[data-close="schedulesDialog"]').click();
 await page.locator('.scene-button').nth(1).click();
 await page.locator('#findButton').click();await page.locator('#findInput').fill('eth0');
 assert.equal(await page.locator('.find-match').count(),6);
 await page.locator('#findNext').click();assert.equal(await page.locator('.find-current').count(),1);
 await page.locator('#findClose').click();
 await page.locator('#settingsButton').click();await page.locator('[data-theme=dark]').click();await page.locator('#settingsForm button[type=submit]').click();
 await page.locator('.scene-button').nth(1).click();await page.locator('#editorScroller').evaluate(el=>el.scrollTop=0);await page.mouse.move(900,80);await page.waitForTimeout(2800);await page.screenshot({animations:'disabled',path:path.join(output,'dark.png')});
 const weight=await page.locator('body').evaluate(el=>getComputedStyle(el).fontWeight);assert.equal(weight,'360');
 for(const [width,height] of [[1040,760],[680,440],[390,720]]) {
  await page.setViewportSize({width,height});
  const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,target:document.getElementById('targetButton').getBoundingClientRect().right,file:document.getElementById('fileButton').getBoundingClientRect().left,pin:document.getElementById('pinButton').getBoundingClientRect().right}));
  assert.equal(geometry.overflow,false,JSON.stringify({width,...geometry}));assert.ok(geometry.target<=geometry.file,JSON.stringify({width,...geometry}));
  if(width===680){await page.screenshot({animations:'disabled',path:path.join(output,'compact.png')});await page.locator('#schedulesButton').click();await page.locator('#scheduleMode').selectOption('once');await page.locator('#scheduleStart').scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:path.join(output,'compact-schedules.png')});await page.locator('[data-close="schedulesDialog"]').click();}
 }
 await page.setViewportSize({width:1280,height:820});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.locator('#pinButton').click();
 assert.equal(await page.locator('#toast').isVisible(),true);await page.waitForTimeout(2800);assert.equal(await page.locator('#toast').isHidden(),true);
 assert.equal(await page.locator('#toast .toast-mark').evaluate(el=>el.getAnimations().length),0);
 // Literal preview rendering cannot inject markup or alter the stored TXT.
 await page.locator('#editor').fill('[验证]\necho <script>alert(1)</script>\n# comment');
 await page.locator('#editor').evaluate(el=>{el.setSelectionRange(0,0);el.dispatchEvent(new Event('select'));});
 assert.equal(await page.locator('#pendingCommand').textContent(),'echo <script>alert(1)</script>');
 assert.equal(await page.locator('#pendingCommand script').count(),0);
 await page.locator('#saveButton').click();
 assert.equal(await page.locator('#saveState').textContent(),'已保存');
 assert.equal(await page.evaluate(()=>window.uiCaptures.saves.at(-1).text),'[验证]\necho <script>alert(1)</script>\n# comment');
 const preview=await browser.newPage({viewport:{width:1280,height:820},colorScheme:'light'});
 preview.on('pageerror',e=>errors.push(e.message));
 await preview.goto('file://'+path.join(output,'cmd-send-preview.html'));
 await preview.waitForFunction(()=>document.getElementById('targetLabel').textContent==='192.168.1.10:22');
 assert.equal(await preview.locator('#pendingCommand').textContent(),'ip addr show eth0');
 await preview.getByRole('button',{name:'切换主题'}).click();
 assert.equal(await preview.locator('html').getAttribute('data-theme'),'dark');
 await preview.locator('#sendButton').click();
 await preview.waitForFunction(()=>document.getElementById('pendingCommand').textContent==='ethtool eth0');
 await preview.close();
 // Closing saved buffers restores a usable empty state.
 await page.locator('#fileButton').click();await page.locator('[data-remove=demo]').click();
 await page.locator('#fileButton').click();await page.locator('[data-remove=other]').click();
 await page.waitForFunction(()=>!document.getElementById('emptyState').hidden);
 assert.equal(await page.locator('#sendButton').isDisabled(),true);
 assert.equal(await page.locator('#saveButton').isDisabled(),true);
 assert.equal(await page.locator('#pendingCount').textContent(),'0 条');
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(output,'checks.json'),JSON.stringify({checks:['Preview and send payload match; cursor advances after delivery','Selection import into schedule','Grid folding and keyboard inert state','Search button and exact highlights','Dark weight compensation','1040 / 680 / 390 widths without overflow','Reduced motion and successful toast expiry','Literal preview safety and exact file saving'],errors},null,2));
 console.log('PASS: renderer workflow, themes, responsive layouts, feedback, folding, search and payload integrity');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
