import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  parsedPublicRoom,roomForIndex,roomCapacity,workerForRoom,choosePublicRoom
} from '../server/room-routing.js';
import {baseLibraryForRoom,layoutForRoom,npcCountForRoom} from '../server/room.js';
import {parseWorkerTargets} from '../server/ws-router.js';
import {LivePresence} from '../server/live-presence.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('public 10th to 100th rooms retain proper layouts and zero NPCs',()=>{
 for(const library of ['main','korea','yonsei'])for(const number of [2,9,10,11,20,49,50,100]){
   const room=roomForIndex(library,number);
   assert.deepEqual(parsedPublicRoom(room),{library,index:number,id:room});
   assert.equal(baseLibraryForRoom(room),library);
   assert.equal(layoutForRoom(room),layoutForRoom(library));
   assert.equal(npcCountForRoom(room),0);
   assert.equal(roomCapacity(room),48);
 }
 for(const library of ['main','korea','yonsei']){
   assert.equal(roomCapacity(library),32);
   assert.equal(npcCountForRoom(library),16);
 }
 for(const invalid of ['main-1','main-0','main-01','korea-001','yonsei-101','main-9999'])assert.equal(parsedPublicRoom(invalid),null);
});

test('automatic room allocation selects first available capacity and creates overflow',async()=>{
 const counts=new Map([['main',32],['main-2',48],['main-3',28]]);
 assert.deepEqual(await choosePublicRoom('main',async()=>counts),{room:'main-3',occupied:28,capacity:48});
 counts.set('main-3',48);
 assert.deepEqual(await choosePublicRoom('main',async()=>counts),{room:'main-4',occupied:0,capacity:48});
 assert.equal(await choosePublicRoom('main',async()=>new Map([['main',32]]),{maximum:1}),null);
 await assert.rejects(()=>choosePublicRoom('not-a-library',async()=>counts));
});

test('five workers have balanced 2,000-seat distribution across each library',()=>{
 for(const mix of [[2000,0,0],[0,2000,0],[0,0,2000],[700,650,650]]){
   const workerLoads=Array(5).fill(0);
   let seatsUsed=0;
   for(let school=0;school<3;school++){
     let left=mix[school],i=1;
     const library=['main','korea','yonsei'][school];
     while(left>0){
       const room=roomForIndex(library,i++),n=Math.min(left,roomCapacity(room));
       workerLoads[workerForRoom(room,5)]+=n;
       seatsUsed+=n;left-=n;
     }
   }
   assert.equal(seatsUsed,2000);
   assert.ok(Math.max(...workerLoads)<=512,`unbalanced workers: ${workerLoads}`);
 }
});

test('stable sharding sends every user of a room to exactly one worker',()=>{
 for(const room of ['main','main-10','korea','korea-39','yonsei-100','private-abcdef123456']){
  assert.equal(workerForRoom(room,5),workerForRoom(room,5));
  assert.ok(workerForRoom(room,5)>=0&&workerForRoom(room,5)<5);
 }
 assert.equal(workerForRoom('main',5),0);
 assert.equal(workerForRoom('korea',5),1);
 assert.equal(workerForRoom('yonsei',5),2);
});

test('private worker targets reject external servers and malformed URLs',()=>{
 assert.equal(parseWorkerTargets('')[0],undefined);
 assert.equal(parseWorkerTargets('http://studyroom-worker-1.railway.internal:3000,http://studyroom-worker-2.railway.internal:3000').length,2);
 assert.throws(()=>parseWorkerTargets('https://example.com'));
 assert.throws(()=>parseWorkerTargets('http://example.com:3000'));
 assert.throws(()=>parseWorkerTargets('http://foo.railway.internal:3000/path'));
});

test('client uses worker room routing, automated room links and dedicated overflow rendering',()=>{
 const network=readFileSync(new URL('../client/network.js',import.meta.url),'utf8');
 assert.match(network,/\/ws\?room=/);
 assert.match(html,/url\.searchParams\.set\('auto','1'\)/);
 assert.match(html,/const PRIMARY_ROOM=\['main','korea','yonsei'\]\.includes\(ROOM_ID\)/);
 assert.match(html,/korea-\(\?:\[2-9\]\|\[1-9\]\[0-9\]\+\)/);
});

test('presence directory occupancy and allocation work with global DB counts',async()=>{
 const calls=[];
 const connection={async query(sql,args){calls.push([sql,args]);
   if(sql.includes('FROM live_room_presence')&&sql.includes('GROUP BY'))return {rows:[{room_id:'yonsei',n:40},{room_id:'yonsei-2',n:48},{room_id:'yonsei-3',n:10}]};
   return {rows:[],rowCount:1};
 },release(){}};
 const fakePool={async connect(){return connection;}};
 const presence=new LivePresence(fakePool);
 const next=await presence.allocate('yonsei');
 assert.deepEqual({room:next.room,occupied:next.occupied,capacity:next.capacity},{room:'yonsei-3',occupied:10,capacity:48});
 assert.match(next.reservation,/^[0-9a-f]{32}$/);
 assert.ok(calls.some(([sql])=>sql.includes('INSERT INTO live_room_reservations')));
});

test('atomic allocation accounts for temporary admissions before any user joins',async()=>{
 const reservations=new Map();
 const db={
  async query(sql,args=[]){
   if(sql.includes('FROM live_room_presence')&&sql.includes('GROUP BY'))return {rows:[]};
   if(sql.includes('FROM live_room_reservations')&&sql.includes('GROUP BY')){
    const count=new Map();for(const room of reservations.values())count.set(room,(count.get(room)||0)+1);
    return {rows:[...count].map(([room_id,n])=>({room_id,n}))};
   }
   if(sql.includes('INSERT INTO live_room_reservations'))reservations.set(args[0],args[1]);
   return {rows:[],rowCount:1};
  },release(){}
 };
 const presence=new LivePresence({async connect(){return db;}});
 const result=[];
 for(let i=0;i<91;i++)result.push(await presence.allocate('main'));
 assert.equal(result[0].room,'main');
 assert.equal(result[31].room,'main');
 assert.equal(result[32].room,'main-2');
 assert.equal(result[79].room,'main-2');
 assert.equal(result[80].room,'main-3');
 assert.equal(new Set(result.map(v=>v.reservation)).size,91);
});
