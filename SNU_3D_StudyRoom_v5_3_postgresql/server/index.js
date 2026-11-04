import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {isIP} from 'node:net';
import { fileURLToPath } from 'node:url';
import { upgradeWebSocket } from './websocket.js';
import { createAuth, Rooms, koreaDay } from './room.js';
import { createStore } from './store.js';
import { buildStats,buildRanking,validMonth } from './stats.js';
import { AccountsStore } from './accounts-store.js';
import { PostgresAccountsStore } from './postgres-accounts-store.js';
import { createFirebaseVerifier } from './firebase.js';
import { createAccountAPI,accountContext } from './account-api.js';
import { originDecision } from './origin.js';
import {statePaths,assertExistingProductionData} from './state-paths.js';
import {LivePresence} from './live-presence.js';
import {validId} from './room.js';
import {parseWorkerTargets,proxyRoomWebsocket} from './ws-router.js';
import {LIBRARIES,choosePublicRoom,parsedPublicRoom,workerForRoom,roomCapacity} from './room-routing.js';
import {createSQLiteBackup} from '../scripts/backup-sqlite.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const allow=new Map([['/','index.html'],['/index.html','index.html'],['/client/network.js','client/network.js'],['/client/dashboard.js','client/dashboard.js'],['/client/account.js','client/account.js'],['/client/friends.js','client/friends.js'],['/client/navigation-smooth.js','client/navigation-smooth.js']]);
const state=statePaths(root);
assertExistingProductionData(state);
const secretFile=state.secret;
function loadSecret() {
  if(process.env.STUDYROOM_SECRET && process.env.STUDYROOM_SECRET.length>=32)return Buffer.from(process.env.STUDYROOM_SECRET);
  try{return fs.readFileSync(secretFile)}catch(e){if(e.code!=='ENOENT')throw e;}
  if(process.env.NODE_ENV==='production')throw new Error('STUDYROOM_SECRET (minimum 32 characters) is required in production.');
  const secret=crypto.randomBytes(32);
  try{fs.writeFileSync(secretFile,secret,{flag:'wx',mode:0o600});return secret}
  catch(e){if(e.code==='EEXIST')return fs.readFileSync(secretFile);throw e;}
}
const auth=createAuth(loadSecret());
const store=await createStore();
const accounts=store.kind==='postgres'?new PostgresAccountsStore(store):new AccountsStore(store);
const firebaseVerifier=await createFirebaseVerifier();
const routeTargets=parseWorkerTargets(process.env.STUDYROOM_ROUTER_TARGETS||'');
const livePresence=store.kind==='postgres'?await new LivePresence(store.pool).init():null;
const rooms=new Rooms(auth,store,accounts,livePresence);
const workerCount=Number(process.env.STUDYROOM_WORKER_COUNT||0);
const workerIndex=Number(process.env.STUDYROOM_WORKER_INDEX||0);
const internalSecret=process.env.STUDYROOM_INTERNAL_SECRET||'';
if((routeTargets.length||workerCount) && (internalSecret.length<32 || store.kind!=='postgres'))
  throw new Error('Multi-worker mode requires PostgreSQL and a shared 32+ character STUDYROOM_INTERNAL_SECRET');
if(routeTargets.length && workerCount)throw new Error('Gateway and worker modes are mutually exclusive');
if(workerCount&&(!Number.isInteger(workerCount)||workerCount<1||workerCount>32||!Number.isInteger(workerIndex)||workerIndex<0||workerIndex>=workerCount))
  throw new Error('Invalid worker configuration');
async function stopIdentityGlobal(id){
 if(!routeTargets.length)return rooms.stopIdentity(id);
 const live=(await livePresence.getUsers([id])).get(id);
 if(!live)return;
 const dest=new URL('/internal/stop-identity',routeTargets[workerForRoom(live.roomId,routeTargets.length)]);
 const abort=AbortSignal.timeout(7000);
 const response=await fetch(dest,{method:'POST',signal:abort,headers:{'Content-Type':'application/json','X-Studyroom-Internal-Secret':internalSecret},body:JSON.stringify({id})});
 if(!response.ok)throw new Error('Room worker checkpoint failed; abort identity change');
 await livePresence.forceRelease(id);
}

let rankingCache=null;
function currentPlayers(){const byId=new Map();for(const room of rooms.rooms.values())for(const p of room.users.values())byId.set(p.id,p);return byId;}
async function dailyRanking(day){
  const now=Date.now();
  if(!rankingCache||rankingCache.day!==day||now-rankingCache.time>5000){
    rankingCache={day,time:now,rows:await store.getRanking(day)};
  }
  // Database cache is up to 5s old; merge only SERVER-VALIDATED unflushed study
  // milliseconds and current visibility/profile from each single active guest.
  const entries=new Map(rankingCache.rows.map(r=>[r.id,{...r}]));
  for(const p of currentPlayers().values()){
    if(!p.rankingPublic){entries.delete(p.id);continue;}
    const ms=rooms.studyMs(p,now);
    if(p.day===day&&ms>0)entries.set(p.id,{id:p.id,nick:p.nick,species:p.species,hood:p.hood,ms});
  }
  return [...entries.values()];
}
const json=(res,status,value)=>{const data=JSON.stringify(value);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);};
// In local/LAN development require the browser Origin to equal the served Host.
// Behind a reverse proxy set STUDYROOM_PUBLIC_ORIGIN=https://your-domain.example
// (comma-separated exact origins are also accepted). Non-browser native clients
// may omit Origin; authentication is still compulsory for room membership.
const publicOrigins=new Set((process.env.STUDYROOM_PUBLIC_ORIGIN||'').split(',').map(v=>v.trim()).filter(Boolean));
// Diagnostic-only patch: retain the exact same Origin policy. Print only URL/Host
// metadata on rejection, never cookies, tokens, Authorization or request bodies.
const rejectedOrigins=new Map();
function originRejected(req,reason){
  const key=String(req.headers.origin||'(missing)')+'|'+String(req.headers.host||'(missing)');
  const now=Date.now();
  if(now-(rejectedOrigins.get(key)||0)>10000){
    rejectedOrigins.set(key,now);
    // Values below are public URL metadata; do not log sensitive headers.
    console.warn('[origin-check] BLOCKED '+JSON.stringify({
      reason,
      receivedOrigin:String(req.headers.origin||'(missing)').slice(0,220),
      requestHost:String(req.headers.host||'(missing)').slice(0,220),
      forwardedHost:String(req.headers['x-forwarded-host']||'(missing)').slice(0,220),
      forwardedProto:String(req.headers['x-forwarded-proto']||'(missing)').slice(0,50),
      loopbackPeer:['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress),
      allowedOrigins:[...publicOrigins].map(s=>s.slice(0,220))
    }));
  }
  if(rejectedOrigins.size>40){for(const [k,t] of rejectedOrigins)if(now-t>10000)rejectedOrigins.delete(k);}
  return false;
}
function sameOrigin(req) {
  const verdict = originDecision(req, publicOrigins);
  return verdict.ok || originRejected(req, verdict.reason);
}

// Basic IP rate limits; application message limits are in room.js.
const rate=new Map();
function permit(req,kind,limit,intervalMs=60000) {
  // Railway public ingress rewrites X-Real-IP. In distributed mode the trusted
  // gateway forwards it only to workers authenticated with the internal secret.
  const realIp=req.headers['x-real-ip'];
  const identity=(routeTargets.length||workerCount||process.env.STUDYROOM_TRUST_RAILWAY_EDGE_IP==='1')
    &&typeof realIp==='string'&&isIP(realIp)?realIp:(req.socket.remoteAddress||'?');
  const key=identity+':'+kind,now=Date.now();
  const entry=rate.get(key);
  if(!entry||now-entry.start>intervalMs){rate.set(key,{start:now,count:1});return true;}
  if(++entry.count>limit)return false;
  return true;
}
function clearStaleRates(){for(const [key,value] of rate)if(Date.now()-value.start>120000)rate.delete(key);}

function readBody(req,maxBytes=2048) {return new Promise((resolve,reject)=>{
  let body='',size=0;
  req.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){reject(new Error('Large body'));req.destroy();return;}body+=chunk;});
  req.on('end',()=>{try{resolve(JSON.parse(body||'{}'))}catch{reject(new Error('JSON required'))}});
  req.on('error',reject);
 });}
const accountAPI=createAccountAPI({accounts,rooms,auth,verifyFirebase:firebaseVerifier,json,sameOrigin,permit,readBody,store,livePresence,stopIdentity:stopIdentityGlobal});
async function handleHttp(req,res){
  let pathname;try{pathname=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`).pathname;}catch{return json(res,400,{error:'Invalid URL'});}
  // Worker-only private endpoint: flush an identity BEFORE the gateway links
  // a guest to Google or deletes an account. Never expose worker services publicly.
  if(pathname==='/internal/stop-identity' && req.method==='POST' && workerCount){
    const actual=req.headers['x-studyroom-internal-secret'];
    const a=Buffer.from(typeof actual==='string'?actual:'');const b=Buffer.from(internalSecret);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return json(res,403,{error:'Forbidden'});
    let data;try{data=await readBody(req,128);}catch{return json(res,400,{error:'Invalid request'});}
    if(!validId(data.id))return json(res,400,{error:'Invalid identity'});
    await rooms.stopIdentity(data.id);
    if(livePresence)await livePresence.forceRelease(data.id);
    return json(res,200,{ok:true});
  }
  // Shareable auto-room links; no room ID is trusted from a browser for capacity.
  if(pathname==='/' && req.method==='GET'){
    const q=new URL(req.url||'/', 'http://localhost').searchParams;
    if(q.get('auto')==='1'){
      if(!permit(req,'allocate',60))return json(res,429,{error:'입장 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'});
      const library=q.get('room')||'main';
      if(!LIBRARIES.includes(library))return json(res,400,{error:'도서관을 선택해 주세요.'});
      const allocated=livePresence?await livePresence.allocate(library):await choosePublicRoom(library,async l=>{
        return new Map([...rooms.rooms].filter(([id])=>parsedPublicRoom(id)?.library===l)
          .map(([id,r])=>[id,rooms.members(r)]));
      });
      if(!allocated)return json(res,503,{error:'모든 방이 가득 찼습니다. 잠시 후 다시 시도해 주세요.'});
      const dest=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
      dest.searchParams.set('room',allocated.room);dest.searchParams.delete('auto');
      if(allocated.reservation)dest.searchParams.set('admission',allocated.reservation);
      // 303 is deliberate: prevent caching and preserve no account tokens.
      res.writeHead(303,{'Location':dest.pathname+dest.search,'Cache-Control':'no-store'});res.end();return;
    }
  }
  if(await accountAPI(req,res,pathname))return;
  if(pathname==='/api/rooms/status'&&req.method==='GET'){
    if(!permit(req,'status',60))return json(res,429,{error:'Too many requests'});
    const data={};
    for(const library of LIBRARIES){
      const counts=livePresence?await livePresence.occupancy(library):
        new Map([...rooms.rooms].filter(([room])=>parsedPublicRoom(room)?.library===library)
          .map(([room,r])=>[room,rooms.members(r)]));
      data[library]={users:[...counts.values()].reduce((a,b)=>a+b,0),rooms:[...counts.entries()].filter(([,n])=>n>0).length,
        occupied:[...counts.entries()].map(([room,n])=>({room,users:n,capacity:roomCapacity(room)}))};
    }
    return json(res,200,{libraries:data,users:Object.values(data).reduce((a,x)=>a+x.users,0),routerEnabled:routeTargets.length>0});
  }
  if(pathname==='/health'&&req.method==='GET'){
    let dbOK=!rooms.persistenceError;
    if(store.kind==='postgres')try{await store.pool.query('SELECT 1')}catch{dbOK=false;}
    let workerHealth=[];
    if(routeTargets.length){workerHealth=await Promise.all(routeTargets.map(async(target,index)=>{
      try{const response=await fetch(new URL('/health',target),{signal:AbortSignal.timeout(1800)});
        return {index,ok:response.ok};}
      catch{return {index,ok:false};}
    }));}
    const healthy=dbOK&&workerHealth.every(w=>w.ok);
    return json(res,healthy?200:503,{ok:healthy,rooms:rooms.rooms.size,db:store.kind,
      storageError:!dbOK,router:routeTargets.length>0,workerCount:routeTargets.length||1,
      ...(routeTargets.length?{workers:workerHealth}:{} )});
  }
  if(pathname==='/api/me/stats'||pathname==='/api/ranking'||pathname==='/api/me/privacy'){
    if(!sameOrigin(req))return json(res,403,{error:'Wrong origin'});
    if(!permit(req,'api',120))return json(res,429,{error:'Rate limit exceeded'});
    const token=(req.headers.authorization||'').match(/^Bearer (\S+)$/)?.[1];
    const account=await accountContext(req,accounts);
    const id=account?.id||auth.validate(token);
    if(!id||(!account&&!await accounts.isGuestAvailable(id)))return json(res,401,{error:'Authentication required'});
    try{
      const user=await store.getGuest(id);if(!user)return json(res,401,{error:'Guest is not registered'});
      if(pathname==='/api/me/privacy'){
        if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
        let body;try{body=await readBody(req);}catch{return json(res,400,{error:'Invalid JSON'});}if(typeof body?.rankingPublic!=='boolean')return json(res,400,{error:'Invalid visibility'});
        const updated=await store.setVisibility(id,body.rankingPublic);rankingCache=null;
        for(const room of rooms.rooms.values()){const p=room.users.get(id);if(p)p.rankingPublic=updated.rankingPublic;}
        return json(res,200,{rankingPublic:updated.rankingPublic});
      }
      if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
      await rooms.flushAll();
      const day=koreaDay();
      if(pathname==='/api/me/stats'){
        const param=new URL(req.url,'http://localhost').searchParams.get('month');
        const month=param??day.slice(0,7);if(!validMonth(month))return json(res,400,{error:'Invalid month'});
        const records=await store.getDays(id);
        const live=currentPlayers().get(id);
        if(live){const liveMs=rooms.studyMs(live);
          if(live.day===day){const entry=records.find(r=>r.day===day);if(entry)entry.ms=liveMs;else records.push({day,ms:liveMs});}
        }
        const report=buildStats(records,month,day,user.rankingPublic);rooms.persistenceError=null;return json(res,200,report);
      }
      const requested=new URL(req.url,'http://localhost').searchParams.get('limit');
      const limit=requested===null?20:Number(requested);
      if(!Number.isInteger(limit)||limit<1||limit>20)return json(res,400,{error:'Invalid ranking limit'});
      const report=buildRanking(await dailyRanking(day),id,day,limit);rooms.persistenceError=null;return json(res,200,report);
    }catch(e){console.error('[api/storage]',e.message);rooms.persistenceError=e.message;return json(res,503,{error:'공부 기록 DB를 사용할 수 없습니다. 다시 시도해 주세요.'});}
  }
  if(pathname==='/api/session'&&req.method==='POST'){
    if(!sameOrigin(req))return json(res,403,{error:'Wrong origin'});
    if(!permit(req,'session',60))return json(res,429,{error:'Too many session requests'});
    let payload;try{payload=await readBody(req)}catch{return json(res,400,{error:'Invalid request'})}
    const oldId=auth.validate(payload?.token);
    if(oldId&&await accounts.isGuestAvailable(oldId))return json(res,200,auth.reissue(oldId));
    return json(res,200,auth.issue());
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed'});
  const allowed=allow.get(pathname);if(!allowed)return json(res,404,{error:'Not found'});
  const data=path.join(root,allowed), contentType=allowed.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8';
  try{const bytes=await fs.promises.readFile(data);
    res.writeHead(200,{'Content-Type':contentType,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'self' https://cdn.jsdelivr.net https://www.gstatic.com; connect-src 'self' ws: wss: https://cdn.jsdelivr.net https://*.googleapis.com https://*.firebaseapp.com; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://www.gstatic.com https://apis.google.com; frame-src https://*.firebaseapp.com https://accounts.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'", 'Referrer-Policy':'same-origin'});
    res.end(req.method==='HEAD'?'':bytes);
  }catch{json(res,500,{error:'Cannot load file'});}
}
export const server=http.createServer((req,res)=>{
 void handleHttp(req,res).catch(e=>{
  // Database failures must return a bounded error, never take down the node process.
  console.error('[HTTP] request failed',e.code||e.name||'error');
  if(!res.headersSent)json(res,503,{error:'일시적으로 서버를 이용할 수 없습니다.'});
  else if(!res.writableEnded)res.end();
 });
});
server.on('upgrade',(req,socket,head)=>{
  let url;try{url=new URL(req.url,`http://${req.headers.host||'localhost'}`)}catch{socket.destroy();return;}
  if(url.pathname!=='/ws'||!sameOrigin(req)){
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;
  }
  if(!permit(req,'upgrade',90)){socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');return;}
  // The PG session lookup is asynchronous. Do not trust a claimed WS user ID.
  if(routeTargets.length){proxyRoomWebsocket(req,socket,head,routeTargets,internalSecret);return;}
  if(workerCount){
    const actual=req.headers['x-studyroom-internal-secret'];
    const a=Buffer.from(typeof actual==='string'?actual:'');const b=Buffer.from(internalSecret);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b)){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  }
  const expectedRoom=url.searchParams.get('room');
  if(expectedRoom && !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(expectedRoom)){
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');return;
  }
  if(workerCount && (!expectedRoom || workerForRoom(expectedRoom,workerCount)!==workerIndex)){
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;
  }
  void Promise.resolve(accountContext(req,accounts)).then(ctx=>{
    if(socket.destroyed)return;
    upgradeWebSocket(req,socket,head,peer=>rooms.connect(peer,ctx?.id||null,ctx?.expiresAt||0,expectedRoom));
  }).catch(()=>{try{socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')}catch{socket.destroy();}});
});
let ticking=false;const timer=setInterval(()=>{if(ticking)return;ticking=true;void rooms.tick().catch(e=>console.error('room tick',e)).finally(()=>{ticking=false;});},1000);timer.unref();
const pruning=setInterval(clearStaleRates,60000);pruning.unref();
// Consistent online SQLite snapshots on persistent storage (Railway platform
// volume backups are a separate, independently configured layer).
const backupHours=Number(process.env.STUDYROOM_BACKUP_INTERVAL_HOURS||0);
let snapshotTimer=null,firstSnapshotTimer=null,snapshotRunning=false;
async function takeSnapshot(){
 if(snapshotRunning||store.kind!=='sqlite')return;
 snapshotRunning=true;
 try{
  await rooms.flushAll(true);
  const dest=await createSQLiteBackup({source:state.db,backupDir:state.backupDir,secretPath:state.secret});
  console.log('[backup] SQLite integrity verified:',path.basename(dest));
 }catch(e){console.error('[backup] failed:',e.code||e.message);}finally{snapshotRunning=false;}
}
if(store.kind==='sqlite'&&Number.isFinite(backupHours)&&backupHours>0&&backupHours<=168){
 firstSnapshotTimer=setTimeout(()=>{void takeSnapshot();},60_000);
 snapshotTimer=setInterval(()=>{void takeSnapshot();},backupHours*3600_000);
 firstSnapshotTimer.unref();snapshotTimer.unref();
}
server.requestTimeout=15000;server.headersTimeout=12000;server.keepAliveTimeout=5000;
server.maxConnections=routeTargets.length?Number(process.env.STUDYROOM_ROUTER_MAX_CONNECTIONS||4096):Number(process.env.STUDYROOM_SERVER_MAX_CONNECTIONS||512);
const PORT=Number(process.env.PORT)||3000;
const HOST=process.env.HOST||'0.0.0.0';
if(process.env.NODE_ENV!=='test-autostart-disabled'){
 server.listen(PORT,HOST,()=>console.log(`SNU 3D Study Room server: http://localhost:${server.address().port} (LAN access enabled)`));
}
export {rooms,store,accounts};
// Graceful shutdown flushes sessions. A hard crash can lose up to one checkpoint interval.
async function shutdown(){
  clearInterval(timer);clearInterval(pruning);
  if(snapshotTimer)clearInterval(snapshotTimer);if(firstSnapshotTimer)clearTimeout(firstSnapshotTimer);
  for(const connection of rooms.connections)try{connection.peer.close(1001,'Server shutting down')}catch{}
  try{await rooms.flushAll(true)}catch(e){console.error('Final checkpoint failed:',e.message)}
  if(server.listening)await new Promise(r=>server.close(r));
  await store.close();
}
if(process.env.NODE_ENV!=='test-autostart-disabled'){
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{shutdown().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});});
}
export {shutdown};
