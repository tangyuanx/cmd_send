// Renderer-only Electron fixture. Native delivery is tested separately.
const {app,BrowserWindow,ipcMain}=require('electron');const path=require('node:path');
const fixture=JSON.parse(process.env.CMD_SEND_SEARCH_FIXTURE);
app.setPath('userData',fixture.profile);global.searchCaptures={saves:[],plans:[],picks:0,cancels:0};let pendingPick;
global.finishTargetPick=value=>{pendingPick?.(value);pendingPick=null;};
app.whenReady().then(()=>{
 const win=new BrowserWindow({width:1040,height:760,frame:false,webPreferences:{preload:path.join(__dirname,'search-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
 ipcMain.handle('fixture:config',()=>fixture.config);
 ipcMain.handle('fixture:pick',()=>{global.searchCaptures.picks++;const target=fixture.target||{id:'fixture-target',name:'测试目标',title:'Renderer fixture',detail:'仅记录发送请求',strategy:'测试'};return fixture.pendingPick?new Promise(resolve=>pendingPick=resolve):target;});
 ipcMain.handle('fixture:cancel-pick',()=>{global.searchCaptures.cancels++;pendingPick?.({cancelled:true});pendingPick=null;});
 ipcMain.handle('fixture:save',(_event,id,text)=>{global.searchCaptures.saves.push({id,text});return {};});
 ipcMain.handle('fixture:start',(_event,options)=>{global.searchCaptures.plans.push(options);return {id:'search-run'};});
 ipcMain.handle('fixture:stop',()=>win.webContents.send('fixture:queue',{id:'search-run',type:'stopped',total:0}));
 void win.loadFile(fixture.page);
});
app.on('window-all-closed',()=>app.quit());

