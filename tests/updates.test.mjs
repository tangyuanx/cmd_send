import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {ManualUpdates,newer}=require('../electron/updates.cjs');
class FakeUpdater extends EventEmitter {
  checks=0;downloads=0;installs=[];
  async checkForUpdates(){this.checks++;this.emit('update-available',{version:'0.1.4',releaseNotes:'修复说明'});return {};}
  async downloadUpdate(){this.downloads++;this.emit('download-progress',{percent:35,total:100,transferred:35});this.emit('update-downloaded',{version:'0.1.4'});return ['verified.exe'];}
  quitAndInstall(...args){this.installs.push(args);}
}
function setup(){const updater=new FakeUpdater();return {updater,service:new ManualUpdates({updater,version:'0.1.3',platform:'win32'})};}
test('manual check, download, then explicit install; ordinary quitting cannot install',async()=>{
  const {service,updater}=setup(),states=[];service.on('state',s=>states.push(s));
  assert.equal(updater.checks,0);assert.equal(updater.downloads,0);
  assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,false);
  assert.equal(updater.allowDowngrade,false);assert.equal(updater.disableWebInstaller,true);
  await assert.rejects(service.download(),/先检查/);assert.throws(()=>service.install(),/校验/);
  assert.equal((await service.check()).phase,'available');assert.equal(updater.downloads,0);
  assert.throws(()=>service.install(),/校验/);
  assert.equal((await service.download()).phase,'downloaded');assert.equal(updater.installs.length,0);
  assert.ok(states.some(s=>s.phase==='downloading'&&s.progress===35));
  await service.check();await service.download();assert.equal(updater.checks,1);assert.equal(updater.downloads,1);
  service.install();assert.deepEqual(updater.installs,[[true,true]]);assert.equal(service.snapshot().phase,'installing');
});
test('simultaneous checks and downloads are each single flight',async()=>{
  const {service,updater}=setup();let release;
  updater.checkForUpdates=async()=>{updater.checks++;await new Promise(r=>release=r);updater.emit('update-available',{version:'0.1.4'});return {};};
  const a=service.check(),b=service.check();assert.equal(updater.checks,1);release();await Promise.all([a,b]);
  updater.downloadUpdate=async()=>{updater.downloads++;await new Promise(r=>release=r);updater.emit('update-downloaded',{version:'0.1.4'});};
  const c=service.download(),d=service.download();assert.equal(updater.downloads,1);release();await Promise.all([c,d]);assert.equal(service.snapshot().phase,'downloaded');
});
test('network failure and SHA512 failure preserve current version and allow retry',async()=>{
  const {service,updater}=setup();const check=updater.checkForUpdates.bind(updater),download=updater.downloadUpdate.bind(updater);
  updater.checkForUpdates=async()=>{throw new Error('ENOTFOUND');};assert.equal((await service.check()).phase,'error');
  updater.checkForUpdates=check;await service.check();
  updater.downloadUpdate=async()=>{const error=new Error('sha512 checksum mismatch');updater.emit('error',error);throw error;};
  const failed=await service.download();assert.equal(failed.currentVersion,'0.1.3');assert.match(failed.error,/校验失败/);assert.throws(()=>service.install(),/校验/);
  updater.downloadUpdate=download;assert.equal((await service.download()).phase,'downloaded');
});
test('failed installer returns error state instead of pretending to install',async()=>{
  const {service,updater}=setup();await service.check();await service.download();
  updater.quitAndInstall=()=>{throw new Error('cannot spawn installer');};assert.throws(()=>service.install(),/spawn/);assert.equal(service.snapshot().phase,'error');
});
test('version comparison rejects downgrade, equal versions and prereleases',()=>{
  for(const v of ['0.1.2','0.1.3','0.1.4-beta.1','garbage'])assert.equal(newer(v,'0.1.3'),false);
  assert.equal(newer('v0.1.10','0.1.9'),true);assert.equal(newer('1.0.0','0.99.99'),true);
  const {service}=setup();service.available({version:'0.1.2'});assert.equal(service.snapshot().phase,'current');assert.equal(service.snapshot().availableVersion,null);
});
test('macOS checks public stable release manually and offers external installation',async()=>{
  let calls=0;const service=new ManualUpdates({version:'0.1.3',platform:'darwin',fetchRelease:async url=>{calls++;assert.equal(url,'https://api.github.com/repos/tangyuanx/cmd_send/releases/latest');return {tag_name:'v0.1.4',body:'新版本'};}});
  assert.equal(calls,0);assert.equal((await service.check()).availableVersion,'0.1.4');assert.equal(service.snapshot().supported,false);await assert.rejects(service.download(),/发布页面/);
});
