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
  const groupId=value.groupId??null;
  if(groupId!==null&&(typeof groupId!=='string'||!groupId||groupId.length>100))throw new Error('分组标识无效');
  return {name:String(value.name||'定时任务').trim().slice(0,80)||'定时任务',commands:[...commands],mode,periodMs,at:mode==='once'?at:null,commandInterval,characterInterval,enter:value.enter!==false,groupId};
}

class ScheduleManager extends EventEmitter {
  constructor({backend,broker,file=null,clock=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout}){
    super();Object.assign(this,{backend,broker,file,clock,setTimer,clearTimer});this.jobs=new Map();this.groups=new Map();this.lanes=new Map();this.writes=Promise.resolve();this.closing=false;
  }
  snapshot(){return [...this.jobs.values()].map(j=>({id:j.id,...j.config,target:j.target?{...j.target}:null,targetLabel:j.targetLabel,enabled:j.enabled,status:j.status,nextAt:j.nextAt,lastAt:j.lastAt,count:j.count,error:j.error}));}
  groupSnapshot(){return [...this.groups.values()].map(g=>({...g}));}
  publish(){this.emit('state',this.snapshot());this.emit('groups',this.groupSnapshot());}
  async load(){
    if(!this.file)return;
    let data;try{data=JSON.parse(await fs.readFile(this.file,'utf8'));}catch{return;}
    const legacy=Array.isArray(data);
    if(!legacy&&data?.version!==2)return;
    for(const g of (!legacy&&Array.isArray(data.groups)?data.groups:[]).slice(0,50)){
      if(g&&typeof g.id==='string'&&g.id.length>0&&g.id.length<=100&&typeof g.name==='string'&&g.name.trim())this.groups.set(g.id,{id:g.id,name:g.name.trim().slice(0,80)});
    }
    for(const item of (legacy?data:Array.isArray(data.jobs)?data.jobs:[]).slice(0,50)){
      try{const config=configuration({...item,groupId:this.groups.has(item.groupId)?item.groupId:null,mode:item.mode==='interval'?'countdown':item.mode});const id=typeof item.id==='string'?item.id:randomUUID();this.jobs.set(id,this.entry(id,config,null,String(item.targetLabel||'')));}catch{}
    }
  }
  entry(id,config,target,targetLabel=''){
    return {id,config,target,targetLabel,enabled:false,status:target?'paused':'unbound',nextAt:null,lastAt:null,count:0,error:'',timer:null,queue:null,generation:0};
  }
  persist(){
    if(!this.file)return Promise.resolve();
    // Never persist HWNDs, target IDs or an armed state across application restarts.
    const text=JSON.stringify({version:2,groups:this.groupSnapshot(),jobs:this.snapshot().map(j=>({id:j.id,name:j.name,commands:j.commands,mode:j.mode,periodMs:j.periodMs,at:j.at,commandInterval:j.commandInterval,characterInterval:j.characterInterval,enter:j.enter,groupId:j.groupId,targetLabel:j.targetLabel}))},null,2);
    const write=async()=>{await fs.mkdir(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';try{await fs.writeFile(temp,text,'utf8');await fs.rename(temp,this.file);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}};
    this.writes=this.writes.catch(()=>{}).then(write);return this.writes;
  }
  lane(id,fn){const run=(this.lanes.get(id)||Promise.resolve()).catch(()=>{}).then(fn);this.lanes.set(id,run);run.finally(()=>{if(this.lanes.get(id)===run)this.lanes.delete(id);}).catch(()=>{});return run;}
  get(id){const j=this.jobs.get(id);if(!j)throw new Error('定时任务不存在');return j;}
  // All metadata changes share a lane: a group operation cannot race an edit,
  // reorder or deletion. Running native queues remain independent.
  change(fn){return this.lane('workspace',()=>{if(this.closing)throw new Error('正在退出，请稍后重试');return fn();});}
  checkGroup(id){if(id!==null&&!this.groups.has(id))throw new Error('分组不存在，请重新选择');}
  async metadata(fn){
    const jobs=new Map(this.jobs),configs=new Map([...jobs.values()].map(j=>[j,j.config])),groups=new Map(this.groups);
    try{fn();await this.persist();}catch(error){this.jobs=jobs;this.groups=groups;for(const [j,config] of configs)j.config=config;throw new Error('更改未保存：'+error.message);}finally{this.publish();}
  }
  move(id,{groupId,beforeId=null}={}){return this.change(async()=>{
    const j=this.get(id);groupId=groupId===undefined?j.config.groupId:groupId;this.checkGroup(groupId);
    if(beforeId!==null){const before=this.get(beforeId);if(before.config.groupId!==groupId)throw new Error('排序位置不属于所选分组');if(beforeId===id)return this.snapshot();}
    await this.metadata(()=>{
      const entries=[...this.jobs].filter(([key])=>key!==id);
      let index=beforeId===null?entries.findLastIndex(([,job])=>job.config.groupId===groupId)+1:entries.findIndex(([key])=>key===beforeId);
      if(beforeId===null&&index===0)index=entries.length;
      j.config={...j.config,groupId};entries.splice(index,0,[id,j]);this.jobs=new Map(entries);
    });return this.snapshot();
  });}
  saveGroup(value){return this.change(async()=>{
    const name=value?.name;if(typeof name!=='string'||!name.trim()||name.trim().length>80)throw new Error('请填写 1–80 字的组名');
    const id=value.id??randomUUID();if(value.id!==undefined&&!this.groups.has(id))throw new Error('分组不存在');
    if(!this.groups.has(id)&&this.groups.size>=50)throw new Error('最多创建 50 个分组');
    if([...this.groups.values()].some(g=>g.id!==id&&g.name===name.trim()))throw new Error('此组名已存在，请换一个名称');
    await this.metadata(()=>this.groups.set(id,{id,name:name.trim()}));return this.groupSnapshot();
  });}
  groupAction(id,action){return this.change(async()=>{
    if(!this.groups.has(id))throw new Error('分组不存在');
    const members=[...this.jobs.values()].filter(j=>j.config.groupId===id);
    if(action==='delete')await this.metadata(()=>{this.groups.delete(id);for(const j of members)j.config={...j.config,groupId:null};});
    else if(action==='pause'){await Promise.all(members.map(j=>this.halt(j)));this.publish();}
    else if(action==='start'){
      if(!members.length)throw new Error('此组还没有任务，请先将任务放入组内');
      const now=this.clock(),pending=members.filter(j=>!j.enabled);
      // Preflight every pending member before arming any timer. Existing runs
      // retain their original deadline, target and partially delivered command.
      for(const j of pending)try{this.checkStart(j,now);}catch(error){throw new Error(`「${j.config.name}」：${error.message}；本次未启动其他任务`);}
      for(const j of pending)this.arm(j,now,true);this.publish();
    }else throw new Error('未知分组操作');
    return this.snapshot();
  });}
  async save(value,target){
    const config=configuration(value);if(value.id!==undefined&&(typeof value.id!=='string'||value.id.length>100||!value.id))throw new Error('任务标识无效');const id=value.id||randomUUID();
    return this.change(async()=>{
      if(this.closing)throw new Error('正在退出，请稍后重试');
      const old=value.id?this.get(id):null;
      if(value.groupId===undefined&&old)config.groupId=old.config.groupId;
      this.checkGroup(config.groupId);
      if(!old&&this.jobs.size>=50)throw new Error('最多创建 50 个定时任务');
      target=target||old?.target||null;
      if(value.start){if(!target||!this.backend.hasTarget(target.id))throw new Error('请先绑定此任务的目标');if(config.mode==='once'&&config.at<=this.clock())throw new Error('发送时间需要晚于当前时间');}
      if(target&&!this.backend.hasTarget(target.id))throw new Error('目标已失效，请重新绑定');
      if(old)await this.halt(old);
      if(target)this.backend.retain(target.id);
      const label=target?[target.alias||target.sessionName||target.title||target.name,target.sessionAddress].filter(Boolean).join(' · '):old?.targetLabel||'';
      const j=this.entry(id,config,target?{...target}:null,label),before=new Map(this.jobs);this.jobs.set(id,j);
      try{await this.persist();}catch(error){this.jobs=before;if(target)this.backend.release(target.id);this.publish();throw new Error('任务未保存：'+error.message);}
      if(old?.target)this.backend.release(old.target.id);
      if(value.start)this.arm(j);this.publish();return this.snapshot();
    });
  }
  checkStart(j,now=this.clock()){
    if(this.closing)throw new Error('正在退出');
    if(!j.target||!this.backend.hasTarget(j.target.id))throw new Error('请先编辑任务并重新绑定目标');
    this.backend.deliveryInfo(j.target.id);
    if(j.config.mode==='once'&&j.config.at<=now)throw new Error('发送时间已过，请重新设置');
  }
  arm(j,now=this.clock(),checked=false){
    if(!checked)this.checkStart(j,now);
    j.enabled=true;j.error='';j.status='scheduled';j.generation++;j.nextAt=j.config.mode==='once'?j.config.at:now+j.config.periodMs;this.schedule(j);
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
  action(id,action){return this.change(async()=>{const j=this.get(id);if(action==='start'){if(!j.enabled){this.arm(j);}}else if(action==='pause')await this.halt(j);else if(action==='delete'){
    await this.halt(j);await this.metadata(()=>this.jobs.delete(id));if(j.target)this.backend.release(j.target.id);return this.snapshot();
  }else throw new Error('未知任务操作');try{await this.persist();}finally{this.publish();}return this.snapshot();});}
  async stopAll(){this.closing=true;await Promise.allSettled([...this.lanes.values()]);await Promise.all([...this.jobs.values()].map(j=>this.halt(j)));await this.writes.catch(()=>{});this.publish();}
  reopen(){this.closing=false;}
}
module.exports={ScheduleManager,configuration};
