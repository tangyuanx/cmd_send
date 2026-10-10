'use strict';
const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');const readline=require('node:readline');
// Startup includes PowerShell and assembly loading; only ready workers receive requests.
class AutomationWorker {
  constructor({spawnProcess=spawn,startupTimeout=20000,requestTimeout=5000}={}){
    this.spawnProcess=spawnProcess;this.startupTimeout=startupTimeout;this.requestTimeout=requestTimeout;
    this.session=null;this.pending=new Map();this.sequence=0;
  }
  launch(){
    if(this.session)return this.session;
    const source=fs.readFileSync(path.join(__dirname,'windows-uia.ps1'),'utf8');
    const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const child=this.spawnProcess(executable,['-NoLogo','-NoProfile','-NonInteractive','-MTA','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const session={child};
    session.promise=new Promise((resolve,reject)=>{session.resolve=resolve;session.reject=reject;});
    this.session=session;
    session.timer=setTimeout(()=>this.stop(new Error('控件识别服务启动超时，请重新绑定目标'),session),this.startupTimeout);
    const fail=()=>this.stop(new Error('控件识别服务已停止，请重新绑定目标'),session);
    child.on('error',fail);child.on('exit',fail);child.stdin.on('error',fail);child.stderr.resume();
    readline.createInterface({input:child.stdout}).on('line',line=>{
      if(this.session!==session)return;
      let response;try{response=JSON.parse(line);}catch{return;}
      if(response.type==='ready'){clearTimeout(session.timer);session.resolve();return;}
      const item=this.pending.get(response.id);if(!item)return;clearTimeout(item.timer);this.pending.delete(response.id);
      if(response.ok)item.resolve(response.value);else item.reject(Object.assign(new Error(response.error),{code:response.code}));
    });
    return session;
  }
  async call(method,args={}){
    const session=this.launch();await session.promise;
    if(this.session!==session)throw new Error('控件识别已取消');
    return new Promise((resolve,reject)=>{
      const id=++this.sequence;
      const timer=setTimeout(()=>this.stop(new Error('目标控件响应超时，已停止投递'),session),this.requestTimeout);
      this.pending.set(id,{resolve,reject,timer});
      try{session.child.stdin.write(JSON.stringify({id,method,...args})+'\n');}catch{this.stop(new Error('控件识别服务已停止，请重新绑定目标'),session);}
    });
  }
  stop(error,session=this.session){
    if(!session||this.session!==session)return;
    this.session=null;clearTimeout(session.timer);session.reject(error);
    for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error);}this.pending.clear();
    session.child.kill();
  }
  dispose(){this.stop(new Error('控件识别已取消'));}
}
module.exports={AutomationWorker};

