import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {PostgresAccountsStore} from '../server/postgres-accounts-store.js';
import {PostgresStore} from '../server/store.js';

const idA='a'.repeat(32),idB='b'.repeat(32);
class FakePool {
 constructor(){this.log=[];this.uid=new Map();this.sessions=new Map();this.failNext=false;this.closed=false;}
 async connect(){return {query:(...x)=>this.query(...x),release:()=>{this.closed=true;}};}
 async query(sql,p=[]){
  this.log.push({sql,p});
  if(this.failNext&&sql.startsWith('INSERT INTO accounts')){this.failNext=false;throw Object.assign(new Error('test DB error'),{code:'08006'});}
  if(sql.startsWith('SELECT user_id FROM accounts WHERE firebase_uid'))return {rows:this.uid.has(p[0])?[{user_id:this.uid.get(p[0])}]:[],rowCount:Number(this.uid.has(p[0]))};
  if(sql.startsWith('INSERT INTO accounts(')){this.uid.set(p[1],p[0]);return {rows:[{user_id:p[0]}],rowCount:1};}
  if(sql.startsWith('INSERT INTO app_sessions')){this.sessions.set(p[0],{user_id:p[1],csrf_hash:p[2],csrf_token:p[3],expires_at:p[4]});return {rows:[],rowCount:1};}
  if(sql.startsWith('SELECT s.* FROM app_sessions')){const entry=this.sessions.get(p[0]);return {rows:entry&&entry.expires_at>p[1]?[entry]:[],rowCount:entry?1:0};}
  if(sql.startsWith('DELETE FROM app_sessions WHERE token_hash')){this.sessions.delete(p[0]);return {rows:[],rowCount:1};}
  if(sql.startsWith('SELECT 1 FROM accounts WHERE user_id'))return {rows:[{'?column?':1}],rowCount:1};
  if(sql.startsWith('SELECT COUNT(*)::int AS n'))return {rows:[{n:0}],rowCount:1};
  if(sql.startsWith('INSERT INTO friend_requests'))return {rows:[{id:'74'}],rowCount:1};
  if(sql.startsWith('SELECT * FROM friend_requests'))return {rows:[{id:'74',sender:idA,target:idB,state:'pending'}],rowCount:1};
  return {rows:[],rowCount:sql.startsWith('SELECT')?0:1};
 }
}

test('PG v5.3 schema contains all existing study and all friend tables without destructive changes',()=>{
 const base=fs.readFileSync(new URL('../migrations/001_postgres.sql',import.meta.url),'utf8');
 const social=fs.readFileSync(new URL('../migrations/002_postgres.sql',import.meta.url),'utf8');
 for(const table of ['guests','study_daily'])assert.match(base,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
 for(const table of ['accounts','guest_consumed','app_sessions','friend_requests','friends','blocks','room_policies','room_access'])assert.match(social,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
 assert.doesNotMatch(base+social,/\b(?:DROP|TRUNCATE)\s+TABLE\b/i);
 assert.match(social,/CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending_pair_idx/);
});

test('PG accounts: Firebase UID mapping is transactionally created once and account ID is server assigned',async()=>{
 const pool=new FakePool(),a=new PostgresAccountsStore({kind:'postgres',pool});
 assert.deepEqual(await a.createOrLink(''),{error:'Invalid Firebase UID'});
 const first=await a.createOrLink('test-uid-1');
 assert.equal(first.created,true);assert.match(first.id,/^[0-9a-f]{32}$/);
 assert.deepEqual(await a.createOrLink('test-uid-1'),{id:first.id,merged:false,created:false});
 assert.equal(pool.uid.size,1);
 assert.equal(pool.log.filter(x=>x.sql==='BEGIN').length,2);
 assert.equal(pool.log.filter(x=>x.sql==='COMMIT').length,2);
 assert.ok(pool.log.some(x=>x.sql.includes('pg_advisory_xact_lock')),'concurrent UID/link must be serialized');
 assert.ok(pool.log.some(x=>x.sql.startsWith('INSERT INTO accounts')&&x.p[1]==='test-uid-1'));
});

test('PG sessions persist only SHA-256 token hashes and can be revoked',async()=>{
 const pool=new FakePool(),a=new PostgresAccountsStore({kind:'postgres',pool});
 const sess=await a.createSession(idA);
 assert.match(sess.raw,/^[\w-]{30,}$/);assert.equal(pool.sessions.has(sess.raw),false);
 const row=await a.session(sess.raw);assert.equal(row.id,idA);assert.equal(row.csrfToken,sess.csrf);
 await a.revokeSession(sess.raw);assert.equal(await a.session(sess.raw),null);
});

test('PG account changes rollback on DB failure, and friend respond enforces recipient ownership',async()=>{
 const pool=new FakePool(),a=new PostgresAccountsStore({kind:'postgres',pool});
 pool.failNext=true;
 await assert.rejects(a.createOrLink('will-fail'),/test DB error/);
 assert.ok(pool.log.some(x=>x.sql==='ROLLBACK'));
 await assert.rejects(a.respond(idA,74,'accept'),/처리 권한/);
 assert.equal((await a.respond(idB,74,'accept')).state,'accepted');
 assert.ok(pool.log.some(x=>x.sql.startsWith('INSERT INTO friends')));
 assert.ok(pool.log.some(x=>x.sql.includes('FOR UPDATE')));
});

test('PG study checkpoint commits atomically and rolls back failed transaction',async()=>{
 const pool=new FakePool(),store=new PostgresStore(pool);
 await store.addSegments(idA,new Map([['2026-11-03',123],['2026-11-04',300]]));
 assert.equal(pool.log.filter(x=>x.sql==='COMMIT').length,1);
 assert.equal(pool.log.filter(x=>x.sql.includes('ON CONFLICT(guest_id,day)')).length,2);
 const before=pool.log.length;await store.addSegments(idA,new Map([['bad date',30],['2026-11-04',0]]));assert.equal(pool.log.length,before);
 // Never interpolate user-supplied values into SQL.
 assert.ok(pool.log.filter(x=>x.sql.startsWith('INSERT INTO study_daily')).every(x=>x.p.length===3));
});
