'use strict';
const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises');const path=require('node:path');
const {SendQueue}=require('./queue.cjs');

function configuration(value){
  if(!value||typeof value!=='object')throw new Error('任务配置无效');
  const {commands,mode='countdown',periodMs=1000,at=null,commandInterval=500,characterInterval=2}=value;
  if(!Array.isArray(commands)||!commands.length||commands.length>10000||commands.some(c=>typeof c!=='string'||!c.trim()||c.length>100000||/[\r\n\0]/u.test(c))||commands.reduce((n,c)=>n+Buffer.byteLength(c),0)>20*1024*1024)throw new Error('请填写有效指令，每行一条');
  if(!['countdown','once'].includes(mode))throw new Error('请选择定时方式');
  if(!Number.isInteger(periodMs)||periodMs<50||periodMs>86400000)throw new Error('倒计时需在 50 ms 到 24 小时之间');
  if(mode==='once'&&(!Number.isSafeInteger(at)||at<=0||at>8640000000000000))throw new Error('请选择有效的发送时间');
  if(!Number.isInteger(commandInterval)||commandInterval<50||commandInterval>600000||!Number.isInteger(characterInterval)||characterInterval<0||characterInterval>1000)throw new Error('命令或字符间隔无效');
  return {name:String(value.name||'定时任务').trim().slice(0,80)||'定时任务',commands:[...commands],mode,periodMs,at:mode==='once'?at:null,commandInterval,characterInterval,enter:value.enter!==false};
}

class ScheduleManager extends EventEmitter {
  constructor({backend,broker,file=null,clock=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout}){
    super();Object.assign(this,{backend,broker,file,clock,setTimer,clearTimer});this.jobs=new Map();this.lanes=new Map();this.writes=Promise.resolve();this.closing=false;
  }
  snapshot(){return [...this.jobs.values()].map(j=>({id:j.id,...j.config,target:j.target?{...j.target}:null,targetLabel:j.targetLabel,enabled:j.enabled,status:j.status,nextAt:j.nextAt,lastAt:j.lastAt,count:j.count,error:j.error}));}
  publish(){this.emit('state',this.snapshot());}
  async load(){
    if(!this.file)return;
    let data;try{data=JSON.parse(await fs.readFile(this.file,'utf8'));}catch{return;}
    for(const item of (Array.isArray(data)?data:[]).slice(0,50)){
      try{const config=configuration({...item,mode:item.mode==='interval'?'countdown':item.mode});const id=typeof item.id==='string'?item.id:randomUUID();this.jobs.set(id,this.entry(id,config,null,String(item.targetLabel||'')));}catch{}
    }
  }
  entry(id,config,target,targetLabel=''){
    return {id,config,target,targetLabel,enabled:false,status:target?'paused':'unbound',nextAt:null,lastAt:null,count:0,error:'',timer:null,queue:null,generation:0};
  }
  persist(){
    if(!this.file)return Promise.resolve();
    // Never persist HWNDs, target IDs or an armed state across application restarts.
    const text=JSON.stringify(this.snapshot().map(j=>({id:j.id,name:j.name,commands:j.commands,mode:j.mode,periodMs:j.periodMs,at:j.at,commandInterval:j.commandInterval,characterInterval:j.characterInterval,enter:j.enter,targetLabel:j.targetLabel})),null,2);
    const write=async()=>{await fs.mkdir(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';try{await fs.writeFile(temp,text,'utf8');await fs.rename(temp,this.file);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}};
    this.writes=this.writes.catch(()=>{}).then(write);return this.writes;
  }
  lane(id,fn){const run=(this.lanes.get(id)||Promise.resolve()).catch(()=>{}).then(fn);this.lanes.set(id,run);run.finally(()=>{if(this.lanes.get(id)===run)this.lanes.delete(id);}).catch(()=>{});return run;}
  get(id){const j=this.jobs.get(id);if(!j)throw new Error('定时任务不存在');return j;}
  async save(value,target){
    const config=configuration(value);if(value.id!==undefined&&(typeof value.id!=='string'||value.id.length>100||!value.id))throw new Error('任务标识无效');const id=value.id||randomUUID();
    return this.lane(id,async()=>{
      if(this.closing)throw new Error('正在退出，请稍后重试');
      const old=value.id?this.get(id):null;
      if(!old&&this.jobs.size>=50)throw new Error('最多创建 50 个定时任务');
      target=target||old?.target||null;
      if(value.start){if(!target||!this.backend.hasTarget(target.id))throw new Error('请先绑定此任务的目标');if(config.mode==='once'&&config.at<=this.clock())throw new Error('发送时间需要晚于当前时间');}
      if(target&&!this.backend.hasTarget(target.id))throw new Error('目标已失效，请重新绑定');
      if(old)await this.halt(old);
      if(target)this.backend.retain(target.id);
      const label=target?[target.alias||target.sessionName||target.title||target.name,target.sessionAddress].filter(Boolean).join(' · '):old?.targetLabel||'';
      const j=this.entry(id,config,target?{...target}:null,label);this.jobs.set(id,j);
      try{await this.persist();}catch(error){this.jobs.delete(id);if(target)this.backend.release(target.id);if(old)this.jobs.set(id,old);this.publish();throw new Error('任务未保存：'+error.message);}
      if(old?.target)this.backend.release(old.target.id);
      if(value.start)this.arm(j);this.publish();return this.snapshot();
    });
  }
  arm(j){
    if(this.closing)throw new Error('正在退出');
    if(!j.target||!this.backend.hasTarget(j.target.id))throw new Error('请先编辑任务并重新绑定目标');
    if(j.config.mode==='once'&&j.config.at<=this.clock())throw new Error('发送时间已过，请重新设置');
    j.enabled=true;j.error='';j.status='scheduled';j.generation++;j.nextAt=j.config.mode==='once'?j.config.at:this.clock()+j.config.periodMs;this.schedule(j);
  }
  schedule(j){
    if(!j.enabled||this.closing)return;
    j.timer=this.setTimer(()=>{j.timer=null;void this.tick(j).catch(error=>{j.enabled=false;j.status='failed';j.nextAt=null;j.error=error.message;this.publish();});},Math.min(1000,Math.max(0,j.nextAt-this.clock())));
  }
  async tick(j){
    if(!j.enabled||this.closing)return;
    const now=this.clock(),due=j.nextAt;if(now<due){this.schedule(j);return;}
    if(now-due>3000){j.enabled=false;j.status='missed';j.nextAt=null;j.error='已错过发送时间，请重新设置；未补发';this.publish();return;}
    const generation=j.generation;j.nextAt=null;j.status='waiting';
    const channel=this.broker.channel({onWait:()=>{if(j.generation===generation){j.status='waiting';this.publish();}},onActive:()=>{if(j.generation===generation){j.status='running';this.publish();}}});
    const queue=new SendQueue(channel);j.queue=queue;this.publish();
    queue.on('state',event=>{
      if(!['completed','failed','stopped'].includes(event.type)||j.generation!==generation)return;
      j.queue=null;
      if(event.type==='completed'){
        j.count++;j.lastAt=this.clock();
        j.enabled=false;j.status='completed';j.nextAt=null;
      }else if(event.type==='failed'){j.enabled=false;j.status='failed';j.error=event.error+'；已停止，不自动重试';j.nextAt=null;}
      this.publish();
    });
    try{queue.start({commands:j.config.commands,targetId:j.target.id,interval:j.config.commandInterval,characterInterval:j.config.characterInterval,rounds:1,enter:j.config.enter});}
    catch(error){j.queue=null;j.enabled=false;j.status='failed';j.error=error.message;j.nextAt=null;this.publish();}
  }
  async halt(j){
    j.enabled=false;j.generation++;if(j.timer!==null)this.clearTimer(j.timer);j.timer=null;j.nextAt=null;
    const queue=j.queue;j.queue=null;if(queue)await queue.stop();j.status=j.target?'paused':'unbound';
  }
  action(id,action){return this.lane(id,async()=>{const j=this.get(id);if(action==='start'){if(!j.enabled){this.arm(j);}}else if(action==='pause')await this.halt(j);else if(action==='delete'){await this.halt(j);this.jobs.delete(id);if(j.target)this.backend.release(j.target.id);}else throw new Error('未知任务操作');try{await this.persist();}finally{this.publish();}return this.snapshot();});}
  async stopAll(){this.closing=true;await Promise.allSettled([...this.lanes.values()]);await Promise.all([...this.jobs.values()].map(j=>this.halt(j)));await this.writes.catch(()=>{});this.publish();}
  reopen(){this.closing=false;}
}
module.exports={ScheduleManager,configuration};
