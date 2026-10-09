'use strict';
const koffi=require('koffi');
const {AutomationWorker}=require('./windows-uia.cjs');
const {randomUUID}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
function createBackend(){
  const user=koffi.load('user32.dll'),kernel=koffi.load('kernel32.dll');
  const POINT=koffi.struct('CmdWinPoint',{x:'int32_t',y:'int32_t'});
  const RECT=koffi.struct('CmdWinRect',{left:'int32_t',top:'int32_t',right:'int32_t',bottom:'int32_t'});
  const GUI=koffi.struct('CmdWinGui',{cbSize:'uint32_t',flags:'uint32_t',active:'void *',focus:'void *',capture:'void *',menuOwner:'void *',moveSize:'void *',caret:'void *',caretRect:RECT});
  const api={
    cursor:user.func('int __stdcall GetCursorPos(_Out_ CmdWinPoint *point)'),fromPoint:user.func('void * __stdcall WindowFromPoint(CmdWinPoint point)'),ancestor:user.func('void * __stdcall GetAncestor(void *window, uint32_t flags)'),
    pid:user.func('uint32_t __stdcall GetWindowThreadProcessId(void *window, _Out_ uint32_t *pid)'),valid:user.func('int __stdcall IsWindow(void *window)'),enabled:user.func('int __stdcall IsWindowEnabled(void *window)'),
    className:user.func('int __stdcall GetClassNameW(void *window, _Out_ uint16_t *text, int length)'),title:user.func('int __stdcall GetWindowTextW(void *window, _Out_ uint16_t *text, int length)'),
    style:user.func('intptr_t __stdcall GetWindowLongPtrW(void *window, int index)'),
    gui:user.func('int __stdcall GetGUIThreadInfo(uint32_t thread, _Inout_ CmdWinGui *info)'),foreground:user.func('void * __stdcall GetForegroundWindow()'),activate:user.func('int __stdcall SetForegroundWindow(void *window)'),focus:user.func('void * __stdcall SetFocus(void *window)'),
    attach:user.func('int __stdcall AttachThreadInput(uint32_t from, uint32_t to, int attach)'),child:user.func('int __stdcall IsChild(void *parent, void *child)'),show:user.func('int __stdcall ShowWindow(void *window, int command)'),
    key:user.func('int16_t __stdcall GetAsyncKeyState(int key)'),post:user.func('intptr_t __stdcall SendMessageTimeoutW(void *window, uint32_t msg, uintptr_t wp, intptr_t lp, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *result)'),
    input:user.func('uint32_t __stdcall SendInput(uint32_t count, const void *inputs, int size)'),
    open:kernel.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),times:kernel.func('int __stdcall GetProcessTimes(void *process, _Out_ uint64_t *created, _Out_ uint64_t *exit, _Out_ uint64_t *kernel, _Out_ uint64_t *user)'),
    path:kernel.func('int __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, _Out_ uint16_t *name, _Inout_ uint32_t *size)'),close:kernel.func('int __stdcall CloseHandle(void *handle)'),thread:kernel.func('uint32_t __stdcall GetCurrentThreadId()'),error:kernel.func('uint32_t __stdcall GetLastError()'),
  };
  const targets=new Map(),worker=new AutomationWorker();let excluded=new Set([process.pid]);
  const pointer=p=>p==null?'0':String(koffi.address(p));
  function pidOf(window){const out=[0],thread=api.pid(window,out);return {pid:out[0],thread};}
  function text(window,fn){const buf=Buffer.alloc(2048);const length=fn(window,buf,1024);return buf.subarray(0,Math.max(0,length)*2).toString('utf16le');}
  function identity(pid){const h=api.open(0x1000,0,pid);if(!h)throw new Error('无法读取目标进程，可能需要同等权限启动');try{const created=[0n],exit=[0n],kernelTime=[0n],userTime=[0n];if(!api.times(h,created,exit,kernelTime,userTime))throw new Error('目标进程已失效');const buffer=Buffer.alloc(65536),size=[32768];const hasPath=api.path(h,0,buffer,size);return {created:String(created[0]),name:hasPath?buffer.subarray(0,size[0]*2).toString('utf16le').split('\\').pop().replace(/\.exe$/i,''):`进程 ${pid}`};}finally{api.close(h);}}
  function validate(id){const t=targets.get(id);if(!t)throw new Error('目标绑定已失效');const current=pidOf(t.element);if(!api.valid(t.element)||!api.valid(t.window)||!api.enabled(t.element)||current.pid!==t.pid||current.thread!==t.thread||identity(t.pid).created!==t.created||text(t.element,api.className)!==t.className)throw new Error('目标窗口已关闭或被替换，请重新绑定');if(t.background&&(BigInt(api.style(t.element,-16))&0x800n)!==0n)throw new Error('目标输入区为只读');return t;}
  function gui(thread){const info={cbSize:koffi.sizeof(GUI)};if(!api.gui(thread,info))throw new Error('目标输入区不可访问');return info;}
  function focused(t){const info=gui(t.thread);return pointer(info.focus)===pointer(t.element)||api.child(t.element,info.focus)!==0;}
  async function pick(){
    const point={};if(!api.cursor(point))throw new Error('无法读取指针位置');const element=api.fromPoint(point);if(!element)throw new Error('未找到目标窗口');
    const window=api.ancestor(element,2),{pid,thread}=pidOf(element);if(!window||!pid||excluded.has(pid))throw new Error('不能将工具自身绑定为目标');
    const className=text(element,api.className),processInfo=identity(pid),id=randomUUID();const background=/^(Edit|RichEdit\w*)$/i.test(className);
    const automation=background?null:await worker.call('pick',{x:point.x,y:point.y,processId:pid});
    const t={id,element,window,pid,thread,className,created:processInfo.created,background,automation,epoch:0};targets.set(id,t);
    try{validate(id);if(automation)await worker.call('commit',{targetId:automation.targetId});}catch(error){targets.delete(id);throw error;}
    for(const key of targets.keys())if(key!==id)targets.delete(key);
    return {id,name:processInfo.name,title:text(window,api.title),detail:automation?.detail||className,strategy:background?'后台文本输入':'具体控件聚焦输入',verified:false};
  }
  function unicode(char,key=0){const units=char?Array.from({length:char.length},(_,i)=>char.charCodeAt(i)):[null];for(const unit of units){const bytes=Buffer.alloc(80);for(let i=0;i<2;i++){const offset=i*40;bytes.writeUInt32LE(1,offset);bytes.writeUInt16LE(unit===null?key:0,offset+8);bytes.writeUInt16LE(unit===null?0:unit,offset+10);bytes.writeUInt32LE((unit===null?0:4)+(i===1?2:0),offset+12);}const sent=api.input(2,bytes,40);if(sent!==2)throw new Error('投递未完成，可能存在权限限制；已停止且不会自动重试');}}
  function modifiers(){return [16,17,18,91,92].some(key=>(api.key(key)&0x8000)!==0);}
  async function send(id,char,key=0){
    const t=validate(id),epoch=t.epoch;
    if(t.background){for(const unit of Array.from({length:char?.length||1},(_,i)=>char?char.charCodeAt(i):13)){const result=[0];if(!api.post(t.element,0x0102,unit,1,0x0002|0x0020,300,result))throw new Error(`后台投递失败（系统错误 ${api.error()}），已停止且不会重试`);}}
    else{await worker.call('verify',{targetId:t.automation.targetId});if(t.epoch!==epoch)throw new Error('发送已取消');validate(id);if(pointer(api.foreground())!==pointer(t.window))throw new Error('目标窗口已失去焦点，已停止投递');if(modifiers())throw new Error('检测到修饰键按下，已停止投递');unicode(char,key);}
  }
  return {
    hasTarget:id=>targets.has(id),setExcludedPids:pids=>{excluded=new Set([process.pid,...pids]);},permission:()=>true,mouseDown:()=>(api.key(1)&0x8000)!==0,escapeDown:()=>(api.key(27)&0x8000)!==0,pick,
    async prepare(id){
      const t=validate(id);if(t.background)return {background:true};const previous=api.foreground(),epoch=t.epoch;
      try{const deadline=Date.now()+2000;while(modifiers()){if(t.epoch!==epoch||Date.now()>deadline)throw new Error('请先松开修饰键，再重新发送');await delay(20);}if(t.epoch!==epoch)throw new Error('发送已取消');api.show(t.window,9);api.activate(t.window);await worker.call('focus',{targetId:t.automation.targetId});await delay(70);await worker.call('verify',{targetId:t.automation.targetId});
        if(t.epoch!==epoch||pointer(api.foreground())!==pointer(t.window))throw new Error('无法聚焦指定输入区，未发送任何内容');return {previous};
      }catch(error){if(api.valid(previous)&&pointer(api.foreground())===pointer(t.window))api.activate(previous);throw error;}
    },
    character(id,char){send(id,char);},enter(id){send(id,null,13);},
    finish(id,context){const t=targets.get(id);if(t)t.epoch++;if(t&&context?.previous&&api.valid(context.previous)&&pointer(api.foreground())===pointer(t.window))api.activate(context.previous);},dispose(){worker.dispose();targets.clear();},
  };
}
module.exports={createBackend};
