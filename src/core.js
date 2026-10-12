export function linesOf(text) {
  let offset=0;
  return text.split(/\r\n|\n|\r/).map((raw,index)=>{const line={raw,index,start:offset,end:offset+raw.length};offset+=raw.length+(text.slice(line.end,line.end+2)==='\r\n'?2:1);return line;});
}
// A heading occupies a complete line. Never treat brackets inside a command as a heading.
export function sceneName(raw) {
  const match=raw.trim().match(/^(?:\[([^\]\r\n]*)\]|［([^］\r\n]*)］|【([^】\r\n]*)】)\s*(?:(?:#|\/\/|;).*)?$/);
  return match?match.slice(1).find(name=>name!==undefined).trim():null;
}
export function validCommand(raw,prefixes=['#','//',';']) {
  const s=raw.trim();
  return !!s&&sceneName(raw)===null&&!prefixes.some(p=>p&&s.startsWith(p));
}
export function scenesOf(text) {
  return linesOf(text).flatMap(l=>{const name=sceneName(l.raw);return name?[{name,start:l.start,index:l.index}]:[];});
}
export function sendPlan(text,start,end,prefixes=['#','//',';'],exhausted=false) {
  const lines=linesOf(text),selected=start!==end;
  if(selected) return {selected,commands:lines.filter(l=>l.start<end&&l.end>start&&validCommand(l.raw,prefixes)).map(l=>({text:text.slice(Math.max(start,l.start),Math.min(end,l.end)).replace(/\r$/,''),start:l.start,index:l.index})).filter(c=>c.text.trim()),next:null};
  if(exhausted)return {selected:false,commands:[],next:null,atEnd:true};
  const index=lines.findLastIndex(l=>l.start<=start),command=lines.slice(Math.max(0,index)).find(l=>validCommand(l.raw,prefixes));
  if(!command)return {selected:false,commands:[],next:null,atEnd:true};
  const next=lines.slice(command.index+1).find(l=>validCommand(l.raw,prefixes));
  return {selected:false,commands:[{text:command.raw,start:command.start,index:command.index}],next:next?.start??null};
}
