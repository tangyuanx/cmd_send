'use strict';
const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');const readline=require('node:readline');
// Isolated UI Automation worker. No persistent changes to PowerShell or OS policy.
class AutomationWorker {
  constructor(){this.child=null;this.pending=new Map();this.sequence=0;}
  launch(){
    if(this.child)return;
    const source=fs.readFileSync(path.join(__dirname,'windows-uia.ps1'),'utf8');
    const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const child=spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-MTA','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child=child;
    const fail=()=>{if(this.child!==child)return;this.child=null;for(const [id,item] of this.pending){clearTimeout(item.timer);item.reject(new Error('控件识别服务已停止，请重新绑定目标'));this.pending.delete(id);}};
    child.on('error',fail);child.on('exit',fail);child.stdin.on('error',fail);child.stderr.resume();
    readline.createInterface({input:child.stdout}).on('line',line=>{
      let response;try{response=JSON.parse(line);}catch{return;}
      const item=this.pending.get(response.id);if(!item)return;clearTimeout(item.timer);this.pending.delete(response.id);
      if(response.ok)item.resolve(response.value);else item.reject(new Error(response.error));
    });
  }
  call(method,args={}){this.launch();return new Promise((resolve,reject)=>{
    const id=++this.sequence;const timer=setTimeout(()=>{this.dispose();reject(new Error('目标控件响应超时，已停止投递'));},5000);
    this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,...args})+'\n');
  });}
  dispose(){this.child?.kill();this.child=null;for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('控件识别已取消'));}this.pending.clear();}
}
module.exports={AutomationWorker};
