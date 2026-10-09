'use strict';
const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');

// The queue owns the frozen snapshot. The renderer can only pause, resume or stop it.
class SendQueue extends EventEmitter {
  constructor(backend,{characterDelay=8,clock=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout}={}) {
    super();Object.assign(this,{backend,characterDelay,clock,setTimer,clearTimer});this.run=null;this.activeSteps=new Set();this.stopPromise=null;
  }
  start({commands,targetId,interval=500,rounds=1,enter=true}) {
    if(this.run||this.stopPromise||this.activeSteps.size)throw new Error('当前发送任务尚未结束，请稍后再试');
    if(!Array.isArray(commands)||!commands.length||commands.length>10000||commands.some(c=>typeof c!=='string'||!c.trim()||c.length>100000||/[\r\n\0]/u.test(c)))throw new Error('发送内容无效');
    if(commands.reduce((bytes,c)=>bytes+Buffer.byteLength(c,'utf8'),0)>20*1024*1024)throw new Error('发送内容不能超过 20 MB');
    if(typeof targetId!=='string'||!this.backend.hasTarget(targetId))throw new Error('请选择有效的目标输入区');
    if(!Number.isInteger(interval)||interval<50||interval>600000)throw new Error('发送间隔需在 50–600000 ms 之间');
    if(rounds!=='loop'&&(!Number.isInteger(rounds)||rounds<1||rounds>100000))throw new Error('重复次数需在 1–100000 之间');
    const r={id:randomUUID(),commands:Object.freeze(commands.map(c=>Object.freeze(Array.from(c)))),targetId,interval,rounds:rounds==='loop'?Infinity:rounds,enter:!!enter,index:0,round:0,char:0,total:0,phase:'prepare',paused:false,timer:null,remaining:0,deadline:0,busy:false,restore:null};
    this.run=r;this.publish('started');this.schedule(0);return {id:r.id};
  }
  state(type,error){const r=this.run;return r?{type,id:r.id,index:r.index,commandCount:r.commands.length,round:r.round+1,rounds:Number.isFinite(r.rounds)?r.rounds:null,total:r.total,paused:r.paused,error}:null;}
  publish(type,error){const state=this.state(type,error);if(state)this.emit('state',state);}
  schedule(ms){const r=this.run;if(!r||r.paused)return;r.remaining=ms;r.deadline=this.clock()+ms;r.timer=this.setTimer(()=>{r.timer=null;void this.step(r);},ms);}
  async step(r){
    if(this.run!==r||r.paused||r.busy)return;r.busy=true;
    r.busyDone=new Promise(resolve=>r.resolveBusy=resolve);this.activeSteps.add(r);
    try {
      if(r.phase==='prepare') {
        r.restore=await this.backend.prepare(r.targetId);
        if(this.run!==r){await this.backend.finish(r.targetId,r.restore);return;}
        r.phase='typing';
      } else if(r.phase==='typing') {
        await this.backend.character(r.targetId,r.commands[r.index][r.char]);if(this.run!==r)return;r.char++;
        if(r.char===r.commands[r.index].length)r.phase='finish';
      } else if(r.phase==='finish') {
        if(r.enter)await this.backend.enter(r.targetId);
        if(this.run!==r)return;
        await this.backend.finish(r.targetId,r.restore);if(this.run!==r)return;r.restore=null;r.total++;r.index++;r.char=0;
        if(r.index===r.commands.length){r.index=0;r.round++;}
        if(r.round>=r.rounds){const done=this.state('completed');this.run=null;this.emit('state',done);return;}
        r.phase='wait';
      } else if(r.phase==='wait') {r.phase='prepare';}
      if(this.run!==r)return;
      this.publish('progress');
      // Wait once between commands (including crossing a round), never before the first.
      const delay=r.phase==='wait'?r.interval:r.phase==='typing'?this.characterDelay:0;
      if(r.paused)r.remaining=delay;else this.schedule(delay);
    } catch(error) {
      if(this.run!==r)return;
      const failed=this.state('failed',String(error.message||error));this.run=null;
      try{await this.backend.finish(r.targetId,r.restore);}catch{}
      this.emit('state',failed); // Never retry a possibly delivered character or Enter.
    } finally {r.busy=false;this.activeSteps.delete(r);r.resolveBusy();}
  }
  pause(){const r=this.run;if(!r||r.paused)return;r.remaining=Math.max(0,r.deadline-this.clock());if(r.timer!==null)this.clearTimer(r.timer);r.timer=null;r.paused=true;this.publish('paused');}
  resume(){const r=this.run;if(!r||!r.paused)return;r.paused=false;this.publish('resumed');if(!r.busy)this.schedule(r.remaining);}
  stop(){
    if(this.stopPromise)return this.stopPromise;
    const r=this.run,stopped=r?this.state('stopped'):null;this.run=null;
    if(r?.timer!==null&&r?.timer!==undefined)this.clearTimer(r.timer);
    const pending=[...this.activeSteps].map(step=>step.busyDone);
    this.stopPromise=(async()=>{
      if(r)try{await this.backend.finish(r.targetId,r.restore);}catch{}
      // Native resources must remain alive until all outstanding calls have settled.
      await Promise.all(pending);if(stopped)this.emit('state',stopped);
    })().finally(()=>{this.stopPromise=null;});
    return this.stopPromise;
  }
}
module.exports={SendQueue};
