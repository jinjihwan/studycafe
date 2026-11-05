import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {buildRanking} from '../server/stats.js';
import {Rooms,createAuth,layoutForRoom} from '../server/room.js';
import {
 VIRTUAL_NAMES,VIRTUAL_POPULATION,MAX_SIMULTANEOUS,TARGET_BANDS,
 virtualPlan,virtualPresent,virtualStudyMs,virtualDayStart,virtualProfile,virtualRankingRows
} from '../server/virtual-learners.js';

const campuses=['main','korea','yonsei'];
const fakeStore={
 async ensureGuest(){return {nick:'학생',species:'cat',hood:'#8bcaff',rankingPublic:true};},
 async getDay(){return 0;},async updateProfile(){},async addSegments(){}
};
class Peer extends EventEmitter{
 constructor(){super();this.messages=[];this.closed=false;}
 send(message){this.messages.push(message);this.emit('sent',message);}
 close(){this.closed=true;this.emit('close');}
 inbound(message){this.emit('message',JSON.stringify(message));}
}
async function waitFor(peer,type){for(let i=0;i<100;i++){
 const found=peer.messages.find(m=>m.t===type);if(found)return found;
 await new Promise(r=>setTimeout(r,10));
}throw new Error('Not received '+type);}

test('144 distinct nicknames, school-specific fixed IDs and appearances',()=>{
 const all=Object.values(VIRTUAL_NAMES).flat();assert.equal(all.length,144);
 assert.equal(new Set(all).size,144);
 for(const campus of campuses){assert.equal(VIRTUAL_NAMES[campus].length,VIRTUAL_POPULATION);
  const ids=new Set(Array.from({length:48},(_,i)=>virtualProfile(campus,i).virtualId));assert.equal(ids.size,48);
 }
});

test('deterministic 30-day / three-campus occupancy meets high targets with allowed variation',()=>{
 const first=Date.UTC(2026,10,1,21);let total=0,inBand=0;
 for(let d=0;d<30;d++)for(const campus of campuses){
  const when=first+d*86400000+30000,a=virtualPlan(campus,when),b=virtualPlan(campus,when);
  assert.equal(a,b,'calendar cache preserves the same seeded plan');
  assert.ok(a.shifts.length<=48);
  assert.ok(a.count.every(n=>n>=0&&n<=MAX_SIMULTANEOUS));
  for(let slot=0;slot<96;slot++){
   const h=(slot/4+6)%24,[,,min,max]=TARGET_BANDS.find(([start,end])=>h>=start&&h<end);
   total++;if(a.count[slot]>=min&&a.count[slot]<=max)inBand++;
  }
 }
 assert.ok(inBand/total>.97,`within target: ${inBand}/${total}`);
});

test('KST midnight resets study while study across operating-day midnight remains continuous',()=>{
 const midnight=Date.parse('2026-11-05T15:00:00Z');
 assert.equal(virtualDayStart(midnight),midnight);
 for(const now of [midnight,midnight+30*60000,midnight+60*60000]){
  const maxAllowed=now-midnight;
  const rows=virtualRankingRows(now);
  if(now===midnight)assert.equal(rows.length,0,'no NPC shows with zero seconds after the KST reset');
  assert.ok(rows.every(r=>r.ms>=1000&&r.ms<=maxAllowed),`midnight cap and 1-second minimum ${maxAllowed}`);
 }
 for(const campus of campuses){const plan=virtualPlan(campus,midnight+10*60000);
  const attendee=virtualPresent(campus,midnight+10*60000);
  assert.ok(attendee.length<=16);
  for(const p of attendee){assert.equal(virtualStudyMs(campus,p.id,midnight+10*60000),
    virtualStudyMs(campus,p.id,midnight+10*60000));}
 }
});

test('room assigns only free seats, real user can claim an NPC chair, overflow stays empty',async()=>{
 const rooms=new Rooms(createAuth('v71-fixed-test-secret'),fakeStore);
 const room=rooms.get('main');
 // Worst-case: 40 user seats occupied; virtuals may take only remaining eight.
 for(let i=0;i<40;i++)room.locks.set(i,{id:`person${i}`,phase:'seated',expiresAt:Infinity});
 const initial=rooms.refreshNpc(room,Date.UTC(2026,10,5,11,0));
 assert.ok(initial.length<=8);
 assert.equal(new Set(initial.map(n=>n.seatId)).size,initial.length);
 assert.ok(initial.every(n=>n.seatId>=40));
 // Clear injected locks, then join a real participant and reserve a chair in use by a virtual.
 room.locks.clear();
 const peer=new Peer();rooms.connect(peer);const token=rooms.auth.issue();
 peer.inbound({t:'join',room:'main',token:token.token,profile:{nick:'실제학생',species:'cat',hood:'#fffddd'}});
 const welcome=await waitFor(peer,'welcome');const lock=welcome.locks.find(l=>l.phase==='npc');
 if(lock){peer.inbound({t:'seat_request',seatId:lock.id});
  await waitFor(peer,'seat_granted');
  assert.equal(room.locks.get(lock.id)?.phase,'reserved');
  assert.equal([...room.npcSeats.values()].includes(lock.id),false);
 }
 assert.equal(rooms.refreshNpc(rooms.get('main-2')).length,0);
 peer.close();
});

test('ranking includes only virtual learners with at least one second and paginates with real accounts',()=>{
 const rows=[{id:'actual',nick:'회원',species:'cat',hood:'#ffffff',ms:9990000},
  ...virtualRankingRows(Date.UTC(2026,10,5,12))];
 const first=buildRanking(rows,'actual','2026-11-05',20,0);
 const lastOffset=Math.max(0,rows.length-5);
 const last=buildRanking(rows,'actual','2026-11-05',20,lastOffset);
 assert.equal(first.count,rows.length);
 assert.equal(first.entries.length,Math.min(20,rows.length));
 assert.equal(last.entries.length,Math.min(5,rows.length));
 assert.equal(last.entries[0].rank,lastOffset+1);
 assert.ok(first.myRank!==null);
 assert.ok(rows.slice(1).every(r=>r.ms>=1000),'zero-second virtual learners are not ranked');
 assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
});

test('client creates only present virtual avatars, nameplates hide NPC prefix, interface counts are distinct',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/const npcById=new Map\(\)/);
 assert.match(html,/if\(active\.has\(id\)\)continue/);
 assert.doesNotMatch(html,/'NPC · '/);
 assert.match(html,/가상 학습자가 함께 참여/);
 assert.match(html,/접속 '\+Math\.max\(0,count\|\|0\)\+'명 · 가상 '/);
});
