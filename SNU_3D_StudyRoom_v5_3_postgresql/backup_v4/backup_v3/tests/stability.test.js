import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import {once} from 'node:events';

process.env.NODE_ENV='test-autostart-disabled';
process.env.RECONNECT_GRACE_MS='700';
const {server,rooms}=await import('../server/index.js');
const {NPC_SEATS,LAYOUT_SEATS,koreaDay,koreaMidnightUtc}=await import('../server/room.js');
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const wsBase=base.replace('http','ws')+'/ws';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const opened=new Set();
const stopServer=async()=>{
  for(const s of opened)try{s.close()}catch{};
  for(const c of rooms.connections)try{c.peer.socket.destroy()}catch{};
  server.closeAllConnections();
  if(server.listening)await new Promise(r=>server.close(r));
};
after(stopServer);
// Incoming messages are buffered so tests can assert asynchronous, ordered events.
async function join(token,room='stability') {
  const socket=new WebSocket(wsBase);opened.add(socket);
  const queue=[];const waiter=[];
  socket.addEventListener('message',e=>{
    const data=JSON.parse(e.data);queue.push(data);
    for(const w of [...waiter])if(w.filter(data)){
      clearTimeout(w.timeout);waiter.splice(waiter.indexOf(w),1);w.resolve(data);
    }
  });
  await once(socket,'open');
  socket.send(JSON.stringify({t:'join',room,token,profile:{nick:'테스트',species:'cat',hood:'#8bcaff'}}));
  const client={socket,queue,send:data=>socket.send(JSON.stringify(data)),
    close:()=>socket.close(),wait:(filter,timeout=4000)=>{
      const current=queue.find(filter);if(current)return Promise.resolve(current);
      return new Promise((resolve,reject)=>{const w={filter,resolve,reject};w.timeout=setTimeout(()=>{
        waiter.splice(waiter.indexOf(w),1);reject(new Error('Timed out '+JSON.stringify(queue.slice(-5))));
      },timeout);waiter.push(w);});
    }};
  await client.wait(m=>m.t==='welcome');return client;
}
async function session(token=''){
  const response=await fetch(base+'/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});
  assert.equal(response.status,200);return response.json();
}
async function rawHandshake(originHeader,extras='',connectionLine='Connection: Upgrade'){
  const socket=net.createConnection({host:'127.0.0.1',port:server.address().port});
  const host=new URL(base).host,key=crypto.randomBytes(16).toString('base64');
  const result=new Promise((resolve,reject)=>{
    let data='';const timeout=setTimeout(()=>{socket.destroy();reject(new Error('Handshake timed out'));},3000);
    socket.on('data',b=>{data+=b.toString('latin1');if(data.includes('\r\n\r\n')){
      clearTimeout(timeout);socket.destroy();resolve(data.split('\r\n')[0]);
    }});
    socket.on('error',e=>{clearTimeout(timeout);reject(e)});
  });
  await once(socket,'connect');
  socket.write('GET /ws HTTP/1.1\r\nHost: '+host+'\r\nUpgrade: websocket\r\n'+connectionLine+'\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: '+key+'\r\n'+(originHeader?'Origin: '+originHeader+'\r\n':'')+extras+'\r\n');
  return result;
}

test('security: same-origin checks, malformed handshakes, JSON/frame size and binary frame limits',{timeout:15000},async()=>{
  const wrongOrigin=await fetch(base+'/api/session',{method:'POST',headers:{origin:'https://external.example','content-type':'application/json'},body:'{}'});
  assert.equal(wrongOrigin.status,403);
  assert.match(await rawHandshake('https://external.example'),/403 Forbidden/);
  assert.match(await rawHandshake(base),/101 Switching Protocols/);
  assert.match(await rawHandshake(base,'','Connection: keep-alive'),/(400 Bad Request|404 Not Found)/);
  // Server allows native client without Origin; browser cross-site origin is rejected.
  const forbidden=new WebSocket(wsBase);opened.add(forbidden);
  const denied=[];forbidden.addEventListener('message',e=>denied.push(JSON.parse(e.data)));
  await once(forbidden,'open');
  forbidden.send(JSON.stringify({t:'join',token:'forged-token',room:'security',profile:{nick:'attacker'}}));
  await once(forbidden,'close');
  assert.equal(denied.some(m=>m.t==='error'&&m.code==='auth'),true);
  const a=await session();const A=await join(a.token,'security');
  assert.equal(A.queue[0].id,a.id);
  A.send({t:'chat',message:'x'.repeat(6000)});
  const closed=await Promise.race([once(A.socket,'close'),sleep(3500).then(()=>{throw Error('No close after large message')})]);
  assert.ok(closed);
  const b=await session(), B=await join(b.token,'binary');
  B.socket.send(new Uint8Array([5,4,3]));
  await Promise.race([once(B.socket,'close'),sleep(3500).then(()=>{throw Error('No close after binary frame')})]);
  const c=await session(),C=await join(c.token,'rate');
  for(let i=0;i<48;i++)try{C.send({t:'sync'})}catch{}
  await Promise.race([once(C.socket,'close'),sleep(3500).then(()=>{throw Error('No close after rate flood')})]);
});

test('timer: server-only elapsed, pause/resume, background-like idle, rejoin and seat lock cleanup',{timeout:16000},async()=>{
  const a=await session(),b=await session(),A=await join(a.token,'clock'),B=await join(b.token,'clock');
  const s=LAYOUT_SEATS.find(v=>!NPC_SEATS.has(v.id)&&v.z>25&&v.x>5&&v.x<6&&v.sign===1);
  assert.ok(s);
  const near={x:s.x,z:s.z+s.sign*2.62};
  // Access a legal nearby position without teleporting through a wall: step along
  // a known walkable route (same methodology as the original v2 integration test).
  let x=0,z=35;
  A.send({t:'seat_request',seatId:s.id});await A.wait(m=>m.t==='seat_granted'&&m.seatId===s.id);
  for(let i=1;i<=12;i++){x=near.x*i/12;A.send({t:'move',x,z,yaw:0});await sleep(110);}
  for(let i=1;i<=12;i++){z=35+(near.z-35)*i/12;A.send({t:'move',x,z,yaw:0});await sleep(110);}
  A.send({t:'seat_sit',seatId:s.id});
  await A.wait(m=>m.t==='player'&&m.player.id===a.id&&m.player.seatId===s.id);
  await sleep(1200);A.send({t:'sync'});
  const first=await A.wait(m=>m.t==='snapshot'&&m.players.find(v=>v.id===a.id).studyMs>=900);
  const started=first.players.find(v=>v.id===a.id).studyMs;
  assert.equal(first.day,koreaDay());
  assert.ok(Number.isFinite(first.serverNow));
  // A browser can be completely idle/suspended while the socket remains open.
  await sleep(1200);A.send({t:'sync'});
  const second=await A.wait(m=>m.t==='snapshot'&&m.players.find(v=>v.id===a.id).studyMs>=started+900);
  assert.ok(second.players.find(v=>v.id===a.id).studyMs>started);
  A.send({t:'pause',paused:true});
  await A.wait(m=>m.t==='clock'&&m.players.some(v=>v.id===a.id&&v.paused===true));
  A.send({t:'sync'});let current=await A.wait(m=>m.t==='snapshot'&&m.players.find(v=>v.id===a.id).paused);
  const held=current.players.find(v=>v.id===a.id).studyMs;
  await sleep(1120);A.send({t:'sync'});
  // Identify newest snapshot rather than an earlier cached one.
  await sleep(100);current=A.queue.filter(m=>m.t==='snapshot').at(-1);
  assert.ok(Math.abs(current.players.find(v=>v.id===a.id).studyMs-held)<100,'paused time stays frozen');
  A.send({t:'pause',paused:false});
  await A.wait(m=>m.t==='clock'&&m.players.some(v=>v.id===a.id&&v.paused===false));
  A.close();await B.wait(m=>m.t==='player'&&m.player.id===a.id&&!m.player.online);
  const rejoin=await join(a.token,'clock');
  const resume=rejoin.queue.find(m=>m.t==='welcome');
  assert.equal(resume.resumed,true);
  const state=resume.players.find(v=>v.id===a.id);
  assert.equal(state.seatId,s.id);
  assert.equal(state.paused,true,'disconnected guests are paused by server');
  assert.ok(state.studyMs>=held);
  rejoin.close();await B.wait(m=>m.t==='left'&&m.id===a.id,5000);
  B.send({t:'seat_request',seatId:s.id});await B.wait(m=>m.t==='seat_granted'&&m.seatId===s.id);
});

test('KST midnight accounting includes time elapsed after midnight even with delayed tick',()=>{
  const dayBefore=Date.parse('2026-11-03T14:59:45Z'); // 23:59:45 KST
  const dayAfter=Date.parse('2026-11-03T15:00:08Z');  // 00:00:08 KST
  assert.notEqual(koreaDay(dayBefore),koreaDay(dayAfter));
  assert.equal(koreaMidnightUtc(dayAfter),Date.parse('2026-11-03T15:00:00Z'));
  const p={day:koreaDay(dayBefore),studyMs:300000,studying:true,paused:false,studyStartedAt:dayBefore};
  const result=rooms.studyMs(p,dayAfter);
  assert.equal(result,8000);
  assert.equal(p.day,koreaDay(dayAfter));
  assert.equal(p.studyMs,0);
  p.studying=false;p.studyMs=2500;
  assert.equal(rooms.studyMs(p,dayAfter+2000),2500);
});

function maskedFrame(opcode,payload,final=true){
  const data=Buffer.isBuffer(payload)?payload:Buffer.from(payload);
  const bytes=data.length,headerSize=bytes<126?2:4,mask=crypto.randomBytes(4);
  const frame=Buffer.alloc(headerSize+4+bytes);
  frame[0]=(final?0x80:0)|opcode;
  frame[1]=0x80|(bytes<126?bytes:126);
  if(headerSize===4)frame.writeUInt16BE(bytes,2);
  mask.copy(frame,headerSize);
  for(let i=0;i<bytes;i++)frame[headerSize+4+i]=data[i]^mask[i%4];
  return frame;
}
async function protocolSocket(){
  const socket=net.connect(server.address().port,'127.0.0.1');
  await once(socket,'connect');
  const key=crypto.randomBytes(16).toString('base64');
  const handshake='GET /ws HTTP/1.1\r\nHost: 127.0.0.1:'+server.address().port+'\r\nOrigin: '+base+
    '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: '+key+'\r\n\r\n';
  let buffer=Buffer.alloc(0);
  const header=new Promise((resolve,reject)=>{
    const fail=setTimeout(()=>reject(new Error('Protocol handshake timed out')),2500);
    function onData(b){buffer=Buffer.concat([buffer,b]);const marker=buffer.indexOf('\r\n\r\n');
      if(marker>=0){clearTimeout(fail);socket.off('data',onData);const text=buffer.subarray(0,marker).toString('utf8');
      buffer=buffer.subarray(marker+4);resolve(text);}
    }socket.on('data',onData);
  });
  socket.write(handshake);
  const reply=await header;
  assert.match(reply,/101 Switching Protocols/);
  return {socket,initial:buffer};
}

test('restricted WebSocket transport: masked fragmentation, ping inside fragments, unmasked frame rejection',{timeout:9000},async()=>{
  const identity=await session();
  const {socket}=await protocolSocket();
  const received=[];socket.on('data',b=>received.push(b));
  const json=JSON.stringify({t:'join',token:identity.token,room:'raw-wire',profile:{nick:'tcp-frames',species:'bear',hood:'#8bcaff'}});
  const pivot=Math.floor(json.length*.55);
  socket.write(maskedFrame(1,json.slice(0,pivot),false));
  socket.write(maskedFrame(9,'hello',true));
  socket.write(maskedFrame(0,json.slice(pivot),true));
  await sleep(150);
  assert.equal(rooms.get('raw-wire').users.has(identity.id),true,'Fragmented join must be decoded');
  assert.ok(Buffer.concat(received).includes(Buffer.from('hello')),'Ping response payload should match');
  // Any unmasked client-to-server data is a protocol violation (RFC 6455).
  const ending=once(socket,'close');
  socket.write(Buffer.from([0x81,0x02,0x7b,0x7d]));
  await Promise.race([ending,sleep(3200).then(()=>{throw Error('Unmasked frame not rejected')})]);
});
