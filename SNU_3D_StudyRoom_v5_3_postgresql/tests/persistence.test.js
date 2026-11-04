import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SQLiteStore} from '../server/store.js';
import {Rooms,createAuth,koreaDay} from '../server/room.js';
import {buildStats,buildRanking} from '../server/stats.js';
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'snu-v4-db-'));

test('SQLite schema, date records, reopen persistent file, profile and ranking privacy',{timeout:8000},async t=>{
  const dir=temp(),filename=path.join(dir,'study.sqlite');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const a='a'.repeat(32),b='b'.repeat(32),c='c'.repeat(32);
  let store=new SQLiteStore(filename);
  for(const id of [a,b,c])await store.ensureGuest(id);
  await store.updateProfile(a,{nick:'토끼',species:'rabbit',hood:'#f39bc4'});
  await store.updateProfile(b,{nick:'곰',species:'bear',hood:'#8bcaff'});
  await store.addSegments(a,new Map([['2026-11-02',60000],['2026-11-03',180000]]));
  await store.addSegments(a,new Map([['2026-11-03',10000]]));
  await store.addSegments(b,new Map([['2026-11-03',190000]]));
  await store.addSegments(c,new Map([['2026-11-03',1000]]));
  assert.equal(await store.getDay(a,'2026-11-03'),190000);
  assert.deepEqual((await store.getRanking('2026-11-03')).map(r=>r.id),[a,b,c]);
  await store.setVisibility(b,false);
  assert.deepEqual((await store.getRanking('2026-11-03')).map(r=>r.id),[a,c]);
  assert.equal(await store.getDay(b,'2026-11-03'),190000,'private study history remains');
  store.close();
  store=new SQLiteStore(filename);t.after(()=>store.close());
  assert.equal((await store.getGuest(a)).nick,'토끼');
  assert.equal((await store.getGuest(b)).rankingPublic,false);
  assert.equal(await store.getDay(a,'2026-11-03'),190000,'time survives DB reopen');
  assert.equal((await store.getDays(a)).length,2);
  const stats=buildStats(await store.getDays(a),'2026-11','2026-11-03');
  assert.equal(stats.todayMs,190000);assert.equal(stats.yesterdayMs,60000);
  assert.equal(stats.weekMs,250000);assert.equal(stats.monthMs,250000);assert.equal(stats.totalMs,250000);
  assert.equal(stats.streak,2);assert.equal(stats.calendar.find(x=>x.day==='2026-11-01').ms,0);
  assert.equal(stats.last7.length,7);
});

test('day boundary splits accrued time at Korea midnight and persists to correct day',{timeout:8000},async t=>{
  const dir=temp();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new SQLiteStore(path.join(dir,'study.sqlite'));t.after(()=>store.close());
  const id='d'.repeat(32);await store.ensureGuest(id);
  const room=new Rooms(createAuth(Buffer.alloc(32,1)),store);
  const before=Date.parse('2026-11-03T14:59:58.500Z'); // KST 23:59:58.500
  const after=Date.parse('2026-11-03T15:00:03.250Z'); // KST 00:00:03.250
  const p={id,studyMs:0,day:koreaDay(before),studying:true,paused:false,
    lastAccruedAt:before,pending:new Map(),persistPromise:null};
  assert.equal(room.studyMs(p,after),3250);
  assert.equal(p.pending.get('2026-11-03'),1500);
  assert.equal(p.pending.get('2026-11-04'),3250);
  await room.persist(p);
  assert.equal(await store.getDay(id,'2026-11-03'),1500);
  assert.equal(await store.getDay(id,'2026-11-04'),3250);
});

test('server stop/resume/duplicate checkpoint and DB failure do not double count',{timeout:8000},async t=>{
  const dir=temp();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new SQLiteStore(path.join(dir,'study.sqlite'));t.after(()=>store.close());
  const id='e'.repeat(32);await store.ensureGuest(id);
  const room=new Rooms(createAuth(Buffer.alloc(32,2)),store);
  const start=Date.parse('2026-11-03T10:00:00Z');
  const p={id,studyMs:0,day:koreaDay(start),studying:true,paused:false,lastAccruedAt:start,pending:new Map(),persistPromise:null};
  room.studyMs(p,start+4000);
  await room.persist(p);await room.persist(p);
  assert.equal(await store.getDay(id,koreaDay(start)),4000);
  p.paused=true;p.lastAccruedAt=0;room.studyMs(p,start+10000);
  assert.equal(room.studyMs(p,start+20000),4000,'time paused stays constant');
  p.paused=false;p.lastAccruedAt=start+20000;
  room.studyMs(p,start+23000);await room.persist(p);
  assert.equal(await store.getDay(id,koreaDay(start)),7000);
  room.studyMs(p,start+26000);
  const original=store.addSegments.bind(store);let fail=true;
  store.addSegments=async(...args)=>{if(fail){fail=false;throw Error('SIMULATED_DATABASE_DISCONNECT')}return original(...args)};
  await assert.rejects(room.persist(p),/SIMULATED_DATABASE_DISCONNECT/);
  assert.equal(p.pending.get(koreaDay(start)),3000,'failed checkpoint is retained for retry');
  await room.persist(p);
  assert.equal(await store.getDay(id,koreaDay(start)),10000,'recover commits the batch just once');
});

test('ranking deterministic tie break, top 20, empty dates and optional visibility semantics',()=>{
  const rows=Array.from({length:22},(_,i)=>({id:i.toString(16).padStart(32,'0'),nick:'게스트'+i,species:'cat',hood:'#abcdef',ms:i%2?360000:720000}));
  const result=buildRanking(rows,rows[21].id,'2026-11-03',20);
  assert.equal(result.entries.length,20);
  assert.equal(result.entries[0].id,rows[0].id);
  assert.equal(result.myRank,22);
  const empty=buildRanking([],rows[0].id,'2026-11-04');assert.equal(empty.myRank,null);assert.equal(empty.entries.length,0);
  const stats=buildStats([],'2026-10','2026-11-04',false);
  assert.equal(stats.totalMs,0);assert.equal(stats.streak,0);assert.equal(stats.rankingPublic,false);
  assert.ok(stats.calendar.every(v=>v.ms===0));
});
