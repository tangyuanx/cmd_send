'use strict';
const koffi=require('koffi');
const {randomUUID}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
function createBackend(){
  const ax=koffi.load('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices');
  const cf=koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  const proc=koffi.load('/usr/lib/libproc.dylib');
  const point=koffi.struct({x:'double',y:'double'}),psn=koffi.struct({high:'uint32_t',low:'uint32_t'});
  const api={
    trusted:ax.func('bool AXIsProcessTrusted()'),system:ax.func('void *AXUIElementCreateSystemWide()'),application:ax.func('void *AXUIElementCreateApplication(int32_t pid)'),
    at:ax.func('int32_t AXUIElementCopyElementAtPosition(void *element, float x, float y, _Out_ void **result)'),
    attr:ax.func('int32_t AXUIElementCopyAttributeValue(void *element, void *attribute, _Out_ void **result)'),
    set:ax.func('int32_t AXUIElementSetAttributeValue(void *element, void *attribute, void *value)'),
    action:ax.func('int32_t AXUIElementPerformAction(void *element, void *action)'),pid:ax.func('int32_t AXUIElementGetPid(void *element, _Out_ int32_t *pid)'),
    timeout:ax.func('int32_t AXUIElementSetMessagingTimeout(void *element, float timeout)'),
    str:cf.func('void *CFStringCreateWithCString(void *allocator, const char *text, uint32_t encoding)'),cstring:cf.func('bool CFStringGetCString(void *string, _Out_ char *buffer, int64_t length, uint32_t encoding)'),
    equal:cf.func('bool CFEqual(void *a, void *b)'),retain:cf.func('void *CFRetain(void *value)'),release:cf.func('void CFRelease(void *value)'),boolean:cf.func('void *CFNumberCreate(void *allocator, int type, const void *value)'),
    event:ax.func('void *CGEventCreate(void *source)'),location:ax.func('CGEventGetLocation',point,['void *']),button:ax.func('bool CGEventSourceButtonState(int state, uint32_t button)'),keyState:ax.func('bool CGEventSourceKeyState(int state, uint16_t key)'),
    keyboard:ax.func('void *CGEventCreateKeyboardEvent(void *source, uint16_t key, bool down)'),unicode:ax.func('void CGEventKeyboardSetUnicodeString(void *event, uint64_t length, const uint16_t *text)'),flags:ax.func('void CGEventSetFlags(void *event, uint64_t flags)'),post:ax.func('void CGEventPostToPid(int32_t pid, void *event)'),
    front:ax.func('int16_t GetFrontProcess(_Out_ void *psn)'),processPid:ax.func('int16_t GetProcessPID(const void *psn, _Out_ int32_t *pid)'),processFor:ax.func('int16_t GetProcessForPID(int32_t pid, _Out_ void *psn)'),activate:ax.func('int16_t SetFrontProcess(const void *psn)'),
    info:proc.func('int proc_pidinfo(int pid, int flavor, uint64_t arg, _Out_ void *buffer, int size)'),
  };
  const attributes=new Map();const targets=new Map();let excluded=new Set([process.pid]);
  const attr=name=>{if(!attributes.has(name))attributes.set(name,api.str(null,name,0x08000100));return attributes.get(name);};
  const boolTrue=koffi.decode(koffi.address(cf.symbol('kCFBooleanTrue')),'void *');
  const system=api.system();api.timeout(system,.2);
  function get(el,name){const out=[null];return api.attr(el,attr(name),out)===0?out[0]:null;}
  function string(el,name){const value=get(el,name);if(!value)return '';try{const out=Buffer.alloc(4096);return api.cstring(value,out,out.length,0x08000100)?out.toString('utf8').split('\0')[0]:'';}finally{api.release(value);}}
  function pidOf(el){const pid=[0];if(api.pid(el,pid)!==0)return 0;return pid[0];}
  function identity(pid){const buffer=Buffer.alloc(136);if(api.info(pid,3,0,buffer,buffer.length)!==136)throw new Error('目标进程已退出或无法访问');return {created:`${buffer.readBigUInt64LE(120)}:${buffer.readBigUInt64LE(128)}`,name:buffer.subarray(64,96).toString('utf8').split('\0')[0]||buffer.subarray(48,64).toString('utf8').split('\0')[0]};}
  function frontPid(){const p=Buffer.alloc(koffi.sizeof(psn)),pid=[0];return api.front(p)===0&&api.processPid(p,pid)===0?pid[0]:0;}
  function activate(pid){const p=Buffer.alloc(koffi.sizeof(psn));if(api.processFor(pid,p)!==0||api.activate(p)!==0)throw new Error('无法激活目标窗口，请检查系统权限');}
  function clear(){for(const target of targets.values()){api.release(target.element);api.release(target.window);api.release(target.app);}targets.clear();}
  function validate(id){
    const t=targets.get(id);if(!t)throw new Error('目标绑定已失效，请重新选择');
    if(!api.trusted())throw new Error('请在系统设置中允许「命令定向」使用辅助功能');
    if(identity(t.pid).created!==t.created||pidOf(t.element)!==t.pid||!string(t.window,'AXRole'))throw new Error('目标窗口已关闭或被替换，请重新绑定');
    return t;
  }
  function focused(t){const window=get(t.app,'AXFocusedWindow'),element=get(t.app,'AXFocusedUIElement');try{return !!window&&!!element&&api.equal(window,t.window)&&api.equal(element,t.element);}finally{if(window)api.release(window);if(element)api.release(element);}}
  function pick(){
    if(!api.trusted())throw new Error('请先在系统设置 → 隐私与安全性 → 辅助功能中允许「命令定向」');
    const event=api.event(null);let position;try{position=api.location(event);}finally{api.release(event);}
    const out=[null];if(api.at(system,position.x,position.y,out)!==0||!out[0])throw new Error('未识别到目标输入区');
    let hit=out[0],element=null,window=null;
    try{
      const pid=pidOf(hit);if(!pid||excluded.has(pid))throw new Error('不能将工具自身绑定为发送目标');
      window=get(hit,'AXWindow');
      for(let depth=0;hit&&depth<24;depth++){
        const role=string(hit,'AXRole');
        if(!element&&['AXTextArea','AXTextField','AXComboBox','AXSearchField'].includes(role))element=api.retain(hit);
        if(role==='AXWindow'){if(!window)window=api.retain(hit);break;}
        const parent=get(hit,'AXParent');api.release(hit);hit=parent;
      }
      if(!window||!element)throw new Error('此区域没有提供可识别的输入控件，请选择实际文本框或终端区域');
      const app=api.application(pid),processInfo=identity(pid);api.timeout(element,.2);api.timeout(window,.2);api.timeout(app,.2);
      const name=string(app,'AXTitle')||processInfo.name,title=string(window,'AXTitle'),detail=string(element,'AXRoleDescription')||string(element,'AXRole');
      clear();const id=randomUUID();targets.set(id,{id,pid,created:processInfo.created,element,window,app,name,title,detail});element=null;window=null;
      return {id,name,title,detail,strategy:'定向进程投递',verified:false};
    }finally{if(hit)api.release(hit);if(element)api.release(element);if(window)api.release(window);}
  }
  function post(t,text,key=0){
    validate(t.id);if(!focused(t))throw new Error('目标输入区已改变，已停止投递，请重新绑定');
    const units=text?Array.from({length:text.length},(_,i)=>text.charCodeAt(i)):null;
    for(const down of [true,false]){const event=api.keyboard(null,key,down);if(!event)throw new Error('系统未能创建键盘事件');try{api.flags(event,0);if(units)api.unicode(event,units.length,units);api.post(t.pid,event);}finally{api.release(event);}}
  }
  return {
    hasTarget:id=>targets.has(id),setExcludedPids:pids=>{excluded=new Set([process.pid,...pids]);},permission:()=>api.trusted(),mouseDown:()=>api.button(0,0),escapeDown:()=>api.keyState(0,53),pick,
    async prepare(id){const t=validate(id),previous=frontPid();try{if(!focused(t)){activate(t.pid);api.action(t.window,attr('AXRaise'));api.set(t.window,attr('AXMain'),boolTrue);api.set(t.element,attr('AXFocused'),boolTrue);await delay(70);}if(!focused(t))throw new Error('无法聚焦指定输入区，未发送任何内容');return {previous,activated:frontPid()===t.pid&&previous!==t.pid};}catch(error){if(previous&&previous!==t.pid&&frontPid()===t.pid)try{activate(previous);}catch{}throw error;}},
    character(id,char){post(validate(id),char);},enter(id){post(validate(id),null,36);},
    finish(id,context){const t=targets.get(id);if(context?.activated&&t&&frontPid()===t.pid&&context.previous){try{activate(context.previous);}catch{}}},
    dispose(){clear();api.release(system);for(const a of attributes.values())api.release(a);attributes.clear();},
  };
}
module.exports={createBackend};
