import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const clean=s=>typeof s==='string'&&/^[a-f0-9]{32}$/.test(s);
const pair=(a,b)=>[a,b].sort();
const pub=r=>r?{id:r.id,nick:r.nickname,species:r.species,hood:r.hood,code:r.friend_code,activityPublic:!!r.activity_public,joinAllowed:!!r.join_allowed,friendRankingPublic:!!r.friend_ranking_public,rankingPublic:!!r.ranking_public}:null;
export const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
export class AccountsStore {
 constructor(store){
  if(store.kind!=='sqlite')throw new Error('v5 계정·친구 기능은 SQLite만 지원합니다. DATABASE_URL을 제거하세요. v4 PostgreSQL 어댑터는 v5 마이그레이션에 미대응입니다.');
  this.store=store;this.db=store.db;
  this.db.exec(fs.readFileSync(path.join(dir,'../migrations/002_sqlite.sql'),'utf8'));
 }
 transact(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 isAccount(id){return !!this.db.prepare('SELECT 1 FROM accounts WHERE user_id=?').get(id)}
 isGuestAvailable(id){return clean(id)&&!this.db.prepare('SELECT 1 FROM accounts WHERE user_id=? UNION SELECT 1 FROM guest_consumed WHERE guest_id=?').get(id,id)}
 code(){return 'ST-'+crypto.randomBytes(5).toString('hex').toUpperCase();}
 account(id){return pub(this.db.prepare(`SELECT g.*,a.friend_code,a.activity_public,a.join_allowed,a.friend_ranking_public FROM accounts a JOIN guests g ON g.id=a.user_id WHERE a.user_id=?`).get(id));}
 byUid(uid){return this.db.prepare('SELECT user_id FROM accounts WHERE firebase_uid=?').get(uid)?.user_id||null;}
 createOrLink(uid,guestId=null){
  if(typeof uid!=='string'||uid.length>128||!uid)return {error:'Invalid Firebase UID'};
  return this.transact(()=>{
   const existing=this.byUid(uid);
   // Missing/consumed/linked guest token cannot claim another account.
   const validSource=guestId&&this.isGuestAvailable(guestId)&&!!this.db.prepare('SELECT 1 FROM guests WHERE id=?').get(guestId);
   if(!existing){
    const id=validSource?guestId:crypto.randomBytes(16).toString('hex');
    this.db.prepare('INSERT OR IGNORE INTO guests(id) VALUES(?)').run(id);
    let code;for(let i=0;i<10;i++){code=this.code();if(!this.db.prepare('SELECT 1 FROM accounts WHERE friend_code=?').get(code))break;}
    this.db.prepare('INSERT INTO accounts(user_id,firebase_uid,friend_code) VALUES(?,?,?)').run(id,uid,code);
    return {id,merged:false,created:true};
   }
   if(validSource&&guestId!==existing){
    // V4 rows are additive ledger segments. Consuming each guest ID exactly once
    // makes repeated linking idempotent. Concurrent cross-process calls serialize
    // at SQLite BEGIN IMMEDIATE; live sessions must be stopped/flushed BEFORE this.
    this.db.prepare(`INSERT INTO study_daily(guest_id,day,milliseconds)
      SELECT ?,day,milliseconds FROM study_daily WHERE guest_id=?
      ON CONFLICT(guest_id,day) DO UPDATE SET milliseconds=study_daily.milliseconds+excluded.milliseconds`).run(existing,guestId);
    this.db.prepare('DELETE FROM study_daily WHERE guest_id=?').run(guestId);
    this.db.prepare('INSERT INTO guest_consumed(guest_id,account_id) VALUES(?,?)').run(guestId,existing);
    return {id:existing,merged:true,created:false};
   }
   return {id:existing,merged:false,created:false};
  });
 }
 createSession(id,ms=14*86400000){const raw=crypto.randomBytes(32).toString('base64url'),csrf=crypto.randomBytes(24).toString('base64url'),now=Date.now(),expiry=now+ms;
  this.db.prepare('INSERT INTO app_sessions(token_hash,user_id,csrf_hash,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?,?)').run(hash(raw),id,hash(csrf),csrf,expiry,now);
  return {raw,csrf,expiresAt:expiry,id};
 }
 session(raw){if(typeof raw!=='string'||raw.length>180)return null;
  const row=this.db.prepare('SELECT * FROM app_sessions WHERE token_hash=?').get(hash(raw));return row&&row.expires_at>Date.now()&&this.isAccount(row.user_id)?{id:row.user_id,csrfHash:row.csrf_hash,csrfToken:row.csrf_token,expiresAt:row.expires_at,tokenHash:hash(raw)}:null;
 }
 revokeSession(raw){if(typeof raw==='string')this.db.prepare('DELETE FROM app_sessions WHERE token_hash=?').run(hash(raw));}
 revokeAll(id){this.db.prepare('DELETE FROM app_sessions WHERE user_id=?').run(id);}
 profile(id){return this.account(id);}
 findCode(code){if(typeof code!=='string'||!/^ST-[0-9A-F]{10}$/.test(code))return null;
  return pub(this.db.prepare(`SELECT g.*,a.friend_code,a.activity_public,a.join_allowed,a.friend_ranking_public FROM accounts a JOIN guests g ON g.id=a.user_id WHERE a.friend_code=?`).get(code));}
 setPrivacy(id,p){const fields={activityPublic:'activity_public',joinAllowed:'join_allowed',friendRankingPublic:'friend_ranking_public'};
  this.transact(()=>{for(const [key,column] of Object.entries(fields))if(Object.hasOwn(p,key)){if(typeof p[key]!=='boolean')throw new Error('Invalid privacy setting');this.db.prepare(`UPDATE accounts SET ${column}=? WHERE user_id=?`).run(p[key]?1:0,id);}});return this.account(id);
 }
 blocked(a,b){return !!this.db.prepare('SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)').get(a,b,b,a)}
 isFriend(a,b){const [x,y]=pair(a,b);return !!this.db.prepare('SELECT 1 FROM friends WHERE a=? AND b=?').get(x,y)}
 sendRequest(from,to){if(!this.isAccount(from)||!this.isAccount(to)||from===to||this.blocked(from,to)||this.isFriend(from,to))throw new Error('친구 신청을 보낼 수 없습니다.');
  return this.transact(()=>{const now=Date.now();const count=this.db.prepare('SELECT COUNT(*) AS n FROM friend_requests WHERE sender=? AND created_at>?').get(from,now-86400000).n;
   if(count>=20)throw new Error('하루 친구 신청 제한을 초과했습니다.');
   if(this.db.prepare(`SELECT 1 FROM friend_requests WHERE state='pending' AND ((sender=? AND target=?) OR (sender=? AND target=?))`).get(from,to,to,from))throw new Error('대기 중인 친구 신청이 있습니다.');
   const result=this.db.prepare('INSERT INTO friend_requests(sender,target,state,created_at,updated_at) VALUES(?,?,?,?,?)').run(from,to,'pending',now,now);return {id:Number(result.lastInsertRowid)};});
 }
 respond(id,requestId,action){if(!Number.isSafeInteger(requestId)||requestId<1||!['accept','reject','cancel'].includes(action))throw new Error('Invalid friend request');
  return this.transact(()=>{const r=this.db.prepare(`SELECT * FROM friend_requests WHERE id=? AND state='pending'`).get(requestId);
   if(!r||((action==='cancel'?r.sender:r.target)!==id))throw new Error('친구 신청이 없거나 처리 권한이 없습니다.');
   if(this.blocked(r.sender,r.target))throw new Error('차단된 관계입니다.');
   const state={accept:'accepted',reject:'rejected',cancel:'cancelled'}[action];
   this.db.prepare('UPDATE friend_requests SET state=?,updated_at=? WHERE id=?').run(state,Date.now(),requestId);
   if(action==='accept'){const [a,b]=pair(r.sender,r.target);this.db.prepare('INSERT OR IGNORE INTO friends(a,b,created_at) VALUES(?,?,?)').run(a,b,Date.now());}
   return {state};});
 }
 unfriend(id,other){return this.transact(()=>{const [a,b]=pair(id,other);this.db.prepare('DELETE FROM friends WHERE a=? AND b=?').run(a,b);});}
 block(id,other){if(id===other||!this.isAccount(other))throw new Error('Invalid user');
  return this.transact(()=>{this.db.prepare('INSERT OR IGNORE INTO blocks(blocker,blocked,created_at) VALUES(?,?,?)').run(id,other,Date.now());
   const [a,b]=pair(id,other);this.db.prepare('DELETE FROM friends WHERE a=? AND b=?').run(a,b);
   this.db.prepare("UPDATE friend_requests SET state='cancelled',updated_at=? WHERE state='pending' AND ((sender=? AND target=?) OR (sender=? AND target=?))").run(Date.now(),id,other,other,id);});}
 unblock(id,other){this.db.prepare('DELETE FROM blocks WHERE blocker=? AND blocked=?').run(id,other);}
 requests(id){return this.db.prepare(`SELECT r.*,gs.nickname AS sender_nick,gt.nickname AS target_nick FROM friend_requests r
   JOIN guests gs ON gs.id=r.sender JOIN guests gt ON gt.id=r.target
   WHERE r.state='pending' AND (r.sender=? OR r.target=?) ORDER BY r.created_at DESC LIMIT 100`).all(id,id);}
 friendIds(id){return this.db.prepare(`SELECT CASE WHEN a=? THEN b ELSE a END AS id FROM friends WHERE a=? OR b=?`).all(id,id,id).map(r=>r.id).filter(other=>!this.blocked(id,other));}
 blocks(id){return this.db.prepare(`SELECT b.blocked AS id,g.nickname AS nick FROM blocks b JOIN guests g ON g.id=b.blocked WHERE b.blocker=?`).all(id);}
 friends(id){return this.friendIds(id).map(f=>this.account(f)).filter(Boolean);}
 friendRanking(ids,day){if(!ids.length)return [];const placeholders=ids.map(()=>'?').join(',');
  return this.db.prepare(`SELECT g.id,g.nickname AS nick,g.species,g.hood,d.milliseconds AS ms
    FROM study_daily d JOIN guests g ON g.id=d.guest_id WHERE d.day=? AND g.id IN (${placeholders})`).all(day,...ids).map(r=>({...r,ms:Number(r.ms)}));}
 roomPolicy(room){return this.db.prepare('SELECT * FROM room_policies WHERE room_id=?').get(room);}
 canEnterRoom(room,id){const p=this.roomPolicy(room);return !p||!p.is_private||!!(id&&(p.owner_id===id||(this.isFriend(p.owner_id,id)&&!this.blocked(p.owner_id,id)&&this.db.prepare('SELECT 1 FROM room_access WHERE room_id=? AND user_id=?').get(room,id))));}
 createPrivateRoom(owner,room){if(!this.isAccount(owner))throw new Error('Account needed');this.db.prepare('INSERT INTO room_policies(room_id,owner_id,is_private) VALUES(?,?,1)').run(room,owner);}
 grantRoom(room,id){this.db.prepare('INSERT OR IGNORE INTO room_access(room_id,user_id,granted_at) VALUES(?,?,?)').run(room,id,Date.now());}
 deleteAccount(id){return this.transact(()=>{
  // Deletion erases internal study records and social links, never deletes Google identity provider account.
  this.db.prepare('DELETE FROM app_sessions WHERE user_id=?').run(id);
  this.db.prepare('DELETE FROM friend_requests WHERE sender=? OR target=?').run(id,id);
  this.db.prepare('DELETE FROM friends WHERE a=? OR b=?').run(id,id);
  this.db.prepare('DELETE FROM blocks WHERE blocker=? OR blocked=?').run(id,id);
  this.db.prepare('DELETE FROM room_access WHERE user_id=? OR room_id IN (SELECT room_id FROM room_policies WHERE owner_id=?)').run(id,id);
  this.db.prepare('DELETE FROM room_policies WHERE owner_id=?').run(id);
  this.db.prepare('DELETE FROM guest_consumed WHERE account_id=?').run(id);
  this.db.prepare('DELETE FROM accounts WHERE user_id=?').run(id);
  this.db.prepare('DELETE FROM study_daily WHERE guest_id=?').run(id);
  this.db.prepare('DELETE FROM guests WHERE id=?').run(id);
 });}
}
