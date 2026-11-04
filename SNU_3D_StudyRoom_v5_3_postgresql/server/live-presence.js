import crypto from 'node:crypto';
import {choosePublicRoom,roomCapacity,parsedPublicRoom} from './room-routing.js';

// PostgreSQL is the cross-process room directory and lease owner, not the
// broadcast transport. Real-time events stay on one authoritative room worker.
const SQL=`
 CREATE TABLE IF NOT EXISTS live_room_presence (
   guest_id char(32) PRIMARY KEY,
   room_id varchar(32) NOT NULL,
   server_id varchar(80) NOT NULL,
   seat_id integer,
   studying boolean NOT NULL DEFAULT FALSE,
   paused boolean NOT NULL DEFAULT FALSE,
   lease_until timestamptz NOT NULL
 );
 CREATE INDEX IF NOT EXISTS idx_live_room_presence_room_lease ON live_room_presence(room_id,lease_until);
 CREATE TABLE IF NOT EXISTS live_room_reservations (
   reservation_id varchar(32) PRIMARY KEY,
   room_id varchar(32) NOT NULL,
   expires_at timestamptz NOT NULL
 );
 CREATE INDEX IF NOT EXISTS idx_live_room_reservations_room_exp ON live_room_reservations(room_id,expires_at);
`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export class LivePresence {
 constructor(pool,{serverId=crypto.randomUUID(),ttlSeconds=45}={}){
   this.pool=pool;this.serverId=serverId;this.ttlSeconds=ttlSeconds;
 }
 async init(){await this.pool.query(SQL);return this;}
 async occupancy(library){
   const {rows}=await this.pool.query(`SELECT room_id,COUNT(*)::integer AS n FROM live_room_presence
     WHERE lease_until>NOW() AND (room_id=$1 OR room_id LIKE $2)
     GROUP BY room_id`,[library,`${library}-%`]);
   return new Map(rows.map(r=>[r.room_id,Number(r.n)]));
 }
 async allocate(library){
   const client=await this.pool.connect();
   try{
     await client.query('BEGIN');
     await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`library:${library}`]);
     await client.query('DELETE FROM live_room_reservations WHERE expires_at < NOW()');
     const counts=new Map();
     const {rows:active}=await client.query(`SELECT room_id,COUNT(*)::int AS n FROM live_room_presence
       WHERE lease_until>NOW() AND (room_id=$1 OR room_id LIKE $2) GROUP BY room_id`,[library,`${library}-%`]);
     for(const row of active)counts.set(row.room_id,Number(row.n));
     const {rows:held}=await client.query(`SELECT room_id,COUNT(*)::int AS n FROM live_room_reservations
       WHERE expires_at>NOW() AND (room_id=$1 OR room_id LIKE $2) GROUP BY room_id`,[library,`${library}-%`]);
     for(const row of held)counts.set(row.room_id,(counts.get(row.room_id)||0)+Number(row.n));
     const result=await choosePublicRoom(library,async()=>counts);
     if(!result){await client.query('ROLLBACK');return null;}
     const reservation=crypto.randomBytes(16).toString('hex');
     await client.query(`INSERT INTO live_room_reservations(reservation_id,room_id,expires_at)
       VALUES($1,$2,NOW()+interval '60 seconds')`,[reservation,result.room]);
     await client.query('COMMIT');return {...result,reservation};
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
   finally{client.release();}
 }

 async acquire(id,room,{takeover=false,reservation=null}={}){
   const client=await this.pool.connect();
   try{
     await client.query('BEGIN');
     // Allocation and joins must share the library lock, so reservations cannot overbook.
     const library=parsedPublicRoom(room)?.library;
     for(const value of [...(library?[`library:${library}`]:[]),`identity:${id}`,`room:${room}`].sort())
       await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[value]);
     const {rows}=await client.query('SELECT server_id,room_id,lease_until > NOW() AS active FROM live_room_presence WHERE guest_id=$1 FOR UPDATE',[id]);
     const old=rows[0];
     if(old?.active && old.server_id!==this.serverId && !takeover){await client.query('ROLLBACK');return {ok:false,code:'control_conflict'};}
     const cap=roomCapacity(room);
     const validAdmission=typeof reservation==='string'&&/^[a-f0-9]{32}$/.test(reservation)
        ?(await client.query(`SELECT 1 FROM live_room_reservations WHERE reservation_id=$1
           AND room_id=$2 AND expires_at>NOW() FOR UPDATE`,[reservation,room])).rowCount>0:false;
     const existingHere=old?.active&&old.room_id===room&&old.server_id===this.serverId;
     if(reservation&&!validAdmission&&!existingHere){await client.query('ROLLBACK');return {ok:false,code:'full'};}
     const n=Number((await client.query(`SELECT COUNT(*)::integer AS n FROM live_room_presence
       WHERE room_id=$1 AND lease_until>NOW() AND guest_id<>$2`,[room,id])).rows[0].n);
     const holds=Number((await client.query(`SELECT COUNT(*)::integer AS n FROM live_room_reservations
       WHERE room_id=$1 AND expires_at>NOW() AND reservation_id<>$2`,[room,validAdmission?reservation:''])).rows[0].n);
     if(n+holds>=cap && !existingHere){
       await client.query('ROLLBACK');return {ok:false,code:'full'};
     }
     if(validAdmission)await client.query('DELETE FROM live_room_reservations WHERE reservation_id=$1',[reservation]);
     await client.query(`INSERT INTO live_room_presence(guest_id,room_id,server_id,lease_until)
       VALUES($1,$2,$3,NOW()+$4::int * interval '1 second')
       ON CONFLICT(guest_id) DO UPDATE SET room_id=EXCLUDED.room_id,server_id=EXCLUDED.server_id,
         seat_id=NULL,studying=FALSE,paused=FALSE,lease_until=EXCLUDED.lease_until`,[id,room,this.serverId,this.ttlSeconds]);
     await client.query('COMMIT');return {ok:true};
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
   finally{client.release();}
 }
 async forceRelease(id){await this.pool.query('DELETE FROM live_room_presence WHERE guest_id=$1',[id]);}
 async release(id){await this.pool.query('DELETE FROM live_room_presence WHERE guest_id=$1 AND server_id=$2',[id,this.serverId]);}
 async renew(players){
   if(!players.length)return [];
   const data=players.map(p=>({id:p.id,seat_id:p.seatId,studying:!!p.studying,paused:!!p.paused}));
   const {rows}=await this.pool.query(`UPDATE live_room_presence p SET
     lease_until=NOW()+$3::int * interval '1 second',seat_id=u.seat_id,
     studying=u.studying,paused=u.paused
     FROM jsonb_to_recordset($1::jsonb) AS u(id text,seat_id integer,studying boolean,paused boolean)
     WHERE p.guest_id=u.id AND p.server_id=$2
     RETURNING p.guest_id`,[JSON.stringify(data),this.serverId,this.ttlSeconds]);
   // Return current owners so an old server can stop a taken-over identity.
   const current=new Set(rows.map(r=>r.guest_id.trim()));
   return players.filter(p=>!current.has(p.id)).map(p=>p.id);
 }
 async allUsers(){
   const {rows}=await this.pool.query('SELECT guest_id,room_id,seat_id,studying,paused FROM live_room_presence WHERE lease_until>NOW()');
   return new Map(rows.map(r=>[r.guest_id.trim(),{id:r.guest_id.trim(),roomId:r.room_id,seatId:r.seat_id,online:true,studying:r.studying,paused:r.paused}]));
 }
 async getUsers(ids){
   if(!ids.length)return new Map();
   const {rows}=await this.pool.query(`SELECT guest_id,room_id,seat_id,studying,paused
     FROM live_room_presence WHERE guest_id=ANY($1::char(32)[]) AND lease_until>NOW()`,[ids]);
   return new Map(rows.map(r=>[r.guest_id.trim(),{id:r.guest_id.trim(),roomId:r.room_id,seatId:r.seat_id,
     online:true,studying:r.studying,paused:r.paused}]));
 }
 async roomSeats(room){
   const {rows}=await this.pool.query(`SELECT seat_id FROM live_room_presence
     WHERE room_id=$1 AND lease_until>NOW() AND seat_id IS NOT NULL`,[room]);
   return new Set(rows.map(r=>r.seat_id));
 }
}
