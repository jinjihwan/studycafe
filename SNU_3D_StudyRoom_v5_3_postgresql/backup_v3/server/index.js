import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { upgradeWebSocket } from './websocket.js';
import { createAuth, Rooms } from './room.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const allow=new Map([['/','index.html'],['/index.html','index.html'],['/client/network.js','client/network.js']]);
const secretFile=path.join(root,'.guest-secret');
function loadSecret() {
  if(process.env.STUDYROOM_SECRET && process.env.STUDYROOM_SECRET.length>=32)return Buffer.from(process.env.STUDYROOM_SECRET);
  try{return fs.readFileSync(secretFile)}catch(e){if(e.code!=='ENOENT')throw e;}
  const secret=crypto.randomBytes(32);
  try{fs.writeFileSync(secretFile,secret,{flag:'wx',mode:0o600});return secret}
  catch(e){if(e.code==='EEXIST')return fs.readFileSync(secretFile);throw e;}
}
const auth=createAuth(loadSecret());
const rooms=new Rooms(auth);
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
  if(pathname==='/health'&&req.method==='GET')return json(res,200,{ok:true,rooms:rooms.rooms.size});
  if(pathname==='/api/session'&&req.method==='POST'){
    if(!sameOrigin(req))return json(res,403,{error:'Wrong origin'});
    if(!permit(req,'session',60))return json(res,429,{error:'Too many session requests'});
    let payload;try{payload=await readBody(req)}catch{return json(res,400,{error:'Invalid request'})}
    const oldId=auth.validate(payload?.token);
    if(oldId)return json(res,200,{id:oldId,token:payload.token});
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
const timer=setInterval(()=>rooms.tick(),1000);timer.unref();
const pruning=setInterval(clearStaleRates,60000);pruning.unref();
server.requestTimeout=15000;server.headersTimeout=12000;server.keepAliveTimeout=5000;
server.maxConnections=512;
const PORT=Number(process.env.PORT)||3000;
const HOST=process.env.HOST||'0.0.0.0';
if(process.env.NODE_ENV!=='test-autostart-disabled'){
 server.listen(PORT,HOST,()=>console.log(`SNU 3D Study Room server: http://localhost:${server.address().port} (LAN access enabled)`));
}
export {rooms};
