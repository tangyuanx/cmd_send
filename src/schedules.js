import {bindTargetDrag} from './target-drag.js';
import {validCommand} from './core.js';
const $=id=>document.getElementById(id);
const statuses={unbound:'待绑定',paused:'已暂停',scheduled:'已启用',waiting:'排队中',running:'发送中',completed:'已完成',failed:'失败',missed:'已错过'};
const time=value=>value?new Date(value).toLocaleString():'';
function targetLabel(target){
  const {alias,name,title,sessionName,sessionAddress,sessionPort}=target;
  const address=sessionAddress?.includes(':')&&sessionPort?`[${sessionAddress}]`:sessionAddress;
  const endpoint=address?`${address}${sessionPort?`:${sessionPort}`:''}`:sessionName;
  return [...new Set([alias||name||title,endpoint].filter(Boolean))].join(' · ')||'已绑定';
}
const pad=value=>String(value).padStart(2,'0');
const presets={
  countdown:[['5 秒',5000,1000],['30 秒',30000,1000],['1 分钟',60000,60000],['5 分钟',300000,60000],['30 分钟',1800000,60000]],
  once:[['1 分钟后',60000],['5 分钟后',300000],['30 分钟后',1800000],['1 小时后',3600000]]
};
function remaining(at){const seconds=Math.max(0,Math.ceil((at-Date.now())/1000));return `${pad(Math.floor(seconds/3600))}:${pad(Math.floor(seconds/60)%60)}:${pad(seconds%60)} 后发送`;}
export function initSchedules({desktop,initial,initialGroups=[],icon,getSource,getSettings,canPick,toast}){
  let jobs=initial,groups=initialGroups,id=null,target=null,picking=false,busy=false,ticker=null,groupEditId=null,dragId=null,dragSource=null,dropPosition=null;
  const dialog=$('schedulesDialog');
  const collapsedGroups=new Set();
  function error(message=''){$('scheduleError').textContent=message;$('scheduleError').hidden=!message;}
  function renderTarget(){
    const button=$('scheduleTarget');
    const name=picking?'拖到目标后释放':target?targetLabel(target):'未绑定';
    $('scheduleTargetLabel').textContent=name;
    button.dataset.bound=String(Boolean(target));
    button.setAttribute('aria-label',`发送目标：${name}`);
    button.title=picking?'Esc 取消':target?`${name}\n按住拖动可更换`:'按住并拖到目标输入区';
  }
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
    $('schedulePresets').replaceChildren(new Option('快捷时间',''),...presets[$('scheduleMode').value].map(([text,ms])=>new Option(text,String(ms))));
    durationLimit();
  }
  $('schedulePresets').addEventListener('change',event=>{
    const select=event.currentTarget,mode=$('scheduleMode').value;
    const preset=presets[mode].find(([,ms])=>ms===Number(select.value));
    if(!preset)return;
    const [,ms,unit]=preset;
    if(mode==='once')setDate(new Date(Date.now()+ms));
    else{
      $('schedulePeriod').value=String(ms/unit);$('scheduleUnit').value=String(unit);durationLimit();
    }
    select.value='';error();
  });
  function durationLimit(){const unit=Number($('scheduleUnit').value);$('schedulePeriod').max=String(86400000/unit);$('schedulePeriod').min=String(1000/unit);$('schedulePeriod').step='any';}
  function updateRemaining(){
    for(const node of $('scheduleList').querySelectorAll('[data-next-at]'))node.textContent=remaining(Number(node.dataset.nextAt));
  }
  function groupError(message=''){$('scheduleGroupError').textContent=message;$('scheduleGroupError').hidden=!message;}
  function groupOptions(){
    const select=$('scheduleGroup'),value=select.value;select.replaceChildren(new Option('未分组',''),...groups.map(g=>new Option(g.name,g.id)));select.value=groups.some(g=>g.id===value)?value:'';
  }
  function editGroup(group=null){
    if(busy||picking)return;groupEditId=group?.id||null;$('scheduleGroupName').value=group?.name||'';$('scheduleGroupDelete').hidden=!group;$('scheduleGroupForm').hidden=false;groupError();$('scheduleGroupName').focus();
  }
  async function groupAction(group,action){
    if(busy||picking)return;busy=true;render();error();groupError();
    try{jobs=await desktop.scheduleGroupAction(group.id,action);if(action==='delete'){$('scheduleGroupForm').hidden=true;groupEditId=null;}toast(action==='start'?'组内任务已开启':action==='pause'?'组内任务已暂停':'分组已删除，任务已移到未分组');}
    catch(e){if(action==='delete')groupError(e.message);else error(e.message);toast(e.message);}finally{busy=false;render();}
  }
  function clearDrop(){dropPosition=null;for(const node of $('scheduleList').querySelectorAll('.drop-before,.drop-after,.drop-group'))node.classList.remove('drop-before','drop-after','drop-group');}
  function endDrag(){dragId=null;dragSource=null;clearDrop();render();}
  async function moveTask(job,position,keyboard=false){
    if(busy||picking)return;busy=true;render();error();
    try{
      jobs=await desktop.moveSchedule(job.id,position);
      collapsedGroups.delete(position.groupId);
      if(id===job.id)$('scheduleGroup').value=position.groupId||'';
      $('scheduleOrderStatus').textContent=`已移动「${job.name}」并保存顺序`;
    }
    catch(e){error(e.message);toast(e.message);}finally{busy=false;render();if(keyboard)[...$('scheduleList').querySelectorAll('[data-drag-handle]')].find(n=>n.dataset.dragHandle===job.id)?.focus();}
  }
  function renderJob(j,parent){
    const row=document.createElement('article');row.className='schedule-job'+(id===j.id?' selected':'');row.dataset.job=j.id;
    const handle=document.createElement('button');handle.type='button';handle.className='schedule-drag-handle';handle.dataset.dragHandle=j.id;handle.dataset.focusKey='move:'+j.id;handle.draggable=!busy&&!picking;handle.disabled=busy||picking;handle.title='拖动排序；Alt + 上/下移动';handle.setAttribute('aria-label',`移动 ${j.name}`);
    handle.setAttribute('aria-keyshortcuts','Alt+ArrowUp Alt+ArrowDown');
    handle.innerHTML='<svg viewBox="0 0 16 20" aria-hidden="true" fill="currentColor"><circle cx="5" cy="5" r="1"/><circle cx="11" cy="5" r="1"/><circle cx="5" cy="10" r="1"/><circle cx="11" cy="10" r="1"/><circle cx="5" cy="15" r="1"/><circle cx="11" cy="15" r="1"/></svg>';
    handle.addEventListener('dragstart',event=>{if(busy||picking){event.preventDefault();return;}dragId=j.id;dragSource=handle;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',j.id);event.dataTransfer.setDragImage(row,12,12);});
    // A cancelled Windows native drag can finish after the list has rerendered.
    // An old source must never clear a newer drag's destination.
    handle.addEventListener('dragend',()=>{if(dragSource===handle)endDrag();});
    handle.addEventListener('keydown',event=>{
      if(!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key)||busy||picking)return;event.preventDefault();
      const members=jobs.filter(x=>(x.groupId||null)===(j.groupId||null)),index=members.findIndex(x=>x.id===j.id),up=event.key==='ArrowUp';
      if(up?index>0:index<members.length-1)void moveTask(j,{groupId:j.groupId||null,beforeId:up?members[index-1].id:members[index+2]?.id||null},true);
    });
    const title=document.createElement('strong');title.textContent=j.name;title.title=j.name;
    const editButton=document.createElement('button');editButton.type='button';editButton.className='schedule-job-name';editButton.title=j.name;
    editButton.setAttribute('aria-label',`编辑 ${j.name}`);editButton.dataset.focusKey='edit:'+j.id;
    if(id===j.id)editButton.setAttribute('aria-current','true');
    editButton.disabled=busy||picking;editButton.addEventListener('click',()=>operate(j,'edit'));
    const toggle=document.createElement('button');toggle.type='button';toggle.className='schedule-toggle';toggle.dataset.focusKey='toggle:'+j.id;toggle.setAttribute('role','switch');toggle.setAttribute('aria-checked',String(j.enabled));toggle.setAttribute('aria-label',`${j.name}：${j.enabled?'暂停':'启动'}`);toggle.title=j.enabled?'暂停':'启动';toggle.disabled=busy||picking||(!j.enabled&&!j.target);toggle.addEventListener('click',()=>operate(j,j.enabled?'pause':'start'));
    const state=document.createElement('span');state.className='schedule-job-state';state.dataset.status=j.status;
    const status=document.createElement('span');status.textContent=statuses[j.status]||j.status;
    status.title=j.lastAt?`上次 ${time(j.lastAt)}`:'';
    const next=document.createElement('span');next.className='schedule-next';
    state.append(status);
    if(j.enabled&&j.nextAt){
      const clock=document.createElement('span');clock.className='schedule-clock';clock.innerHTML=icon('clock');
      next.dataset.nextAt=String(j.nextAt);next.textContent=remaining(j.nextAt);next.title=time(j.nextAt);state.append(clock);
    }
    state.append(next);
    const info=document.createElement('span');info.className='schedule-job-target';
    const targetIcon=document.createElement('span');targetIcon.innerHTML=icon('arrowUpRight');
    const destination=document.createElement('span');destination.textContent=j.target?targetLabel(j.target):j.targetLabel||'未绑定';
    info.classList.toggle('unbound',!j.target&&!j.targetLabel);info.append(targetIcon,destination);
    editButton.append(title,info);
    if(j.target||j.targetLabel)editButton.append(state);
    row.append(handle,editButton,toggle);
    if(j.error){const failure=document.createElement('p');failure.className='schedule-error';failure.textContent=j.error;row.append(failure);}parent.append(row);
  }
  function renderGroupHeading(group,members,rows){
    const heading=document.createElement('div');heading.className='schedule-group-heading';
    const fold=document.createElement('button');fold.type='button';fold.className='schedule-group-fold';fold.dataset.focusKey='fold:'+group.id;
    fold.setAttribute('aria-expanded',String(!rows.hidden));fold.setAttribute('aria-controls',rows.id);
    fold.addEventListener('click',()=>{
      if(collapsedGroups.has(group.id))collapsedGroups.delete(group.id);else collapsedGroups.add(group.id);
      rows.hidden=collapsedGroups.has(group.id);
      fold.setAttribute('aria-expanded',String(!rows.hidden));
    });
    const name=document.createElement('span');name.className='schedule-group-name';name.textContent=group.name;name.title=group.name;
    const count=document.createElement('span');count.className='schedule-group-count';count.textContent=String(members.length);
    fold.append(name,count);heading.append(fold);
    if(!group.id)return heading;

    const active=members.filter(j=>j.enabled).length;
    const allActive=members.length>0&&active===members.length;
    const action=document.createElement('button');action.type='button';action.className='schedule-group-toggle';
    const actionLabel=allActive?'全组暂停':'全组启动';
    action.dataset.focusKey='group-toggle:'+group.id;
    action.innerHTML=icon(allActive?'pause':'play');
    action.title=actionLabel;
    action.setAttribute('aria-label',`${group.name}：${actionLabel}`);
    action.disabled=busy||picking||!members.length;
    action.addEventListener('click',()=>groupAction(group,allActive?'pause':'start'));

    const more=document.createElement('button');more.type='button';more.className='schedule-group-more';more.textContent='⋯';
    more.setAttribute('aria-label',`${group.name}：更多操作`);more.title='更多操作';more.disabled=busy||picking;more.dataset.focusKey='group-more:'+group.id;
    const menu=document.createElement('div');menu.className='schedule-group-menu';menu.popover='auto';more.popoverTargetElement=menu;
    const rename=document.createElement('button');rename.type='button';rename.textContent='编辑分组';
    rename.setAttribute('aria-label',`编辑分组 ${group.name}`);
    rename.addEventListener('click',()=>{menu.hidePopover();editGroup(group);});
    menu.append(rename);
    if(active&&!allActive){
      const pause=document.createElement('button');pause.type='button';pause.textContent='全组暂停';
      pause.addEventListener('click',()=>groupAction(group,'pause'));
      menu.append(pause);
    }
    heading.append(action,more,menu);
    return heading;
  }
  function render(){
    // Keep native drag sources alive while scheduler state events arrive.
    if(dragId)return;
    const list=$('scheduleList'),focusKey=list.contains(document.activeElement)?document.activeElement.dataset.focusKey:null;list.replaceChildren();$('scheduleEmpty').hidden=jobs.length>0||groups.length>0;
    $('scheduleNew').disabled=busy||picking;$('scheduleGroupNew').disabled=busy||picking;for(const node of $('scheduleGroupForm').elements)node.disabled=busy||picking;
    $('scheduleDelete').hidden=!id;$('scheduleDelete').disabled=busy||picking;
    const count=jobs.filter(j=>j.enabled).length;$('scheduleActiveCount').textContent=String(count);$('scheduleActiveCount').hidden=!count;
    for(const group of [{id:null,name:'未分组'},...groups]){
      const members=jobs.filter(j=>(j.groupId||null)===group.id);if(!group.id&&!groups.length&&!members.length)continue;
      const section=document.createElement('section');section.className='schedule-group';section.dataset.group=group.id||'';section.setAttribute('aria-label',group.name);
      const rows=document.createElement('div');rows.id='schedule-rows-'+(group.id||'ungrouped');
      if(group.id||groups.length){
        rows.hidden=collapsedGroups.has(group.id);section.append(renderGroupHeading(group,members,rows));
      }
      for(const j of members)renderJob(j,rows);
      if(!members.length){const empty=document.createElement('p');empty.className='schedule-group-empty';empty.textContent='暂无任务';rows.append(empty);}
      section.append(rows);list.append(section);
    }
    if(focusKey)[...list.querySelectorAll('[data-focus-key]')].find(node=>node.dataset.focusKey===focusKey)?.focus({preventScroll:true});
  }
  async function edit(job=null){
    if(picking||busy)return;
    const source=job?null:getSource();
    await desktop.releaseScheduleDraft?.();
    id=job?.id||null;target=job?.target||null;const s=getSettings();
    groupOptions();$('scheduleGroup').value=job?.groupId||'';
    $('scheduleName').value=job?.name||`定时任务 ${jobs.length+1}`;$('scheduleCommands').value=(job?.commands||source?.commands||[]).join('\n');
    $('scheduleMode').value=job?.mode==='once'?'once':'countdown';const period=job?.periodMs||5000,unit=period%3600000===0?3600000:period%60000===0?60000:1000;
    $('scheduleUnit').value=String(unit);$('schedulePeriod').value=String(period/unit);setDate(new Date(job?.at||Date.now()+60000));
    $('scheduleEnter').checked=job?.enter??s.enter;$('scheduleCommandInterval').value=job?.commandInterval??s.interval;$('scheduleCharacterInterval').value=job?.characterInterval??s.characterInterval;
    $('scheduleOptions').open=false;
    $('scheduleForm').scrollTop=0;error();mode();renderTarget();render();
  }
  async function operate(job,action){
    if(busy||picking)return;if(action==='edit'){await edit(job);return;}
    busy=true;render();error();try{jobs=await desktop.scheduleAction(job.id,action);if(action==='delete'&&id===job.id){busy=false;await edit();}}catch(e){error(e.message);}finally{busy=false;render();}
  }
  async function pick(){
    if(picking||busy||!canPick())return;picking=true;error();renderTarget();render();
    const scheduleId=id||undefined;
    try{
      const result=await desktop.pickTarget({scope:'schedule',scheduleId});
      if(result?.cancelled)return;
      if(scheduleId){
        jobs=result.jobs;target=result.target;
        toast(result.paused?'目标已更新，任务已暂停':'目标已更新');
      }else target=result;
    }catch(e){error(e.message);}finally{picking=false;renderTarget();render();}
  }
  function cancelPick(){if(!picking)return;void desktop.cancelPick().catch(e=>error(e.message));}
  const drag=bindTargetDrag($('scheduleTarget'),{canStart:()=>!busy&&!picking&&canPick(),onDrag:pick,onCancel:cancelPick,onClick:()=>error('按住目标按钮，拖到目标输入区后释放。')});
  dialog.addEventListener('cancel',event=>{if(dragId){event.preventDefault();endDrag();}else if(picking){event.preventDefault();drag.cancel();cancelPick();}});
  dialog.addEventListener('close',()=>{clearInterval(ticker);ticker=null;endDrag();drag.cancel();cancelPick();void desktop.releaseScheduleDraft?.().catch(e=>toast(e.message));});
  $('scheduleList').addEventListener('dragover',event=>{
    if(!dragId||busy||picking)return;const section=event.target.closest('.schedule-group');if(!section)return;event.preventDefault();event.dataTransfer.dropEffect='move';clearDrop();
    const groupId=section.dataset.group||null,row=event.target.closest('.schedule-job'),members=jobs.filter(j=>(j.groupId||null)===groupId&&j.id!==dragId);
    let beforeId=null;
    if(row&&row.dataset.job!==dragId){const after=event.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;const index=members.findIndex(j=>j.id===row.dataset.job);beforeId=after?members[index+1]?.id||null:row.dataset.job;row.classList.add(after?'drop-after':'drop-before');}
    else if(row){beforeId=dragId;}
    else section.classList.add('drop-group');
    dropPosition={groupId,beforeId};
    const sidebar=$('scheduleList').closest('.schedule-sidebar'),rect=sidebar.getBoundingClientRect();if(event.clientY<rect.top+35)sidebar.scrollTop-=12;else if(event.clientY>rect.bottom-35)sidebar.scrollTop+=12;
  });
  $('scheduleList').addEventListener('drop',event=>{if(!dragId||!dropPosition)return;event.preventDefault();const job=jobs.find(j=>j.id===dragId),position=dropPosition;endDrag();if(job)void moveTask(job,position);});
  $('scheduleGroupNew').addEventListener('click',()=>editGroup());$('scheduleGroupCancel').addEventListener('click',()=>$('scheduleGroupForm').hidden=true);
  $('scheduleGroupDelete').addEventListener('click',()=>{const group=groups.find(g=>g.id===groupEditId);if(group)void groupAction(group,'delete');});
  $('scheduleGroupForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||picking)return;busy=true;groupError();render();
    try{const before=new Set(groups.map(g=>g.id));groups=await desktop.saveScheduleGroup({...(groupEditId?{id:groupEditId}:{}),name:$('scheduleGroupName').value});groupOptions();if(!groupEditId)$('scheduleGroup').value=groups.find(g=>!before.has(g.id))?.id||'';$('scheduleGroupForm').hidden=true;groupEditId=null;}
    catch(e){groupError(e.message);}finally{busy=false;render();}
  });
  $('schedulesButton').addEventListener('click',async()=>{if(!desktop.saveSchedule){toast('当前环境不支持定时发送');return;}await edit();if(!dialog.open){dialog.showModal();ticker=setInterval(updateRemaining,250);}});
  $('scheduleNew').addEventListener('click',()=>void edit());$('scheduleMode').addEventListener('change',mode);$('scheduleUnit').addEventListener('change',durationLimit);
  $('scheduleDelete').addEventListener('click',()=>{const job=jobs.find(j=>j.id===id);if(job)void operate(job,'delete');});
  $('scheduleForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||picking)return;error();
    const commands=$('scheduleCommands').value.split(/\r?\n/).filter(c=>validCommand(c,getSettings().prefixes));
    if(!commands.length){error('请选择或输入有效指令');return;}
    const start=event.submitter?.id==='scheduleStart',once=$('scheduleMode').value==='once',at=once?readDate():null;
    const periodMs=Math.round(Number($('schedulePeriod').value)*Number($('scheduleUnit').value));
    if(once&&(!Number.isSafeInteger(at)||at<=Date.now())){error('发送时间需要晚于当前时间');return;}
    if(!once&&(!Number.isSafeInteger(periodMs)||periodMs<1000||periodMs>86400000)){error('倒计时需在 1 秒到 24 小时之间');return;}
    if((!id||start)&&!target){error('请拖动选择发送目标');$('scheduleTarget').focus();return;}
    const value={...(id?{id}:{}),name:$('scheduleName').value,commands,targetId:target?.id,targetAlias:target?.alias,groupId:$('scheduleGroup').value||null,mode:once?'once':'countdown',periodMs:once?5000:periodMs,at,enter:$('scheduleEnter').checked,commandInterval:Number($('scheduleCommandInterval').value),characterInterval:Number($('scheduleCharacterInterval').value),start};
    busy=true;$('scheduleSave').disabled=true;$('scheduleStart').disabled=true;render();
    try{const previous=new Set(jobs.map(j=>j.id));jobs=await desktop.saveSchedule(value);id=id||jobs.find(j=>!previous.has(j.id))?.id;collapsedGroups.delete(value.groupId);toast(start?'定时任务已启动':'已保存');}
    catch(e){error(e.message);}finally{busy=false;$('scheduleSave').disabled=false;$('scheduleStart').disabled=false;render();}
  });
  desktop.onSchedules?.(value=>{jobs=value;render();});desktop.onScheduleGroups?.(value=>{if(JSON.stringify(value)===JSON.stringify(groups))return;groups=value;groupOptions();render();});groupOptions();render();
}
