import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PostgresStore} from '../server/store.js';
import {PostgresAccountsStore} from '../server/postgres-accounts-store.js';

const enabled=!!(process.env.PG_TEST_DATABASE_URL&&process.env.PG_TEST_ALLOW==='YES');
test('REAL PostgreSQL: persistent records, Google identity, friends, privacy and transactions',{
 skip:enabled?false:'Not run: separate PG_TEST_DATABASE_URL and PG_TEST_ALLOW=YES required',timeout:30000
},async()=>{
 const store=await PostgresStore.create(process.env.PG_TEST_DATABASE_URL);
 const a=new PostgresAccountsStore(store),uid=crypto.randomBytes(12).toString('hex');
 let id1,id2,source;
 try{
  const first=await a.createOrLink('test-fb-a-'+uid);id1=first.id;
  const second=await a.createOrLink('test-fb-b-'+uid);id2=second.id;
  assert.notEqual(id1,id2);
  await store.updateProfile(id1,{nick:'테스트',species:'cat',hood:'#aabbcc'});
  await store.addSegments(id1,new Map([['2026-11-01',10800000],['2026-11-02',5000]]));
  source=crypto.randomBytes(16).toString('hex');await store.ensureGuest(source);
  await store.addSegments(source,new Map([['2026-11-01',2000]]));
  const merged=await a.createOrLink('test-fb-a-'+uid,source);assert.equal(merged.merged,true);
  assert.equal((await a.createOrLink('test-fb-a-'+uid,source)).merged,false);
  assert.equal(await store.getDay(id1,'2026-11-01'),10802000);
  assert.equal((await store.getDays(id1)).length,2);
  const c=await a.account(id2),req=await a.sendRequest(id1,id2);
  assert.ok(req.id>=1);assert.equal((await a.requests(id2)).length,1);
  assert.equal((await a.respond(id2,req.id,'accept')).state,'accepted');
  assert.equal(await a.isFriend(id1,id2),true);
  assert.equal((await a.friends(id1)).length,1);
  const sess=await a.createSession(id1),seen=await a.session(sess.raw);
  assert.equal(seen?.id,id1);await a.revokeSession(sess.raw);assert.equal(await a.session(sess.raw),null);
  const priv=await a.setPrivacy(id2,{friendRankingPublic:false,activityPublic:false});
  assert.equal(priv.friendRankingPublic,false);
  await a.block(id1,id2);assert.equal(await a.isFriend(id1,id2),false);
  await a.unblock(id1,id2);assert.equal(await a.blocked(id1,id2),false);
  // Reconnect against another pool: durable state (not SQLite or memory).
  await store.pool.query('SELECT 1');
  assert.equal((await a.account(id1)).nick,'테스트');
 }finally{
  for(const id of [id1,id2].filter(Boolean))await a.deleteAccount(id).catch(()=>{});
  if(source)await store.pool.query('DELETE FROM guests WHERE id=$1',[source]).catch(()=>{});
  await store.close();
 }
});
