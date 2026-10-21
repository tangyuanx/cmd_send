import {bindTargetDrag} from './target-drag.js';
import {validCommand} from './core.js';
const $=id=>document.getElementById(id);
const statuses={unbound:'待重新绑定',paused:'已暂停',scheduled:'等待发送',waiting:'排队等待',running:'发送中',completed:'已完成',failed:'发送失败',missed:'已错过时间'};
const time=value=>value?new Date(value).toLocaleString():'';
const label=t=>t?[t.alias||t.sessionName||t.title||t.name,t.sessionAddress,t.sessionPort?`端口 ${t.sessionPort}`:'',t.sessionKey].filter(Boolean).join(' · '):'拖到目标输入区后释放';
export function initSchedules({desktop,initial,getTarget,getCommands,getSettings,canPick,toast,initIcons}){
  let jobs=initial,id=null,target=null,picking=false,busy=false;
  const dialog=$('schedulesDialog');
  function error(message=''){$('scheduleError').textContent=message;$('scheduleError').hidden=!message;}
  function renderTarget(){$('scheduleTargetLabel').textContent=picking?'拖到目标后释放 · Esc 取消':label(target);$('scheduleTarget').title=label(target);$('scheduleUseTarget').disabled=!getTarget()||picking;}
  function mode(){$('schedulePeriodRow').hidden=$('scheduleMode').value!=='interval';$('scheduleAtRow').hidden=$('scheduleMode').value!=='once';$('scheduleAt').required=$('scheduleMode').value==='once';$('schedulePeriod').required=$('scheduleMode').value==='interval';}
  function render(){
    const list=$('scheduleList');list.replaceChildren();$('scheduleEmpty').hidden=jobs.length>0;
    const count=jobs.filter(j=>j.enabled).length;$('scheduleActiveCount').textContent=String(count);$('scheduleActiveCount').hidden=!count;
    for(const j of jobs){
      const row=document.createElement('article');row.className='schedule-job'+(id===j.id?' selected':'');row.dataset.job=j.id;
      const title=document.createElement('strong');title.textContent=j.name;
      const info=document.createElement('p');info.textContent=j.target?label(j.target):(j.targetLabel?`${j.targetLabel} · 需重新绑定`:'尚未绑定目标');info.title=info.textContent;
      const state=document.createElement('p');state.className='schedule-job-state';state.textContent=`${statuses[j.status]||j.status} · 已发送 ${j.count} 轮`;
      const next=document.createElement('p');next.className='schedule-next';next.textContent=j.nextAt?`下次 ${time(j.nextAt)}`:j.lastAt?`上次 ${time(j.lastAt)}`:j.mode==='interval'?`间隔 ${j.periodMs/1000} 秒`:`指定 ${time(j.at)}`;
      row.append(title,info,state,next);
      if(j.error){const failure=document.createElement('p');failure.className='schedule-error';failure.textContent=j.error;row.append(failure);}
      const actions=document.createElement('div');actions.className='schedule-job-actions';
      for(const [action,text] of [[j.enabled?'pause':'start',j.enabled?'暂停':'启动'],['edit','编辑'],['delete','删除']]){
        const button=document.createElement('button');button.type='button';button.textContent=text;button.dataset.action=action;button.disabled=busy||picking||(action==='start'&&!j.target);button.addEventListener('click',()=>operate(j,action));actions.append(button);
      }
      row.append(actions);list.append(row);
    }
  }
  function importCommands(){const commands=getCommands();if(!commands.length){error('当前行或选区中没有可发送的指令');return;}$('scheduleCommands').value=commands.join('\n');error();}
  async function edit(job=null){
    if(picking||busy)return;await desktop.releaseScheduleDraft?.();
    id=job?.id||null;target=job?.target||getTarget()||null;const s=getSettings();
    $('scheduleName').value=job?.name||`定时任务 ${jobs.length+1}`;$('scheduleCommands').value=job?.commands.join('\n')||getCommands().join('\n');
    $('scheduleMode').value=job?.mode||'interval';const period=job?.periodMs||5000;const unit=period%3600000===0?3600000:period%60000===0?60000:1000;
    $('scheduleUnit').value=String(unit);$('schedulePeriod').value=String(period/unit);
    const date=new Date(job?.at||Date.now()+60000);$('scheduleAt').value=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,19);
    $('scheduleEnter').checked=job?.enter??s.enter;$('scheduleCommandInterval').value=job?.commandInterval??s.interval;$('scheduleCharacterInterval').value=job?.characterInterval??s.characterInterval;
    error();mode();renderTarget();render();
  }
  async function operate(job,action){
    if(busy||picking)return;if(action==='edit'){await edit(job);return;}
    busy=true;render();error();try{jobs=await desktop.scheduleAction(job.id,action);if(action==='delete'&&id===job.id){id=null;target=null;}}catch(e){error(e.message);}finally{busy=false;render();}
  }
  async function pick(){
    if(picking||busy||!canPick())return;picking=true;error();renderTarget();render();
    try{const result=await desktop.pickTarget({scope:'schedule'});if(!result?.cancelled)target=result;}catch(e){error(e.message);}finally{picking=false;renderTarget();render();}
  }
  function cancelPick(){if(!picking)return;void desktop.cancelPick().catch(e=>error(e.message));}
  const drag=bindTargetDrag($('scheduleTarget'),{canStart:()=>!busy&&!picking&&canPick(),onDrag:pick,onCancel:cancelPick,onClick:()=>error('按住此按钮，直接拖到目标窗口的输入区后释放；无需长按等待。')});
  dialog.addEventListener('cancel',event=>{if(picking){event.preventDefault();drag.cancel();cancelPick();}});
  dialog.addEventListener('close',()=>{drag.cancel();cancelPick();void desktop.releaseScheduleDraft?.().catch(e=>toast(e.message));});
  $('schedulesButton').addEventListener('click',async()=>{if(!desktop.saveSchedule){toast('当前环境不支持定时发送');return;}await edit(jobs.find(j=>j.id===id));if(!dialog.open)dialog.showModal();});
  $('scheduleNew').addEventListener('click',()=>void edit());$('scheduleMode').addEventListener('change',mode);$('scheduleImport').addEventListener('click',importCommands);
  $('scheduleUseTarget').addEventListener('click',async()=>{if(picking||busy)return;await desktop.releaseScheduleDraft?.();target=getTarget();renderTarget();error();});
  $('scheduleForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||picking)return;error();
    const commands=$('scheduleCommands').value.split(/\r?\n/).filter(c=>validCommand(c,getSettings().prefixes));
    const start=event.submitter?.id==='scheduleStart';
    if(start&&!target){error('请先拖选目标，或使用顶部已绑定的目标');return;}
    const value={...(id?{id}:{}),name:$('scheduleName').value,commands,targetId:target?.id,targetAlias:target?.alias,mode:$('scheduleMode').value,periodMs:Math.round(Number($('schedulePeriod').value)*Number($('scheduleUnit').value)),at:new Date($('scheduleAt').value).getTime(),enter:$('scheduleEnter').checked,commandInterval:Number($('scheduleCommandInterval').value),characterInterval:Number($('scheduleCharacterInterval').value),start};
    busy=true;$('scheduleSave').disabled=true;$('scheduleStart').disabled=true;render();
    try{const previous=new Set(jobs.map(j=>j.id));jobs=await desktop.saveSchedule(value);id=id||jobs.find(j=>!previous.has(j.id))?.id;toast(start?'定时任务已启动':'已保存，任务处于暂停状态');}
    catch(e){error(e.message);}finally{busy=false;$('scheduleSave').disabled=false;$('scheduleStart').disabled=false;render();}
  });
  desktop.onSchedules?.(value=>{jobs=value;render();});render();
}
