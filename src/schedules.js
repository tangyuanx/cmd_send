import {bindTargetDrag} from './target-drag.js';
import {validCommand} from './core.js';
const $=id=>document.getElementById(id);
const statuses={unbound:'待绑定',paused:'已暂停',scheduled:'已启用',waiting:'排队中',running:'发送中',completed:'已完成',failed:'失败',missed:'已错过'};
const time=value=>value?new Date(value).toLocaleString():'';
const label=t=>t?[t.alias||t.sessionName||t.title||t.name,t.sessionAddress,t.sessionPort?`端口 ${t.sessionPort}`:''].filter(Boolean).join(' · '):'选择目标';
const shortLabel=t=>t?.alias||t?.sessionAddress||t?.sessionName||t?.name||t?.title||'待绑定';
const pad=value=>String(value).padStart(2,'0');
function remaining(at){const seconds=Math.max(0,Math.ceil((at-Date.now())/1000));return `${pad(Math.floor(seconds/3600))}:${pad(Math.floor(seconds/60)%60)}:${pad(seconds%60)} 后发送`;}
export function initSchedules({desktop,initial,getTarget,getSource,getSettings,canPick,toast}){
  let jobs=initial,id=null,target=null,picking=false,busy=false,ticker=null;
  const dialog=$('schedulesDialog');
  function error(message=''){$('scheduleError').textContent=message;$('scheduleError').hidden=!message;}
  function renderTarget(){$('scheduleTargetLabel').textContent=picking?'拖到目标后释放':target?shortLabel(target):'选择目标';$('scheduleTarget').title=picking?'Esc 取消':label(target);}
  function setDate(date){
    $('scheduleDate').value=`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
    $('scheduleHour').value=pad(date.getHours());$('scheduleMinute').value=pad(date.getMinutes());$('scheduleSecond').value=pad(date.getSeconds());
  }
  function readDate(){
    const date=$('scheduleDate').value,h=$('scheduleHour').value,m=$('scheduleMinute').value,s=$('scheduleSecond').value;
    if(!date||![h,m,s].every(v=>/^\d{1,2}$/.test(v))||+h>23||+m>59||+s>59)return NaN;
    const value=new Date(`${date}T${pad(h)}:${pad(m)}:${pad(s)}`);
    // Reject nonexistent local times during daylight-saving clock changes.
    return value.getHours()===+h&&value.getMinutes()===+m&&value.getSeconds()===+s?value.getTime():NaN;
  }
  function mode(){
    const once=$('scheduleMode').value==='once';
    $('schedulePeriodRow').hidden=once;$('scheduleAtRow').hidden=!once;
    for(const name of ['scheduleDate','scheduleHour','scheduleMinute','scheduleSecond']){$(name).required=once;$(name).disabled=!once;}
    $('schedulePeriod').required=!once;$('schedulePeriod').disabled=once;$('scheduleUnit').disabled=once;
    $('schedulePresets').replaceChildren();
    for(const [text,amount,unit] of once?[['1 分钟后',1,60000],['5 分钟后',5,60000],['30 分钟后',30,60000],['1 小时后',1,3600000]]:[['5 秒',5,1000],['30 秒',30,1000],['1 分钟',1,60000],['5 分钟',5,60000],['30 分钟',30,60000]]){
      const button=document.createElement('button');button.type='button';button.textContent=text;
      button.addEventListener('click',()=>{if(once)setDate(new Date(Date.now()+amount*unit));else{$('schedulePeriod').value=String(amount);$('scheduleUnit').value=String(unit);durationLimit();}error();});$('schedulePresets').append(button);
    }
    durationLimit();
  }
  function durationLimit(){const unit=Number($('scheduleUnit').value);$('schedulePeriod').max=String(86400000/unit);$('schedulePeriod').min=String(1000/unit);$('schedulePeriod').step='any';}
  function updateRemaining(){
    for(const node of $('scheduleList').querySelectorAll('[data-next-at]'))node.textContent=remaining(Number(node.dataset.nextAt));
  }
  function render(){
    const list=$('scheduleList');list.replaceChildren();$('scheduleEmpty').hidden=jobs.length>0;
    const count=jobs.filter(j=>j.enabled).length;$('scheduleActiveCount').textContent=String(count);$('scheduleActiveCount').hidden=!count;
    for(const j of jobs){
      const row=document.createElement('article');row.className='schedule-job'+(id===j.id?' selected':'');row.dataset.job=j.id;
      const heading=document.createElement('div');heading.className='schedule-job-heading';
      const title=document.createElement('strong');title.textContent=j.name;title.title=j.name;
      const toggle=document.createElement('button');toggle.type='button';toggle.className='schedule-toggle';toggle.setAttribute('role','switch');toggle.setAttribute('aria-checked',String(j.enabled));toggle.setAttribute('aria-label',`${j.name}：${j.enabled?'暂停':'启动'}`);toggle.title=j.enabled?'暂停':'启动';toggle.disabled=busy||picking||(!j.enabled&&!j.target);toggle.addEventListener('click',()=>operate(j,j.enabled?'pause':'start'));heading.append(title,toggle);
      const state=document.createElement('div');state.className='schedule-job-state';state.dataset.status=j.status;
      const status=document.createElement('span');status.textContent=statuses[j.status]||j.status;
      const next=document.createElement('span');next.className='schedule-next';if(j.enabled&&j.nextAt)next.dataset.nextAt=String(j.nextAt);next.textContent=j.enabled&&j.nextAt?remaining(j.nextAt):'';next.title=j.nextAt?time(j.nextAt):j.lastAt?`上次 ${time(j.lastAt)}`:'';state.append(status,next);
      const footer=document.createElement('div');footer.className='schedule-job-footer';
      const info=document.createElement('span');info.className='schedule-job-target';info.textContent=j.target?shortLabel(j.target):j.targetLabel||'待绑定';info.title=j.target?label(j.target):j.targetLabel;
      footer.append(info);
      for(const [action,text] of [['edit','编辑'],['delete','删除']]){
        const button=document.createElement('button');button.type='button';button.textContent=text;button.dataset.action=action;button.disabled=busy||picking;button.addEventListener('click',()=>operate(j,action));footer.append(button);
      }
      row.append(heading,state,footer);
      if(j.error){const failure=document.createElement('p');failure.className='schedule-error';failure.textContent=j.error;row.append(failure);}
      list.append(row);
    }
  }
  async function edit(job=null){
    if(picking||busy)return;
    const source=job?null:getSource(),defaultTarget=getTarget();
    await desktop.releaseScheduleDraft?.();
    id=job?.id||null;target=job?.target||defaultTarget||null;const s=getSettings();
    $('scheduleName').value=job?.name||`定时任务 ${jobs.length+1}`;$('scheduleCommands').value=(job?.commands||source?.commands||[]).join('\n');
    $('scheduleMode').value=job?.mode==='once'?'once':'countdown';const period=job?.periodMs||5000,unit=period%3600000===0?3600000:period%60000===0?60000:1000;
    $('scheduleUnit').value=String(unit);$('schedulePeriod').value=String(period/unit);setDate(new Date(job?.at||Date.now()+60000));
    $('scheduleEnter').checked=job?.enter??s.enter;$('scheduleCommandInterval').value=job?.commandInterval??s.interval;$('scheduleCharacterInterval').value=job?.characterInterval??s.characterInterval;
    error();mode();renderTarget();render();
  }
  async function operate(job,action){
    if(busy||picking)return;if(action==='edit'){await edit(job);return;}
    busy=true;render();error();try{jobs=await desktop.scheduleAction(job.id,action);if(action==='delete'&&id===job.id){busy=false;await edit();}}catch(e){error(e.message);}finally{busy=false;render();}
  }
  async function pick(){
    if(picking||busy||!canPick())return;picking=true;error();renderTarget();render();
    try{const result=await desktop.pickTarget({scope:'schedule'});if(!result?.cancelled)target=result;}catch(e){error(e.message);}finally{picking=false;renderTarget();render();}
  }
  function cancelPick(){if(!picking)return;void desktop.cancelPick().catch(e=>error(e.message));}
  const drag=bindTargetDrag($('scheduleTarget'),{canStart:()=>!busy&&!picking&&canPick(),onDrag:pick,onCancel:cancelPick,onClick:()=>error('按住目标按钮，拖到目标输入区后释放。')});
  dialog.addEventListener('cancel',event=>{if(picking){event.preventDefault();drag.cancel();cancelPick();}});
  dialog.addEventListener('close',()=>{clearInterval(ticker);ticker=null;drag.cancel();cancelPick();void desktop.releaseScheduleDraft?.().catch(e=>toast(e.message));});
  $('schedulesButton').addEventListener('click',async()=>{if(!desktop.saveSchedule){toast('当前环境不支持定时发送');return;}await edit();if(!dialog.open){dialog.showModal();ticker=setInterval(updateRemaining,250);}});
  $('scheduleNew').addEventListener('click',()=>void edit());$('scheduleMode').addEventListener('change',mode);$('scheduleUnit').addEventListener('change',durationLimit);
  $('scheduleForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||picking)return;error();
    const commands=$('scheduleCommands').value.split(/\r?\n/).filter(c=>validCommand(c,getSettings().prefixes));
    if(!commands.length){error('请选择或输入有效指令');return;}
    const start=event.submitter?.id==='scheduleStart',once=$('scheduleMode').value==='once',at=once?readDate():null;
    const periodMs=Math.round(Number($('schedulePeriod').value)*Number($('scheduleUnit').value));
    if(once&&(!Number.isSafeInteger(at)||at<=Date.now())){error('发送时间需要晚于当前时间');return;}
    if(!once&&(!Number.isSafeInteger(periodMs)||periodMs<1000||periodMs>86400000)){error('倒计时需在 1 秒到 24 小时之间');return;}
    if(start&&!target){error('请先绑定发送目标');return;}
    const value={...(id?{id}:{}),name:$('scheduleName').value,commands,targetId:target?.id,targetAlias:target?.alias,mode:once?'once':'countdown',periodMs:once?5000:periodMs,at,enter:$('scheduleEnter').checked,commandInterval:Number($('scheduleCommandInterval').value),characterInterval:Number($('scheduleCharacterInterval').value),start};
    busy=true;$('scheduleSave').disabled=true;$('scheduleStart').disabled=true;render();
    try{const previous=new Set(jobs.map(j=>j.id));jobs=await desktop.saveSchedule(value);id=id||jobs.find(j=>!previous.has(j.id))?.id;toast(start?'定时任务已启动':'已保存');}
    catch(e){error(e.message);}finally{busy=false;$('scheduleSave').disabled=false;$('scheduleStart').disabled=false;render();}
  });
  desktop.onSchedules?.(value=>{jobs=value;render();});render();
}
