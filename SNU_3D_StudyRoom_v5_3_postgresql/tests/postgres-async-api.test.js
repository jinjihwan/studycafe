import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createAccountAPI,accountContext} from '../server/account-api.js';
import {createAuth,Rooms} from '../server/room.js';
import {hash} from '../server/accounts-store.js';

const A='a'.repeat(32),B='b'.repeat(32);
function asyncAccounts(){
 const sessions=new Map(),requests=new Map();
 return {
  async isGuestAvailable(id){await Promise.resolve();return id===A;},
  async canEnterRoom(room,id){await Promise.resolve();return room==='main' || id===A;},
  async session(token){await Promise.resolve();return sessions.get(token)||null;},
  async createOrLink(uid){return {id:A,merged:false,created:true};},
  async createSession(id){const raw='safe-session',csrf='csrf-value';sessions.set(raw,{id,csrfHash:hash(csrf),csrfToken:csrf,expiresAt:Date.now()+600000});return {raw,csrf,id};},
  async account(id){return id===A?{id:A,nick:'테스트',species:'cat',hood:'#123456',code:'ST-AAAABBBBCC',friendRankingPublic:true}:null;},
  async friendIds(){return [];},async friends(){return [];},async requests(){return [];},async blocks(){return [];},
  async roomPolicy(){return null;},
  async friendRanking(){return [];},
  async isFriend(){return false;},async blocked(){return false;},async findCode(){return null;}
 };
}
test('async PostgreSQL accountContext resolves session before enforcing identity and CSRF',async()=>{
 const a=asyncAccounts();await a.createSession(A);
 const good=await accountContext({headers:{cookie:'snu_session=safe-session'}},a);
 assert.equal(good.id,A);assert.equal(good.csrfToken,'csrf-value');
 assert.equal(await accountContext({headers:{cookie:'snu_session=unknown'}},a),null);
});
test('async PostgreSQL-mode login pipeline creates HttpOnly session and refuses CSRF-bypassing POST',async()=>{
 const accounts=asyncAccounts(),auth=createAuth(Buffer.from('test-secret-for-friends-postgres-mode'));
 const rooms={rooms:new Map(),stopIdentity:async()=>{},flushAll:async()=>{}};
 const json=(res,code,obj)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(obj));};
 const fn=createAccountAPI({accounts,rooms,auth,verifyFirebase:{verify:async token=>token==='verified'?{uid:'firebase-uid'}:Promise.reject(new Error('bad'))},json,sameOrigin:()=>true,permit:()=>true,readBody:req=>new Promise((resolve,reject)=>{let s='';req.on('data',v=>s+=v);req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch(e){reject(e)}})})});
 const srv=http.createServer((req,res)=>{void fn(req,res,new URL(req.url,'http://localhost').pathname).catch(e=>{res.statusCode=500;res.end(String(e.message));});});
 await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve));
 try{
  const url=`http://127.0.0.1:${srv.address().port}`;
  const login=await fetch(url+'/api/auth/google',{method:'POST',body:JSON.stringify({idToken:'verified'})});
  assert.equal(login.status,200);const session=await login.json();assert.equal(session.account.id,A);assert.equal(session.csrf,'csrf-value');
  const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  const me=await fetch(url+'/api/auth/me',{headers:{cookie}});assert.equal(me.status,200);
  const blocked=await fetch(url+'/api/friends/privacy',{method:'POST',headers:{cookie},body:'{}'});assert.equal(blocked.status,403);
 }finally{srv.close();await once(srv,'close');}
});
test('async PG-mode private room ACL is awaited before accepting room join',async()=>{
 const auth=createAuth(Buffer.from('different-test-secret-for-async-room'));
 const store={ensureGuest:async id=>({id,nick:'테스트',species:'rabbit',hood:'#0000ff',rankingPublic:true}),getDay:async()=>0,updateProfile:async()=>{}};
 const accounts=asyncAccounts();
 const rooms=new Rooms(auth,store,accounts);
 const messages=[];const peer={send:v=>messages.push(v),close(){},on(){}};
 const conn=rooms.connect(peer,B,Date.now()+600000);
 await rooms.join(conn,{room:'private-denied',profile:{nick:'이용자'}});
 assert.ok(messages.some(m=>m.t==='error'&&m.code==='room_private'));
 assert.equal(conn.joined,false);
});
