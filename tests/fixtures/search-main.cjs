// Renderer-only Electron fixture. Native delivery is tested separately.
const {app,BrowserWindow,ipcMain}=require('electron');const path=require('node:path');
const fixture=JSON.parse(process.env.CMD_SEND_SEARCH_FIXTURE);
app.setPath('userData',fixture.profile);global.searchCaptures={saves:[],plans:[],picks:0,cancels:0};let pendingPick;
global.finishTargetPick=value=>{pendingPick?.(value);pendingPick=null;};
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1040,height:760,frame:false,webPreferences:{preload:path.join(__dirname,'search-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
 let schedules;const targets=new Map();
 if(fixture.schedules){
   const {ScheduleManager}=require('../../electron/schedules.cjs'),{DeliveryBroker}=require('../../electron/delivery.cjs');
   global.searchCaptures.deliveries=[];
   const backend={hasTarget:id=>targets.has(id),retain:()=>{},release:()=>{},deliveryInfo:id=>({key:id,background:true}),prepare:async()=>({}),finish:()=>{},character:(id,c)=>global.searchCaptures.deliveries.push([id,c]),enter:id=>global.searchCaptures.deliveries.push([id,'\n'])};
   schedules=new ScheduleManager({backend,broker:new DeliveryBroker(backend),file:path.join(fixture.profile,'schedules.json')});await schedules.load();global.scheduleManager=schedules;
   schedules.on('state',value=>win.webContents.send('fixture:schedules',value));
 }
 global.setUpdateFixture=value=>{fixture.config.update=value;win.webContents.send('fixture:update',value);};
 ipcMain.handle('fixture:update-check',()=>fixture.config.update);
 ipcMain.handle('fixture:config',()=>({...fixture.config,schedules:schedules?.snapshot()||[]}));
 ipcMain.handle('fixture:schedule-save',(_event,value)=>schedules.save(value,targets.get(value.targetId)));
 ipcMain.handle('fixture:schedule-action',(_event,id,action)=>schedules.action(id,action));
 ipcMain.handle('fixture:schedule-draft-release',()=>{});

 ipcMain.handle('fixture:pick',()=>{global.searchCaptures.picks++;const target=fixture.target||{id:fixture.schedules?'target-'+global.searchCaptures.picks:'fixture-target',name:fixture.schedules?'测试目标 '+global.searchCaptures.picks:'测试目标',title:fixture.schedules?'Renderer fixture '+global.searchCaptures.picks:'Renderer fixture',detail:'仅记录发送请求',strategy:'测试'};targets.set(target.id,target);return fixture.pendingPick?new Promise(resolve=>pendingPick=resolve):target;});
 ipcMain.handle('fixture:cancel-pick',()=>{global.searchCaptures.cancels++;pendingPick?.({cancelled:true});pendingPick=null;});
 ipcMain.handle('fixture:save',(_event,id,text)=>{global.searchCaptures.saves.push({id,text});return {};});
 ipcMain.handle('fixture:start',(_event,options)=>{global.searchCaptures.plans.push(options);return {id:'search-run'};});
 ipcMain.handle('fixture:stop',()=>win.webContents.send('fixture:queue',{id:'search-run',type:'stopped',total:0}));
 void win.loadFile(fixture.page);
});
app.on('window-all-closed',()=>{void global.scheduleManager?.stopAll();app.quit();});

