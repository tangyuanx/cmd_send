'use strict';
const {app,BrowserWindow,ipcMain,dialog,Menu,shell,net}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {FileStore}=require('./files.cjs');
const {SendQueue}=require('./queue.cjs');
const {createBackend}=require('./native/index.cjs');
const {ManualUpdates,RELEASE_PAGE}=require('./updates.cjs');
const {restoreSession,saveSession}=require('./session.cjs');
app.setName('命令定向');
if(!app.requestSingleInstanceLock()){app.quit();}else{
let win,backend,queue,picker,updates,sessionFile,restored,closing=false,approvedClose=false,closeReason=null,finalizingClose=false;
const files=new FileStore();
const page=pathToFileURL(path.join(__dirname,'../src/index.html')).href;
function cancelPick(){if(!picker)return;clearInterval(picker.timer);picker.resolve({cancelled:true});picker=null;}
function emit(channel,data){if(win&&!win.isDestroyed())win.webContents.send(channel,data);}
function windowState(){return {maximized:win.isMaximized(),fullscreen:win.isFullScreen()};}
function handle(name,fn){ipcMain.handle(name,async(event,...args)=>{
  if(event.sender!==win?.webContents||event.senderFrame?.url!==page)throw new Error('无法识别请求来源');
  try{return {ok:true,value:await fn(...args)};}catch(error){return {ok:false,error:String(error.message||error)};}
});}
function unlocked(){if(queue?.run)throw new Error('发送期间不能修改文件或目标');}
async function requestClose(reason='quit'){
  if(closing)return;closing=true;closeReason=reason;cancelPick();await queue?.stop();emit('desktop:request-close',{reason});
}
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(async()=>{
  sessionFile=path.join(app.getPath('userData'),'session.json');restored=await restoreSession(sessionFile,files);
  const updater=process.platform==='win32'&&app.isPackaged?require('electron-updater').autoUpdater:null;
  if(updater)updater.installDirectory=path.dirname(app.getPath('exe'));
  updates=new ManualUpdates({updater,version:app.getVersion(),packaged:app.isPackaged,
    fetchRelease:async url=>{const response=await net.fetch(url,{headers:{Accept:'application/vnd.github+json'}});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json();}});
  updates.on('state',state=>{if(state.phase==='error'&&closeReason==='update'){closing=false;approvedClose=false;closeReason=null;}emit('desktop:update',state);});
  backend=createBackend();queue=new SendQueue(backend);queue.on('state',state=>emit('desktop:queue',state));
  win=new BrowserWindow({width:1040,height:760,minWidth:680,minHeight:440,title:'命令定向',icon:path.join(__dirname,'../assets/icon.png'),backgroundColor:'#f7f7f8',show:false,frame:false,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!==page)event.preventDefault();});
  win.webContents.session.on('will-download',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  win.webContents.on('did-finish-load',()=>backend.setExcludedPids([win.webContents.getOSProcessId()]));
  win.once('ready-to-show',()=>win.show());
  win.on('close',event=>{if(!approvedClose){event.preventDefault();void requestClose();}});
  win.on('closed',()=>{cancelPick();backend.dispose();win=null;app.quit();});
  for(const event of ['maximize','unmaximize','enter-full-screen','leave-full-screen'])win.on(event,()=>emit('desktop:window-state',windowState()));
  handle('desktop:config',()=>({platform:process.platform,version:app.getVersion(),accessibility:backend.permission(),window:windowState(),update:updates.snapshot(),session:restored}));
  handle('desktop:window-minimize',()=>win.minimize());
  handle('desktop:window-maximize',()=>{
    if(win.isFullScreen())win.setFullScreen(false);
    else if(win.isMaximized())win.unmaximize();
    else win.maximize();
  });
  handle('desktop:window-close',()=>requestClose());
  handle('desktop:update-check',()=>updates.check());
  handle('desktop:update-download',()=>updates.download());
  handle('desktop:update-page',()=>shell.openExternal(RELEASE_PAGE));
  handle('desktop:update-install',()=>{if(updates.state.phase!=='downloaded')throw new Error('升级包尚未下载完成');return requestClose('update');});
  handle('desktop:open',async()=>{
    unlocked();const selection=await dialog.showOpenDialog(win,{title:'打开 TXT 文件',properties:['openFile','multiSelections'],filters:[{name:'UTF-8 文本',extensions:['txt']} ]});
    const results=[];for(const file of selection.filePaths){try{results.push(await files.open(file));}catch(error){await dialog.showMessageBox(win,{type:'error',message:`无法打开 ${path.basename(file)}`,detail:error.message});}}
    return results;
  });
  handle('desktop:save',async(id,text)=>{
    unlocked();if(typeof id!=='string')throw new Error('文件标识无效');
    try{return await files.save(id,text);}catch(error){
      if(error.code!=='FILE_CHANGED')throw error;
      const choice=await dialog.showMessageBox(win,{type:'warning',message:'原文件已被其他程序修改',detail:'覆盖将替换磁盘上的内容。取消可保留你在本工具中的修改。',buttons:['取消','覆盖原文件'],defaultId:0,cancelId:0,noLink:true});
      if(choice.response!==1)return {cancelled:true};return files.save(id,text,{overwrite:true});
    }
  });
  handle('desktop:close-file',id=>{unlocked();return files.close(id);});
  handle('desktop:pin',()=>{const pinned=!win.isAlwaysOnTop();win.setAlwaysOnTop(pinned);return pinned;});
  handle('desktop:accessibility',async()=>{
    if(process.platform==='darwin')await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    return backend.permission();
  });
  handle('desktop:pick',()=>{
    unlocked();if(!backend.permission())throw new Error('请先在系统设置 → 隐私与安全性 → 辅助功能中允许「命令定向」，再重新长按拾取。');
    cancelPick();return new Promise((resolve,reject)=>{
      const started=Date.now();picker={resolve,reject,timer:setInterval(()=>{
        const current=picker;
        try{
          if(backend.escapeDown()||Date.now()-started>60000){cancelPick();return;}
          if(backend.mouseDown())return;
          clearInterval(current.timer);picker=null;current.resolve(backend.pick());
        }catch(error){clearInterval(current.timer);if(picker===current)picker=null;current.reject(error);}
      },30)};
    });
  });
  handle('desktop:cancel-pick',cancelPick);
  handle('desktop:start',options=>{if(closing)throw new Error('请先完成退出或升级确认');if(picker)throw new Error('请先完成目标拾取');return queue.start(options||{});});
  handle('desktop:pause',()=>queue.pause());handle('desktop:resume',()=>queue.resume());handle('desktop:stop',()=>queue.stop());
  handle('desktop:close-response',async(confirm,activeId)=>{
    if(finalizingClose)return;
    if(confirm!==true){closing=false;closeReason=null;return;}
    if(!closing)throw new Error('退出请求已取消');
    finalizingClose=true;
    try{await queue.stop();await saveSession(sessionFile,files,activeId);approvedClose=true;
      if(closeReason==='update')updates.install();else win.close();
    }catch(error){closing=false;approvedClose=false;closeReason=null;throw error;}
    finally{finalizingClose=false;}
  });
  const edit={label:'编辑',submenu:[{role:'undo',label:'撤销'},{role:'redo',label:'重做'},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]};
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==='darwin'?[{label:'命令定向',submenu:[{role:'about',label:'关于命令定向'},{type:'separator'},{role:'hide',label:'隐藏命令定向'},{role:'hideOthers',label:'隐藏其他应用'},{role:'unhide',label:'显示全部'},{type:'separator'},{label:'退出命令定向',accelerator:'Cmd+Q',click:()=>void requestClose()}]}]:[]),
    {label:'文件',submenu:[{label:'打开…',accelerator:'CmdOrCtrl+O',click:()=>emit('desktop:open-request')},{label:'保存',accelerator:'CmdOrCtrl+S',click:()=>emit('desktop:save-request')},{type:'separator'},{label:'关闭窗口',accelerator:'CmdOrCtrl+W',click:()=>void requestClose()}]},edit,
    {label:'窗口',submenu:[{role:'minimize',label:'最小化'},{role:'zoom',label:'缩放'}]}
  ]));
  if(process.platform!=='darwin')win.removeMenu();
  void win.loadURL(page);
}).catch(error=>{dialog.showErrorBox('无法启动命令定向',error.stack||error.message);app.exit(1);});
app.on('before-quit',event=>{if(win&&!approvedClose){event.preventDefault();void requestClose();}});
app.on('window-all-closed',()=>app.quit());
}

