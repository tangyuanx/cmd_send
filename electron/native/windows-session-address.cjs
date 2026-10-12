'use strict';

// Read connection metadata only: no command lines, saved sessions or credentials.
// A MobaXterm host can contain many sessions, so it is NEVER a lookup root.
function parseTcpTable(bytes,family){
  const stride=family===2?24:56,items=[];
  if(bytes.length<4)return items;
  const count=bytes.readUInt32LE(0);
  if(count>Math.floor((bytes.length-4)/stride))throw new Error('Incomplete TCP table');
  for(let i=0;i<count;i++){
    const o=4+i*stride,state=bytes.readUInt32LE(o+(family===2?0:48));
    if(state!==5)continue; // ESTABLISHED only, never listeners or stale sockets.
    const pid=bytes.readUInt32LE(o+(family===2?20:52)),port=bytes.readUInt16BE(o+(family===2?16:44));
    if(!port)continue;
    let address;
    if(family===2)address=Array.from(bytes.subarray(o+12,o+16)).join('.');
    else{
      const raw=bytes.subarray(o+24,o+40);
      if(raw.subarray(0,10).every(v=>v===0)&&raw[10]===255&&raw[11]===255)address=Array.from(raw.subarray(12)).join('.');
      else{
        const groups=Array.from({length:8},(_,j)=>raw.readUInt16BE(j*2).toString(16)).join(':');
        address=new URL(`http://[${groups}]/`).hostname.slice(1,-1);
        const scope=bytes.readUInt32BE(o+40);if(scope)address+=`%${scope}`;
      }
    }
    if(address==='0.0.0.0'||address==='::')continue;
    items.push({pid,address,port});
  }
  return items;
}

function sessionEndpoint(root,processes,connections){
  const byPid=new Map(processes.map(p=>[p.pid,p])),bound=byPid.get(root.pid);
  if(!bound||bound.created!==root.created)return null;
  const descendants=new Set(),queue=[bound];
  while(queue.length){
    const parent=queue.shift();
    for(const p of processes){
      // A recycled parent PID is not proof of a process relationship.
      if(p.pid!==root.pid&&p.parent===parent.pid&&!descendants.has(p.pid)&&p.created&&BigInt(p.created)>=BigInt(parent.created)){
        descendants.add(p.pid);queue.push(p);
      }
    }
  }
  // Local tabs launch ssh/telnet beneath MoTTY. Ignore arbitrary commands
  // such as curl, and never walk up into the shared MobaXterm host.
  const clients=new Set(processes.filter(p=>descendants.has(p.pid)&&/^(?:ssh|telnet|rlogin|plink|putty|puttytel|mosh-client)\.exe$/i.test(p.name)).map(p=>p.pid));
  const childConnections=connections.filter(c=>clients.has(c.pid));
  const candidates=childConnections.length?childConnections:connections.filter(c=>c.pid===root.pid);
  const unique=new Map(candidates.map(c=>[`${c.address}:${c.port}`,{address:c.address,port:c.port}]));
  // Port forwarding, nested connections and ambiguous peers must not invent
  // a destination. Keep the original session label in those cases.
  return unique.size===1?[...unique.values()][0]:null;
}

function createSessionAddressResolver({koffi=require('koffi')}={}){
  const ip=koffi.load('iphlpapi.dll'),kernel=koffi.load('kernel32.dll');
  const ENTRY=koffi.struct('CmdSessionProcessEntry',{size:'uint32_t',usage:'uint32_t',pid:'uint32_t',heap:'uintptr_t',module:'uint32_t',threads:'uint32_t',parent:'uint32_t',priority:'int32_t',flags:'uint32_t',name:'uint16_t[260]'});
  const table=ip.func('uint32_t __stdcall GetExtendedTcpTable(void *table, _Inout_ uint32_t *size, int order, uint32_t family, uint32_t tableClass, uint32_t reserved)');
  const snapshot=kernel.func('void * __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)'),first=kernel.func('int __stdcall Process32FirstW(void *snapshot, _Inout_ CmdSessionProcessEntry *entry)'),next=kernel.func('int __stdcall Process32NextW(void *snapshot, _Inout_ CmdSessionProcessEntry *entry)');
  const open=kernel.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),times=kernel.func('int __stdcall GetProcessTimes(void *process, _Out_ uint64_t *created, _Out_ uint64_t *exit, _Out_ uint64_t *kernel, _Out_ uint64_t *user)'),close=kernel.func('int __stdcall CloseHandle(void *handle)');
  function created(pid){const h=open(0x1000,0,pid);if(!h)return null;try{const birth=[0n],exit=[0n],k=[0n],u=[0n];return times(h,birth,exit,k,u)?String(birth[0]):null;}finally{close(h);}}
  function processes(root){
    const h=snapshot(2,0);if(!h||BigInt(koffi.address(h))===0xffffffffffffffffn)throw new Error('No process snapshot');
    const all=[];
    try{const entry={size:koffi.sizeof(ENTRY)};let ok=first(h,entry);while(ok){all.push({pid:entry.pid,parent:entry.parent,name:Buffer.from(Uint16Array.from(entry.name).buffer).toString('utf16le').split('\0')[0]});ok=next(h,entry);}}finally{close(h);}
    // Read creation times only within this terminal's process subtree.
    const ids=new Set([root.pid]);let changed=true;
    while(changed){changed=false;for(const p of all)if(ids.has(p.parent)&&!ids.has(p.pid)){ids.add(p.pid);changed=true;}}
    return all.filter(p=>ids.has(p.pid)).map(p=>({...p,created:created(p.pid)}));
  }
  function connections(family){
    const size=[0];let status=table(null,size,0,family,4,0); // OWNER_PID_CONNECTIONS
    for(let i=0;i<3&&status===122;i++){
      if(size[0]<4||size[0]>16*1024*1024)throw new Error('Invalid TCP table size');
      const bytes=Buffer.alloc(size[0]);status=table(bytes,size,0,family,4,0);
      if(status===0)return parseTcpTable(bytes.subarray(0,size[0]),family);
    }
    if(status===50)return []; // IPv6 unavailable on this system.
    throw new Error('Cannot read TCP endpoints');
  }
  return root=>{
    try{
      const tree=processes(root),result=sessionEndpoint(root,tree,[...connections(2),...connections(23)]);
      return created(root.pid)===root.created?result:null;
    }catch{return null;} // Missing metadata must not prevent safe native binding.
  };
}
module.exports={createSessionAddressResolver,parseTcpTable,sessionEndpoint};
