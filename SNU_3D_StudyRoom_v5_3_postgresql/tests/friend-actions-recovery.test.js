import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountClient } from '../client/account.js';
import { SQLiteStore } from '../server/store.js';
import { AccountsStore } from '../server/accounts-store.js';
import { createAccountAPI } from '../server/account-api.js';

const reply=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});

// An outdated CSRF token can occur in one tab when another tab creates a new
// HttpOnly session. Retry ONLY after the server confirms the same account ID.
test('CSRF stale tab refreshes same-user token and retries friend accept once',async()=>{
 const originalFetch=globalThis.fetch;const calls=[];
 const client=new AccountClient({onChange:()=>{},onToast:()=>{},getGuestToken:()=>null});
 client.account={id:'recipient'};client.csrf='old';client.draw=()=>{};
 globalThis.fetch=async(url,opts)=>{
  calls.push({url,token:opts.headers?.['X-CSRF-Token']});
  if(calls.length===1)return reply(403,{error:'CSRF 확인 실패. 다시 로그인 상태를 확인하세요.'});
  if(calls.length===2)return reply(200,{account:{id:'recipient'},csrf:'fresh'});
  return reply(200,{state:'accepted'});
 };
 try{
  assert.deepEqual(await client.request('/api/friends/respond','POST',{requestId:5,action:'accept'}),{state:'accepted'});
  assert.deepEqual(calls.map(x=>x.url),['/api/friends/respond','/api/auth/me','/api/friends/respond']);
  assert.equal(calls[0].token,'old');assert.equal(calls[2].token,'fresh');
 }finally{globalThis.fetch=originalFetch;}
});

test('CSRF revalidation never submits a friend action as another signed-in user',async()=>{
 const originalFetch=globalThis.fetch;const calls=[];
 const client=new AccountClient({onChange:()=>{},onToast:()=>{},getGuestToken:()=>null});
 client.account={id:'recipient'};client.csrf='old';client.draw=()=>{};
 globalThis.fetch=async(url)=>{calls.push(url);return calls.length===1?reply(403,{error:'CSRF 확인 실패.'}):reply(200,{account:{id:'different-user'},csrf:'other'});};
 try{
  await assert.rejects(client.request('/api/friends/respond','POST',{requestId:5,action:'reject'}),/로그인 계정이 변경/);
  assert.equal(calls.length,2,'must not retry a sensitive POST under a different identity');
 }finally{globalThis.fetch=originalFetch;}
});

test('unrelated HTTP 403 is not retried, and displays actual status',async()=>{
 const originalFetch=globalThis.fetch;let calls=0;
 const client=new AccountClient({onChange:()=>{},onToast:()=>{},getGuestToken:()=>null});
 client.account={id:'recipient'};client.csrf='valid';
 globalThis.fetch=async()=>{calls++;return reply(403,{error:'Wrong origin'});};
 try{await assert.rejects(client.request('/api/friends/respond','POST',{requestId:5,action:'accept'}),/Wrong origin.*HTTP 403/);assert.equal(calls,1);}
 finally{globalThis.fetch=originalFetch;}
});

test('real SQLite friend endpoint accepts and rejects requests only as recipient; sender cancellation stays valid',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'snu-friend-actions-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const store=new SQLiteStore(join(directory,'db.sqlite'));t.after(()=>store.close());
 const accounts=new AccountsStore(store);
 const A=accounts.createOrLink('firebase-receiver-test-A').id;
 const B=accounts.createOrLink('firebase-receiver-test-B').id;
 const sessionA=accounts.createSession(A);const sessionB=accounts.createSession(B);
 const ctx={accounts,rooms:{rooms:new Map()},auth:{},verifyFirebase:null,store,sameOrigin:()=>true,permit:()=>true,readBody:async req=>req.body,
  json:(res,status,value)=>{res.status=status;res.value=value;}};
 const api=createAccountAPI(ctx);
 const call=async(raw,csrf,path,body)=>{
  const req={method:'POST',url:path,headers:{cookie:'snu_session='+raw,'x-csrf-token':csrf},body};const res={};
  await api(req,res,path);return res;
 };
 const first=accounts.sendRequest(A,B);
 assert.equal((await call(sessionA.raw,sessionA.csrf,'/api/friends/respond',{requestId:first.id,action:'accept'})).status,400,'sender cannot accept');
 assert.equal((await call(sessionB.raw,'wrong','/api/friends/respond',{requestId:first.id,action:'accept'})).status,403,'CSRF is enforced');
 const accepted=await call(sessionB.raw,sessionB.csrf,'/api/friends/respond',{requestId:first.id,action:'accept'});
 assert.equal(accepted.status,200);assert.equal(accepted.value.state,'accepted');assert.equal(accounts.isFriend(A,B),true);
 assert.equal((await call(sessionB.raw,sessionB.csrf,'/api/friends/respond',{requestId:first.id,action:'reject'})).status,400,'already handled request cannot be reprocessed');
 accounts.unfriend(A,B);
 const second=accounts.sendRequest(A,B);
 const rejected=await call(sessionB.raw,sessionB.csrf,'/api/friends/respond',{requestId:second.id,action:'reject'});
 assert.equal(rejected.status,200);assert.equal(rejected.value.state,'rejected');assert.equal(accounts.isFriend(A,B),false);
 const third=accounts.sendRequest(A,B);
 const cancelled=await call(sessionA.raw,sessionA.csrf,'/api/friends/respond',{requestId:third.id,action:'cancel'});
 assert.equal(cancelled.status,200);assert.equal(cancelled.value.state,'cancelled');
});
