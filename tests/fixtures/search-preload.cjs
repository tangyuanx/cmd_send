const {contextBridge,ipcRenderer}=require('electron');
const noop=()=>{},done=async()=>{};
contextBridge.exposeInMainWorld('desktop',{
 config:()=>ipcRenderer.invoke('fixture:config'),saveFile:(id,text)=>ipcRenderer.invoke('fixture:save',id,text),
 start:options=>ipcRenderer.invoke('fixture:start',options),stop:()=>ipcRenderer.invoke('fixture:stop'),
 pickTarget:()=>ipcRenderer.invoke('fixture:pick'),cancelPick:done,
 onQueue:callback=>ipcRenderer.on('fixture:queue',(_event,value)=>callback(value)),
 onOpen:noop,onSave:noop,onClose:noop,onWindowState:noop,onUpdate:noop,
 minimize:done,toggleMaximize:done,closeWindow:done,togglePin:async()=>false,openAccessibility:done,
 pause:done,resume:done,openFiles:async()=>[],closeFile:done,closeResponse:done
});
