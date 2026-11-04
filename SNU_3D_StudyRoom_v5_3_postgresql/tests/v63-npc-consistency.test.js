import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {
  Rooms,createAuth,NPC_COUNT,NPC_HOME_SEAT_IDS,baseLibraryForRoom,
  npcCountForRoom,npcStatesForRoom,layoutForRoom
} from '../server/room.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

class Peer extends EventEmitter {
  constructor(){super();this.messages=[];this.closed=false;}
  send(message){this.messages.push(message);this.emit('sent',message);}
  close(){if(!this.closed){this.closed=true;this.emit('close');}}
  inbound(message){this.emit('message',JSON.stringify(message));}
}
async function until(peer,type){
  for(let i=0;i<120;i++){
    const m=peer.messages.find(m=>m.t===type);
    if(m)return m;
    await new Promise(r=>setTimeout(r,10));
  }
  throw new Error('Missing response '+type);
}

const store={
  async ensureGuest(){return {nick:'테스트',species:'cat',hood:'#aaccbb',rankingPublic:true};},
  async getDay(){return 0;},async updateProfile(){},async addSegments(){}
};

// An overflow room gets the same furniture geometry, but no NPC avatars or
// reserved NPC chairs; the first room of each university keeps all 8 NPCs.
test('only university first rooms have eight NPCs; overflow rooms have none',()=>{
  for(const room of ['main','korea','yonsei']){
    assert.equal(npcCountForRoom(room),NPC_COUNT);
    assert.equal(npcStatesForRoom(room).length,8);
    assert.deepEqual([...layoutForRoom(room).npcSeats].sort((a,b)=>a-b),[...NPC_HOME_SEAT_IDS]);
  }
  for(const [room,base] of [['main-2','main'],['korea-2','korea'],['yonsei-2','yonsei'],['yonsei-25','yonsei']]){
    assert.equal(baseLibraryForRoom(room),base);
    assert.equal(layoutForRoom(room),layoutForRoom(base));
    assert.equal(npcCountForRoom(room),0);
    assert.deepEqual(npcStatesForRoom(room),[]);
  }
});

test('NPC poses are deterministic by server time; a reserved chair never changes ID',()=>{
  const timestamp=Date.UTC(2026,10,5,4,0,0);
  for(const room of ['main','korea','yonsei']){
    const a=npcStatesForRoom(room,timestamp);
    const b=npcStatesForRoom(room,timestamp);
    assert.deepEqual(a,b);
    assert.equal(a.length,8);
    for(const pose of a){
      assert.equal(pose.seatId,NPC_HOME_SEAT_IDS[pose.id]);
      assert.equal(typeof pose.x,'number');
      assert.equal(typeof pose.z,'number');
      assert.ok(Number.isFinite(pose.yaw));
    }
    const future=npcStatesForRoom(room,timestamp+30_000);
    assert.notDeepEqual(a.map(p=>p.kind),future.map(p=>p.kind));
  }
});

test('two users receive identical NPC states and reserved seats in the first room',async()=>{
  const rooms=new Rooms(createAuth('v63-server-authority'),store);
  const peers=[new Peer(),new Peer()];
  for(const peer of peers){
    rooms.connect(peer);
    const token=rooms.auth.issue();
    peer.inbound({t:'join',room:'yonsei',token:token.token,profile:{nick:'학생',species:'cat',hood:'#ffffff'}});
    await until(peer,'welcome');
  }
  const first=peers[0].messages.find(m=>m.t==='welcome');
  const second=peers[1].messages.find(m=>m.t==='welcome');
  assert.equal(first.npcCount,8);
  assert.equal(second.npcCount,8);
  assert.equal(first.npcStates.length,8);
  assert.equal(second.npcStates.length,8);
  const npcLocks=second.locks.filter(lock=>lock.phase==='npc');
  assert.deepEqual(npcLocks.map(lock=>lock.id).sort((a,b)=>a-b),[...NPC_HOME_SEAT_IDS]);
  peers[0].inbound({t:'seat_request',seatId:2});
  const invalid=await until(peers[0],'error');
  assert.equal(invalid.code,'seat_unavailable');
  await rooms.tick();
  const c1=peers[0].messages.findLast(m=>m.t==='clock');
  const c2=peers[1].messages.findLast(m=>m.t==='clock');
  assert.deepEqual(c1.npcStates,c2.npcStates);
  assert.equal(c1.npcCount,c2.npcCount);
  const snapshotPromise=until(peers[0],'snapshot');
  peers[0].inbound({t:'sync'});
  assert.equal((await snapshotPromise).npcStates.length,8);
  peers.forEach(p=>p.close());
});

test('overflow rooms share correct geometry but allow former NPC-only seats',async()=>{
  const rooms=new Rooms(createAuth('v63-test-overflow'),store);
  for(const room of ['main-2','korea-2','yonsei-2']){
    const peer=new Peer();rooms.connect(peer);
    const token=rooms.auth.issue();
    peer.inbound({t:'join',room,token:token.token,profile:{nick:'학생',species:'cat',hood:'#ffffff'}});
    const welcome=await until(peer,'welcome');
    assert.equal(welcome.npcCount,0);
    assert.equal(welcome.npcStates.length,0);
    assert.equal(welcome.locks.filter(lock=>lock.phase==='npc').length,0);
    peer.inbound({t:'seat_request',seatId:2});
    const granted=await until(peer,'seat_granted');
    assert.equal(granted.seatId,2);
    peer.close();
  }
});

test('client never generates per-user random NPC actions; it uses server states',()=>{
  assert.match(html,/const PRIMARY_ROOM=\['main','korea','yonsei'\]\.includes\(ROOM_ID\)/);
  assert.match(html,/for\(let i=0;i<\(PRIMARY_ROOM\?CONFIG\.npcCount:0\);i\+\+\)/);
  assert.match(html,/function syncNpcStates\(states\)/);
  assert.match(html,/syncNpcStates\(m\.npcStates\)/);
  assert.match(html,/function updateNpcVisuals\(dt\)/);
  assert.doesNotMatch(html,/function updateNpcBehaviors\(/);
  assert.doesNotMatch(html,/let npcEventAt=/);
});
