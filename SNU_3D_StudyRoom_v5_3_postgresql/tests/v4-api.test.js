import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {once} from 'node:events';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'snu-v4-api-'));
process.env.STUDYROOM_DB_PATH=path.join(tmp,'study.sqlite');
process.env.NODE_ENV='test-autostart-disabled';
process.env.RECONNECT_GRACE_MS='750';
const {server,rooms,store}=await import('../server/index.js');
const {LAYOUT_SEATS,NPC_SEATS,koreaDay}=await import('../server/room.js');
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const sockets=[];const nap=ms=>new Promise(r=>setTimeout(r,ms));
after(async()=>{for(const s of sockets)try{s.close()}catch{};
  for(const c of rooms.connections)try{c.peer.socket.destroy()}catch{};
  await nap(80);if(server.listening)await new Promise(r=>server.close(r));store.close();fs.rmSync(tmp,{recursive:true,force:true});});
async function session(token=''){
 const resp=await fetch(base+'/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});assert.equal(resp.status,200);return resp.json();
}
async function api(identity,where,opts={}){
 const resp=await fetch(base+where,{...opts,headers:{authorization:'Bearer '+identity.token,'content-type':'application/json',...(opts.headers||{})}});
 return {status:resp.status,body:await resp.json()};
}
async function connect(identity,nick,room='main'){
 const ws=new WebSocket(base.replace('http','ws')+'/ws');sockets.push(ws);
 const queue=[],waiters=[];
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);queue.push(m);for(const w of [...waiters])if(w.fn(m)){
    clearTimeout(w.timeout);waiters.splice(waiters.indexOf(w),1);w.resolve(m);
 }});
 await once(ws,'open');ws.send(JSON.stringify({t:'join',token:identity.token,room,profile:{nick,species:'cat',hood:'#8bcaff'}}));
 const conn={ws,queue,send:m=>ws.send(JSON.stringify(m)),wait:(fn,limit=6000)=>{
   const old=queue.find(fn);if(old)return Promise.resolve(old);
   return new Promise((resolve,reject)=>{const w={fn,resolve,reject};w.timeout=setTimeout(()=>{waiters.splice(waiters.indexOf(w),1);reject(Error('Timed out waiting for '+fn+' '+JSON.stringify(queue.slice(-5))))},limit);waiters.push(w);});
 }};
 await conn.wait(m=>m.t==='welcome');return conn;
}
async function sitPlayer(client,seat){
 client.send({t:'seat_request',seatId:seat.id});await client.wait(m=>m.t==='seat_granted'&&m.seatId===seat.id);
 const near={x:seat.x,z:seat.z+seat.sign*2.62};let x=0,z=35;
 for(let i=1;i<=12;i++){x=near.x*i/12;client.send({t:'move',x,z,yaw:0});await nap(110);}
 for(let i=1;i<=12;i++){z=35+(near.z-35)*i/12;client.send({t:'move',x,z,yaw:0});await nap(110);}
 client.send({t:'seat_sit',seatId:seat.id});return client.wait(m=>m.t==='player'&&m.player.seatId===seat.id);
}

test('real HTTP+WebSocket: study is server-owned, ranking, privacy, rejoin, token isolation and NPC exclusion',{timeout:35000},async()=>{
 const a=await session(),b=await session();
 const A=await connect(a,'A 연구자'),B=await connect(b,'B 연구자');
 const s1=LAYOUT_SEATS.find(s=>s.x>5&&s.x<6&&s.z>27&&s.sign===1&&!NPC_SEATS.has(s.id));
 const s2=LAYOUT_SEATS.find(s=>s.x>6&&s.x<8&&s.z>27&&s.sign===1&&!NPC_SEATS.has(s.id));
 assert.ok(s1&&s2);await sitPlayer(A,s1);await nap(1400);await sitPlayer(B,s2);await nap(400);
 let rank=await api(a,'/api/ranking?limit=20');assert.equal(rank.status,200);
 assert.equal(rank.body.day,koreaDay());assert.equal(rank.body.count,2);
 assert.equal(rank.body.entries.length,2);assert.equal(rank.body.entries[0].id,a.id);
 assert.ok(rank.body.entries[0].ms>rank.body.entries[1].ms);
 assert.equal(rank.body.entries.some(r=>r.nick.includes('NPC')),false);
 const mine=await api(a,'/api/me/stats');assert.equal(mine.status,200);
 assert.ok(mine.body.todayMs>1000);assert.ok(mine.body.totalMs>=mine.body.todayMs);
 assert.equal(mine.body.rankingPublic,true);
 const wrong=await api({token:'forged'},'/api/me/stats');assert.equal(wrong.status,401);
 const wrongOrigin=await api(a,'/api/me/stats',{headers:{origin:'https://not-our-site.example'}});assert.equal(wrongOrigin.status,403);
 const privacy=await api(a,'/api/me/privacy',{method:'POST',body:JSON.stringify({rankingPublic:false})});
 assert.equal(privacy.status,200);assert.equal(privacy.body.rankingPublic,false);
 rank=await api(b,'/api/ranking');assert.equal(rank.body.count,1);assert.equal(rank.body.entries[0].id,b.id);
 const privateRank=await api(a,'/api/ranking');assert.equal(privateRank.body.myRank,null);
 assert.ok((await api(a,'/api/me/stats')).body.todayMs>0,'non-participants retain their private study time');
 A.send({t:'pause',paused:true});await A.wait(m=>m.t==='clock'&&m.players.some(p=>p.id===a.id&&p.paused));
 const oldTime=(await api(a,'/api/me/stats')).body.todayMs;
 await nap(1200);
 assert.ok((await api(a,'/api/me/stats')).body.todayMs-oldTime<200,'paused user does not grow');
 const A2=await connect(a,'A 연구자');await A2.wait(m=>m.t==='welcome'&&m.resumed);
 assert.equal(rooms.members(rooms.get('main')),2,'duplicate connection does not increase real user count');
 assert.equal(rooms.get('main').users.size,2,'duplicate guest has just one session object');
 assert.equal(rooms.get('main').users.get(a.id).seatId,s1.id,'duplicate tabs retain one seat lock');
 B.send({t:'seat_request',seatId:s1.id});await B.wait(m=>m.t==='error'&&m.code==='seat_occupied');
 A2.send({t:'stand'});await A2.wait(m=>m.t==='player'&&m.player.id===a.id&&m.player.seatId===null);
 assert.equal((await api(a,'/api/me/stats')).body.rankingPublic,false);
 const open=await api(a,'/api/me/privacy',{method:'POST',body:JSON.stringify({rankingPublic:true})});assert.equal(open.body.rankingPublic,true);
 const visible=await api(a,'/api/ranking');assert.equal(visible.body.count,2);
 const dash=await fetch(base+'/client/dashboard.js');assert.equal(dash.status,200);assert.match(await dash.text(),/initDashboard/);
 const noBackup=await fetch(base+'/backup_v3/index.html');assert.equal(noBackup.status,404);
});
