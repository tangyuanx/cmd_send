// Exercise the shipped renderer in real Electron; no native target input.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {_electron as electron} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-send-search-'));
const evidence=path.join(root,'test-output','search');await fs.mkdir(evidence,{recursive:true});
const text=['[搜索验证]','echo FINDME FINDME',...Array.from({length:120},(_,i)=>`echo routine ${i}`),'echo '+ 'prefix-'.repeat(100)+'\t中😀 FINDME','echo FINDME','echo <literal> .* [a]','echo İ HEADER test TEST'].join('\n');
const other='[另一个文件]\necho FINDME other\necho FINDME second';
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
const config={platform:process.platform,window:{maximized:false,fullscreen:false},update:{phase:'idle',currentVersion:version,supported:false},session:{activeId:'first',files:[{id:'first',name:'搜索验证.txt',text},{id:'second',name:'另一个文件.txt',text:other}]}};
const env={...process.env,CMD_SEND_SEARCH_FIXTURE:JSON.stringify({profile:path.join(temp,'profile'),page:path.join(root,'src','index.html'),config})};delete env.ELECTRON_RUN_AS_NODE;
const checks=[],errors=[];let application,page;
function passed(message){checks.push(message);console.log('PASS:',message);}
async function currentVisible(index,count){
 await page.waitForFunction(({index,count})=>{
  const marks=[...document.querySelectorAll('.find-current')],scroller=document.getElementById('editorScroller'),box=scroller.getBoundingClientRect();
  return document.getElementById('findCount').textContent===`${index+1} / ${count}`&&marks.length===1&&marks[0].dataset.findIndex===String(index)&&marks[0].getBoundingClientRect().top>=box.top&&marks[0].getBoundingClientRect().bottom<=box.top+scroller.clientHeight&&marks[0].getBoundingClientRect().left>=box.left&&marks[0].getBoundingClientRect().right<=box.left+scroller.clientWidth;
 },{index,count});
 const state=await page.evaluate(()=>{
  const editor=document.getElementById('editor'),mark=document.querySelector('.find-current'),range=document.createRange();range.selectNodeContents(mark);
  const r=range.getBoundingClientRect(),box=document.getElementById('findBar').getBoundingClientRect();
  return {selected:editor.value.slice(editor.selectionStart,editor.selectionEnd),start:editor.selectionStart,end:editor.selectionEnd,length:editor.value.length,painted:mark.textContent,internalTop:editor.scrollTop,internalLeft:editor.scrollLeft,clearOfBar:r.top>=box.bottom,outline:getComputedStyle(mark).outlineWidth,lineHidden:document.getElementById('findLine').hidden};
 });
 assert.equal(state.selected,state.painted,JSON.stringify(state));assert.equal(state.internalTop,0);assert.equal(state.internalLeft,0);
 assert.equal(state.clearOfBar,true);assert.equal(state.outline,'2px');assert.equal(state.lineHidden,false);
}
try{
 application=await electron.launch({args:[path.join(root,'tests','fixtures','search-main.cjs')],env,timeout:60000});
 page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>document.getElementById('editor').value.includes('routine 119'));
 await page.evaluate(()=>{
  window.searchEvents=[];
  for(const type of ['input','select','focusin','click'])document.addEventListener(type,event=>{
   const editor=document.getElementById('editor');window.searchEvents.push({type,target:event.target.id,active:document.activeElement.id,start:editor.selectionStart,end:editor.selectionEnd,length:editor.value.length,count:document.getElementById('findCount').textContent});if(window.searchEvents.length>40)window.searchEvents.shift();
  });
 });
 await page.keyboard.press('Control+f');await page.locator('#findInput').fill('FINDME');await currentVisible(0,4);
 assert.equal(await page.locator('.find-match').count(),4);assert.equal(await page.locator('#findInput').evaluate(el=>el===document.activeElement),true);
 await page.screenshot({path:path.join(evidence,'light-first.png')});passed('all results stay painted with search input focused; first result is clear of the find bar');
 await page.locator('#findNext').click();await currentVisible(1,4);
 await page.locator('#findNext').click();await currentVisible(2,4);
 assert.ok(await page.locator('#editorScroller').evaluate(el=>el.scrollTop>1000&&el.scrollLeft>1000));
 await page.screenshot({path:path.join(evidence,'long-line.png')});passed('Next changes the current mark and reveals offscreen results vertically and horizontally');
 await page.locator('#findInput').press('Enter');await currentVisible(3,4);
 await page.locator('#findInput').press('Shift+Enter');await currentVisible(2,4);
 await page.locator('#findInput').press('Enter');await page.locator('#findInput').press('Enter');await currentVisible(0,4);
 await page.locator('#findPrevious').click();await currentVisible(3,4);passed('Enter, Shift+Enter, buttons and wraparound navigate the same exact matches');
 await page.locator('#settingsButton').click();await page.locator('[data-theme="dark"]').click();await page.locator('#settingsForm button[type="submit"]').click();
 await page.locator('#findInput').fill('FINDME');await currentVisible(3,4);
 await page.screenshot({path:path.join(evidence,'dark-current.png')});
 await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(680,440));
 await page.waitForFunction(()=>window.innerWidth===680);await page.locator('#findPrevious').click();await currentVisible(2,4);
 await page.screenshot({path:path.join(evidence,'compact-dark.png')});passed('dark theme and minimum desktop window size keep the current match visible');
 await page.locator('#findInput').fill('___ABSENT___');assert.equal(await page.locator('#findCount').textContent(),'无匹配');
 assert.equal(await page.locator('.find-match').count(),0);assert.equal(await page.locator('#findNext').isDisabled(),true);assert.equal(await page.locator('#findPrevious').isDisabled(),true);
 assert.equal(await page.locator('#findLine').evaluate(el=>el.hidden),true);
 await page.locator('#findInput').fill('');assert.equal(await page.locator('#findCount').textContent(),'0 / 0');passed('absent and empty queries clear stale marks and disable navigation');
 await page.locator('#findInput').fill('<literal>');assert.equal(await page.locator('.find-current').textContent(),'<literal>');assert.equal(await page.locator('#syntaxText literal').count(),0);
 await page.locator('#findInput').fill('.*');assert.equal(await page.locator('.find-current').textContent(),'.*');
 await page.locator('#findInput').fill('test');await currentVisible(0,2);
 assert.equal(await page.locator('#editor').evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd)),'test');passed('HTML, punctuation and Unicode casing use safe literal matches at exact original offsets');
 await page.locator('#findInput').fill('FINDME');await page.locator('#fileButton').click();await page.locator('[data-file="second"]').click();
 assert.equal(await page.locator('.find-match').count(),2);assert.equal(await page.locator('#editor').inputValue(),other);
 await page.locator('#findNext').click();await currentVisible(1,2);passed('switching files rebuilds highlights for the active text');
 const edited='echo 中😀 FINDME\necho edited FINDME\necho preserved';await page.locator('#editor').fill(edited);
 assert.equal(await page.locator('.find-match').count(),2);await page.locator('#findNext').click();await currentVisible(1,2);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#findBar').isHidden(),true);assert.equal(await page.locator('.find-match').count(),0);
 assert.equal(await page.locator('#editor').inputValue(),edited);assert.equal(await page.locator('#syntaxText').textContent(),edited+'\n');
 await page.keyboard.press('Control+s');assert.deepEqual(await application.evaluate(()=>global.searchCaptures.saves),[{id:'second',text:edited}]);
 passed('editing recomputes matches; Escape clears highlights; saving preserves exact TXT content');
 // Select a complete command as before, then send. Painted marks never enter the payload.
 await page.keyboard.press('Control+f');await page.locator('#findInput').fill('FINDME');
 await page.locator('#editor').evaluate(el=>{el.setSelectionRange(0,0);el.dispatchEvent(new Event('select'));});
 await page.locator('#targetButton').dispatchEvent('pointerdown',{button:0});await page.waitForFunction(()=>document.getElementById('targetLabel').textContent==='测试目标');
 await page.locator('#sendButton').click();await page.waitForFunction(()=>document.getElementById('sendButton').disabled);
 const plans=await application.evaluate(()=>global.searchCaptures.plans);assert.equal(plans.length,1);assert.deepEqual(plans[0].commands,['echo 中😀 FINDME']);
 assert.equal(await page.locator('.find-match').count(),0);assert.equal(await page.locator('#editor').inputValue(),edited);passed('search rendering cannot change the actual command sent or TXT buffer');
 assert.deepEqual(errors,[]);
}catch(error){if(page&&!page.isClosed()){
 await fs.writeFile(path.join(evidence,'failure-state.json'),JSON.stringify(await page.evaluate(()=>({events:window.searchEvents,text:document.getElementById('editor').value,painted:document.getElementById('syntaxText').textContent})),null,2)).catch(()=>{});
 await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});
 }throw error;}
finally{await application?.close().catch(()=>{});await fs.writeFile(path.join(evidence,'checks.json'),JSON.stringify({version,platform:process.platform,checks,errors},null,2));await fs.rm(temp,{recursive:true,force:true});}
