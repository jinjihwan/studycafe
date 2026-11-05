import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Rooms, createAuth, layoutForRoom } from '../server/room.js';

const store={
  async ensureGuest(){return {nick:'사람',species:'rabbit',hood:'#88caff',rankingPublic:true};},
  async getDay(){return 0;},
  async updateProfile(){},
  async addSegments(){}
};
class Peer extends EventEmitter {
  constructor(){super();this.messages=[];this.closed=false;}
  send(m){this.messages.push(m);this.emit('sent',m);}
  close(){if(this.closed)return;this.closed=true;this.emit('close');}
  inbound(m){this.emit('message',JSON.stringify(m));}
}
async function findMessage(peer,matcher){
  for(let i=0;i<70;i++){
    const found=peer.messages.find(matcher);
    if(found)return found;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw new Error('Did not receive matching server message');
}

for(const campus of ['main','korea','yonsei']){
  test(`${campus}: tapping an NPC-occupied chair cannot evict, reserve or stand anyone`,async()=>{
    const rooms=new Rooms(createAuth('v74-npc-chair-test-secret'),store);
    const room=rooms.get(campus),peer=new Peer(),conn=rooms.connect(peer),user=rooms.auth.issue();
    peer.inbound({t:'join',room:campus,token:user.token,profile:{nick:'사람',species:'rabbit',hood:'#88caff'}});
    const welcome=await findMessage(peer,m=>m.t==='welcome');
    const npcLock=welcome.locks.find(l=>l.phase==='npc');
    assert.ok(npcLock,'at least one NPC occupies a chair in each primary room');
    const occupiedBefore=new Map(room.npcSeats);
    const free=layoutForRoom(campus).seats.find(s=>!welcome.locks.some(l=>l.id===s.id));
    assert.ok(free,'another seat is free');

    // Simulate an existing seated user (the request handler must reject before
    // it can stand them or cancel their reservation).
    conn.player.seatId=free.id;
    conn.player.studying=true;
    room.locks.set(free.id,{id:user.id,phase:'seated',expiresAt:Infinity});
    const broadcastsBefore=peer.messages.filter(m=>m.t==='seat_lock').length;

    peer.inbound({t:'seat_request',seatId:npcLock.id});
    const error=await findMessage(peer,m=>m.t==='error'&&m.seatId===npcLock.id);
    assert.equal(error.code,'seat_occupied');
    assert.equal(peer.messages.some(m=>m.t==='seat_granted'&&m.seatId===npcLock.id),false);
    assert.deepEqual(room.npcSeats,occupiedBefore,'NPC remains on the same chair');
    assert.equal(peer.messages.filter(m=>m.t==='seat_lock').length,broadcastsBefore,'denial broadcasts no false empty seat');
    assert.equal(conn.player.seatId,free.id,'existing human seat is not released');
    assert.equal(room.locks.get(free.id)?.phase,'seated');
    assert.equal(conn.player.studying,true);
    assert.equal(room.locks.has(npcLock.id),false,'NPC chair must never become a human lock');

    await rooms.tick();
    assert.equal(room.npcSeats.get([...occupiedBefore].find(([,seatId])=>seatId===npcLock.id)?.[0]),npcLock.id,
      'NPC stays in the same chair after synchronization');
    peer.close();
  });
}

test('client gives immediate occupied feedback and never sends seat_request for NPC lock',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const block=html.slice(html.indexOf('function goToSeat(s){'),html.indexOf('function goToFloor(p){'));
  assert.match(block,/lock&&lock\.ownerId!==selfId/);
  assert.match(block,/s\.occupiedBy&&s\.occupiedBy!==player/);
  assert.match(block,/이미 사용 중이거나 예약된 좌석입니다/);
  assert.match(block,/return;/);
  assert.match(block,/net\.send\(\{t:'seat_request',seatId:s\.id\}\)/);
});
