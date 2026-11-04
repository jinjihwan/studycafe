import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAccountAPI} from '../server/account-api.js';
import {hash} from '../server/accounts-store.js';

const A='a'.repeat(32),B='b'.repeat(32);
const build=(memberCount,roomId='yonsei-10')=>{
 const seen=[], sent=[];
 const accounts={
  session:()=>({id:A,csrfHash:hash('csrf-good'),csrfToken:'csrf-good'}),
  isFriend:async()=>true,blocked:async()=>false,
  account:async()=>({activityPublic:true,joinAllowed:true}),
  canEnterRoom:async(room,id)=>{seen.push([room,id]);return true},
  grantRoom:async()=>{}
 };
 const rooms={rooms:new Map(),members:()=>0,flushAll:async()=>{},studyMs:()=>0};
 const livePresence={
  getUsers:async(ids)=>new Map([[B,{id:B,online:true,roomId,studying:true,paused:false,seatId:11}]]),
  occupancy:async()=>new Map([[roomId,memberCount]]),
  roomSeats:async()=>new Set([12])
 };
 const handler=createAccountAPI({accounts,rooms,auth:{},verifyFirebase:null,
  json:(res,code,data)=>{res.code=code;res.data=data;sent.push([code,data]);},
  sameOrigin:()=>true,permit:()=>true,readBody:async()=>({id:B}),
  store:{},livePresence
 });
 return {handler,seen,sent};
};

test('gateway can join friend on a remote worker without local Room object',async()=>{
 const {handler,seen,sent}=build(5);
 const req={method:'POST',url:'/api/friends/join',headers:{cookie:'snu_session=dummy','x-csrf-token':'csrf-good'}};
 const handled=await handler(req,{},'/api/friends/join');
 assert.equal(handled,true);
 assert.equal(sent[0][0],200);
 assert.equal(sent[0][1].room,'yonsei-10');
 assert.equal(sent[0][1].seats.length,4);
 assert.ok(!sent[0][1].seats.some(s=>s.id===12));
 assert.deepEqual(seen,[['yonsei-10',A]]);
});
test('gateway returns full error for full remote worker room',async()=>{
 const {handler,sent}=build(48);
 const req={method:'POST',url:'/api/friends/join',headers:{cookie:'snu_session=dummy','x-csrf-token':'csrf-good'}};
 await handler(req,{},'/api/friends/join');
 assert.equal(sent[0][0],409);
});
test('public room occupancy is left for core server to answer, even as a guest',async()=>{
 const {handler,sent}=build(0);
 const handled=await handler({method:'GET',headers:{}},{},'/api/rooms/status');
 assert.equal(handled,false);assert.deepEqual(sent,[]);
});
