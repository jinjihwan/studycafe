import crypto from 'node:crypto';
import {hash} from './accounts-store.js';

const clean=s=>typeof s==='string'&&/^[a-f0-9]{32}$/.test(s);
const pair=(a,b)=>[a,b].sort();
const pub=r=>r?{id:r.id,nick:r.nickname,species:r.species,hood:r.hood,code:r.friend_code,
  activityPublic:!!r.activity_public,joinAllowed:!!r.join_allowed,friendRankingPublic:!!r.friend_ranking_public,rankingPublic:!!r.ranking_public}:null;
const profileSql=`SELECT g.*,a.friend_code,a.activity_public,a.join_allowed,a.friend_ranking_public
 FROM accounts a JOIN guests g ON g.id=a.user_id`;
export class PostgresAccountsStore {
 constructor(store){if(store.kind!=='postgres')throw new TypeError('Postgres store expected');this.store=store;this.pool=store.pool;}
 async query(sql,params=[],client=this.pool){return (await client.query(sql,params)).rows;}
 async one(sql,params=[],client=this.pool){return (await this.query(sql,params,client))[0]||null;}
 async tx(fn){const c=await this.pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}
   catch(e){try{await c.query('ROLLBACK');}catch{}throw e;}finally{c.release();}}
 async lock(c,keys){for(const key of [...new Set(keys)].sort())await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);}
 code(){return 'ST-'+crypto.randomBytes(5).toString('hex').toUpperCase();}
 async isAccount(id,client=this.pool){return !!(await this.one('SELECT 1 FROM accounts WHERE user_id=$1',[id],client));}
 async isGuestAvailable(id,client=this.pool){return clean(id)&&!(await this.one(
  'SELECT 1 FROM accounts WHERE user_id=$1 UNION SELECT 1 FROM guest_consumed WHERE guest_id=$1',[id],client));}
 async account(id){return pub(await this.one(profileSql+' WHERE a.user_id=$1',[id]));}
 async byUid(uid,client=this.pool){return (await this.one('SELECT user_id FROM accounts WHERE firebase_uid=$1',[uid],client))?.user_id||null;}
 async createOrLink(uid,guestId=null){
  if(typeof uid!=='string'||!uid||uid.length>128)return {error:'Invalid Firebase UID'};
  return this.tx(async c=>{
   // Locks serialize links for the SAME Firebase UID and/or guest. Atomic even under concurrent HTTP requests.
   await this.lock(c,['firebase:'+uid,...(clean(guestId)?['guest:'+guestId]:[])]);
   const existing=await this.byUid(uid,c);
   const validSource=clean(guestId)&&await this.isGuestAvailable(guestId,c)&&!!await this.one('SELECT 1 FROM guests WHERE id=$1',[guestId],c);
   if(!existing){
    const id=validSource?guestId:crypto.randomBytes(16).toString('hex');
    await c.query('INSERT INTO guests(id) VALUES($1) ON CONFLICT DO NOTHING',[id]);
    let created=false;
    for(let i=0;i<10;i++){
     const code=this.code();
     const r=await c.query('INSERT INTO accounts(user_id,firebase_uid,friend_code) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id',[id,uid,code]);
     if(r.rowCount){created=true;break;}
    }
    if(!created)throw new Error('Could not allocate unique account code');
    return {id,merged:false,created:true};
   }
   if(validSource&&guestId!==existing){
    await c.query(`INSERT INTO study_daily(guest_id,day,milliseconds)
      SELECT $1,day,milliseconds FROM study_daily WHERE guest_id=$2
      ON CONFLICT(guest_id,day) DO UPDATE SET milliseconds=study_daily.milliseconds+EXCLUDED.milliseconds,updated_at=NOW()`,[existing,guestId]);
    await c.query('DELETE FROM study_daily WHERE guest_id=$1',[guestId]);
    await c.query('INSERT INTO guest_consumed(guest_id,account_id) VALUES($1,$2)',[guestId,existing]);
    return {id:existing,merged:true,created:false};
   }
   return {id:existing,merged:false,created:false};
  });
 }
 async createSession(id,ms=14*86400000){
  const raw=crypto.randomBytes(32).toString('base64url'),csrf=crypto.randomBytes(24).toString('base64url'),now=Date.now(),expiry=now+ms;
  await this.pool.query('INSERT INTO app_sessions(token_hash,user_id,csrf_hash,csrf_token,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6)',[hash(raw),id,hash(csrf),csrf,expiry,now]);
  return {raw,csrf,expiresAt:expiry,id};
 }
 async session(raw){if(typeof raw!=='string'||raw.length>180)return null;
  const row=await this.one(`SELECT s.* FROM app_sessions s JOIN accounts a ON a.user_id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at>$2`,[hash(raw),Date.now()]);
  return row?{id:row.user_id,csrfHash:row.csrf_hash,csrfToken:row.csrf_token,expiresAt:Number(row.expires_at),tokenHash:hash(raw)}:null;
 }
 async revokeSession(raw){if(typeof raw==='string')await this.pool.query('DELETE FROM app_sessions WHERE token_hash=$1',[hash(raw)]);}
 async revokeAll(id){await this.pool.query('DELETE FROM app_sessions WHERE user_id=$1',[id]);}
 async profile(id){return this.account(id);}
 async findCode(code){if(typeof code!=='string'||!/^ST-[0-9A-F]{10}$/.test(code))return null;
  return pub(await this.one(profileSql+' WHERE a.friend_code=$1',[code]));}
 async setPrivacy(id,p){
  const fields={activityPublic:'activity_public',joinAllowed:'join_allowed',friendRankingPublic:'friend_ranking_public'};
  await this.tx(async c=>{for(const [key,column] of Object.entries(fields))if(Object.hasOwn(p,key)){
   if(typeof p[key]!=='boolean')throw new Error('Invalid privacy setting');
   await c.query(`UPDATE accounts SET ${column}=$1 WHERE user_id=$2`,[p[key],id]);
  }});return this.account(id);
 }
 async blocked(a,b,client=this.pool){return !!await this.one('SELECT 1 FROM blocks WHERE (blocker=$1 AND blocked=$2) OR (blocker=$2 AND blocked=$1)',[a,b],client);}
 async isFriend(a,b,client=this.pool){const [x,y]=pair(a,b);return !!await this.one('SELECT 1 FROM friends WHERE a=$1 AND b=$2',[x,y],client);}
 async sendRequest(from,to){
  if(!clean(from)||!clean(to)||from===to)throw new Error('친구 신청을 보낼 수 없습니다.');
  return this.tx(async c=>{
   await this.lock(c,['friend:'+from,'friend:'+to]);
   if(!await this.isAccount(from,c)||!await this.isAccount(to,c)||await this.blocked(from,to,c)||await this.isFriend(from,to,c))throw new Error('친구 신청을 보낼 수 없습니다.');
   const now=Date.now();const count=await this.one('SELECT COUNT(*)::int AS n FROM friend_requests WHERE sender=$1 AND created_at>$2',[from,now-86400000],c);
   if(count.n>=20)throw new Error('하루 친구 신청 제한을 초과했습니다.');
   if(await this.one("SELECT 1 FROM friend_requests WHERE state='pending' AND ((sender=$1 AND target=$2) OR (sender=$2 AND target=$1))",[from,to],c))throw new Error('대기 중인 친구 신청이 있습니다.');
   const row=await this.one('INSERT INTO friend_requests(sender,target,state,created_at,updated_at) VALUES($1,$2,$3,$4,$5) RETURNING id',[from,to,'pending',now,now],c);
   return {id:Number(row.id)};
  });
 }
 async respond(id,requestId,action){
  if(!Number.isSafeInteger(requestId)||requestId<1||!['accept','reject','cancel'].includes(action))throw new Error('Invalid friend request');
  return this.tx(async c=>{
   const r=await this.one("SELECT * FROM friend_requests WHERE id=$1 AND state='pending' FOR UPDATE",[requestId],c);
   if(!r||((action==='cancel'?r.sender:r.target)!==id))throw new Error('친구 신청이 없거나 처리 권한이 없습니다.');
   if(await this.blocked(r.sender,r.target,c))throw new Error('차단된 관계입니다.');
   const state={accept:'accepted',reject:'rejected',cancel:'cancelled'}[action];
   await c.query('UPDATE friend_requests SET state=$1,updated_at=$2 WHERE id=$3',[state,Date.now(),requestId]);
   if(action==='accept'){const [a,b]=pair(r.sender,r.target);await c.query('INSERT INTO friends(a,b,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[a,b,Date.now()]);}
   return {state};
  });
 }
 async unfriend(id,other){const [a,b]=pair(id,other);await this.pool.query('DELETE FROM friends WHERE a=$1 AND b=$2',[a,b]);}
 async block(id,other){if(id===other||!await this.isAccount(other))throw new Error('Invalid user');
  await this.tx(async c=>{
   await this.lock(c,['friend:'+id,'friend:'+other]);
   await c.query('INSERT INTO blocks(blocker,blocked,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,other,Date.now()]);
   const [a,b]=pair(id,other);await c.query('DELETE FROM friends WHERE a=$1 AND b=$2',[a,b]);
   await c.query("UPDATE friend_requests SET state='cancelled',updated_at=$1 WHERE state='pending' AND ((sender=$2 AND target=$3) OR (sender=$3 AND target=$2))",[Date.now(),id,other]);
  });
 }
 async unblock(id,other){await this.pool.query('DELETE FROM blocks WHERE blocker=$1 AND blocked=$2',[id,other]);}
 async requests(id){const rows=await this.query(`SELECT r.*,gs.nickname AS sender_nick,gt.nickname AS target_nick FROM friend_requests r
   JOIN guests gs ON gs.id=r.sender JOIN guests gt ON gt.id=r.target
   WHERE r.state='pending' AND (r.sender=$1 OR r.target=$1) ORDER BY r.created_at DESC LIMIT 100`,[id]);
  return rows.map(r=>({...r,id:Number(r.id),created_at:Number(r.created_at),updated_at:Number(r.updated_at)}));}
 async friendIds(id){const rows=await this.query('SELECT CASE WHEN a=$1 THEN b ELSE a END AS id FROM friends WHERE a=$1 OR b=$1',[id]);
  const list=[];for(const row of rows)if(!await this.blocked(id,row.id))list.push(row.id);return list;
 }
 async blocks(id){return this.query('SELECT b.blocked AS id,g.nickname AS nick FROM blocks b JOIN guests g ON g.id=b.blocked WHERE b.blocker=$1',[id]);}
 async friends(id){const list=[];for(const f of await this.friendIds(id)){const a=await this.account(f);if(a)list.push(a);}return list;}
 async friendRanking(ids,day){if(!ids.length)return [];
  return (await this.query(`SELECT g.id,g.nickname AS nick,g.species,g.hood,d.milliseconds AS ms FROM study_daily d
   JOIN guests g ON g.id=d.guest_id WHERE d.day=$1 AND g.id=ANY($2::char(32)[])`,[day,ids])).map(r=>({...r,ms:Number(r.ms)}));
 }
 async roomPolicy(room){return this.one('SELECT * FROM room_policies WHERE room_id=$1',[room]);}
 async canEnterRoom(room,id){const p=await this.roomPolicy(room);return !p||!p.is_private||!!(id&&(p.owner_id===id||(await this.isFriend(p.owner_id,id)&&!await this.blocked(p.owner_id,id)&&await this.one('SELECT 1 FROM room_access WHERE room_id=$1 AND user_id=$2',[room,id]))));}
 async createPrivateRoom(owner,room){if(!await this.isAccount(owner))throw new Error('Account needed');await this.pool.query('INSERT INTO room_policies(room_id,owner_id,is_private) VALUES($1,$2,TRUE)',[room,owner]);}
 async grantRoom(room,id){await this.pool.query('INSERT INTO room_access(room_id,user_id,granted_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[room,id,Date.now()]);}
 async deleteAccount(id){await this.tx(async c=>{
  await c.query('DELETE FROM app_sessions WHERE user_id=$1',[id]);
  await c.query('DELETE FROM friend_requests WHERE sender=$1 OR target=$1',[id]);
  await c.query('DELETE FROM friends WHERE a=$1 OR b=$1',[id]);
  await c.query('DELETE FROM blocks WHERE blocker=$1 OR blocked=$1',[id]);
  await c.query('DELETE FROM room_access WHERE user_id=$1 OR room_id IN (SELECT room_id FROM room_policies WHERE owner_id=$1)',[id]);
  await c.query('DELETE FROM room_policies WHERE owner_id=$1',[id]);
  await c.query('DELETE FROM guest_consumed WHERE account_id=$1',[id]);
  await c.query('DELETE FROM accounts WHERE user_id=$1',[id]);
  await c.query('DELETE FROM study_daily WHERE guest_id=$1',[id]);
  await c.query('DELETE FROM guests WHERE id=$1',[id]);
 });}
}
