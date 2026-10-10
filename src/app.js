import {linesOf,validCommand,scenesOf,sendPlan} from './core.js';
import {literalMatches} from './search.js';
const $=id=>document.getElementById(id);
const iconPaths={minimize:'<path d="M5 12h14"/>',maximize:'<rect x="5" y="5" width="14" height="14" rx="1"/>',restore:'<path d="M9 5V3h12v12h-2"/><rect x="3" y="9" width="12" height="12" rx="1"/>',repeat:'<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/>',terminal:'<path d="m5 6 5 6-5 6m8 0h6"/>',crosshair:'<circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8m-8 4h6"/>',chevron:'<path d="m7 10 5 5 5-5"/>',pin:'<path d="m16 3 5 5-4 1-4 5v4l-2 2-3-5-5-3 2-2h4l5-4zM8 16l-5 5"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4m.1 3h.01"/>',list:'<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',hash:'<path d="M5 9h14M4 15h14M11 3 7 21M17 3l-4 18"/>',mouse:'<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 6v4"/>',send:'<path d="m22 2-7 20-4-9-9-4 20-7zM11 13 22 2"/>',sliders:'<path d="M4 21v-7m0-4V3m8 18V11m0-4V3m8 18v-5m0-4V3M1 14h6m2-7h6m2 9h6"/>',pause:'<path d="M8 5v14M16 5v14"/>',play:'<path d="m7 4 13 8-13 8z"/>',stop:'<rect x="5" y="5" width="14" height="14" rx="2"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',up:'<path d="m6 14 6-6 6 6"/>',down:'<path d="m6 10 6 6 6-6"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 9h18"/>',check:'<path d="m5 12 4 4L19 6"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',window:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01m3 0h.01"/>'};
function icon(name){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]||iconPaths.file}</svg>`;}
function initIcons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));}
initIcons();
const desktop=window.desktop;
if(!desktop)throw new Error('请通过桌面应用启动此界面');
function buffer(name,text,extras={}){const normalized=text.replace(/\r\n/g,'\n');return {name,text:normalized,saved:normalized,start:0,end:0,scrollTop:0,scrollLeft:0,encoding:'UTF-8',newline:'LF',bom:false,exhausted:false,...extras};}
let files=[],activeId=null;
let target=null,run=null,toastTimer=null,closingId=null,composing=false,picking=false,holdTimer=null,held=false,findMatches=[],findIndex=-1;
const settings={enter:true,interval:500,repeat:'loop',rounds:10,prefixes:['#','//',';'],theme:'system'};
try{const saved=JSON.parse(localStorage.getItem('courier-settings')||'{}');if(typeof saved.enter==='boolean')settings.enter=saved.enter;if(Number.isFinite(saved.interval))settings.interval=Math.max(50,Math.min(600000,saved.interval));if(['count','loop'].includes(saved.repeat))settings.repeat=saved.repeat;if(Number.isFinite(saved.rounds))settings.rounds=Math.max(1,Math.min(100000,saved.rounds));if(Array.isArray(saved.prefixes)&&saved.prefixes.every(x=>typeof x==='string'))settings.prefixes=saved.prefixes;settings.theme=localStorage.getItem('courier-theme')||'system';}catch{}
const systemTheme=matchMedia('(prefers-color-scheme: dark)');
const active=()=>files.find(f=>f.id===activeId);
function escaped(s){return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
function changed(f){return f&&f.text!==f.saved;}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3600);}
function status(message){$('statusText').textContent=message;}
function applyTheme(){document.documentElement.dataset.theme=settings.theme==='system'?(systemTheme.matches?'dark':'light'):settings.theme;document.querySelectorAll('button[data-theme]').forEach(b=>{b.classList.toggle('active',b.dataset.theme===settings.theme);b.setAttribute('aria-pressed',String(b.dataset.theme===settings.theme));});}
systemTheme.addEventListener('change',applyTheme);applyTheme();
function syncSelection(){const f=active();if(!f)return;f.start=$('editor').selectionStart;f.end=$('editor').selectionEnd;f.scrollTop=$('editorScroller').scrollTop;f.scrollLeft=$('editorScroller').scrollLeft;renderPosition();}
function renderPosition(){const f=active();if(!f){$('positionText').textContent='行 1，列 1';$('selectionText').hidden=true;$('currentLine').hidden=true;return;}
 const line=linesOf(f.text).findLast(l=>l.start<=f.start)||{index:0,start:0};$('positionText').textContent=`行 ${line.index+1}，列 ${f.start-line.start+1}`;$('selectionText').hidden=f.start===f.end;$('selectionText').textContent=`已选 ${f.end-f.start} 字`;
 const pad=parseFloat(getComputedStyle($('editor')).paddingTop),height=parseFloat(getComputedStyle($('editor')).lineHeight);$('currentLine').style.top=`${pad+line.index*height}px`;$('currentLine').hidden=f.start!==f.end;
 const scenes=scenesOf(f.text),current=scenes.findLast(s=>s.start<=f.start);document.querySelectorAll('.scene-button').forEach(b=>{const selected=Number(b.dataset.start)===current?.start;b.classList.toggle('active',selected);if(selected)b.setAttribute('aria-current','location');else b.removeAttribute('aria-current');});
}
function renderSyntax(){
 const f=active(),matches=$('findBar').hidden?[]:findMatches;let first=0;
 $('syntaxText').innerHTML=f?linesOf(f.text).map(l=>{
  const trimmed=l.raw.trim(),cls=/^\[[^\]\r\n]*\]$/.test(trimmed)?'section-line':settings.prefixes.some(p=>trimmed.startsWith(p))?'comment-line':'';
  while(first<matches.length&&matches[first].end<=l.start)first++;
  let cursor=l.start,html='';
  for(let i=first;i<matches.length&&matches[i].start<l.end;i++){
   const start=Math.max(l.start,matches[i].start),end=Math.min(l.end,matches[i].end);if(end<=start)continue;
   html+=escaped(f.text.slice(cursor,start))+`<mark class="find-match${i===findIndex?' find-current':''}" data-find-index="${i}">${escaped(f.text.slice(start,end))}</mark>`;cursor=end;
  }
  return `<span class="${cls}">${html+escaped(f.text.slice(cursor,l.end))}</span>`;
 }).join('\n')+'\n':'';
 const current=matches[findIndex];$('findLine').hidden=!current;$('editorArea').classList.toggle('has-find-matches',matches.length>0);
 if(current&&f){const line=linesOf(f.text).findLast(l=>l.start<=current.start),style=getComputedStyle($('editor'));$('findLine').style.top=`${parseFloat(style.paddingTop)+(line?.index||0)*parseFloat(style.lineHeight)}px`;}
}
function renderScenes(){const f=active();$('sceneList').innerHTML=f?scenesOf(f.text).map(s=>`<button class="scene-button" data-start="${s.start}" ${run?'disabled':''} title="${escaped(s.name)}">${icon('hash')}<span class="scene-name">${escaped(s.name)}</span></button>`).join(''):'';renderPosition();}
function renderMenu(){$('fileMenu').innerHTML=files.map(f=>`<div class="menu-file ${f.id===activeId?'active':''}" role="none"><button role="menuitem" data-file="${f.id}" ${run?'disabled':''}>${icon('file')}<span class="menu-filename">${escaped(f.name)}${changed(f)?' *':''}</span>${f.id===activeId?`<span class="file-check">${icon('check')}</span>`:''}</button><button class="icon-button" data-remove="${f.id}" aria-label="关闭 ${escaped(f.name)}" title="关闭文件" ${run?'disabled':''}>${icon('close')}</button></div>`).join('')+`<button class="menu-open" role="menuitem" id="openFilesButton" ${run?'disabled':''}>${icon('folder')}打开 TXT 文件…</button>`;}
function renderFileLabel(){const f=active();$('fileName').textContent=f?f.name+(changed(f)?' *':''):'未打开文件';renderMenu();}
function loadBuffer(){const f=active();$('editor').value=f?.text||'';$('editor').readOnly=!f||!!run;$('emptyState').hidden=!!f;$('editorHint').hidden=!f;$('encodingText').textContent=f?.encoding||'UTF-8';$('newlineText').textContent=f?.newline||'LF';renderSyntax();renderScenes();renderFileLabel();$('editor').setSelectionRange(f?.start||0,f?.end||0);$('editorScroller').scrollTop=f?.scrollTop||0;$('editorScroller').scrollLeft=f?.scrollLeft||0;renderControls();if(!$('findBar').hidden)refreshFind();}
function renderControls(){const locked=!!run;$('targetButton').disabled=locked;$('fileButton').disabled=locked;$('settingsButton').disabled=locked;$('editor').readOnly=locked||!active();$('runControls').hidden=!locked;$('sendButton').disabled=locked||!target||!active();$('repeatButton').disabled=locked||!target||!active();$('sendLabel').textContent=locked&&!run.repeating?'发送中':'发送';$('repeatLabel').textContent=locked&&run.repeating?(run.paused?'重复已暂停':'重复发送中'):'重复发送';$('repeatButton').classList.toggle('is-running',locked&&run.repeating);$('repeatInterval').textContent=`间隔 ${settings.interval} ms`;$('repeatModeHint').textContent=settings.repeat==='count'?`共 ${Math.round(settings.rounds)} 轮后停止`:'持续循环，直到手动停止';$('pauseLabel').textContent=run?.paused?'继续':'暂停';$('pauseButton').querySelector('[data-icon]').innerHTML=icon(run?.paused?'play':'pause');$('statusIndicator').classList.toggle('running',locked&&!run.paused);document.querySelectorAll('.scene-button').forEach(b=>b.disabled=locked);}
function placeCursor(position,selectEnd=position,focus=true,reveal=true){const f=active();if(!f)return;f.start=position;f.end=selectEnd;$('editor').setSelectionRange(position,selectEnd);if(focus)$('editor').focus({preventScroll:true});renderPosition();if(reveal)revealCursor(position);}
function revealCursor(position){const f=active();if(!f)return;const line=linesOf(f.text).findLast(l=>l.start<=position);const height=parseFloat(getComputedStyle($('editor')).lineHeight),pad=parseFloat(getComputedStyle($('editor')).paddingTop);const y=pad+(line?.index||0)*height;const scroller=$('editorScroller');if(y<scroller.scrollTop+20||y+height>scroller.scrollTop+scroller.clientHeight-30)scroller.scrollTo({top:Math.max(0,y-scroller.clientHeight/3),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
$('editor').addEventListener('input',()=>{const f=active();if(!f||run)return;f.text=$('editor').value;f.exhausted=false;syncSelection();renderSyntax();renderScenes();renderFileLabel();if(!$('findBar').hidden)refreshFind(false);});
$('editor').addEventListener('select',syncSelection);$('editor').addEventListener('click',syncSelection);$('editor').addEventListener('keyup',syncSelection);$('editor').addEventListener('pointerdown',()=>{if(active()&&!run)active().exhausted=false;});$('editor').addEventListener('keydown',e=>{if(active()&&!run&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))active().exhausted=false;});$('editor').addEventListener('compositionstart',()=>composing=true);$('editor').addEventListener('compositionend',()=>composing=false);$('editorScroller').addEventListener('scroll',()=>{const f=active();if(f){f.scrollTop=$('editorScroller').scrollTop;f.scrollLeft=$('editorScroller').scrollLeft;}});
$('sceneList').addEventListener('click',e=>{const b=e.target.closest('[data-start]');if(!b||run)return;const f=active(),heading=Number(b.dataset.start),lines=linesOf(f.text),index=lines.findIndex(l=>l.start===heading);const after=lines.slice(index+1),nextScene=after.findIndex(l=>/^\[[^\]\r\n]*\]$/.test(l.raw.trim()));const command=(nextScene<0?after:after.slice(0,nextScene)).find(l=>validCommand(l.raw,settings.prefixes));f.exhausted=false;placeCursor(command?.start??heading);status(target?'就绪':'待选择目标');});
function hideMenu(){$('fileMenu').hidden=true;$('fileButton').setAttribute('aria-expanded','false');}
$('fileButton').addEventListener('click',()=>{if(run)return;const open=$('fileMenu').hidden;renderMenu();$('fileMenu').hidden=!open;$('fileButton').setAttribute('aria-expanded',String(open));});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.file-control'))hideMenu();});
$('fileMenu').addEventListener('click',async e=>{const remove=e.target.closest('[data-remove]'),switcher=e.target.closest('[data-file]');if(run)return;if(remove){hideMenu();requestClose(remove.dataset.remove);}else if(switcher){syncSelection();activeId=switcher.dataset.file;hideMenu();loadBuffer();status(target?'就绪':'待选择目标');}else if(e.target.closest('#openFilesButton')){hideMenu();await openFiles();}});
async function openFiles(){if(run)return;syncSelection();try{for(const file of await desktop.openFiles()){if(!file.existing)files.push(buffer(file.name,file.text,file));activeId=file.id;}loadBuffer();status(target?'就绪':'待选择目标');}catch(error){toast(error.message);}}
async function saveFile(f=active()){if(!f||run)return false;const snapshot=f.text;try{const result=await desktop.saveFile(f.id,snapshot);if(result.cancelled)return false;f.saved=snapshot;renderFileLabel();status('已保存到原文件');return true;}catch(error){toast(`保存失败，修改已保留：${error.message}`);return false;}}
async function removeFile(id){try{await desktop.closeFile(id);const index=files.findIndex(f=>f.id===id);if(index<0)return;files.splice(index,1);if(activeId===id)activeId=files[Math.min(index,files.length-1)]?.id??null;loadBuffer();status(!files.length?'未打开文件':target?'就绪':'待选择目标');}catch(error){toast(error.message);}}
function requestClose(id){const f=files.find(f=>f.id===id);if(!f)return;if(changed(f)){closingId=id;$('closeDescription').textContent=`「${f.name}」有未保存的修改。`;showDialog('closeDialog');}else removeFile(id);}
$('cancelClose').addEventListener('click',()=>{$('closeDialog').close();closingId=null;});$('discardClose').addEventListener('click',()=>{removeFile(closingId);$('closeDialog').close();closingId=null;});$('saveClose').addEventListener('click',async()=>{const f=files.find(f=>f.id===closingId);if(await saveFile(f)){removeFile(closingId);$('closeDialog').close();closingId=null;}});
function showDialog(id){hideMenu();$(id).showModal();}
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
$('helpButton').addEventListener('click',()=>showDialog('helpDialog'));
$('pinButton').addEventListener('click',async()=>{try{const pinned=await desktop.togglePin();$('pinButton').classList.toggle('is-pinned',pinned);$('pinButton').setAttribute('aria-pressed',String(pinned));toast(pinned?'窗口已置顶':'已取消置顶');}catch(error){toast(error.message);}});
$('targetButton').addEventListener('pointerdown',e=>{if(run||e.button!==0)return;held=false;holdTimer=setTimeout(async()=>{held=true;picking=true;document.body.classList.add('picking');status('移到目标输入区后释放 · Esc 取消');try{const picked=await desktop.pickTarget();if(!picked.cancelled){target=picked;$('targetLabel').textContent=target.name;$('targetTag').textContent='已绑定';$('targetButton').title=`${target.name} · ${target.title} · ${target.detail} · ${target.strategy}`;$('targetButton').querySelector('[data-icon]').innerHTML=icon('crosshair');toast(`已绑定 ${target.name} · ${target.detail}`);}}catch(error){toast(error.message);if(error.message.includes('辅助功能'))showDialog('targetDialog');}finally{picking=false;document.body.classList.remove('picking');status(target?'就绪':'待选择目标');renderControls();}},400);});
document.addEventListener('pointerup',()=>clearTimeout(holdTimer));
$('targetButton').addEventListener('click',()=>{if(held){held=false;return;}if(!run&&!picking&&!$('targetDialog').open)showDialog('targetDialog');});
async function cancelPicking(){clearTimeout(holdTimer);await desktop.cancelPick();picking=false;document.body.classList.remove('picking');status(target?'就绪':'待选择目标');}
$('accessibilityButton').addEventListener('click',async()=>{try{await desktop.openAccessibility();}catch(error){toast(error.message);}});
$('settingsButton').addEventListener('click',()=>{if(run)return;$('enterToggle').checked=settings.enter;$('intervalInput').value=settings.interval;$('repeatSelect').value=settings.repeat;$('roundsInput').value=settings.rounds;$('roundsRow').hidden=settings.repeat!=='count';$('prefixInput').value=settings.prefixes.join(', ');showDialog('settingsDialog');});
$('repeatSelect').addEventListener('change',()=>$('roundsRow').hidden=$('repeatSelect').value!=='count');
document.querySelectorAll('button[data-theme]').forEach(b=>b.addEventListener('click',()=>{settings.theme=b.dataset.theme;applyTheme();try{localStorage.setItem('courier-theme',settings.theme);}catch{}}));
$('settingsForm').addEventListener('submit',e=>{e.preventDefault();settings.enter=$('enterToggle').checked;settings.interval=Math.max(50,Math.min(600000,Number($('intervalInput').value)));settings.repeat=$('repeatSelect').value;settings.rounds=Math.max(1,Math.min(100000,Number($('roundsInput').value)));settings.prefixes=$('prefixInput').value.split(',').map(s=>s.trim()).filter(Boolean);try{localStorage.setItem('courier-settings',JSON.stringify(settings));}catch{}renderSyntax();renderControls();$('settingsDialog').close();toast('发送设置已更新');});
async function startSending(repeating=false){if(run||picking||document.querySelector('dialog[open]')||composing)return;const f=active();if(!f)return;if(!target){toast('请先选择发送目标');return;}syncSelection();const plan=sendPlan(f.text,f.start,f.end,settings.prefixes,repeating?false:f.exhausted);if(!plan.commands.length){toast(plan.atEnd?'已到文件末尾；移动光标后可重新发送':'选区中没有有效命令');status(plan.atEnd?'已到文件末尾':'没有有效命令');return;}const repeat=repeating?settings.repeat:'once';
 if(repeating)f.exhausted=false;
 const current={id:null,repeating,fileId:f.id,plan,paused:false,total:0,start:f.start,end:f.end};run=current;hideMenu();closeFind(false);renderControls();
 try{const result=await desktop.start({commands:plan.commands.map(c=>c.text),targetId:target.id,interval:Math.round(settings.interval),rounds:repeat==='loop'?'loop':repeat==='count'?Math.round(settings.rounds):1,enter:settings.enter});if(run===current)current.id=result.id;}catch(error){if(run===current){run=null;renderControls();status('发送未开始');}toast(error.message);}
}
desktop.onQueue(event=>{const r=run;if(!r||(r.id&&r.id!==event.id))return;r.id=event.id;r.total=event.total;r.paused=event.paused;
 if(['completed','stopped','failed'].includes(event.type)){run=null;const f=files.find(f=>f.id===r.fileId);
  if(f&&event.type==='completed'&&!r.repeating&&!r.plan.selected){if(r.plan.next!==null){f.exhausted=false;placeCursor(r.plan.next);}else{f.exhausted=true;placeCursor(r.plan.commands[0].start);}}else if(f)placeCursor(r.start,r.end);
  renderControls();status(event.type==='failed'?`投递停止 · 已完成 ${event.total} 条`:event.type==='stopped'?`已停止 · 已完成 ${event.total} 条`:`已投递 ${event.total} 条${f?.exhausted?' · 已到末尾':''}`);if(event.error)toast(event.error);return;
 }
 status(`${event.paused?'已暂停':'正在投递'} · ${event.index+1}/${event.commandCount} 条 · 第 ${event.round}${event.rounds?'/'+event.rounds:''} 轮`);renderControls();
});
async function stopSending(){try{await desktop.stop();}catch(error){toast(error.message);}}
$('sendButton').addEventListener('pointerdown',e=>e.preventDefault());$('sendButton').addEventListener('click',()=>startSending());$('repeatButton').addEventListener('pointerdown',e=>e.preventDefault());$('repeatButton').addEventListener('click',()=>startSending(true));
$('pauseButton').addEventListener('click',async()=>{if(!run)return;try{if(run.paused)await desktop.resume();else await desktop.pause();}catch(error){toast(error.message);}});$('stopButton').addEventListener('click',stopSending);
function openFind(){if(!active()||run)return;$('findBar').hidden=false;$('findInput').focus();$('findInput').select();refreshFind();}
function closeFind(focus=true){$('findBar').hidden=true;renderSyntax();if(focus)$('editor').focus({preventScroll:true});}
function refreshFind(select=true){const f=active();findMatches=f?literalMatches(f.text,$('findInput').value):[];findIndex=findMatches.findIndex(match=>match.start>=f.start);if(findIndex<0&&findMatches.length)findIndex=0;updateFind(select);}
function updateFind(select=true){
 const count=findMatches.length,noMatch=!!$('findInput').value&&!count;
 $('findCount').textContent=noMatch?'无匹配':`${findIndex+1} / ${count}`;$('findInput').setAttribute('aria-invalid',String(noMatch));
 $('findPrevious').disabled=!count;$('findNext').disabled=!count;renderSyntax();
 if(select&&findIndex>=0){const match=findMatches[findIndex];active().exhausted=false;placeCursor(match.start,match.end,false,false);revealFind();}
}
function revealFind(){
 const mark=$('syntaxText').querySelector('.find-current');if(!mark)return;
 const scroller=$('editorScroller'),viewport=scroller.getBoundingClientRect(),rect=mark.getBoundingClientRect();
 const x=rect.left-viewport.left+scroller.scrollLeft,y=rect.top-viewport.top+scroller.scrollTop;
 const top=Math.max(0,y-(scroller.clientHeight-rect.height)/2);let left=scroller.scrollLeft;
 if(rect.left<viewport.left+24||rect.right>viewport.left+scroller.clientWidth-24)left=Math.max(0,x-(scroller.clientWidth-Math.min(rect.width,scroller.clientWidth-48))/2);
 // The outer scroller owns both axes. Native textarea scrolling would offset
 // its selection/caret from the painted syntax and search marks underneath.
 $('editor').scrollTop=0;$('editor').scrollLeft=0;scroller.scrollTo({top,left,behavior:'instant'});
}
function navigateFind(direction=1){if(!findMatches.length)return;$('findInput').focus({preventScroll:true});findIndex=(findIndex+direction+findMatches.length)%findMatches.length;updateFind();}
$('findInput').addEventListener('input',()=>refreshFind());$('findInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();navigateFind(e.shiftKey?-1:1);}});$('findPrevious').addEventListener('click',()=>navigateFind(-1));$('findNext').addEventListener('click',()=>navigateFind());$('findClose').addEventListener('click',()=>closeFind());
document.addEventListener('keydown',e=>{if(e.isComposing||composing)return;const modal=document.querySelector('dialog[open]');if(e.key==='Escape'){if(modal)return;e.preventDefault();if(picking){cancelPicking();return;}if(!$('fileMenu').hidden){hideMenu();return;}if(!$('findBar').hidden){closeFind();return;}if(run)stopSending();return;}if(modal)return;const mod=e.ctrlKey||e.metaKey;if(mod&&e.key.toLowerCase()==='o'){e.preventDefault();openFiles();}else if(mod&&e.key.toLowerCase()==='w'){e.preventDefault();desktop.closeWindow().catch(error=>toast(error.message));}else if(mod&&e.key.toLowerCase()==='s'){e.preventDefault();saveFile();}else if(mod&&e.key==='Enter'){e.preventDefault();startSending();}else if(mod&&e.key.toLowerCase()==='f'){e.preventDefault();openFind();}});
desktop.onOpen(()=>{if(!document.querySelector('dialog[open]'))openFiles();});desktop.onSave(()=>{if(!document.querySelector('dialog[open]'))saveFile();});
function finishClose(){return desktop.closeResponse(true,activeId).catch(error=>toast(error.message));}
desktop.onClose(event=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());hideMenu();const update=event?.reason==='update';$('quitTitle').textContent=update?'保存修改后升级并重启？':'保存修改后退出？';$('cancelQuit').textContent=update?'暂不升级':'取消退出';$('discardQuit').textContent=update?'不保存并升级':'不保存退出';$('saveQuit').textContent=update?'保存并升级':'保存并退出';if(files.some(changed)){$('quitDescription').textContent=`${files.filter(changed).length} 个文件有未保存的修改。发送任务已停止。`;showDialog('quitDialog');}else finishClose();});
$('cancelQuit').addEventListener('click',()=>{$('quitDialog').close();desktop.closeResponse(false);});
$('quitDialog').addEventListener('cancel',()=>desktop.closeResponse(false));
$('discardQuit').addEventListener('click',finishClose);
$('saveQuit').addEventListener('click',async()=>{for(const f of files.filter(changed))if(!await saveFile(f))return;finishClose();});
function renderWindowState(state){const expanded=state.maximized||state.fullscreen;const button=$('maximizeWindow');button.innerHTML=icon(expanded?'restore':'maximize');button.title=expanded?'还原':'最大化';button.setAttribute('aria-label',expanded?'还原窗口':'最大化窗口');}
$('minimizeWindow').addEventListener('click',()=>desktop.minimize().catch(error=>toast(error.message)));
$('maximizeWindow').addEventListener('click',()=>desktop.toggleMaximize().catch(error=>toast(error.message)));
$('closeWindow').addEventListener('click',()=>desktop.closeWindow().catch(error=>toast(error.message)));
desktop.onWindowState(renderWindowState);
let config={platform:'unknown'},updateState={phase:'idle'};
function renderUpdate(state){
  updateState=state;const busy=['checking','downloading','installing'].includes(state.phase),available=!!state.availableVersion;
  const messages={idle:'点击检查更新，从 GitHub 获取最新版本。',checking:'正在从 GitHub 检查更新…',current:'当前已是最新版本',available:`发现新版本 v${state.availableVersion}`,downloading:`正在下载 v${state.availableVersion} · ${Math.round(state.progress||0)}%`,downloaded:`v${state.availableVersion} 已下载并通过校验`,installing:'正在安装更新，即将重启…',error:state.error||'检查更新失败，请重试'};
  $('updateCurrent').textContent=`当前版本 v${state.currentVersion}`;$('updateButton').textContent=available?'有更新':`v${state.currentVersion}`;
  $('updateStatus').textContent=messages[state.phase]||messages.idle;
  $('updateHint').textContent=state.supported?'仅手动检查和下载。安装前会检查未保存的修改。':config?.platform==='darwin'?'macOS 当前通过发布页面下载更新。':'开发环境通过发布页面下载安装版。';
  $('checkUpdate').disabled=busy||state.phase==='downloaded';$('downloadUpdate').hidden=!state.supported||!available||!['available','error'].includes(state.phase);$('downloadUpdate').textContent=state.phase==='error'?'重新下载':'下载更新';
  $('installUpdate').hidden=state.phase!=='downloaded';$('installUpdate').disabled=busy;$('updateReleasePage').hidden=state.supported||!available;
  $('updateProgress').hidden=state.phase!=='downloading';$('updateProgress').value=state.progress||0;
  $('updateNotes').textContent=state.releaseNotes||'';$('updateNotes').hidden=!state.releaseNotes;
}
async function checkUpdate(){try{renderUpdate(await desktop.checkUpdate());}catch(error){toast(error.message);}}
$('updateButton').addEventListener('click',()=>{renderUpdate(updateState);showDialog('updateDialog');checkUpdate();});
$('checkUpdate').addEventListener('click',checkUpdate);
$('downloadUpdate').addEventListener('click',async()=>{try{renderUpdate(await desktop.downloadUpdate());}catch(error){toast(error.message);}});
$('installUpdate').addEventListener('click',()=>desktop.installUpdate().catch(error=>toast(error.message)));
$('updateReleasePage').addEventListener('click',()=>desktop.openUpdatePage().catch(error=>toast(error.message)));
desktop.onUpdate(renderUpdate);
config=await desktop.config();renderWindowState(config.window);document.body.dataset.platform=config.platform;$('accessibilityButton').hidden=config.platform!=='darwin';
renderUpdate(config.update);files=(config.session?.files||[]).map(file=>buffer(file.name,file.text,file));activeId=config.session?.activeId||files[0]?.id||null;
if(config.platform==='darwin')document.querySelectorAll('kbd,.rail-shortcuts>span').forEach(el=>el.innerHTML=el.innerHTML.replaceAll('Ctrl','⌘'));
loadBuffer();
if(config.session?.failed)toast(`${config.session.failed} 个文件未能重新打开，请检查文件是否已移动或删除`);

