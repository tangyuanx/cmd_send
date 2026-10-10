// CI integration test: real NSIS install, real updater download, replacement and restart.
// The loopback feed is written only into an isolated test installation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import {createReadStream,realpathSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {execFileSync,spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';import {_electron as electron} from 'playwright';
import {windowsInstaller} from './windows-installer.mjs';
import {verifyWindowsIcon} from './verify-icons.mjs';
const require=createRequire(import.meta.url),yaml=require('js-yaml');
if(process.platform!=='win32')throw new Error('This integration test requires Windows');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const parts=version.split('.').map(Number);parts[2]++;
const next=parts.join('.'),temp=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-send-update-'));
const directory=path.join(temp,'fixture'),output=path.join(temp,'feed'),installed=path.join(temp,'Installed App');
const executable=path.join(installed,'cmd-send.exe'),appData=path.join(temp,'profile'),localAppData=path.join(temp,'local-profile');
const env={...process.env,APPDATA:appData,LOCALAPPDATA:localAppData};delete env.ELECTRON_RUN_AS_NODE;
const evidence=path.join(root,'test-output','update');await fs.mkdir(evidence,{recursive:true});
let application,page,server,mode='missing',requests=0;const checks=[];
function passed(message){checks.push(message);console.log(`PASS: ${message}`);}
async function until(fn,description,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,400));}throw new Error(`Timed out: ${description}`);}
function processDetails(){return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`$items=@(Get-CimInstance Win32_Process -Filter "Name='cmd-send.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object ProcessId,ExecutablePath,CommandLine); ConvertTo-Json -InputObject $items -Compress`],{encoding:'utf8'}).trim()||'[]');}
function canonical(file){try{return realpathSync.native(file).toLowerCase();}catch{return String(file).toLowerCase();}}
function processes(){const expected=canonical(executable);return processDetails().filter(p=>p.ExecutablePath&&canonical(p.ExecutablePath)===expected).map(p=>p.ProcessId);}
async function runInstaller(file){await new Promise((resolve,reject)=>{const child=spawn(file,['/S',`/D=${installed}`],{env,stdio:'inherit'});const timer=setTimeout(()=>{try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F']);}catch{}reject(new Error('Installer timed out'));},120000);child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`Installer exited ${code}`));});});}
async function launch(){application=await electron.launch({executablePath:executable,env,timeout:60000});application.process().stdout?.on('data',chunk=>process.stdout.write(chunk));page=await application.firstWindow();page.on('pageerror',e=>console.error('Renderer error:',e));await page.waitForFunction(()=>window.desktop&&document.querySelector('#updateButton').textContent.startsWith('v'));}
async function close(){const current=application;application=null;const done=current.waitForEvent('close');await page.locator('#closeWindow').click();await done;}
try{
  await fs.cp(path.join(root,'artifacts','Cmd Send-win32-x64'),directory,{recursive:true});
  const fixturePackage=path.join(directory,'resources','app','package.json');
  const pkg=JSON.parse(await fs.readFile(fixturePackage,'utf8'));pkg.version=next;await fs.writeFile(fixturePackage,JSON.stringify(pkg,null,2));
  await windowsInstaller({root,directory,output,version:next});
  const manifest=yaml.load(await fs.readFile(path.join(output,'latest.yml'),'utf8'));
  assert.equal(manifest.version,next);const installer=path.join(output,manifest.files[0].url);
  await runInstaller(path.join(root,'artifacts',`cmd-send-${version}-Windows-x64-Setup.exe`));
  assert.equal(JSON.parse(await fs.readFile(path.join(installed,'resources','app','package.json'),'utf8')).version,version);
  passed('single EXE installs into a chosen path containing spaces');
  const icon=path.join(root,'assets','icon.ico');
  await verifyWindowsIcon(executable,icon);
  await verifyWindowsIcon(path.join(installed,'Uninstall Cmd Send.exe'),icon);
  // Keep a Windows-rendered preview of the installed executable's real icon.
  const psQuote=value=>`'${value.replaceAll("'","''")}'`;
  execFileSync('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName System.Drawing; $icon=[System.Drawing.Icon]::ExtractAssociatedIcon(${psQuote(executable)}); $bitmap=$icon.ToBitmap(); $bitmap.Save(${psQuote(path.join(evidence,'installed-icon.png'))},[System.Drawing.Imaging.ImageFormat]::Png); $bitmap.Dispose(); $icon.Dispose()`]);
  passed('installed executable and uninstaller retain the custom terminal icon');
  server=http.createServer((req,res)=>{
    requests++;const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/latest.yml'){
      if(mode==='missing'){res.writeHead(404);res.end();return;}
      const value=structuredClone(manifest);if(mode==='corrupt'){value.files[0].sha512=Buffer.alloc(64).toString('base64');value.sha512=value.files[0].sha512;}
      res.setHeader('Content-Type','text/yaml');res.end(yaml.dump(value));
    }else if(pathname===`/${manifest.files[0].url}`){res.setHeader('Content-Length',manifest.files[0].size);createReadStream(installer).pipe(res);}
    else{res.writeHead(404);res.end();}
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  await fs.writeFile(path.join(installed,'resources','app-update.yml'),`provider: generic\nurl: http://127.0.0.1:${server.address().port}\nupdaterCacheDirName: cmd-send-update-test\n`);
  await launch();const userData=await application.evaluate(({app})=>app.getPath('userData'));await close();
  const txt=path.join(temp,'待升级.txt');await fs.writeFile(txt,'原始命令\n');
  await fs.writeFile(path.join(userData,'session.json'),JSON.stringify({paths:[txt],active:txt}));
  await launch();assert.equal(await page.locator('#editor').inputValue(),'原始命令\n');
  assert.equal(requests,0);passed('startup performs no update request; open TXT session restored');
  await page.locator('#updateButton').click();await page.waitForFunction(()=>document.querySelector('#updateStatus').textContent.includes('暂未提供'));
  passed('missing update metadata shows a recoverable error');
  mode='corrupt';await page.locator('#checkUpdate').click();await page.waitForFunction(()=>document.querySelector('#updateStatus').textContent.includes('发现新版本'));
  await page.locator('#downloadUpdate').click();await page.waitForFunction(()=>document.querySelector('#updateStatus').textContent.includes('校验失败'),{},{timeout:120000});
  assert.equal(await page.locator('#installUpdate').isVisible(),false);passed('real updater rejects a corrupt SHA512 and cannot install it');
  mode='valid';await page.locator('#checkUpdate').click();await page.waitForFunction(()=>document.querySelector('#updateStatus').textContent.includes('发现新版本'));
  await page.locator('#downloadUpdate').click();await page.waitForFunction(()=>document.querySelector('#updateStatus').textContent.includes('通过校验'),{},{timeout:120000});
  passed('manual download validates the actual newer Setup.exe');
  await page.locator('[data-close="updateDialog"]').click();
  await page.locator('#editor').fill('升级前保存中文😀\n');
  await page.locator('#settingsButton').click();await page.locator('#intervalInput').fill('1234');await page.locator('[data-theme="dark"]').click();await page.locator('#settingsForm button[type="submit"]').click();
  await page.locator('#updateButton').click();await page.locator('#installUpdate').click();await page.locator('#quitDialog').waitFor({state:'visible'});
  await page.locator('#cancelQuit').click();assert.equal(await page.locator('#editor').inputValue(),'升级前保存中文😀\n');
  assert.equal(await fs.readFile(txt,'utf8'),'原始命令\n');passed('canceling upgrade preserves unsaved text and keeps the old version running');
  await page.locator('#updateButton').click();await page.screenshot({path:path.join(evidence,'downloaded.png')});
  await page.locator('#installUpdate').click();await page.locator('#quitDialog').waitFor({state:'visible'});await page.screenshot({path:path.join(evidence,'save-before-update.png')});
  const oldPid=application.process().pid,closed=application.waitForEvent('close');await page.locator('#saveQuit').click();await closed;application=null;
  assert.equal(await fs.readFile(txt,'utf8'),'升级前保存中文😀\n');
  await until(async()=>{try{return JSON.parse(await fs.readFile(path.join(installed,'resources','app','package.json'),'utf8')).version===next;}catch{return false;}},'replacement with newer app');
  await until(()=>processes().some(pid=>pid!==oldPid),'automatic restart');
  passed('save confirmation writes TXT, installs in place and automatically restarts the newer EXE');
  // Stop the auto-restarted instance, then inspect its persistent state through Playwright.
  for(const pid of processes())execFileSync('taskkill',['/PID',String(pid),'/T','/F']);
  await until(()=>processes().length===0,'restarted process cleanup');
  await launch();assert.equal(await page.locator('#updateButton').textContent(),`v${next}`);
  await verifyWindowsIcon(executable,icon);
  await verifyWindowsIcon(path.join(installed,'Uninstall Cmd Send.exe'),icon);
  assert.equal(await page.locator('#editor').inputValue(),'升级前保存中文😀\n');assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.locator('#settingsButton').click();assert.equal(await page.locator('#intervalInput').inputValue(),'1234');await page.locator('[data-close="settingsDialog"]').click();
  passed('new version retains open TXT, saved content, send settings and theme');await page.screenshot({path:path.join(evidence,'upgraded.png')});await close();
}catch(error){console.error('Restart diagnostic:',JSON.stringify({expected:canonical(executable),processes:processDetails()}));if(page&&!page.isClosed())await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});throw error;}
finally{
  for(const pid of processes())try{execFileSync('taskkill',['/PID',String(pid),'/T','/F']);}catch{}
  if(application)await application.close().catch(()=>{});
  if(server)await new Promise(r=>server.close(r));
  await fs.writeFile(path.join(evidence,'checks.json'),JSON.stringify({version,next,checks},null,2));
  await fs.rm(temp,{recursive:true,force:true}).catch(()=>{});
}
