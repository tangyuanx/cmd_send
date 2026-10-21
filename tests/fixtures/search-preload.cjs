const {contextBridge,ipcRenderer}=require('electron');
const noop=()=>{},done=async()=>{};
contextBridge.exposeInMainWorld('desktop',{
 config:()=>ipcRenderer.invoke('fixture:config'),saveFile:(id,text)=>ipcRenderer.invoke('fixture:save',id,text),
 start:options=>ipcRenderer.invoke('fixture:start',options),stop:()=>ipcRenderer.invoke('fixture:stop'),
 pickTarget:options=>ipcRenderer.invoke('fixture:pick',options),cancelPick:()=>ipcRenderer.invoke('fixture:cancel-pick'),
 saveSchedule:value=>ipcRenderer.invoke('fixture:schedule-save',value),scheduleAction:(id,action)=>ipcRenderer.invoke('fixture:schedule-action',id,action),releaseScheduleDraft:()=>ipcRenderer.invoke('fixture:schedule-draft-release'),onSchedules:callback=>ipcRenderer.on('fixture:schedules',(_event,value)=>callback(value)),
 onQueue:callback=>ipcRenderer.on('fixture:queue',(_event,value)=>callback(value)),
 onOpen:noop,onSave:noop,onClose:noop,onWindowState:noop,onUpdate:callback=>ipcRenderer.on('fixture:update',(_event,value)=>callback(value)),checkUpdate:()=>ipcRenderer.invoke('fixture:update-check'),
 minimize:done,toggleMaximize:done,closeWindow:done,togglePin:async()=>false,openAccessibility:done,
 pause:done,resume:done,openFiles:async()=>[],closeFile:done,closeResponse:done
});

