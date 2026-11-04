import crypto from 'node:crypto';
import {hash} from './accounts-store.js';
import {koreaDay,LAYOUT_SEATS,NPC_SEATS,validRoom} from './room.js';
import {buildRanking} from './stats.js';

export const parseCookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=')).filter(a=>a.length===2));
export function accountContext(req,accounts){
 const raw=parseCookies(req)['snu_session'];const session=accounts.session(raw);
 // SQLite currently returns synchronously; PostgreSQL returns a promise.
 // Keep this dual shape for existing v5 SQLite tests, await in production callers.
 return session&&typeof session.then==='function' ? session.then(s=>s?{...s,raw}:null) : session?{...session,raw}:null;
}
export const sessionCookie=(req,raw,maxAge=14*86400)=>{
 const host=req.headers.host||'';
 const secure=req.socket.encrypted||req.headers['x-forwarded-proto']==='https'||host.endsWith('.app.github.dev')||process.env.STUDYROOM_PUBLIC_ORIGIN?.startsWith('https:');
 return `snu_session=${raw}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; ${secure?'Secure; ':''}Priority=High`;
};
export function createAccountAPI({accounts,rooms,auth,verifyFirebase,json,sameOrigin,permit,readBody,store}){
 const bad=(res,code,message)=>json(res,code,{error:message});
 const roomUsers=()=>{const map=new Map();for(const room of rooms.rooms.values())for(const p of room.users.values())map.set(p.id,{...p,roomId:room.id});return map;};
 async function evictNewlyUnauthorized(a,b){
  for(const room of [...rooms.rooms.values()]){
   const policy=await accounts.roomPolicy(room.id);
   if(!policy?.is_private)continue;
   if(policy.owner_id===a&&room.users.has(b))await rooms.stopIdentity(b);
   else if(policy.owner_id===b&&room.users.has(a))await rooms.stopIdentity(a);
  }
 }
 const presence=async (viewer,id,live)=>{
  const a=await accounts.account(id),p=live.get(id),friend=await accounts.isFriend(viewer,id);
  if(!a||!friend||await accounts.blocked(viewer,id))return {online:null,studying:null,sameRoom:null,room:null};
  const mine=live.get(viewer);if(!a.activityPublic)return {online:null,studying:null,sameRoom:null,room:null};
  return {online:!!p?.online,studying:!!(p?.online&&p?.studying&&!p?.paused),sameRoom:!!(p?.online&&mine?.online&&p.roomId===mine.roomId),
   room:a.joinAllowed&&p?.online?p.roomId:null};
 };
 return async function handle(req,res,pathname){
  if(!pathname.startsWith('/api/auth/')&&!pathname.startsWith('/api/friends/')&&!pathname.startsWith('/api/rooms/'))return false;
  if(!sameOrigin(req))return bad(res,403,'Wrong origin'),true;
  if(!permit(req,'account-api',100))return bad(res,429,'요청 제한을 초과했습니다.'),true;
  try{
   if(pathname==='/api/auth/config'&&req.method==='GET'){
    const config=process.env.FIREBASE_WEB_CONFIG?JSON.parse(process.env.FIREBASE_WEB_CONFIG):null;
    return json(res,200,{enabled:!!verifyFirebase&&!!config,config:verifyFirebase?config:null}),true;
   }
   if(pathname==='/api/auth/google'&&req.method==='POST'){
    if(!verifyFirebase)return bad(res,503,'Firebase 서버 설정이 필요합니다.'),true;
    const body=await readBody(req,12000);
    let verified;try{verified=await verifyFirebase.verify(body.idToken);}catch{return bad(res,401,'Google 인증 검증에 실패했습니다.'),true;}
    const guestId=auth.validate(body.guestToken);
    // Stop and durably checkpoint any active guest BEFORE transactional transfer.
    if(guestId&&await accounts.isGuestAvailable(guestId))await rooms.stopIdentity(guestId);
    const result=await accounts.createOrLink(verified.uid,guestId);
    const session=await accounts.createSession(result.id);
    res.setHeader('Set-Cookie',sessionCookie(req,session.raw));
    return json(res,200,{account:await accounts.account(result.id),csrf:session.csrf,linked:!!guestId,merged:result.merged}),true;
   }
   const ctx=await accountContext(req,accounts);
   if(!ctx)return bad(res,401,'Google 로그인이 필요합니다.'),true;
   if(pathname==='/api/auth/me'&&req.method==='GET')return json(res,200,{account:await accounts.account(ctx.id),csrf:ctx.csrfToken}),true;
   if(req.method!=='GET'){
    const submitted=req.headers['x-csrf-token'];
    if(typeof submitted!=='string'||submitted.length>100||hash(submitted)!==ctx.csrfHash)return bad(res,403,'CSRF 확인 실패. 다시 로그인 상태를 확인하세요.'),true;
   }
   if(pathname==='/api/auth/logout'&&req.method==='POST'){
    await accounts.revokeSession(ctx.raw);
    res.setHeader('Set-Cookie',sessionCookie(req,'',0));
    await rooms.stopIdentity(ctx.id);
    return json(res,200,{ok:true}),true;
   }
   if(pathname==='/api/auth/delete'&&req.method==='POST'){
    // Delete app-side records only; provider Firebase account remains untouched.
    await rooms.stopIdentity(ctx.id);
    await accounts.deleteAccount(ctx.id);
    res.setHeader('Set-Cookie',sessionCookie(req,'',0));return json(res,200,{ok:true,providerAccountDeleted:false}),true;
   }
   if(pathname==='/api/friends/privacy'&&req.method==='POST'){
    return json(res,200,{account:await accounts.setPrivacy(ctx.id,await readBody(req))}),true;
   }
   if(pathname==='/api/friends/find'&&req.method==='GET'){
    const code=new URL(req.url,'http://localhost').searchParams.get('code');const a=await accounts.findCode(code);
    return json(res,200,{user:a&&a.id!==ctx.id&&!await accounts.blocked(ctx.id,a.id)?{id:a.id,nick:a.nick,species:a.species,hood:a.hood,code:a.code}:null}),true;
   }
   if(pathname==='/api/friends/request'&&req.method==='POST'){
    const {code}=await readBody(req);const target=await accounts.findCode(code);
    if(!target)return bad(res,404,'친구 코드를 찾을 수 없습니다.'),true;
    return json(res,200,await accounts.sendRequest(ctx.id,target.id)),true;
   }
   if(pathname==='/api/friends/respond'&&req.method==='POST'){
    const {requestId,action}=await readBody(req);return json(res,200,await accounts.respond(ctx.id,requestId,action)),true;
   }
   if(pathname==='/api/friends/remove'&&req.method==='POST'){
    const {id}=await readBody(req);if(!await accounts.isFriend(ctx.id,id))return bad(res,404,'친구가 아닙니다.'),true;
    await accounts.unfriend(ctx.id,id);await evictNewlyUnauthorized(ctx.id,id);return json(res,200,{ok:true}),true;
   }
   if(pathname==='/api/friends/block'&&req.method==='POST'){
    const {id}=await readBody(req);accounts.block(ctx.id,id);await evictNewlyUnauthorized(ctx.id,id);return json(res,200,{ok:true}),true;
   }
   if(pathname==='/api/friends/unblock'&&req.method==='POST'){
    const {id}=await readBody(req);accounts.unblock(ctx.id,id);return json(res,200,{ok:true}),true;
   }
   if(pathname==='/api/friends/list'&&req.method==='GET'){
    const live=roomUsers();const friends=await accounts.friends(ctx.id);
    return json(res,200,{account:await accounts.account(ctx.id),
      friends:await Promise.all(friends.map(async a=>({id:a.id,nick:a.nick,species:a.species,hood:a.hood,...await presence(ctx.id,a.id,live)}))),
      requests:await accounts.requests(ctx.id),blocks:await accounts.blocks(ctx.id)}),true;
   }
   if(pathname==='/api/friends/ranking'&&req.method==='GET'){
    await rooms.flushAll(true);const day=koreaDay(),friendIds=[];
    for(const id of await accounts.friendIds(ctx.id))if((await accounts.account(id))?.friendRankingPublic)friendIds.push(id);
    const ids=[ctx.id,...friendIds];const entries=await accounts.friendRanking(ids,day),live=roomUsers();const rows=new Map(entries.map(r=>[r.id,r]));
    for(const id of ids){const p=live.get(id);if(p&&p.day===day){const ms=rooms.studyMs(p);if(ms>0)rows.set(id,{id,nick:p.nick,species:p.species,hood:p.hood,ms});}}
    return json(res,200,{...buildRanking([...rows.values()],ctx.id,day,20),friends:friendIds.length}),true;
   }
   if(pathname==='/api/friends/join'&&req.method==='POST'){
    const {id}=await readBody(req);if(!await accounts.isFriend(ctx.id,id)||await accounts.blocked(ctx.id,id))return bad(res,403,'친구 관계가 필요합니다.'),true;
    const profile=await accounts.account(id),live=roomUsers(),target=live.get(id);
    if(!profile.activityPublic||!profile.joinAllowed||!target?.online)return bad(res,403,'친구가 합류를 허용하지 않았거나 오프라인입니다.'),true;
    const room=rooms.rooms.get(target.roomId);
    if(!room||rooms.members(room)>=64)return bad(res,409,'방 정원이 가득 찼습니다.'),true;
    if(!await accounts.canEnterRoom(room.id,ctx.id))await accounts.grantRoom(room.id,ctx.id);
    const mySeat=target.seatId!==null?LAYOUT_SEATS[target.seatId]:null;
    const candidates=LAYOUT_SEATS.filter(s=>!NPC_SEATS.has(s.id)&&!room.locks.has(s.id))
     .sort((a,b)=>Math.hypot(a.x-(mySeat?.x??target.x),a.z-(mySeat?.z??target.z))-Math.hypot(b.x-(mySeat?.x??target.x),b.z-(mySeat?.z??target.z)))
     .slice(0,4).map(s=>({id:s.id,x:s.x,z:s.z}));
    return json(res,200,{room:room.id,seats:candidates}),true;
   }
   if(pathname==='/api/rooms/private'&&req.method==='POST'){
    const room='private-'+crypto.randomBytes(8).toString('hex');
    if(!validRoom(room))return bad(res,500,'Invalid room'),true;
    await accounts.createPrivateRoom(ctx.id,room);return json(res,200,{room}),true;
   }
   return bad(res,404,'Not found'),true;
  }catch(e){
   if(['Invalid privacy setting','Invalid friend request','Invalid user','Account needed','친구 신청을 보낼 수 없습니다.','대기 중인 친구 신청이 있습니다.','하루 친구 신청 제한을 초과했습니다.','친구 신청이 없거나 처리 권한이 없습니다.','차단된 관계입니다.'].includes(e.message))return bad(res,400,e.message),true;
   // Do not log tokens, cookies, uid or email.
   console.error('[account API]',e.code||e.name||'error');return bad(res,503,'계정 서버 처리 오류가 발생했습니다.'),true;
  }
 };
}
