'use strict';
// Independent background targets run concurrently. A complete command owns
// its input area and, when needed, the single system foreground input stream.
class DeliveryBroker {
  constructor(backend){this.backend=backend;this.held=new Set();this.waiters=[];}
  acquire(keys,signal,onWait){
    return new Promise((resolve,reject)=>{
      const item={keys,resolve,reject,signal};
      item.abort=()=>{const i=this.waiters.indexOf(item);if(i>=0)this.waiters.splice(i,1);reject(new Error('发送已取消'));this.pump();};
      if(signal.aborted){item.abort();return;}
      signal.addEventListener('abort',item.abort,{once:true});this.waiters.push(item);this.pump();
      if(this.waiters.includes(item))onWait?.();
    });
  }
  pump(){
    const blocked=new Set();
    for(const item of [...this.waiters]){
      if(item.keys.some(k=>this.held.has(k)||blocked.has(k))){item.keys.forEach(k=>blocked.add(k));continue;}
      this.waiters.splice(this.waiters.indexOf(item),1);item.signal.removeEventListener('abort',item.abort);item.keys.forEach(k=>this.held.add(k));
      let released=false;item.resolve(()=>{if(released)return;released=true;item.keys.forEach(k=>this.held.delete(k));this.pump();});
    }
  }
  channel({onWait,onActive}={}){
    const backend=this.backend,broker=this;let current=null;
    const calls=new Set();
    const track=fn=>{const promise=Promise.resolve().then(fn);calls.add(promise);promise.finally(()=>calls.delete(promise)).catch(()=>{});return promise;};
    return {
      hasTarget:id=>backend.hasTarget(id),
      async prepare(id){
        if(current)throw new Error('此发送通道尚未结束');
        const info=backend.deliveryInfo(id),controller=new AbortController();
        let settle;const t={id,controller,closed:false,native:false,context:null,release:null,ready:new Promise(r=>settle=r),done:null};current=t;
        try{
          t.release=await broker.acquire(['target:'+info.key,...(info.background?[]:['foreground'])],controller.signal,onWait);
          if(t.closed)throw new Error('发送已取消');
          onActive?.();t.native=true;t.context=await backend.prepare(id);
          if(t.closed)throw new Error('发送已取消');
          return {ticket:t};
        }finally{settle();}
      },
      character:(id,c)=>track(()=>backend.character(id,c)),enter:id=>track(()=>backend.enter(id)),
      finish(id,context){
        const t=context?.ticket||current;if(!t)return Promise.resolve();if(t.done)return t.done;
        t.closed=true;t.controller.abort();
        t.done=(async()=>{
          let finishedContext,error;
          try{
            // Invalidate an in-flight native prepare/verify before waiting for
            // it. Never touch the native target if this channel only queued.
            if(t.native){finishedContext=t.context;try{await backend.finish(id,t.context);}catch(e){error=e;}}
            await t.ready;await Promise.allSettled([...calls]);
            if(t.native&&t.context&&t.context!==finishedContext)try{await backend.finish(id,t.context);}catch(e){error||=e;}
            if(error)throw error;
          }finally{t.release?.();if(current===t)current=null;}
        })();return t.done;
      }
    };
  }
}
module.exports={DeliveryBroker};
