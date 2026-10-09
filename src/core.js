export function linesOf(text) {
  let offset=0;
  return text.split('\n').map((raw,index)=>{const line={raw:raw.endsWith('\r')?raw.slice(0,-1):raw,index,start:offset,end:offset+raw.length};offset+=raw.length+1;return line;});
}
export function validCommand(raw,prefixes=['#','//',';']) {
  const s=raw.trim();
  return !!s&&!/^\[[^\]\r\n]*\]$/.test(s)&&!prefixes.some(p=>p&&s.startsWith(p));
}
export function scenesOf(text) {
  return linesOf(text).flatMap(l=>{const match=l.raw.trim().match(/^\[([^\]\r\n]+)\]$/);return match&&match[1].trim()?[{name:match[1].trim(),start:l.start,index:l.index}]:[];});
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
