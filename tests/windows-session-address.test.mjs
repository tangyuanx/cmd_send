import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {parseTcpTable,sessionEndpoint,parseCygwinProcesses,cygwinClients}=createRequire(import.meta.url)('../electron/native/windows-session-address.cjs');
const root={pid:10,created:'100'},processes=[{...root,parent:1,name:'MoTTY.exe'},{pid:20,parent:10,created:'101',name:'bash.exe'},{pid:30,parent:20,created:'102',name:'ssh.exe'},{pid:40,parent:1,created:'103',name:'MoTTY.exe'},{pid:50,parent:40,created:'104',name:'ssh.exe'}];
test('session endpoints belong to the exact bound terminal, never sibling tabs or the host',()=>{
  assert.deepEqual(sessionEndpoint(root,processes,[{pid:30,address:'192.168.1.10',port:22},{pid:50,address:'192.168.1.20',port:22},{pid:1,address:'192.168.1.30',port:22}]),{address:'192.168.1.10',port:22});
  assert.equal(sessionEndpoint(root,processes,[{pid:50,address:'192.168.1.20',port:22}]),null);
  assert.deepEqual(sessionEndpoint(root,processes,[{pid:10,address:'10.0.0.2',port:2222}]),{address:'10.0.0.2',port:2222});
});
test('reused processes and unrelated network commands cannot supply session addresses',()=>{
  const connection=[{pid:30,address:'10.0.0.2',port:22}];
  assert.equal(sessionEndpoint({...root,created:'99'},processes,connection),null);
  assert.equal(sessionEndpoint(root,processes.map(p=>p.pid===30?{...p,created:'90'}:p),connection),null);
  assert.equal(sessionEndpoint(root,processes.map(p=>p.pid===30?{...p,name:'curl.exe'}:p),connection),null);
});
test('ambiguous connections retain the original session label; duplicate endpoints are safe',()=>{
  const a={pid:30,address:'10.0.0.2',port:22};
  assert.deepEqual(sessionEndpoint(root,processes,[a,a]),{address:a.address,port:22});
  assert.equal(sessionEndpoint(root,processes,[a,{...a,address:'10.0.0.3'}]),null);
  assert.equal(sessionEndpoint(root,processes,[a,{...a,port:2222}]),null);
});
test('IPv4 TCP rows decode network byte order and skip listening/stale endpoints',()=>{
  const bytes=Buffer.alloc(4+3*24);bytes.writeUInt32LE(3);
  for(let i=0;i<3;i++){const o=4+i*24;bytes.writeUInt32LE([5,2,11][i],o);bytes.set([192,168,1,10],o+12);bytes.writeUInt16BE(2222,o+16);bytes.writeUInt32LE(30,o+20);}
  assert.deepEqual(parseTcpTable(bytes,2),[{pid:30,address:'192.168.1.10',port:2222}]);
  assert.throws(()=>parseTcpTable(bytes.subarray(0,bytes.length-1),2),/Incomplete/);
});
test('IPv6 TCP rows preserve port, compressed address, mapped IPv4 and scope',()=>{
  const bytes=Buffer.alloc(4+3*56);bytes.writeUInt32LE(3);
  for(let i=0;i<3;i++){const o=4+i*56;bytes.writeUInt16BE(22,o+44);bytes.writeUInt32LE(5,o+48);bytes.writeUInt32LE(30,o+52);}
  bytes.set(Buffer.from('20010db8000000000000000000000001','hex'),28);
  bytes.set(Buffer.from('00000000000000000000ffffc0a8010a','hex'),84);
  bytes.set(Buffer.from('fe800000000000000000000000000001','hex'),140);bytes.writeUInt32BE(7,4+2*56+40);
  assert.deepEqual(parseTcpTable(bytes,23),[{pid:30,address:'2001:db8::1',port:22},{pid:30,address:'192.168.1.10',port:22},{pid:30,address:'fe80::1%7',port:22}]);
});
test('Cygwin exec ancestry is anchored to the exact terminal pipe, never tab order or another pipe',()=>{
  const list=parseCygwinProcesses('100|700 (cygtermd) S 1 700 700 0\n200|701 (zsh) S 700 701 701 34818\n300|710 (_ssh) S 701 701 701 34818\n400|720 (cygtermd) S 1 720 720 0\n500|721 (_ssh) S 720 721 721 34819\n');
  assert.deepEqual(cygwinClients(list,pid=>pid===100),[300]);
  assert.deepEqual(cygwinClients(list,pid=>pid===400),[500]);
  assert.deepEqual(cygwinClients(list,()=>false),[]);
  assert.deepEqual(cygwinClients(list,()=>true),[]);
  assert.deepEqual(cygwinClients(list.map(p=>p.winpid===300?{...p,name:'curl'}:p),pid=>pid===100),[]);
});
