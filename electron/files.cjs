'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
class FileStore {
  constructor(){this.records=new Map();this.paths=new Map();}
  async open(filePath){
    const realPath=await fs.realpath(filePath);const key=process.platform==='win32'?realPath.toLowerCase():realPath;
    if(this.paths.has(key))return {id:this.paths.get(key),existing:true};
    const bytes=await fs.readFile(realPath);if(bytes.length>20*1024*1024)throw new Error('TXT 文件不能超过 20 MB');
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('文件不是有效 UTF-8，请转换编码后再打开');}
    const stat=await fs.stat(realPath);if(this.paths.has(key))return {id:this.paths.get(key),existing:true};const id=randomUUID();
    const record={id,path:realPath,key,bom:bytes[0]===239&&bytes[1]===187&&bytes[2]===191,newline:text.includes('\r\n')?'CRLF':'LF',hash:hash(bytes),mode:stat.mode};
    this.records.set(id,record);this.paths.set(key,id);
    return {id,path:realPath,name:path.basename(filePath),text:text.replace(/\r\n/g,'\n'),bom:record.bom,newline:record.newline,encoding:'UTF-8'};
  }
  save(id,text,options={}){
    const record=this.records.get(id);if(!record)return Promise.reject(new Error('文件已关闭'));
    const pending=(record.pending||Promise.resolve()).then(()=>this.saveNow(id,text,options));
    record.pending=pending.catch(()=>{});return pending;
  }
  async saveNow(id,text,{overwrite=false}={}){
    const record=this.records.get(id);if(!record)throw new Error('文件已关闭');
    if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>20*1024*1024)throw new Error('文件内容无效或超过 20 MB');
    const existing=await fs.readFile(record.path);
    if(!overwrite&&hash(existing)!==record.hash){const error=new Error('磁盘文件已在其他程序中修改');error.code='FILE_CHANGED';throw error;}
    const content=(record.bom?'\uFEFF':'')+(record.newline==='CRLF'?text.replace(/\r?\n/g,'\r\n'):text.replace(/\r\n/g,'\n'));
    const bytes=Buffer.from(content,'utf8'),temp=path.join(path.dirname(record.path),`.${path.basename(record.path)}.${randomUUID()}.tmp`);
    try{await fs.writeFile(temp,bytes,{flag:'wx',mode:record.mode});await fs.rename(temp,record.path);record.hash=hash(bytes);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}
    return {id,path:record.path};
  }
  async close(id){const record=this.records.get(id);if(record){await record.pending;this.paths.delete(record.key);this.records.delete(id);}}
}
module.exports={FileStore};
