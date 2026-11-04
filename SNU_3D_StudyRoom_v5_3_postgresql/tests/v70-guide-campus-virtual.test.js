import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {npcStatesForRoom,npcActiveCountForRoom,virtualRankingForDay,VIRTUAL_NAMES,koreaMidnightUtc,koreaDay} from '../server/room.js';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../client/dashboard.js',import.meta.url),'utf8');
const markup=html.slice(0,html.indexOf('<script type="module">'));

const start=Date.parse('2026-11-05T00:00:00+09:00');

test('right upper guide button is separate from interactive tutorial; unknown URLs remain disabled',()=>{
 assert.match(markup,/id="guideBtn" type="button"[^>]*aria-label="이용 안내"/);
 assert.match(markup,/id="guideOverlay" hidden role="dialog"/);
 assert.match(markup,/id="guideYoutube"[^>]*disabled/);
 assert.match(markup,/id="guideInstagram"[^>]*disabled/);
 assert.match(html,/const GUIDE_LINKS=Object\.freeze\(\{youtube:'',instagram:''\}\)/);
 assert.match(markup,/가상 학습자/);
 assert.match(html,/window\.open\(url,'_blank','noopener,noreferrer'\)/);
});

test('front wall uses white Seoul material and three distinct replaceable inscription panels',()=>{
 assert.match(html,/mat\('snuWhiteWall','#f7f7f4'\)/);
 assert.match(html,/batch\.box\('snuWhiteWall',\[0,H\/2,CONFIG\.frontZ\]/);
 assert.match(html,/function addWallInscription\(\)/);
 for(const string of ['누군가 조국의 미래를 묻거든','고개를 들어 관악을 보게 하라','너의 젊음을 고대에 걸어라','고대는 너에게 세계를 걸겠다','진리가 너희를 자유케 하리라'])assert.ok(html.includes(string),string);
 assert.match(html,/Official university emblems require license approval/);
});

test('unique simulated nicknames across all three libraries with predictable activity counts',()=>{
 const all=Object.values(VIRTUAL_NAMES).flat();
 assert.equal(all.length,24);
 assert.equal(new Set(all).size,24);
 assert.ok(all.every(name=>typeof name==='string'&&name.length>=3));
 for(const room of ['main','korea','yonsei'])for(const hr of [0,2,5,8,13,17,20,23]){
  const date=start+hr*3600000+35*60000;
  const rows=npcStatesForRoom(room,date);
  assert.equal(rows.length,8);
  assert.equal(rows.filter(r=>r.active).length,npcActiveCountForRoom(room,date));
  assert.deepEqual(rows,npcStatesForRoom(room,date),'same clock yields same NPC state');
  assert.ok(rows.every(r=>Number.isInteger(r.studyMs)&&r.studyMs>=0&&r.studyMs<=date-koreaMidnightUtc(date)));
 }
 assert.equal(npcStatesForRoom('main-2',start).length,0);
});

test('midnight resets virtual study balance and 00:30 never exceeds elapsed study day',()=>{
 const noon=start+12*3600000;
 assert.ok(npcStatesForRoom('main',start).every(v=>v.studyMs===0));
 for(const room of ['main','korea','yonsei']){
  assert.ok(npcStatesForRoom(room,start+30*60000).every(v=>v.studyMs<=30*60000));
  assert.ok(npcStatesForRoom(room,noon).some(v=>v.studyMs>0));
 }
 assert.ok(npcStatesForRoom('main',start+24*3600000).every(v=>v.studyMs===0));
});

test('scheduled virtuals vacate seats when absent or real users occupy a seat',()=>{
 const date=start+16*3600000;
 const all=npcStatesForRoom('main',date);
 const active=all.find(v=>v.active);
 assert.ok(active,'daytime fixture should have virtual learner');
 const blocked=npcStatesForRoom('main',date,new Set([active.seatId]));
 assert.equal(blocked.find(v=>v.id===active.id).active,false);
 assert.equal(blocked.filter(v=>v.active).length,all.filter(v=>v.active).length-1);
});

test('virtual leaderboard entries are synthetic, clearly disclosed and not account-backed',()=>{
 const now=start+17*3600000;
 const list=virtualRankingForDay(koreaDay(now),now);
 assert.ok(list.length>0);
 assert.ok(list.every(r=>r.virtual===true&&r.id.startsWith('virtual:')&&r.ms>0));
 assert.equal(virtualRankingForDay('2026-11-04',now).length,0);
 assert.match(dashboard,/가상 학습자/);
 assert.match(dashboard,/r\.virtual\?' · 가상 학습자'/);
 assert.match(html,/실제 '\+lastActualCount\+' · 가상 '\+lastVirtualCount/);
});

test('active virtual seat locks change with time while real reservations take precedence', async()=>{
 const {Rooms,createAuth}=await import('../server/room.js');
 const rooms=new Rooms(createAuth('dynamic-virtual-test'),{async addSegments(){} });
 const room=rooms.get('main');
 // Pick two half-hour windows with a change in the deterministic presence schedule.
 let first=null,second=null,diff=null;
 for(let hour=8;hour<22&&!diff;hour++){
  const t1=start+hour*3600000+5*60000,t2=t1+30*60000;
  const a=npcStatesForRoom('main',t1),b=npcStatesForRoom('main',t2);
  const found=a.find(v=>v.active!==b[v.id].active);
  if(found){first=t1;second=t2;diff=found;}
 }
 assert.ok(diff,'fixture must include arrival/departure transition');
 const old=Date.now;
 try{
  Date.now=()=>first;
  const locksBefore=rooms.getLocks(room).filter(v=>v.phase==='npc');
  assert.equal(locksBefore.some(v=>v.id===diff.seatId),diff.active);
  Date.now=()=>second;
  const locksAfter=rooms.getLocks(room).filter(v=>v.phase==='npc');
  assert.equal(locksAfter.some(v=>v.id===diff.seatId),!diff.active);
  // Reserve for a real user and ensure no NPC overlays the reserved seat.
  room.locks.set(diff.seatId,{id:'real-test',phase:'reserved',expiresAt:second+90000});
  assert.ok(!rooms.getLocks(room).some(v=>v.phase==='npc'&&v.id===diff.seatId));
 }finally{Date.now=old;}
});
