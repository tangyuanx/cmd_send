import {test} from 'node:test';
import assert from 'node:assert/strict';
import {linesOf,sceneName,scenesOf,sendPlan,validCommand} from '../src/core.js';

test('ASCII, fullwidth and Chinese brackets use the same directory and send filtering rules',()=>{
  const text='\uFEFF[串口]\r\necho first\r\n［网络］ # 注释\r\necho second\r\n【版本】 // 说明\r\necho [abc]\r\n【空场景】\r\n; ignored\r\n[最后] ; 注释\r\nlast';
  const scenes=scenesOf(text);
  assert.deepEqual(scenes.map(s=>s.name),['串口','网络','版本','空场景','最后']);
  for(const s of scenes){assert.equal(sceneName(linesOf(text)[s.index].raw),s.name);assert.equal(validCommand(linesOf(text)[s.index].raw),false);assert.equal(text.slice(s.start,s.start+1),s.index===0?'\uFEFF':s.name==='网络'?'［':s.name==='版本'||s.name==='空场景'?'【':'[');}
  assert.deepEqual(sendPlan(text,0,text.length).commands.map(c=>c.text),['echo first','echo second','echo [abc]','last']);
  assert.deepEqual(sendPlan(text,scenes[1].start,scenes[1].start).commands.map(c=>c.text),['echo second']);
});
test('LF, CRLF and CR headings preserve original offsets including repeated names',()=>{
  for(const newline of ['\n','\r\n','\r']){
    const text=['[A]','one','【A】','two'].join(newline),scenes=scenesOf(text);
    assert.deepEqual(scenes.map(s=>[s.name,s.index,s.start]),[['A',0,0],['A',2,6+newline.length*2]]);
    assert.deepEqual(sendPlan(text,0,text.length).commands.map(c=>c.text),['one','two']);
  }
});
test('commands containing brackets and ordinary comments never become directory entries',()=>{
  for(const text of ['echo [abc]','[ -f /tmp/file ] && echo yes','【title】 echo command','# [comment]','// 【comment】','[mismatch］','［mismatch]']){assert.equal(sceneName(text),null);assert.equal(scenesOf(text).length,0);}
  for(const text of ['[]','［ ］','【】']){assert.equal(sceneName(text),'');assert.equal(validCommand(text),false);assert.equal(scenesOf(text).length,0);}
});
