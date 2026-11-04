import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SQLiteStore} from '../server/store.js';
import {AccountsStore} from '../server/accounts-store.js';

const id=()=>crypto.randomBytes(16).toString('hex');
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snu-v5-'));return {file:path.join(dir,'db.sqlite'),cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};}

test('v4 migration preserves study_daily, id, guest profile and restart persistence',async t=>{
 const f=fixture();t.after(f.cleanup);const g=id();
 let db=new SQLiteStore(f.file);await db.ensureGuest(g);await db.updateProfile(g,{nick:'원래 게스트',species:'cat',hood:'#aabbcc'});
 await db.addSegments(g,new Map([['2026-11-01',10800000],['2026-11-02',14400000]]));
 db.close();db=new SQLiteStore(f.file);const a=new AccountsStore(db);
 assert.equal((await db.getDays(g)).length,2);
 const linked=a.createOrLink('firebase-uid-1',g);
 assert.equal(linked.id,g,'first link retains original internal user ID');
 assert.equal(a.account(g).nick,'원래 게스트');
 assert.deepEqual((await db.getDays(g)).map(d=>d.ms),[10800000,14400000]);
 assert.equal(a.isGuestAvailable(g),false,'previously linked guest token cannot access Google data');
 db.close();db=new SQLiteStore(f.file);const again=new AccountsStore(db);
 assert.equal(again.byUid('firebase-uid-1'),g);
 assert.deepEqual((await db.getDays(g)).map(d=>d.ms),[10800000,14400000]);db.close();
});

test('merging a second guest is atomic/idempotent, consumes old guest token, protects against stealing',async t=>{
 const f=fixture();t.after(f.cleanup);const db=new SQLiteStore(f.file),a=new AccountsStore(db);
 const first=id(),second=id(),third=id();for(const idd of [first,second,third])await db.ensureGuest(idd);
 await db.addSegments(first,new Map([['2026-11-01',5000],['2026-11-02',1000]]));
 await db.addSegments(second,new Map([['2026-11-01',7000]]));
 a.createOrLink('firebase-A',first);const linked=a.createOrLink('firebase-A',second);
 assert.equal(linked.id,first);assert.equal(linked.merged,true);
 assert.equal(await db.getDay(first,'2026-11-01'),12000);
 assert.equal(await db.getDay(second,'2026-11-01'),0);
 assert.equal(a.isGuestAvailable(second),false);
 a.createOrLink('firebase-A',second);assert.equal(await db.getDay(first,'2026-11-01'),12000,'replay cannot re-merge consumed guest');
 a.createOrLink('firebase-B',third);assert.equal(a.createOrLink('firebase-A',third).merged,false,'linked account cannot be stolen by other UID');
 assert.equal(a.byUid('firebase-B'),third);db.close();
});

test('mutual request / reject / cancel / accept, block and friend privacy',async t=>{
 const f=fixture();t.after(f.cleanup);const db=new SQLiteStore(f.file),a=new AccountsStore(db);const x=a.createOrLink('uX').id,y=a.createOrLink('uY').id,z=a.createOrLink('uZ').id;
 const r=a.sendRequest(x,y);assert.throws(()=>a.sendRequest(x,y),/대기/);
 assert.deepEqual(a.respond(y,r.id,'reject'),{state:'rejected'});
 const r2=a.sendRequest(x,y);assert.deepEqual(a.respond(x,r2.id,'cancel'),{state:'cancelled'});
 const r3=a.sendRequest(x,y);assert.equal(a.respond(y,r3.id,'accept').state,'accepted');
 assert.equal(a.isFriend(x,y),true);assert.deepEqual(a.friendIds(x),[y]);
 assert.equal(a.setPrivacy(y,{activityPublic:false,friendRankingPublic:false}).friendRankingPublic,false);
 assert.equal(a.account(y).activityPublic,false);
 a.block(x,y);assert.equal(a.isFriend(x,y),false);assert.throws(()=>a.sendRequest(y,x),/신청/);
 a.unblock(x,y);assert.equal(a.blocked(x,y),false);
 const friend=a.sendRequest(z,x);assert.equal(a.respond(x,friend.id,'accept').state,'accepted');
 a.unfriend(x,z);assert.equal(a.isFriend(x,z),false);db.close();
});

test('session expiry, token hash storage, revocation and private-room ACL',async t=>{
 const f=fixture();t.after(f.cleanup);const db=new SQLiteStore(f.file),a=new AccountsStore(db),me=a.createOrLink('uid-1').id,friend=a.createOrLink('uid-2').id;
 const s=a.createSession(me,15000);assert.equal(a.session(s.raw).id,me);
 assert.equal(a.db.prepare('SELECT 1 FROM app_sessions WHERE token_hash=?').get(s.raw),undefined,'raw cookie cannot be found in DB');
 a.revokeSession(s.raw);assert.equal(a.session(s.raw),null);
 const expired=a.createSession(me,-1000);assert.equal(a.session(expired.raw),null);
 a.createPrivateRoom(me,'private-sample');assert.equal(a.canEnterRoom('private-sample',me),true);
 assert.equal(a.canEnterRoom('private-sample',friend),false);const fr=a.sendRequest(me,friend);a.respond(friend,fr.id,'accept');a.grantRoom('private-sample',friend);assert.equal(a.canEnterRoom('private-sample',friend),true);
 a.block(me,friend);assert.equal(a.canEnterRoom('private-sample',friend),false,'blocking revokes private room access immediately');
 assert.equal(a.canEnterRoom('main',friend),true);db.close();
});

test('friend ranking excludes excluded friend and NPC, respects KST study days and block state',async t=>{
 const f=fixture();t.after(f.cleanup);const db=new SQLiteStore(f.file),a=new AccountsStore(db),me=a.createOrLink('uid-r-1').id,b=a.createOrLink('uid-r-2').id,c=a.createOrLink('uid-r-3').id;
 for(const user of [b,c]){const r=a.sendRequest(me,user);a.respond(user,r.id,'accept');}
 for(const [u,ms] of [[me,1000],[b,3000],[c,2000]])await db.addSegments(u,new Map([['2026-11-03',ms]]));
 let ids=[me,...a.friendIds(me).filter(u=>a.account(u).friendRankingPublic)];
 assert.deepEqual(a.friendRanking(ids,'2026-11-03').sort((x,y)=>y.ms-x.ms).map(r=>r.id),[b,c,me]);
 a.setPrivacy(b,{friendRankingPublic:false});ids=[me,...a.friendIds(me).filter(u=>a.account(u).friendRankingPublic)];
 assert.deepEqual(a.friendRanking(ids,'2026-11-03').sort((x,y)=>y.ms-x.ms).map(r=>r.id),[c,me]);
 a.block(me,c);assert.deepEqual(a.friendIds(me),[b]);
 assert.equal(a.friendRanking([me,b],'2026-11-04').length,0);
 db.close();
});
