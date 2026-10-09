import assert from 'node:assert/strict';
import {sendPlan,scenesOf,validCommand} from '../src/core.js';

const text='[A]\n# comment\n  echo "#keep"\n\n// ignored\necho [abc]\n[B]\n; skip\nlast\n';
const checks=[
  ()=>assert.equal(sendPlan(text,0,0).commands[0].text,'  echo "#keep"'),
  ()=>assert.equal(sendPlan(text,8,11).commands.length,0),
  ()=>assert.equal(sendPlan(text,0,text.length).commands.length,3),
  ()=>assert.equal(sendPlan(text,text.indexOf('"#keep"')+2,text.indexOf('"#keep"')+2).commands[0].text,'  echo "#keep"'),
  ()=>assert.equal(sendPlan(text,text.indexOf('echo [abc]')+2,text.indexOf('echo [abc]')+6).commands[0].text,'ho ['),
  ()=>assert.equal(sendPlan(text,0,0).next,text.indexOf('echo [abc]')),
  ()=>assert.equal(sendPlan(text,text.indexOf('last'),text.indexOf('last')).next,null),
  ()=>assert.equal(sendPlan(text,0,0,undefined,true).commands.length,0),
  ()=>assert.deepEqual(scenesOf('[A]\nx\n[A]\ny\n[]\n').map(s=>s.name),['A','A']),
  ()=>assert.equal(validCommand(' echo "#keep" '),true),
  ()=>assert.equal(validCommand(' echo [abc] '),true),
  ()=>assert.equal(validCommand('  ; comment'),false),
  ()=>assert.equal(validCommand('custom cmd',['custom']),false),
  ()=>assert.equal(sendPlan('[Empty]\n# x\n',0,0).commands.length,0),
  ()=>assert.equal(sendPlan('  x  \r\n',0,0).commands[0].text,'  x  '),
];
checks.forEach(check=>check());
console.log(`${checks.length} critical command parsing checks passed`);
