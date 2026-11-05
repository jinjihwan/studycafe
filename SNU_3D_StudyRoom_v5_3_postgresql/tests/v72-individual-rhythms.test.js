import test from 'node:test';
import assert from 'node:assert/strict';
import {generateVirtualPlan,virtualPlan,virtualPresent,virtualStudyMs,virtualRankingRows,
  VIRTUAL_CAMPUSES,MAX_SIMULTANEOUS,TARGET_BANDS} from '../server/virtual-learners.js';

const day=86400000,quarterHour=15*60000;

test('independent second-level arrival, focus and break lengths; reproducible after re-generation',()=>{
 const anchor=Date.parse('2026-11-01T21:00:00Z'); // 06:00 KST on Nov 2
 const plan=generateVirtualPlan('main',anchor);
 const copy=generateVirtualPlan('main',anchor);
 assert.deepEqual(plan,copy,'same campus+day produces identical schedule after a restart');
 assert.ok(plan.shifts.length>35);
 const focusLengths=[],restLengths=[],starts=[];
 for(const shift of plan.shifts){
  const slotStart=plan.anchor+shift.start*quarterHour;
  const slotEnd=slotStart+shift.slots*quarterHour;
  assert.ok(shift.startMs>slotStart&&shift.endMs<slotEnd,'jitter does not spill outside reserved occupancy slots');
  assert.ok(shift.startMs<shift.study[0]?.[0], 'study begins after arrival and setup');
  assert.ok(shift.study.at(-1)?.[1]<shift.endMs,'study stops before departure');
  starts.push(shift.startMs-slotStart);
  for(const [a,b] of shift.study){
   assert.ok(b>a);assert.ok(a>=shift.startMs&&b<=shift.endMs);
   focusLengths.push(Math.round((b-a)/1000));
  }
  for(let i=1;i<shift.study.length;i++)restLengths.push(Math.round((shift.study[i][0]-shift.study[i-1][1])/1000));
 }
 assert.ok(new Set(starts.map(x=>Math.floor(x/1000))).size>20,'arrival second offsets are individualized');
 assert.ok(new Set(focusLengths).size>50,'focus periods are not a uniform 80 minutes');
 assert.ok(new Set(restLengths).size>20,'rest periods are not uniformly 10 minutes');
});

test('real quarter-hour midpoints preserve occupancy targets over 3 schools and 30 days',()=>{
 const first=Date.parse('2026-10-31T21:00:00Z');
 let matching=0,total=0,excess=0;
 for(let d=0;d<30;d++)for(const campus of VIRTUAL_CAMPUSES){
  const p=virtualPlan(campus,first+d*day+1000);
  for(let slot=0;slot<96;slot++){
   const now=p.anchor+(slot+.5)*quarterHour, hour=(slot/4+6)%24;
   const band=TARGET_BANDS.find(([a,b])=>hour>=a&&hour<b);
   const actual=virtualPresent(campus,now).length;
   if(actual>=band[2]&&actual<=band[3])matching++;
   if(actual>MAX_SIMULTANEOUS)excess++;
   total++;
  }
 }
 assert.equal(total,8640);assert.equal(excess,0);
 assert.ok(matching/total>.975,`actual occupancy compliance ${matching}/${total}`);
});

test('cross-midnight NPC study is not identical across an entire nearby crowd',()=>{
 const midnight=Date.parse('2026-11-01T15:00:00Z');
 let present=0,duplicates=0;
 for(let d=0;d<30;d++)for(const campus of VIRTUAL_CAMPUSES){
  const time=midnight+d*day+49*60000+25000;
  const sec=virtualPresent(campus,time).map(s=>Math.floor(virtualStudyMs(campus,s.id,time)/1000));
  duplicates+=sec.length-new Set(sec).size;present+=sec.length;
 }
 assert.ok(present>350);
 assert.ok(duplicates/present<.03,`same-second times ${duplicates} / ${present}`);
});

test('00:00 hidden; exactly one second after first genuine study interval qualifies for ranking',()=>{
 const midnight=Date.parse('2026-11-05T15:00:00Z');
 assert.equal(virtualRankingRows(midnight).length,0);
 const plan=virtualPlan('main',Date.parse('2026-11-05T04:00:00Z'));
 const shift=plan.shifts.find(s=>s.study.length&&s.study[0][0]>plan.anchor+60*60000&&s.study[0][0]<plan.anchor+16*3600000&&virtualStudyMs('main',s.id,s.study[0][0])===0);
 assert.ok(shift);
 const firstStart=shift.study[0][0];
 assert.equal(virtualStudyMs('main',shift.id,firstStart),0);
 assert.equal(virtualStudyMs('main',shift.id,firstStart+999),999);
 assert.equal(virtualRankingRows(firstStart+999).some(row=>row.id===`virtual:main:${String(shift.id).padStart(2,'0')}`),false);
 assert.equal(virtualStudyMs('main',shift.id,firstStart+1000),1000);
 assert.equal(virtualRankingRows(firstStart+1000).some(row=>row.id===`virtual:main:${String(shift.id).padStart(2,'0')}`),true);
});

test('daily accumulated study is monotonic, KST reset and capped by real elapsed time',()=>{
 for(const campus of VIRTUAL_CAMPUSES){
  const midnight=Date.parse('2026-11-06T15:00:00Z');
  for(const offset of [0,1000,30000,600000,1800000,3600000]){
   const rows=virtualRankingRows(midnight+offset);
   assert.ok(rows.every(x=>x.ms>=1000&&x.ms<=offset),'ranked entries must have >=1s of genuine elapsed study');
  }
  const a=virtualPlan(campus,midnight+60000);
  for(const shift of a.shifts.slice(0,10)){
   const times=[midnight,midnight+15*60000,midnight+45*60000].map(t=>virtualStudyMs(campus,shift.id,t));
   assert.ok(times[0]===0&&times[0]<=times[1]&&times[1]<=times[2]);
  }
 }
});
