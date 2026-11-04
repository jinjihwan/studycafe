import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { upgradeWebSocket } from './websocket.js';
import { createAuth, Rooms, koreaDay } from './room.js';
import { createStore } from './store.js';
import { buildStats,buildRanking,validMonth } from './stats.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const allow=new Map([['/','index.html'],['/index.html','index.html'],['/client/network.js','client/network.js'],['/client/dashboard.js','client/dashboard.js']]);
const secretFile=path.join(root,'.guest-secret');
function loadSecret() {
  if(process.env.STUDYROOM_SECRET && process.env.STUDYROOM_SECRET.length>=32)return Buffer.from(process.env.STUDYROOM_SECRET);
  try{return fs.readFileSync(secretFile)}catch(e){if(e.code!=='ENOENT')throw e;}
  const secret=crypto.randomBytes(32);
  try{fs.writeFileSync(secretFile,secret,{flag:'wx',mode:0o600});return secret}
  catch(e){if(e.code==='EEXIST')return fs.readFileSync(secretFile);throw e;}
}
const auth=createAuth(loadSecret());
const store=await createStore();
const rooms=new Rooms(auth,store);
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
function sameOrigin(req) {
  const origin=req.headers.origin;if(!origin)return true;
  try {
    const u=new URL(origin);
    if(u.origin!==origin||(u.protocol!=='http:'&&u.protocol!=='https:'))return false;
    if(publicOrigins.size)return publicOrigins.has(u.origin);
    return u.host===req.headers.host;
  }catch{return false;}
}
// Basic IP rate limits; application message limits are in room.js.
const rate=new Map();
function permit(req,kind,limit,intervalMs=60000) {
  const key=(req.socket.remoteAddress||'?')+':'+kind,now=Date.now();
  const entry=rate.get(key);
  if(!entry||now-entry.start>intervalMs){rate.set(key,{start:now,count:1});return true;}
  if(++entry.count>limit)return false;
  return true;
}
function clearStaleRates(){for(const [key,value] of rate)if(Date.now()-value.start>120000)rate.delete(key);}

function readBody(req) {return new Promise((resolve,reject)=>{
  let body='',size=0;
  req.on('data',chunk=>{size+=chunk.length;if(size>2048){reject(new Error('Large body'));req.destroy();return;}body+=chunk;});
  req.on('end',()=>{try{resolve(JSON.parse(body||'{}'))}catch{reject(new Error('JSON required'))}});
  req.on('error',reject);
 });}
export const server=http.createServer(async(req,res)=>{
  let pathname;try{pathname=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`).pathname;}catch{return json(res,400,{error:'Invalid URL'});}
  if(pathname==='/health'&&req.method==='GET')return json(res,rooms.persistenceError?503:200,{ok:!rooms.persistenceError,rooms:rooms.rooms.size,db:store.kind,storageError:!!rooms.persistenceError});
  if(pathname==='/api/me/stats'||pathname==='/api/ranking'||pathname==='/api/me/privacy'){
    if(!sameOrigin(req))return json(res,403,{error:'Wrong origin'});
    if(!permit(req,'api',120))return json(res,429,{error:'Rate limit exceeded'});
    const token=(req.headers.authorization||'').match(/^Bearer (\S+)$/)?.[1];
    const id=auth.validate(token);
    if(!id)return json(res,401,{error:'Guest authentication required'});
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
    if(oldId)return json(res,200,auth.reissue(oldId));
    return json(res,200,auth.issue());
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed'});
  const allowed=allow.get(pathname);if(!allowed)return json(res,404,{error:'Not found'});
  const data=path.join(root,allowed), contentType=allowed.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8';
  try{const bytes=await fs.promises.readFile(data);
    res.writeHead(200,{'Content-Type':contentType,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self' https://cdn.jsdelivr.net; connect-src 'self' ws: wss: https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'", 'Referrer-Policy':'same-origin'});
    res.end(req.method==='HEAD'?'':bytes);
  }catch{json(res,500,{error:'Cannot load file'});}
});
server.on('upgrade',(req,socket,head)=>{
  let url;try{url=new URL(req.url,`http://${req.headers.host||'localhost'}`)}catch{socket.destroy();return;}
  if(url.pathname!=='/ws'||!sameOrigin(req)){
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;
  }
  if(!permit(req,'upgrade',90)){socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');return;}
  upgradeWebSocket(req,socket,head,peer=>rooms.connect(peer));
});
let ticking=false;const timer=setInterval(()=>{if(ticking)return;ticking=true;void rooms.tick().catch(e=>console.error('room tick',e)).finally(()=>{ticking=false;});},1000);timer.unref();
const pruning=setInterval(clearStaleRates,60000);pruning.unref();
server.requestTimeout=15000;server.headersTimeout=12000;server.keepAliveTimeout=5000;
server.maxConnections=512;
const PORT=Number(process.env.PORT)||3000;
const HOST=process.env.HOST||'0.0.0.0';
if(process.env.NODE_ENV!=='test-autostart-disabled'){
 server.listen(PORT,HOST,()=>console.log(`SNU 3D Study Room server: http://localhost:${server.address().port} (LAN access enabled)`));
}
export {rooms,store};
// Graceful shutdown flushes sessions. A hard crash can lose up to one checkpoint interval.
async function shutdown(){
  clearInterval(timer);clearInterval(pruning);
  for(const connection of rooms.connections)try{connection.peer.close(1001,'Server shutting down')}catch{}
  try{await rooms.flushAll(true)}catch(e){console.error('Final checkpoint failed:',e.message)}
  if(server.listening)await new Promise(r=>server.close(r));
  await store.close();
}
if(process.env.NODE_ENV!=='test-autostart-disabled'){
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{shutdown().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});});
}
export {shutdown};
