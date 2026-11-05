import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {Rooms,createAuth,buildKoreaSeatsAndObstacles,buildSeatsAndObstacles,isWalkable,layoutForRoom} from '../server/room.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const social=readFileSync(new URL('../server/account-api.js',import.meta.url),'utf8');

test('Korea Grand Reading Hall renders distinct historic design and library chooser',()=>{
  assert.match(html,/function buildKoreaRoom\(\)/);
  assert.match(html,/if\(YONSEI_ROOM\)buildYonseiRoom\(\);else if\(KOREA_ROOM\)buildKoreaRoom\(\);else buildRoom\(\)/);
  assert.match(html,/for\(const x of \[-12,0,12\]\)for\(let n=0;n<9;n\+\+\)/); // 27 chandeliers
  for(const material of ['kuCurtain','kuWood','kuBrass','kuPlaster','kuStone'])assert.match(html,new RegExp(`mat\\('${material}'`));
  assert.match(html,/data-library="main"/);assert.match(html,/data-library="korea"/);
  assert.match(html,/id="switchLibraryBtn"/);assert.match(html,/new URL\(location\.href\)/);
  assert.match(html,/room_exit_ok/);assert.match(html,/snu-last-library-v6/);
  assert.doesNotMatch(html,/library\.korea\.ac\.kr\/.*\.(?:png|jpg)/); // not copied a third-party photo
});

test('Seoul stays 8 six-seat tables; Korea has 24 two-sided desks with 48 seats',()=>{
  const snu=buildSeatsAndObstacles(),ku=buildKoreaSeatsAndObstacles();
  assert.equal(snu.seats.length,48);assert.equal(ku.seats.length,48);
  assert.equal(snu.npcSeats.size,0);assert.equal(ku.npcSeats.size,0);
  assert.equal(new Set(ku.seats.map(s=>`${s.x}:${Math.round((s.z - s.sign*1.55+27)/11)}`)).size,24);
  assert.deepEqual(ku.seats.map(s=>s.id),Array.from({length:48},(_,i)=>i));
  assert.equal(layoutForRoom('main').seats.length,48); // default unchanged
  assert.equal(layoutForRoom('korea').seats.length,48);
  assert.equal(layoutForRoom('friends').seats.length,48); // custom older rooms preserved
  assert.equal(isWalkable(-14,-27),true);
  assert.equal(isWalkable(-14,-27,'korea'),false);
  for(const z of [-27,-16,-5,6,17,28,35])assert.equal(isWalkable(0,z,'korea'),true);
  for(const s of ku.seats)assert.equal(isWalkable(s.x,s.z+s.sign*2.62,'korea'),true,`seat ${s.id} approach blocked`);
  assert.match(html,/for\(const x of \[-14,-7,7,14\]\)for\(let row=0;row<6;row\+\+\)/);
  assert.match(html,/const z=-27\+row\*11/);
});

test('friend join candidates use the destination room seat geometry',()=>{
  assert.match(social,/layoutForRoom\(room\.id\)/);
  assert.match(social,/seats\.filter\(s=>!npcSeats\.has\(s\.id\)/);
  assert.doesNotMatch(social,/LAYOUT_SEATS\[target\.seatId\]/);
});

class Peer extends EventEmitter {
  constructor(){super();this.messages=[];this.closed=false;}
  send(message){this.messages.push(message);this.emit('sent',message);}
  close(){if(!this.closed){this.closed=true;this.emit('close');}}
  inbound(message){this.emit('message',JSON.stringify(message));}
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
async function waitMessage(peer,type){
  for(let i=0;i<65;i++){
    const match=peer.messages.find(m=>m.t===type);if(match)return match;
    await tick();
  }
  throw new Error('Did not receive '+type+': '+JSON.stringify(peer.messages));
}

test('two virtual users occupy separate libraries, and leaving persists study time and releases seat',async()=>{
  const auth=createAuth('v6-korea-room-test-secret');const calls=[];
  const store={
    async ensureGuest(){return {nick:'연구자',species:'rabbit',hood:'#8bcaff',rankingPublic:true};},
    async getDay(){return 0;},async updateProfile(){},
    async addSegments(id,segments){calls.push({id,segments:new Map(segments)});}
  };
  const rooms=new Rooms(auth,store);const a=new Peer(),b=new Peer();
  const tokenA=auth.issue(),tokenB=auth.issue();
  const ca=rooms.connect(a),cb=rooms.connect(b);
  a.inbound({t:'join',token:tokenA.token,room:'korea',profile:{nick:'고려대',species:'cat',hood:'#abcdef'}});
  b.inbound({t:'join',token:tokenB.token,room:'main',profile:{nick:'서울대',species:'cat',hood:'#abcdef'}});
  const wa=await waitMessage(a,'welcome'),wb=await waitMessage(b,'welcome');
  assert.equal(wa.room,'korea');assert.equal(wb.room,'main');
  assert.equal(wa.count,1);assert.equal(wb.count,1);
  // NPC chairs are occupied: choose a free chair independently in each library.
  const freeSeat=welcome=>Array.from({length:48},(_,id)=>id).find(id=>!welcome.locks.some(lock=>lock.id===id));
  const seatA=freeSeat(wa),seatB=freeSeat(wb);
  assert.ok(Number.isInteger(seatA)&&Number.isInteger(seatB));
  a.inbound({t:'seat_request',seatId:seatA});
  b.inbound({t:'seat_request',seatId:seatB});
  await waitMessage(a,'seat_granted');await waitMessage(b,'seat_granted');
  assert.equal(rooms.get('korea').locks.get(seatA).id,tokenA.id);
  assert.equal(rooms.get('main').locks.get(seatB).id,tokenB.id);
  assert.equal(b.messages.some(m=>m.t==='seat_lock'&&m.ownerId===tokenA.id),false);
  // Simulate an active study interval; this is the same accrued ledger as normal seating.
  ca.player.studying=true;ca.player.paused=false;ca.player.lastAccruedAt=Date.now()-1250;
  a.inbound({t:'room_exit'});
  await waitMessage(a,'room_exit_ok');
  assert.equal(a.closed,true);assert.equal(rooms.rooms.has('korea'),false);
  assert.equal(rooms.get('main').locks.has(seatB),true);
  assert.ok(calls.some(c=>c.id===tokenA.id&&[...c.segments.values()].some(ms=>ms>=900)));
  b.close();
});
