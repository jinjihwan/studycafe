import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {SQLiteStore} from '../server/store.js';
import {AccountsStore} from '../server/accounts-store.js';
import {createAuth,Rooms,LAYOUT_SEATS,NPC_SEATS,koreaDay} from '../server/room.js';
import {createAccountAPI,accountContext} from '../server/account-api.js';
import {upgradeWebSocket} from '../server/websocket.js';

// This fixture mocks ONLY the trusted provider boundary. The real production
// verifier loads Firebase Admin SDK. No real Google account is tested here.
async function setup(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'study-v5-api-'));
 const store=new SQLiteStore(path.join(dir,'test.sqlite'));
 const accounts=new AccountsStore(store),auth=createAuth(crypto.randomBytes(32)),rooms=new Rooms(auth,store,accounts);
 const json=(res,status,p)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(p));};
 const readBody=req=>new Promise((resolve,reject)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{try{resolve(JSON.parse(raw))}catch{reject(new Error('Invalid JSON'))}});req.on('error',reject);});
 const verifyFirebase={async verify(token){if(token==='valid-project-google-A')return {uid:'verified-A'};if(token==='valid-project-google-B')return {uid:'verified-B'};if(token==='valid-project-google-C')return {uid:'verified-C'};throw new Error('Firebase rejects invalid signature or audience');}};
 const handler=createAccountAPI({accounts,rooms,auth,verifyFirebase,json,sameOrigin:req=>!req.headers.origin||req.headers.origin===`http://${req.headers.host}`,permit:()=>true,readBody,store});
 const server=http.createServer(async(req,res)=>{if(await handler(req,res,new URL(req.url,'http://localhost').pathname))return;json(res,404,{});});
 server.on('upgrade',(req,socket,head)=>{const session=accountContext(req,accounts);upgradeWebSocket(req,socket,head,peer=>rooms.connect(peer,session?.id||null,session?.expiresAt||0));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const sockets=[];
 async function request(path,method='GET',body=null,cookie='',csrf=''){
  const headers={...(cookie?{cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})};if(body)headers['Content-Type']='application/json';
  const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});
  return {status:r.status,json:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||null};
 }
 async function login(token,guestToken){const response=await request('/api/auth/google','POST',{idToken:token,guestToken});
  return {...response,csrf:response.json.csrf};}
 async function openWS(cookie,room='main',takeover=false){
  const socket=net.connect(server.address().port,'127.0.0.1');sockets.push(socket);await once(socket,'connect');
  const key=crypto.randomBytes(16).toString('base64');
  const request=`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${server.address().port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\nCookie: ${cookie}\r\n\r\n`;
  let buffer=Buffer.alloc(0),handshake=false;const messages=[],waiters=[];
  function parse(){
   if(!handshake){const at=buffer.indexOf('\r\n\r\n');if(at<0)return;
    const header=buffer.subarray(0,at).toString();if(!header.startsWith('HTTP/1.1 101'))throw new Error('WebSocket handshake rejected: '+header);
    buffer=buffer.subarray(at+4);handshake=true;
   }
   while(buffer.length>=2){const len0=buffer[1]&127;let head=2,len=len0;
    if(len0===126){if(buffer.length<4)return;len=buffer.readUInt16BE(2);head=4;}
    if(len0===127)throw new Error('Too long frame');
    if(buffer.length<head+len)return;
    const opcode=buffer[0]&15,raw=buffer.subarray(head,head+len);buffer=buffer.subarray(head+len);
    if(opcode===1){const msg=JSON.parse(raw.toString());messages.push(msg);
      for(const w of [...waiters])if(w.pred(msg)){clearTimeout(w.timer);waiters.splice(waiters.indexOf(w),1);w.resolve(msg);}}
   }
  }
  socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);try{parse()}catch(e){for(const w of waiters)w.reject(e);}});
  socket.write(request);
  const wait=(pred,ms=3000)=>{const already=messages.find(pred);if(already)return Promise.resolve(already);
   return new Promise((resolve,reject)=>{const w={pred,resolve,reject};w.timer=setTimeout(()=>{waiters.splice(waiters.indexOf(w),1);reject(new Error('WS timeout '+JSON.stringify(messages.slice(-4))));},ms);waiters.push(w);});};
  const send=message=>{const text=Buffer.from(JSON.stringify(message)),mask=crypto.randomBytes(4);
   const header=text.length<126?Buffer.from([0x81,0x80|text.length]):Buffer.from([0x81,0xfe,text.length>>8,text.length&255]);
   const data=Buffer.alloc(text.length);for(let i=0;i<data.length;i++)data[i]=text[i]^mask[i%4];socket.write(Buffer.concat([header,mask,data]));};
  send({t:'join',room,profile:{nick:'Google 연구자',species:'cat',hood:'#aabbcc'},takeover});
  return {socket,send,wait,messages};
 }
 async function close(){for(const w of sockets)try{w.close()}catch{};for(const c of rooms.connections)try{c.peer.close()}catch{}
  await new Promise(r=>server.close(r));store.close();fs.rmSync(dir,{recursive:true,force:true});}
 return {accounts,auth,rooms,store,request,login,close,base,sockets,openWS};
}

test('Google-ID-token mock boundary, ownership, CSRF, session revocation and stats',async t=>{
 const x=await setup();t.after(x.close);
 const g=x.auth.issue();await x.store.ensureGuest(g.id);
 await x.store.addSegments(g.id,new Map([['2026-11-01',3*3600000]]));
 assert.equal((await x.login('forged-token',g.token)).status,401);
 assert.equal((await x.login('wrong-project-google',g.token)).status,401);
 const first=await x.login('valid-project-google-A',g.token);
 assert.equal(first.status,200);assert.equal(first.json.account.id,g.id);
 assert.ok(first.cookie.startsWith('snu_session='));
 assert.equal((await x.request('/api/auth/me','GET',null,first.cookie)).status,200);
 assert.equal((await x.request('/api/friends/list','GET',null,first.cookie)).status,200);
 assert.equal((await x.request('/api/friends/privacy','POST',{joinAllowed:false},first.cookie)).status,403,'CSRF required');
 assert.equal((await x.request('/api/friends/privacy','POST',{joinAllowed:false},first.cookie,'bad')).status,403);
 assert.equal((await x.request('/api/friends/privacy','POST',{joinAllowed:false},first.cookie,first.csrf)).status,200);
 assert.equal(x.accounts.account(g.id).joinAllowed,false);
 const noGuest=x.auth.validate(g.token);assert.equal(x.accounts.isGuestAvailable(noGuest),false);
 const again=await x.login('valid-project-google-A');assert.equal(again.json.account.id,g.id);
 assert.equal(await x.store.getDay(g.id,'2026-11-01'),10800000);
 assert.equal((await x.request('/api/auth/logout','POST',{},first.cookie,first.csrf)).status,200);
 assert.equal((await x.request('/api/auth/me','GET',null,first.cookie)).status,401);
});

test('friend API: code lookup, accept, presence privacy, friend ranking and join authorization',async t=>{
 const x=await setup();t.after(x.close);
 const A=await x.login('valid-project-google-A'),B=await x.login('valid-project-google-B'),C=await x.login('valid-project-google-C');
 assert.equal(A.status,200);assert.equal(B.status,200);
 const a=A.json.account.id,b=B.json.account.id,c=C.json.account.id;
 const code=B.json.account.code;
 const send=await x.request('/api/friends/request','POST',{code},A.cookie,A.csrf);assert.equal(send.status,200);
 assert.equal((await x.request('/api/friends/list','GET',null,B.cookie)).json.requests.length,1);
 const accepted=await x.request('/api/friends/respond','POST',{requestId:send.json.id,action:'accept'},B.cookie,B.csrf);assert.equal(accepted.status,200);
 assert.equal((await x.request('/api/friends/list','GET',null,A.cookie)).json.friends[0].id,b);
 assert.equal((await x.request('/api/friends/join','POST',{id:c},A.cookie,A.csrf)).status,403,'non-friend cannot join via friends');
 // Real server room presence is required for friend join.
 const room=x.rooms.get('main');const sent=[];
 const peer={send:m=>sent.push(m),close:()=>{},on:()=>{}};
 const p={id:b,online:true,studying:true,paused:false,seatId:null,peer,studyMs:0,day:koreaDay(),pending:new Map(),x:0,z:35};room.users.set(b,p);
 assert.equal((await x.request('/api/friends/join','POST',{id:b},A.cookie,A.csrf)).status,200);
 assert.equal((await x.request('/api/friends/list','GET',null,A.cookie)).json.friends[0].studying,true);
 assert.equal((await x.request('/api/friends/privacy','POST',{activityPublic:false},B.cookie,B.csrf)).status,200);
 assert.equal((await x.request('/api/friends/list','GET',null,A.cookie)).json.friends[0].room,null);
 const hidden=await x.request('/api/friends/join','POST',{id:b},A.cookie,A.csrf);assert.equal(hidden.status,403);
 await x.store.addSegments(a,new Map([[koreaDay(),2000]]));await x.store.addSegments(b,new Map([[koreaDay(),3000]]));
 assert.equal((await x.request('/api/friends/ranking','GET',null,A.cookie)).json.entries.length,2);
 await x.request('/api/friends/privacy','POST',{friendRankingPublic:false},B.cookie,B.csrf);
 assert.equal((await x.request('/api/friends/ranking','GET',null,A.cookie)).json.entries.length,1);
 assert.equal((await x.request('/api/friends/block','POST',{id:b},A.cookie,A.csrf)).status,200);
 assert.equal((await x.request('/api/friends/list','GET',null,A.cookie)).json.friends.length,0);
 assert.equal((await x.request('/api/friends/unblock','POST',{id:b},A.cookie,A.csrf)).status,200);
});

test('App-side account removal erases its study ledger and social links, not Firebase provider account',async t=>{
 const x=await setup();t.after(x.close);const A=await x.login('valid-project-google-A'),id=A.json.account.id;
 await x.store.addSegments(id,new Map([['2026-11-01',7000]]));
 const deleteR=await x.request('/api/auth/delete','POST',{},A.cookie,A.csrf);assert.equal(deleteR.status,200);
 assert.equal(deleteR.json.providerAccountDeleted,false);
 assert.equal(await x.store.getDay(id,'2026-11-01'),0);
 assert.equal((await x.request('/api/auth/me','GET',null,A.cookie)).status,401);
});

test('actual TCP/WebSocket cookie auth: one active Google controller, explicit takeover, private room ACL',{timeout:12000},async t=>{
 const x=await setup();t.after(x.close);
 const A=await x.login('valid-project-google-A'),A2=await x.login('valid-project-google-A'),B=await x.login('valid-project-google-B');
 const a=A.json.account.id;
 const first=await x.openWS(A.cookie,'main');
 assert.equal((await first.wait(m=>m.t==='welcome')).id,a);
 const second=await x.openWS(A2.cookie,'main');
 await second.wait(m=>m.t==='error'&&m.code==='control_conflict');
 assert.equal(x.rooms.get('main').users.get(a).peer!==null,true,'first controller remains online');
 const third=await x.openWS(A2.cookie,'main',true);
 assert.equal((await third.wait(m=>m.t==='welcome')).id,a);
 assert.equal(x.rooms.members(x.rooms.get('main')),1,'duplicated account not counted twice');
 assert.equal((await x.request('/api/rooms/private','POST',{},A.cookie,A.csrf)).status,200);
 const policy=x.accounts.db.prepare('SELECT room_id FROM room_policies WHERE owner_id=?').get(a);
 const denied=await x.openWS(B.cookie,policy.room_id);
 await denied.wait(m=>m.t==='error'&&m.code==='room_private');
 const owner=await x.openWS(A.cookie,policy.room_id,true);
 assert.equal((await owner.wait(m=>m.t==='welcome')).room,policy.room_id);
});
