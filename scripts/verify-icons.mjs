// Check the actual packaged resources, including the NSIS setup and uninstaller.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Data,NtExecutable,NtExecutableResource,Resource} from 'resedit';

function bytes(item){return Buffer.from(item.isRaw()?item.bin:item.generate());}
export async function verifyWindowsIcon(executable,icon){
  const expected=Data.IconFile.from(await fs.readFile(icon)).icons.map(item=>bytes(item.data));
  const resources=NtExecutableResource.from(NtExecutable.from(await fs.readFile(executable),{ignoreCert:true}));
  const groups=Resource.IconGroupEntry.fromEntries(resources.entries);
  assert.ok(groups.some(group=>{
    const actual=group.getIconItemsFromEntries(resources.entries).map(bytes);
    return expected.every(item=>actual.some(value=>value.equals(item)));
  }),`${path.basename(executable)} does not contain the application icon at every size`);
  console.log(`PASS: ${path.basename(executable)} embeds the custom ${expected.length}-size terminal icon`);
}

export async function verifyMacIcon(bundle,icon){
  const contents=path.join(bundle,'Contents');
  const name=execFileSync('plutil',['-extract','CFBundleIconFile','raw','-o','-',path.join(contents,'Info.plist')],{encoding:'utf8'}).trim();
  assert.ok(name&&path.basename(name)===name,'Invalid bundle icon name');
  const file=path.join(contents,'Resources',name.endsWith('.icns')?name:`${name}.icns`);
  assert.deepEqual(await fs.readFile(file),await fs.readFile(icon),'Bundle icon differs from the terminal icon');
  console.log(`PASS: macOS bundle references and embeds the custom terminal ICNS`);
}
