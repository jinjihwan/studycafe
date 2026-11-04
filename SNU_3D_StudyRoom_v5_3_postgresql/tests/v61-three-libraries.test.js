import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {Rooms,createAuth,buildYonseiSeatsAndObstacles,layoutForRoom,isWalkable} from '../server/room.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const server=readFileSync(new URL('../server/room.js',import.meta.url),'utf8');

// Room-specific client/server geometry must match, including click targets.
test('three real-photo-referenced rooms are selectable, with correct names and visuals',()=>{
 for(const name of ['main','korea','yonsei']){
  assert.match(html,new RegExp(`data-library="${name}"`));
 }
 assert.match(html,/function buildYonseiRoom\(\)/);
 assert.match(html,/if\(YONSEI_ROOM\)buildYonseiRoom\(\);else if\(KOREA_ROOM\)buildKoreaRoom\(\);else buildRoom\(\)/);
 assert.match(html,/for\(const x of \[-15,-8,8,15\]\)for\(let row=0;row<6;row\+\+\)/);
 for(const material of ['ysConcrete','ysOak','ysGlass','ysPod','ysChair','ysLight'])
  assert.match(html,new RegExp(`mat\\('${material}'`));
 assert.match(html,/연세대학교 연세·삼성학술정보관/);
 assert.match(html,/고려대학교 중앙도서관/);
 assert.doesNotMatch(html,/중앙도서관\(대학원\)/);
 assert.match(html,/function libraryURL\(room\)/);
 assert.match(html,/const same=btn\.dataset\.library===ROOM_ID/);
});

test('Seoul supports are rotated along Z, have separated ceiling tips and aligned collision feet',()=>{
 assert.match(html,/const x=side\*17\.6, gap=\.92, spread=4\.60/);
 assert.match(html,/const footZ=z\+dir\*spread, tipZ=z\+dir\*gap/);
 assert.match(server,/const x=side\*17\.6/);
 for(const z of [-25,-7,11,29])for(const side of [-1,1])for(const dir of [-1,1]){
  const x=side*17.6,footZ=z+dir*4.60;
  const foot=layoutForRoom('main').obstacles.find(o=>o.x===x&&o.z===footZ);
  assert.ok(foot,`missing collision at ${x} / ${footZ}`);
  assert.equal(isWalkable(x,footZ,'main'),false);
 }
 assert.equal(isWalkable(0,0,'main'),true);
});

test('Yonsei is 24 two-sided desks, 48 seats, 8 NPCs and walkable seat approach points',()=>{
 const l=buildYonseiSeatsAndObstacles();
 assert.equal(l.seats.length,48);
 assert.equal(l.npcSeats.size,8);
 assert.equal(new Set(l.seats.map(s=>s.id)).size,48);
 assert.equal(new Set(l.seats.map(s=>`${s.x}:${Math.round((s.z-s.sign*1.55+27)/11)}`)).size,24);
 assert.equal(layoutForRoom('yonsei'),layoutForRoom('yonsei'));
 assert.notEqual(layoutForRoom('yonsei'),layoutForRoom('korea'));
 assert.notEqual(layoutForRoom('yonsei'),layoutForRoom('main'));
 for(const z of [-27,-16,-5,6,17,28,35])assert.equal(isWalkable(0,z,'yonsei'),true);
 for(const s of l.seats){
  assert.equal(isWalkable(s.x,s.z+s.sign*2.62,'yonsei'),true,`seat ${s.id} approach blocked`);
  assert.equal(isWalkable(s.x,s.z-s.sign*.3,'yonsei'),false,`seat ${s.id} not blocked`);
 }
 assert.match(html,/function addYonseiDesk\(x,z,deskId\)/);
 assert.match(html,/function addYonseiChair\(x,z,sign,deskId\)/);
});

class Peer extends EventEmitter{
 constructor(){super();this.messages=[];this.closed=false;}
 send(m){this.messages.push(m);this.emit('sent',m);}
 close(){if(!this.closed){this.closed=true;this.emit('close');}}
 inbound(m){this.emit('message',JSON.stringify(m));}
}
async function until(peer,type){for(let i=0;i<65;i++){
  const m=peer.messages.find(x=>x.t===type);if(m)return m;
  await new Promise(resolve=>setTimeout(resolve,10));
 }throw new Error(`${type} missing: ${JSON.stringify(peer.messages)}`);
}

test('three simultaneous guests have isolated multiplayer seats and chat; Yonsei exit saves study',async()=>{
 const auth=createAuth('v61-separated-three-room-test-secret');const calls=[];
 const store={
  async ensureGuest(){return {nick:'독서',species:'rabbit',hood:'#abcdef',rankingPublic:true}},
  async getDay(){return 0;},async updateProfile(){},
  async addSegments(id,segments){calls.push({id,segments:new Map(segments)});}
 };
 const rooms=new Rooms(auth,store),peers=[new Peer(),new Peer(),new Peer()];
 const tokens=peers.map(()=>auth.issue());const ids=['main','korea','yonsei'];
 const c=peers.map((peer)=>rooms.connect(peer));
 peers.forEach((p,i)=>p.inbound({t:'join',room:ids[i],token:tokens[i].token,profile:{nick:'공부중',species:'cat',hood:'#abcdef'}}));
 for(let i=0;i<3;i++){
  const msg=await until(peers[i],'welcome');
  assert.equal(msg.room,ids[i]);assert.equal(msg.count,1);
  assert.equal(msg.players.length,1);
  peers[i].inbound({t:'seat_request',seatId:0});
  await until(peers[i],'seat_granted');
  assert.equal(rooms.get(ids[i]).locks.get(0)?.id,tokens[i].id);
 }
 peers[2].inbound({t:'chat',message:'연세대 도서관'});
 await until(peers[2],'chat');
 assert.equal(peers[0].messages.some(m=>m.t==='chat'),false);
 assert.equal(peers[1].messages.some(m=>m.t==='chat'),false);
 c[2].player.studying=true;c[2].player.paused=false;c[2].player.lastAccruedAt=Date.now()-1300;
 peers[2].inbound({t:'room_exit'});await until(peers[2],'room_exit_ok');
 assert.equal(rooms.rooms.has('yonsei'),false);
 assert.ok(rooms.get('main').locks.has(0));assert.ok(rooms.get('korea').locks.has(0));
 assert.ok(calls.some(call=>call.id===tokens[2].id&&[...call.segments.values()].some(ms=>ms>=900)));
 peers[0].close();peers[1].close();
});
