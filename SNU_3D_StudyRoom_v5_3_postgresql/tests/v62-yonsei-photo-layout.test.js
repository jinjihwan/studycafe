import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {Rooms,createAuth,buildYonseiSeatsAndObstacles,seatApproach,seatYaw,isWalkable,layoutForRoom} from '../server/room.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const buildYonsei=html.slice(html.indexOf('function buildYonseiRoom(){'),html.indexOf('if(YONSEI_ROOM)buildYonseiRoom()'));
const furnishing=html.slice(html.indexOf('function addYonseiChair('),html.indexOf('}else if(KOREA_ROOM){',html.indexOf('function addYonseiChair(')));

// The photo supplied by the owner shows a tall daylit elevation and three distinct
// kinds of desks: circular work islands left, single desks facing left in centre,
// and paired, inward-facing study desks right.
test('V6.2 photo composition: glazed front without bookshelves',()=>{
 assert.match(buildYonsei,/FRONT is an uninterrupted, daylight-filled window wall/);
 assert.match(buildYonsei,/batch\.box\('ysGlass',\[x\+2\.88,H\/2,CONFIG\.frontZ\+\.04\]/);
 assert.doesNotMatch(buildYonsei,/batch\.box\('bookshelf'|batch\.box\('book'/i);
 assert.match(buildYonsei,/galleryX=side\*22\.25/);
 assert.match(html,/data-library="main"/);
 assert.match(html,/data-library="korea"/);
 assert.match(html,/data-library="yonsei"/);
});

test('V6.2 exact 6 round x4, 8 west single x1, 8 facing pair x2 = 48',()=>{
 const l=buildYonseiSeatsAndObstacles();
 assert.equal(l.seats.length,48);
 assert.equal(l.npcSeats.size,8);
 assert.deepEqual(l.seats.map(s=>s.id),Array.from({length:48},(_,i)=>i));
 const groups=[...new Set(l.seats.map(s=>s.group))];
 assert.equal(groups.filter(x=>x.startsWith('round')).length,6);
 assert.equal(groups.filter(x=>x.startsWith('single')).length,8);
 assert.equal(groups.filter(x=>x.startsWith('pair')).length,8);
 for(const group of groups){
  const count=l.seats.filter(s=>s.group===group).length;
  assert.equal(count,group.startsWith('round')?4:group.startsWith('pair')?2:1,group);
 }
 assert.match(furnishing,/for\(let i=0;i<6;i\+\+\)addYonseiRoundDesk\(-29\+i\*12,i\)/);
 assert.match(furnishing,/for\(let i=0;i<8;i\+\+\)addYonseiSingleDesk\(-29\+i\*9,i\)/);
 assert.match(furnishing,/for\(let i=0;i<8;i\+\+\)addYonseiPairDesk\(-29\+i\*9,i\)/);
 assert.match(html,/tables:YONSEI_ROOM\?22:KOREA_ROOM\?24/);
});

test('single desks face left and pairs face each other; four circular seats face inward',()=>{
 const l=layoutForRoom('yonsei');
 assert.equal(l.seats.filter(s=>s.type==='round').length,24);
 assert.equal(l.seats.filter(s=>s.type==='single').length,8);
 assert.equal(l.seats.filter(s=>s.type==='pair').length,16);
 for(const s of l.seats){
  assert.ok(Math.abs((s.dirX**2+s.dirZ**2)-1)<1e-8);
  assert.equal(isWalkable(s.x,s.z,'yonsei'),false,`chair ${s.id} should block walking`);
  const a=seatApproach(s);
  assert.equal(isWalkable(a.x,a.z,'yonsei'),true,`chair ${s.id} approach must be walkable`);
  assert.ok(Math.abs(Math.sin(seatYaw(s))+s.dirX)<1e-8,`chair ${s.id} X orientation`);
  assert.ok(Math.abs(Math.cos(seatYaw(s))+s.dirZ)<1e-8,`chair ${s.id} Z orientation`);
  if(s.type==='single')assert.deepEqual([s.dirX,s.dirZ],[1,0]);
  if(s.type==='pair')assert.equal(s.dirZ,0);
 }
 const pair=l.seats.filter(s=>s.group==='pair-0');
 assert.deepEqual(pair.map(s=>s.dirX),[-1,1]);
 const round=l.seats.filter(s=>s.group==='round-0');
 assert.deepEqual(round.map(s=>[s.dirX,s.dirZ]),[[0,-1],[1,0],[0,1],[-1,0]]);
 assert.equal(isWalkable(0,35,'yonsei'),true);
 assert.equal(layoutForRoom('main').seats.length,48);
 assert.equal(layoutForRoom('korea').seats.length,48);
});

class Peer extends EventEmitter{
 constructor(){super();this.messages=[];this.closed=false;}
 send(m){this.messages.push(m);this.emit('out',m);}
 close(){this.closed=true;this.emit('close');}
 inbound(m){this.emit('message',JSON.stringify(m));}
}
async function awaitMessage(peer,type,timeout=1200){
 const now=peer.messages.find(m=>m.t===type);if(now)return now;
 return await new Promise((resolve,reject)=>{
  const t=setTimeout(()=>{peer.off('out',on);reject(new Error('no '+type));},timeout);
  function on(m){if(m.t===type){clearTimeout(t);peer.off('out',on);resolve(m);}}
  peer.on('out',on);
 });
}

test('authoritative Yonsei server allows sitting/standing in each desk type with correct orientation',async()=>{
 const auth=createAuth('v62-photo-layout-test-secret');
 const store={async ensureGuest(){return {nick:'학습자',species:'rabbit',hood:'#abcdef',rankingPublic:true}},async getDay(){return 0},async updateProfile(){},async addSegments(){}};
 const rooms=new Rooms(auth,store);
 for(const seatId of [0,24,34,33]){
  const peer=new Peer(),c=rooms.connect(peer),token=auth.issue();
  peer.inbound({t:'join',room:'yonsei',token:token.token,profile:{nick:'학생',species:'cat',hood:'#cceeff'}});
  await awaitMessage(peer,'welcome');
  const seat=layoutForRoom('yonsei').seats[seatId];
  const a=seatApproach(seat);
  c.player.x=a.x;c.player.z=a.z;
  peer.inbound({t:'seat_request',seatId});
  await awaitMessage(peer,'seat_granted');
  peer.inbound({t:'seat_sit',seatId});
  assert.equal(c.player.seatId,seatId);
  assert.equal(c.player.yaw,seatYaw(seat));
  peer.inbound({t:'stand'});
  assert.equal(c.player.seatId,null);
  assert.equal(isWalkable(c.player.x,c.player.z,'yonsei'),true);
  peer.close();
 }
});
