'use strict';
const {EventEmitter}=require('node:events');
const RELEASE_PAGE='https://github.com/tangyuanx/cmd_send/releases/latest';
const RELEASE_API='https://api.github.com/repos/tangyuanx/cmd_send/releases/latest';
function stableVersion(value){const match=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value));return match?match.slice(1).map(Number):null;}
function newer(a,b){const x=stableVersion(a),y=stableVersion(b);if(!x||!y)return false;for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;}
function notes(value){if(Array.isArray(value))return value.map(x=>x.note||'').join('\n').slice(0,4000);return String(value||'').slice(0,4000);}
function errorText(error){const message=String(error?.message||error);if(/sha512|checksum/i.test(message))return '下载文件校验失败，请重新下载';if(/404|latest\.yml|ERR_UPDATER_LATEST_VERSION_NOT_FOUND/i.test(message))return 'GitHub 暂未提供可用的升级信息，请稍后重试';return '更新失败，请检查 GitHub 网络连接后重试';}
class ManualUpdates extends EventEmitter {
  constructor({updater=null,version,platform=process.platform,packaged=true,fetchRelease=null}){
    super();Object.assign(this,{updater,version,platform,packaged,fetchRelease});this.pending=null;
    this.state={phase:'idle',currentVersion:version,supported:platform==='win32'&&packaged&&!!updater,availableVersion:null,progress:0,error:null};
    if(updater){
      updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.autoRunAppAfterInstall=true;
      updater.allowDowngrade=false;updater.allowPrerelease=false;updater.disableDifferentialDownload=true;updater.disableWebInstaller=true;
      updater.on('update-available',info=>this.available(info));
      updater.on('update-not-available',()=>this.set({phase:'current',availableVersion:null,error:null,progress:0}));
      updater.on('download-progress',p=>this.set({phase:'downloading',progress:Math.max(0,Math.min(100,Number(p.percent)||0)),transferred:p.transferred,total:p.total}));
      updater.on('update-downloaded',info=>{if(newer(info.version,this.version))this.set({phase:'downloaded',progress:100,error:null});});
      updater.on('error',error=>this.set({phase:'error',error:errorText(error)}));
    }
  }
  snapshot(){return {...this.state};}
  set(patch){Object.assign(this.state,patch);this.emit('state',this.snapshot());return this.snapshot();}
  available(info){
    if(!newer(info.version,this.version))return this.set({phase:'current',availableVersion:null,error:null});
    return this.set({phase:'available',availableVersion:info.version,releaseNotes:notes(info.releaseNotes||info.body),releaseDate:info.releaseDate||null,progress:0,error:null});
  }
  async check(){
    if(['downloading','installing','downloaded'].includes(this.state.phase))return this.snapshot();
    if(this.pending)return this.pending;
    this.set({phase:'checking',availableVersion:null,error:null,progress:0});
    this.pending=(async()=>{
      try{
        if(this.state.supported){const result=await this.updater.checkForUpdates();if(!result)throw new Error('No update info');}
        else{if(!this.fetchRelease)throw new Error('Release check unavailable');const info=await this.fetchRelease(RELEASE_API);if(info.draft||info.prerelease||!stableVersion(info.tag_name))throw new Error('Invalid release');this.available({version:info.tag_name.replace(/^v/,''),body:info.body});}
      }catch(error){this.set({phase:'error',error:errorText(error)});}
      return this.snapshot();
    })().finally(()=>this.pending=null);
    return this.pending;
  }
  async download(){
    if(!this.state.supported)throw new Error('请从发布页面下载安装包');
    if(this.pending)return this.pending;
    if(this.state.phase==='downloaded')return this.snapshot();
    if(!this.state.availableVersion||!['available','error'].includes(this.state.phase))throw new Error('请先检查更新');
    this.set({phase:'downloading',progress:0,error:null});
    this.pending=(async()=>{try{await this.updater.downloadUpdate();}catch(error){this.set({phase:'error',error:errorText(error)});}return this.snapshot();})().finally(()=>this.pending=null);
    return this.pending;
  }
  install(){
    if(!this.state.supported||this.state.phase!=='downloaded')throw new Error('请先下载并校验升级包');
    this.set({phase:'installing',error:null});
    try{this.updater.quitAndInstall(true,true);}catch(error){this.set({phase:'error',error:errorText(error)});throw error;}
  }
}
module.exports={ManualUpdates,newer,RELEASE_PAGE};
