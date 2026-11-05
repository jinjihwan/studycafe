import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.NODE_ENV='test-autostart-disabled';
process.env.STUDYROOM_DB_PATH=`/tmp/snu-v4-${process.pid}-${Math.random().toString(16).slice(2)}.sqlite`;
process.env.RECONNECT_GRACE_MS='1500';
const {NPC_COUNT, NPC_SEATS, LAYOUT_SEATS}=await import('../server/room.js');
const {server}=await import('../server/index.js');
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const url=`ws://127.0.0.1:${server.address().port}/ws`;
const sockets=new Set();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function session(token='') {
 const resp=await fetch(origin+'/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});
 assert.equal(resp.status,200);return resp.json();
}
async function client(token,room='main',profile={nick:'테스트',species:'rabbit',hood:'#8bcaff'}) {
 const ws=new WebSocket(url);sockets.add(ws);
 const queue=[],waiters=[];
 ws.addEventListener('message',e=>{
  const msg=JSON.parse(e.data);queue.push(msg);
  for(const w of [...waiters]) if(w.filter(msg)){waiters.splice(waiters.indexOf(w),1);clearTimeout(w.timeout);w.resolve(msg);}
 });
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
 ws.send(JSON.stringify({t:'join',token,room,profile}));
 return {ws,queue,send:m=>ws.send(JSON.stringify(m)),close:()=>ws.close(),wait(filter,timeout=3500){
   const found=queue.find(filter);if(found)return Promise.resolve(found);
   return new Promise((resolve,reject)=>{const w={filter,resolve,reject};w.timeout=setTimeout(()=>{
      waiters.splice(waiters.indexOf(w),1);reject(new Error('Timed out waiting for '+filter.toString()+' messages '+JSON.stringify(queue.slice(-8))));
    },timeout);waiters.push(w);});
 }};
}
async function clean(){for(const ws of sockets){try{ws.close()}catch{}}await delay(100);await new Promise(r=>server.close(r));}

test('REST + genuine WebSocket: 2 users, room isolation, seat lock, chat, movement, reconnection', {timeout:18000},async t=>{
 t.after(clean);
 const a=await session(), b=await session(), c=await session();
 assert.match(a.id,/^[0-9a-f]{32}$/);assert.notEqual(a.id,b.id);
 assert.equal((await session(a.token)).id,a.id);
 assert.notEqual((await session(a.token+'corrupted')).id,a.id);
 const health=await fetch(origin+'/health');assert.equal((await health.json()).ok,true);
 const wrong=await fetch(origin+'/backup_v1/index.html');assert.equal(wrong.status,404);
 const A=await client(a.token), aWelcome=await A.wait(m=>m.t==='welcome');
 assert.equal(aWelcome.count,1);assert.ok(aWelcome.npcCount<=NPC_COUNT);
 assert.equal(aWelcome.players[0].id,a.id);
 const B=await client(b.token), bWelcome=await B.wait(m=>m.t==='welcome');
 assert.equal(bWelcome.count,2);assert.equal(bWelcome.players.length,2);
 await A.wait(m=>m.t==='player'&&m.player.id===b.id);
 const C=await client(c.token,'friends'), cWelcome=await C.wait(m=>m.t==='welcome');
 assert.equal(cWelcome.count,1);assert.equal(cWelcome.room,'friends');
 // Genuine chat is relayed to everyone in the same room, never to a different room.
 const msg='같이 공부해요!';A.send({t:'chat',message:msg});
 assert.equal((await B.wait(m=>m.t==='chat'&&m.id===a.id)).message,msg);
 assert.equal(C.queue.some(m=>m.t==='chat'),false);
 // A reservation locks the chair on the server, preventing B from racing A.
 const sid=0;assert.equal(NPC_SEATS.has(sid),false);
 A.send({t:'seat_request',seatId:sid});assert.equal((await A.wait(m=>m.t==='seat_granted'&&m.seatId===sid)).seatId,sid);
 await B.wait(m=>m.t==='seat_lock'&&m.seatId===sid&&m.phase==='reserved');
 B.send({t:'seat_request',seatId:sid});await B.wait(m=>m.t==='error'&&m.code==='seat_occupied');
 A.send({t:'seat_cancel'});await B.wait(m=>m.t==='seat_lock'&&m.seatId===sid&&m.ownerId===null);
 B.send({t:'seat_request',seatId:sid});await B.wait(m=>m.t==='seat_granted'&&m.seatId===sid);
 B.send({t:'seat_cancel'});
 // NPC-assigned chair yields to an actual human reservation.
 const chosenVirtual=aWelcome.locks.find(l=>l.phase==='npc');
 if(chosenVirtual){A.send({t:'seat_request',seatId:chosenVirtual.id});
   await A.wait(m=>m.t==='seat_granted'&&m.seatId===chosenVirtual.id);
   A.send({t:'seat_cancel'});}

 // Invalid positions are corrected; a legal move is visible on another socket.
 A.send({t:'move',x:100,z:100,yaw:0});await A.wait(m=>m.t==='correction');
 A.send({t:'move',x:.45,z:35,yaw:0});await B.wait(m=>m.t==='moved'&&m.id===a.id&&m.x===.45);
 // Walk to a real free chair (server checks proximity before seating).
 const seat=LAYOUT_SEATS.find(s=>s.x>5&&s.x<6&&s.z>25&&s.sign===1&&!NPC_SEATS.has(s.id));
 assert.ok(seat,'Expect an available front-row seat');
 const approach={x:seat.x,z:seat.z+seat.sign*2.62};
 A.send({t:'seat_request',seatId:seat.id});await A.wait(m=>m.t==='seat_granted'&&m.seatId===seat.id);
 A.send({t:'seat_sit',seatId:seat.id});await A.wait(m=>m.t==='error'&&m.code==='not_near_seat');
 let x=.45,z=35;
 for(let i=1;i<=11;i++){x=.45+(approach.x-.45)*i/11;A.send({t:'move',x,z,yaw:0});await delay(125);}
 for(let i=1;i<=11;i++){z=35+(approach.z-35)*i/11;A.send({t:'move',x,z,yaw:0});await delay(125);}
 await delay(100);
 A.send({t:'seat_sit',seatId:seat.id});
 const seated=await A.wait(m=>m.t==='player'&&m.player.id===a.id&&m.player.seatId===seat.id);
 assert.equal(seated.player.studying,true);
 await B.wait(m=>m.t==='seat_lock'&&m.seatId===seat.id&&m.phase==='seated');
 B.send({t:'seat_request',seatId:seat.id});await B.wait(m=>m.t==='error'&&m.code==='seat_occupied'&&m.seatId===seat.id);
 A.send({t:'pause',paused:true});
 await A.wait(m=>m.t==='clock'&&m.players.some(p=>p.id===a.id&&p.paused===true));
 // Network disconnect -> seat retained while same signed guest token reconnects.
 A.close();await B.wait(m=>m.t==='player'&&m.player.id===a.id&&m.player.online===false);
 const A2=await client(a.token),resume=await A2.wait(m=>m.t==='welcome');
 assert.equal(resume.resumed,true);
 assert.equal(resume.players.find(p=>p.id===a.id).seatId,seat.id);
 assert.ok(resume.locks.some(l=>l.id===seat.id&&l.ownerId===a.id));
 // After grace period, a truly gone guest is removed and seat becomes free.
 A2.close();await B.wait(m=>m.t==='left'&&m.id===a.id,6000);
 B.send({t:'seat_request',seatId:seat.id});
 await B.wait(m=>m.t==='seat_granted'&&m.seatId===seat.id);
});
