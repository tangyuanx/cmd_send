// Isolated renderer fixture; never imported by the desktop application.
export const text='[环境准备]\n# 检查设备与驱动信息\nuname -a\nlspci | grep -i ethernet\nethtool -i eth0\n\n[网络调试]\n# 查看接口状态和链路统计\nip addr show eth0\nethtool eth0\nip -s link show eth0\n\n[性能测试]\n# 检查收发队列与中断分布\nethtool -l eth0\ncat /proc/interrupts | grep eth0\n\n[常用指令]\ndmesg | tail -n 30\n';
export function desktopFixture({text,version}) {
 let queue,updates,scheduled,jobs=[],pin=false,pickCount=0;
 const target={id:'demo-target',name:'MobaXterm',sessionName:'开发板 · SSH',sessionAddress:'192.168.1.10',sessionPort:22,sessionKey:'PID 4820 · 输入区 276',detail:'MoTTY',strategy:'后台终端输入'};
 const noop=()=>{},done=async()=>{};
 window.uiCaptures={plans:[],saves:[]};
 window.desktop={
  config:async()=>({platform:'win32',window:{maximized:false,fullscreen:false},update:{phase:'idle',currentVersion:version,supported:false},session:{activeId:'demo',files:[{id:'demo',name:'开发板调试.txt',text},{id:'other',name:'快速验证.txt',text:'[验证]\necho Hello, Cmd Send\necho 输入测试'}]},schedules:[]}),
  openFiles:async()=>[],closeFile:done,
  saveFile:async(id,text)=>{window.uiCaptures.saves.push({id,text});return {};},
  pickTarget:async()=>({...target,id:'demo-target-'+(++pickCount)}),cancelPick:done,
  start:async plan=>{window.uiCaptures.plans.push(plan);return {id:'ui-run'};},
  stop:async()=>queue?.({id:'ui-run',type:'stopped',total:0}),pause:done,resume:done,
  onQueue:callback=>queue=callback,
  togglePin:async()=>pin=!pin,minimize:done,toggleMaximize:done,closeWindow:done,closeResponse:done,
  openAccessibility:done,onOpen:noop,onSave:noop,onClose:noop,onWindowState:noop,
  onUpdate:callback=>updates=callback,checkUpdate:async()=>({phase:'current',currentVersion:version,supported:false}),
  saveSchedule:async value=>{const job={...value,id:value.id||'demo-job-'+jobs.length,enabled:value.start,status:value.start?'scheduled':'paused',nextAt:Date.now()+value.periodMs,target};jobs=jobs.filter(j=>j.id!==job.id).concat(job);scheduled?.(jobs);return jobs;},
  scheduleAction:async(id,action)=>{jobs=action==='delete'?jobs.filter(j=>j.id!==id):jobs.map(j=>j.id!==id?j:{...j,enabled:action==='start',status:action==='start'?'scheduled':'paused',nextAt:Date.now()+j.periodMs});scheduled?.(jobs);return jobs;},
  releaseScheduleDraft:done,onSchedules:callback=>scheduled=callback,
 };
 window.uiQueue=event=>queue?.(event);
 window.uiUpdate=event=>updates?.(event);
}
