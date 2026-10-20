// Real shipped Electron renderer: no time delay or synthetic pointerdown shortcut.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {_electron as electron} from 'playwright';
const root=path.resolve(import.meta.dirname,'..'),temp=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-send-target-drag-'));
const evidence=path.join(root,'test-output','target-drag');await fs.mkdir(evidence,{recursive:true});
const config={platform:process.platform,window:{maximized:false},update:{phase:'idle',currentVersion:'test',supported:false},session:{activeId:'test',files:[{id:'test',name:'test.txt',text:'echo test'}]}};
const target={id:'bound-terminal',name:'MobaXterm',sessionName:'UART',sessionKey:'PID 123 · 输入区 456',strategy:'后台终端输入'};
const env={...process.env,CMD_SEND_SEARCH_FIXTURE:JSON.stringify({profile:path.join(temp,'profile'),page:path.join(root,'src','index.html'),config,pendingPick:true})};delete env.ELECTRON_RUN_AS_NODE;
let application,page;const checks=[],errors=[];
const passed=message=>{checks.push(message);console.log('PASS:',message);};
async function center(){const r=await page.locator('#targetButton').boundingBox();return {x:r.x+r.width/2,y:r.y+r.height/2};}
async function picks(){return application.evaluate(()=>global.searchCaptures.picks);}
async function drag(){const p=await center();await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+12,p.y);await page.waitForFunction(()=>document.body.classList.contains('picking'));return p;}
async function complete(){await application.evaluate((_,value)=>global.finishTargetPick(value),target);await page.waitForFunction(()=>!document.body.classList.contains('picking'));}
try{
  application=await electron.launch({args:[path.join(root,'tests','fixtures','search-main.cjs')],env,timeout:60000});page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>document.getElementById('editor').value==='echo test');
  await page.locator('#targetButton').click();assert.equal(await page.locator('#targetDialog').isVisible(),true);assert.equal(await picks(),0);await page.locator('[data-close="targetDialog"]').last().click();
  let p=await center();await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+1,p.y+1);await page.mouse.up();assert.equal(await picks(),0);assert.equal(await page.locator('#targetDialog').isVisible(),true);await page.locator('[data-close="targetDialog"]').last().click();
  passed('single click and tiny hand jitter open help without arming native picking');
  // Position before installing the observation: an initial hover move is not a drag.
  p=await center();await page.mouse.move(p.x,p.y);
  await page.evaluate(()=>{const b=document.getElementById('targetButton');b.addEventListener('pointermove',()=>{window.dragSynchronous=document.body.classList.contains('picking');},{once:true});});
  await page.mouse.down();await page.mouse.move(p.x+12,p.y);
  assert.equal(await page.evaluate(()=>window.dragSynchronous),true,'picking must start inside the movement event, not after a timer');
  await page.waitForFunction(()=>document.body.classList.contains('picking'));assert.equal(await picks(),1);await page.mouse.up();await complete();
  assert.equal(await page.locator('#targetDialog').isHidden(),true);assert.equal(await page.locator('#targetLabel').textContent(),'MobaXterm');
  passed('quick movement starts picking synchronously, exactly once, and drop does not open help');
  await page.locator('#targetButton').click();await page.locator('#targetAlias').fill('串口 1');await page.locator('[data-close="targetDialog"]').last().click();assert.match(await page.locator('#targetSession').textContent(),/串口 1/);
  passed('single click after a drop still opens the bound target note editor');
  const before=await picks();await drag();await page.keyboard.press('Escape');await page.mouse.up();await page.waitForFunction(()=>!document.body.classList.contains('picking'));assert.equal(await picks(),before+1);assert.equal(await application.evaluate(()=>global.searchCaptures.cancels),1);assert.equal(await page.locator('#targetDialog').isHidden(),true);assert.match(await page.locator('#targetSession').textContent(),/串口 1/);
  passed('Escape cancels an active drag without changing the old target or opening help');
  p=await center();await page.mouse.move(p.x,p.y);await page.mouse.down();await page.keyboard.press('Escape');await page.mouse.move(p.x+15,p.y);await page.mouse.up();assert.equal(await picks(),before+1);assert.equal(await page.locator('#targetDialog').isHidden(),true);
  passed('Escape before movement prevents a late picker from starting');
  await drag();const size=page.viewportSize()||{width:1040,height:760};await page.mouse.move(size.width+50,size.height+50);await page.mouse.up();await complete();assert.equal(await page.locator('#targetDialog').isHidden(),true);
  await page.locator('#targetButton').click();assert.equal(await page.locator('#targetDialog').isVisible(),true);await page.locator('[data-close="targetDialog"]').last().click();
  passed('dragging beyond the viewport completes and the following normal click works');
  await page.locator('#targetButton').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#targetDialog').isVisible(),true);await page.locator('[data-close="targetDialog"]').last().click();
  await page.screenshot({path:path.join(evidence,'direct-drag.png')});assert.deepEqual(errors,[]);
}catch(error){await page?.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});throw error;}
finally{await application?.close().catch(()=>{});await fs.writeFile(path.join(evidence,'checks.json'),JSON.stringify({checks,errors},null,2));await fs.rm(temp,{recursive:true,force:true});}
