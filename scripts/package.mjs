import {packager} from '@electron/packager';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const [platform='darwin',arch='arm64']=process.argv.slice(2);
if(![['darwin','arm64'],['darwin','x64'],['win32','x64']].some(([p,a])=>p===platform&&a===arch))throw new Error('Unsupported build target');
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
const paths=await packager({dir:root,name:'Cmd Send',platform,arch,electronVersion:'44.7.0',out:path.join(root,'artifacts'),overwrite:true,asar:false,prune:true,afterPrune:[targetNative],appBundleId:'com.tangyuanx.cmd-send',appVersion:version,buildVersion:version,executableName:'cmd-send',extendInfo:{CFBundleDisplayName:'命令定向',NSAccessibilityUsageDescription:'将用户选择的命令发送到指定应用的输入区。'},ignore:[/^\/artifacts(?:\/|$)/,/^\/qa(?:\/|$)/,/^\/tests(?:\/|$)/,/^\/scripts(?:\/|$)/,/^\/\.git(?:\/|$)/,/^\/\.github(?:\/|$)/],download:{cacheRoot:path.join(os.tmpdir(),'cmd-send-electron-cache'),checksums}});
for(const directory of paths){
 await fs.copyFile(path.join(root,'examples','快速验证.txt'),path.join(directory,'快速验证.txt'));
 await fs.copyFile(path.join(root,'README.md'),path.join(directory,'使用说明.md'));
 const name=`cmd-send-${version}-${platform==='darwin'?'macOS':'Windows'}-${arch}`;
 if(platform==='darwin')execFileSync('codesign',['--force','--deep','--sign','-',path.join(directory,'Cmd Send.app')],{stdio:'inherit'});
 const zip=path.join(root,'artifacts',`${name}.zip`);
 if(process.platform==='darwin')execFileSync('ditto',['-c','-k','--sequesterRsrc','--keepParent',directory,zip],{stdio:'inherit'});
 else if(process.platform==='win32')execFileSync('powershell.exe',['-NoProfile','-Command',`Compress-Archive -LiteralPath '${directory.replaceAll("'","''")}' -DestinationPath '${zip.replaceAll("'","''")}' -Force`],{stdio:'inherit'});
 else execFileSync('zip',['-q','-r',zip,path.basename(directory)],{cwd:path.dirname(directory),stdio:'inherit'});
 console.log(zip);
}
