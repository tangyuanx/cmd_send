import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindTargetDrag} from '../src/target-drag.js';

function setup(){
  const button=new EventTarget(),doc=new EventTarget(),captures=new Set();
  Object.assign(button,{ownerDocument:doc,setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id)});
  const state={drags:0,clicks:0,cancels:0,allowed:true};
  const drag=bindTargetDrag(button,{canStart:()=>state.allowed,onDrag:()=>state.drags++,onClick:()=>state.clicks++,onCancel:()=>state.cancels++});
  const emit=(type,extra={})=>{const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:1,isPrimary:true,button:0,buttons:1,clientX:100,clientY:100,detail:1,...extra});(type==='pointerup'?doc:button).dispatchEvent(e);};
  return {state,drag,emit,captures};
}
test('movement starts picking immediately without waiting; pointer capture extends beyond the button',()=>{
  const {emit,state,captures}=setup();emit('pointerdown');assert.ok(captures.has(1));assert.equal(state.drags,0);
  emit('pointermove',{clientX:106});assert.equal(state.drags,1);
  emit('pointermove',{clientX:1000,clientY:-400});assert.equal(state.drags,1);
  emit('pointerup',{buttons:0});assert.equal(captures.size,0);emit('click');assert.equal(state.clicks,0);
});
test('single click and small jitter open help without starting a native picker',()=>{
  const {emit,state}=setup();emit('pointerdown');emit('pointermove',{clientX:102,clientY:101});emit('pointerup',{buttons:0});emit('click');assert.equal(state.clicks,1);assert.equal(state.drags,0);
});
test('a click after an outside drop works and keyboard activation stays accessible',()=>{
  const {emit,state}=setup();emit('pointerdown');emit('pointermove',{clientX:120});emit('pointerup',{buttons:0});
  emit('pointerdown');emit('pointerup',{buttons:0});emit('click');assert.equal(state.clicks,1);
  emit('click',{detail:0});assert.equal(state.clicks,2);
});
test('Escape or pointer cancellation prevents a late start and suppresses the release click',()=>{
  const {emit,state,drag}=setup();emit('pointerdown');assert.equal(drag.cancel(),true);emit('pointermove',{clientX:120});emit('click');assert.equal(state.drags,0);assert.equal(state.clicks,0);
  emit('pointerdown');emit('pointermove',{clientX:120});emit('pointercancel');emit('click');assert.equal(state.cancels,1);assert.equal(state.clicks,0);assert.equal(drag.cancel(),false);
});
test('lost DOM capture leaves the native global release monitor running after a drag starts',()=>{
  const {emit,state}=setup();emit('pointerdown');emit('pointermove',{clientX:120});emit('lostpointercapture');assert.equal(state.drags,1);assert.equal(state.cancels,0);emit('click');assert.equal(state.clicks,0);
});
test('right clicks, secondary pointers, sending state and move-after-release do not pick',()=>{
  const {emit,state}=setup();emit('pointerdown',{button:2});emit('pointermove',{clientX:120});emit('pointerdown',{isPrimary:false});emit('pointermove',{clientX:120});assert.equal(state.drags,0);
  state.allowed=false;emit('pointerdown');emit('pointermove',{clientX:120});assert.equal(state.drags,0);
  state.allowed=true;emit('pointerdown');emit('pointermove',{buttons:0,clientX:120});assert.equal(state.drags,0);
});
