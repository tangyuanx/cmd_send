'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
async function restoreSession(file,store){
  let session;try{session=JSON.parse(await fs.readFile(file,'utf8'));}catch{return {files:[],activeId:null,failed:0};}
  if(!session||typeof session!=='object')return {files:[],activeId:null,failed:0};
  const files=[];let activeId=null,failed=0;
  for(const p of (Array.isArray(session.paths)?session.paths:[]).slice(0,100)){
    if(typeof p!=='string'||!path.isAbsolute(p))continue;
    try{const item=await store.open(p);if(!item.existing)files.push(item);if(p===session.active)activeId=item.id;}catch{failed++;}
  }
  return {files,activeId:activeId||files[0]?.id||null,failed};
}
async function saveSession(file,store,activeId){
  const paths=[...store.records.values()].map(r=>r.path),active=store.records.get(activeId)?.path||paths[0]||null;
  await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.tmp';
  try{await fs.writeFile(temp,JSON.stringify({paths,active}),'utf8');await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}
}
module.exports={restoreSession,saveSession};
