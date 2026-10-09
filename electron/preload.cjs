'use strict';
const {contextBridge,ipcRenderer}=require('electron');
async function call(channel,...args){const result=await ipcRenderer.invoke(`desktop:${channel}`,...args);if(!result.ok)throw new Error(result.error);return result.value;}
function listen(channel,callback){const handler=(_event,data)=>callback(data);ipcRenderer.on(`desktop:${channel}`,handler);return ()=>ipcRenderer.removeListener(`desktop:${channel}`,handler);}
contextBridge.exposeInMainWorld('desktop',{
  config:()=>call('config'),openFiles:()=>call('open'),saveFile:(id,text)=>call('save',id,text),closeFile:id=>call('close-file',id),
  togglePin:()=>call('pin'),openAccessibility:()=>call('accessibility'),pickTarget:()=>call('pick'),cancelPick:()=>call('cancel-pick'),
  start:options=>call('start',options),pause:()=>call('pause'),resume:()=>call('resume'),stop:()=>call('stop'),closeResponse:value=>call('close-response',value),
  onQueue:callback=>listen('queue',callback),onClose:callback=>listen('request-close',callback),onOpen:callback=>listen('open-request',callback),onSave:callback=>listen('save-request',callback)
});
