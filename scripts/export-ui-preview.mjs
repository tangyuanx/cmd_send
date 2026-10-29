// Build a self-contained review artifact from the actual renderer, with a mock
// desktop bridge. The shipped Electron renderer keeps its original strict CSP.
import fs from 'node:fs/promises';
import path from 'node:path';
import {desktopFixture,text} from '../tests/fixtures/ui-desktop.mjs';
const root=path.resolve(import.meta.dirname,'..');
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
const definitions=[
 ['core',['linesOf','sceneName','validCommand','scenesOf','sendPlan']],
 ['search',['literalMatches']],['target-drag',['bindTargetDrag']],
 ['release-notes',['renderReleaseNotes']],['schedules',['initSchedules']],['app',[]],
];
let code=`(${desktopFixture.toString()})(${JSON.stringify({text,version})});\nconst previewModules={};\n`;
for(const [name,exports] of definitions){
 let source=await fs.readFile(path.join(root,'src',name+'.js'),'utf8');
 source=source.replace(/^import \{([^}]+)\} from '\.\/([^']+)\.js';$/gm,(_line,names,dependency)=>`const {${names}}=previewModules[${JSON.stringify(dependency)}];`).replace(/^export /gm,'');
 code+=name==='app'?`await (async()=>{\n${source}\n})();\n`:`previewModules[${JSON.stringify(name)}]=(()=>{\n${source}\nreturn {${exports.join(',')}};\n})();\n`;
}
code+=`
// Bind a fixture target and select a real scene for the initial review state.
const previewTarget=document.getElementById('targetButton');
previewTarget.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,isPrimary:true,button:0,buttons:1,clientX:40,clientY:85,bubbles:true}));
previewTarget.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,isPrimary:true,button:0,buttons:1,clientX:55,clientY:85,bubbles:true}));
previewTarget.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,isPrimary:true,button:0,buttons:0,clientX:55,clientY:85,bubbles:true}));
document.querySelectorAll('.scene-button')[1]?.click();
const previewTheme=document.createElement('button');previewTheme.className='demo-badge';previewTheme.textContent='切换主题';previewTheme.type='button';
previewTheme.addEventListener('click',()=>document.querySelector('[data-theme='+ (document.documentElement.dataset.theme==='dark'?'light':'dark') +']').click());
document.querySelector('.title-right').prepend(previewTheme);
document.querySelector('.brand-en').textContent='交互预览 · 模拟投递';
// Complete only the mock delivery, so cursor advancement can be reviewed.
const fixtureStart=window.desktop.start;
window.desktop.start=async plan=>{const result=await fixtureStart(plan);if(plan.rounds===1)setTimeout(()=>window.uiQueue({id:result.id,type:'completed',total:plan.commands.length}),900);return result;};
`;
const css=await fs.readFile(path.join(root,'src/styles.css'),'utf8');
let html=await fs.readFile(path.join(root,'src/index.html'),'utf8');
html=html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:;">')
 .replace(/<link rel="icon"[^>]*>/,'').replace('<link rel="stylesheet" href="styles.css">',`<style>${css}</style>`)
 .replace('<script type="module" src="app.js"></script>',()=>`<script type="module">${code.replace(/<\/script/gi,'<\\/script')}</script>`);
const destination=path.resolve(process.argv[2]||path.join(root,'test-output/ui/cmd-send-preview.html'));
await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,html);console.log(destination);
