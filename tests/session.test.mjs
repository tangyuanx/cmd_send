import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{FileStore}=require('../electron/files.cjs'),{saveSession,restoreSession}=require('../electron/session.cjs');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmd-send-session-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return {dir,file:path.join(dir,'profile','session.json')};}
test('restart restores open paths and active document with current disk contents',async t=>{
  const {dir,file}=await fixture(t),store=new FileStore(),a=path.join(dir,'一.txt'),b=path.join(dir,'二.txt');await fs.writeFile(a,'一');await fs.writeFile(b,'二');
  await store.open(a);const active=await store.open(b);await store.save(active.id,'保存后升级😀');await saveSession(file,store,active.id);
  const restored=await restoreSession(file,new FileStore());assert.equal(restored.files.length,2);assert.equal(restored.files.find(f=>f.id===restored.activeId).text,'保存后升级😀');
  assert.equal(restored.failed,0);assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(file,'utf8'))).sort(),['active','paths']);
});
test('missing, corrupt and null session files do not block startup; removed documents are skipped',async t=>{
  const {dir,file}=await fixture(t),empty={files:[],activeId:null,failed:0};assert.deepEqual(await restoreSession(file,new FileStore()),empty);
  await fs.mkdir(path.dirname(file));for(const value of ['bad json','null','42']){await fs.writeFile(file,value);assert.deepEqual(await restoreSession(file,new FileStore()),empty);}
  const a=path.join(dir,'a.txt');await fs.writeFile(a,'exists');await fs.writeFile(file,JSON.stringify({paths:[a,a,path.join(dir,'removed.txt'),'relative.txt',123],active:a}));
  const restored=await restoreSession(file,new FileStore());assert.equal(restored.files.length,1);assert.equal(restored.failed,1);assert.equal(restored.activeId,restored.files[0].id);
});
