import {build,Platform,Arch} from 'electron-builder';
import fs from 'node:fs/promises';
import path from 'node:path';

// The application ID and executable name must stay fixed across upgrades.
export async function windowsInstaller({root,directory,output,version}){
  await fs.writeFile(path.join(directory,'resources','app-update.yml'),
    'provider: github\nowner: tangyuanx\nrepo: cmd_send\nupdaterCacheDirName: cmd-send-updater\n');
  return build({projectDir:root,prepackaged:directory,publish:'never',
    targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),
    config:{appId:'com.tangyuanx.cmd-send',productName:'Cmd Send',asar:false,
      directories:{output},extraMetadata:{version},
      publish:{provider:'github',owner:'tangyuanx',repo:'cmd_send'},
      win:{executableName:'cmd-send',icon:path.join(root,'assets','icon.ico'),signAndEditExecutable:false},
      nsis:{artifactName:`cmd-send-${version}-Windows-x64-Setup.exe`,
        installerIcon:path.join(root,'assets','icon.ico'),uninstallerIcon:path.join(root,'assets','icon.ico'),
        oneClick:false,perMachine:false,allowElevation:false,
        allowToChangeInstallationDirectory:true,deleteAppDataOnUninstall:false,
        shortcutName:'命令定向',runAfterFinish:true}}});
}
