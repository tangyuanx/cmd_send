// Release descriptions are remote content. Rebuild a small set of formatting
// elements, with no source attributes, active links or executable content.
const allowed=new Set(['P','DIV','SPAN','UL','OL','LI','H1','H2','H3','H4','H5','H6','STRONG','B','EM','I','S','DEL','CODE','PRE','BLOCKQUOTE','BR','HR','TABLE','THEAD','TBODY','TFOOT','TR','TH','TD']);
const discarded=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','TEMPLATE','NOSCRIPT','FORM','INPUT','BUTTON','TEXTAREA','SELECT','LINK','META','BASE','IMG','VIDEO','AUDIO','SOURCE']);
const rendered=new WeakMap();
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function inline(value){
  // Code spans and escaped punctuation cannot become emphasis or links.
  const tokens=[];const token=html=>`\u0001${tokens.push(html)-1}\u0002`;
  let text=value.replace(/`([^`]+)`/g,(_match,code)=>token(`<code>${escape(code)}</code>`)).replace(/\\([\\`*_{}[\]()#+.!>\-])/g,(_match,char)=>token(escape(char)));
  text=escape(text).replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_match,label,url)=>`${label} (${url})`)
    .replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/__([^_\n]+)__/g,'<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g,'<em>$1</em>').replace(/~~([^~\n]+)~~/g,'<del>$1</del>');
  return text.replace(/\u0001(\d+)\u0002/g,(_match,id)=>tokens[Number(id)]||'');
}
function markdown(source,depth=0){
  if(depth>32)return `<p>${escape(source)}</p>`;
  const lines=source.replace(/\r\n?/g,'\n').split('\n'),blocks=[];let i=0;
  const list=line=>/^(\s*)([-+*]|\d+[.)])\s+(.*)$/.exec(line);
  function listBlock(indent){
    const first=list(lines[i]),ordered=/\d/.test(first[2]),tag=ordered?'ol':'ul';let html=`<${tag}>`;
    while(i<lines.length){
      const item=list(lines[i]);if(!item||item[1].length!==indent||/\d/.test(item[2])!==ordered)break;
      html+=`<li>${inline(item[3])}`;i++;
      while(i<lines.length){
        const child=list(lines[i]);if(child&&child[1].length>indent){html+=listBlock(child[1].length);continue;}
        if(!child&&lines[i].trim()&&/^\s+/.test(lines[i])){html+=' '+inline(lines[i].trim());i++;continue;}break;
      }
      html+='</li>';
    }
    return html+`</${tag}>`;
  }
  const startsBlock=line=>/^\s*(?:#{1,6}\s|```|~~~|>|(?:[-+*]|\d+[.)])\s|<(?:p|div|ul|ol|h[1-6]|pre|table|blockquote)\b)/i.test(line);
  while(i<lines.length){
    const line=lines[i];if(!line.trim()){i++;continue;}
    const fence=/^\s*(`{3,}|~{3,})/.exec(line);
    if(fence){i++;const code=[];while(i<lines.length&&!lines[i].trimStart().startsWith(fence[1]))code.push(lines[i++]);if(i<lines.length)i++;blocks.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);continue;}
    const heading=/^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
    if(heading){blocks.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);i++;continue;}
    if(list(line)){blocks.push(listBlock(list(line)[1].length));continue;}
    if(/^\s*>/.test(line)){const quote=[];while(i<lines.length&&/^\s*>/.test(lines[i]))quote.push(lines[i++].replace(/^\s*> ?/,''));blocks.push(`<blockquote>${markdown(quote.join('\n'),depth+1)}</blockquote>`);continue;}
    if(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)){blocks.push('<hr>');i++;continue;}
    if(/^\s*<(?:p|div|ul|ol|h[1-6]|pre|table|blockquote)\b/i.test(line)){const html=[];while(i<lines.length&&lines[i].trim())html.push(lines[i++]);blocks.push(html.join('\n'));continue;}
    const paragraph=[line];i++;while(i<lines.length&&lines[i].trim()&&!startsBlock(lines[i]))paragraph.push(lines[i++]);
    blocks.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
  }
  return blocks.join('\n');
}
export function renderReleaseNotes(container,value){
  const source=String(value||'');if(rendered.get(container)===source)return;
  const document=container.ownerDocument,template=document.createElement('template');
  // Template content is inert: embedded resources are never inserted into the
  // live document. Only fresh allowlisted elements can leave this template.
  template.innerHTML=/^\s*<(?:p|div|ul|ol|h[1-6]|pre|table|blockquote)\b/i.test(source)?source:markdown(source);
  function copy(from,to,depth=0){
    if(depth>64)return;
    for(const node of from.childNodes){
      if(node.nodeType===3){to.append(document.createTextNode(node.textContent));continue;}
      if(node.nodeType!==1||discarded.has(node.tagName))continue;
      if(!allowed.has(node.tagName)){copy(node,to,depth+1);continue;}
      const element=document.createElement(node.tagName.toLowerCase());
      if(node.tagName==='OL'&&/^\d{1,6}$/.test(node.getAttribute('start')||''))element.setAttribute('start',node.getAttribute('start'));
      copy(node,element,depth+1);to.append(element);
    }
  }
  const content=document.createDocumentFragment();copy(template.content,content);container.replaceChildren(content);container.hidden=!container.textContent.trim();rendered.set(container,source);
}
