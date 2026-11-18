import {packager} from '@electron/packager';
import {windowsInstaller} from './windows-installer.mjs';
import {verifyWindowsIcon} from './verify-icons.mjs';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const [platform='win32',arch='x64']=process.argv.slice(2);
if(platform!=='win32'||arch!=='x64')throw new Error('Only Windows x64 builds are currently supported');
// npm only installs the host's optional native package. Cross builds need the target's binary.
async function targetNative({buildPath}){
 const packageName=`@koromix/koffi-${platform}-${arch}`,destination=path.join(buildPath,'node_modules',packageName);
 try{await fs.access(path.join(destination,`${platform}_${arch}`,'koffi.node'));return;}catch{}
 const cache=path.join(os.tmpdir(),'cmd-send-native-cache');await fs.mkdir(cache,{recursive:true});
 const archive=`koromix-koffi-${platform}-${arch}-3.3.2.tgz`;
 try{await fs.access(path.join(cache,archive));}catch{execFileSync(process.platform==='win32'?'npm.cmd':'npm',['pack',`${packageName}@3.3.2`,'--pack-destination',cache],{cwd:root,stdio:'inherit',shell:process.platform==='win32'});}
 await fs.mkdir(destination,{recursive:true});execFileSync('tar',['-xf',path.join(cache,archive),'-C',destination,'--strip-components=1']);
 await fs.access(path.join(destination,`${platform}_${arch}`,'koffi.node'));
}
const checksums=JSON.parse(await fs.readFile(path.join(root,'node_modules/electron/checksums.json'),'utf8'));
const icon=path.join(root,'assets','icon.ico');
const paths=await packager({dir:root,name:'Cmd Send',platform,arch,icon,electronVersion:'44.7.0',out:path.join(root,'artifacts'),overwrite:true,asar:false,prune:true,afterPrune:[targetNative],appVersion:version,buildVersion:version,executableName:'cmd-send',ignore:[/^\/test-output(?:\/|$)/,/^\/artifacts(?:\/|$)/,/^\/qa(?:\/|$)/,/^\/tests(?:\/|$)/,/^\/scripts(?:\/|$)/,/^\/\.git(?:\/|$)/,/^\/\.github(?:\/|$)/,/(?:^|\/)\._[^/]*(?:\/|$)/],download:{cacheRoot:path.join(os.tmpdir(),'cmd-send-electron-cache'),checksums}});
for(const directory of paths){
 await fs.copyFile(path.join(root,'examples','快速验证.txt'),path.join(directory,'快速验证.txt'));
 await fs.copyFile(path.join(root,'README.md'),path.join(directory,'使用说明.md'));
 await verifyWindowsIcon(path.join(directory,'cmd-send.exe'),icon);
 await windowsInstaller({root,directory,output:path.join(root,'artifacts'),version});
 await verifyWindowsIcon(path.join(root,'artifacts',`cmd-send-${version}-Windows-x64-Setup.exe`),icon);
}

