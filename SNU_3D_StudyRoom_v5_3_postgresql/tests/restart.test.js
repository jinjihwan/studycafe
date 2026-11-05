import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {SQLiteStore} from '../server/store.js';
import {koreaDay} from '../server/room.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const srv=net.createServer();await new Promise(r=>srv.listen(0,'127.0.0.1',r));const port=srv.address().port;await new Promise(r=>srv.close(r));return port;}

async function launch(port,filename){
 const child=spawn(process.execPath,['server/index.js'],{
   cwd:root,env:{...process.env,STUDYROOM_DB_PATH:filename,STUDYROOM_SECRET:'v4-integration-test-stable-secret-0123456789',PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 const base='http://127.0.0.1:'+port;
 for(let i=0;i<70;i++){
   if(child.exitCode!==null)throw Error('server exited before ready: '+logs);
   try{const reply=await fetch(base+'/health');if(reply.ok)return {child,base,logs:()=>logs};}catch{}
   await pause(70);
 }
 child.kill('SIGKILL');throw Error('server start timeout: '+logs);
}
async function terminate(child){if(child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([once(child,'exit'),pause(4000).then(()=>{if(child.exitCode===null)child.kill('SIGKILL')})]);}
async function makeSession(base,token=''){
 const r=await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(r.status,200);return r.json();
}
async function connect(base,token){
 const sock=new WebSocket(base.replace('http','ws')+'/ws');const queue=[],waiters=[];
 sock.addEventListener('message',e=>{const msg=JSON.parse(e.data);queue.push(msg);
 for(const w of [...waiters])if(w.filter(msg)){clearTimeout(w.timeout);waiters.splice(waiters.indexOf(w),1);w.resolve(msg);}
 });
 await once(sock,'open');sock.send(JSON.stringify({t:'join',room:'main',token,profile:{nick:'재시작공부',species:'rabbit',hood:'#f39bc4'}}));
 const obj={sock,queue,send:m=>sock.send(JSON.stringify(m)),wait:(filter)=>{
  const old=queue.find(filter);if(old)return Promise.resolve(old);
  return new Promise((resolve,reject)=>{const w={filter,resolve,reject};w.timeout=setTimeout(()=>reject(Error('timeout '+JSON.stringify(queue.slice(-5)))),6000);waiters.push(w)});
 }};
 await obj.wait(m=>m.t==='welcome');return obj;
}
test('actual Node server exits, restarts, restores same guest token and persisted study history',{timeout:25000},async t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'snu-v4-process-'));const filename=path.join(tmp,'study.sqlite');
 t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const port=await freePort();let instance=await launch(port,filename);
 t.after(()=>terminate(instance.child));
 const auth=await makeSession(instance.base);
 // The API cannot accept claimed study milliseconds. Study is exclusively created
 // from server-owned seat state; this test persists a verified ledger via actual SQLite.
 const where='/api/me/stats';
 const denied=await fetch(instance.base+where);assert.equal(denied.status,401);
 // Use direct DB access to seed a historical study session; persistence across two
 // *real server processes* is what this test isolates (actual chair timing is in v4-api.test).
 const db=new SQLiteStore(filename);
 await db.ensureGuest(auth.id);
 await db.addSegments(auth.id,new Map([[koreaDay(),75000],['2026-10-31',22222]]));
 db.close();
 const conn=await connect(instance.base,auth.token);
 const before=await fetch(instance.base+where,{headers:{authorization:'Bearer '+auth.token}});
 assert.equal((await before.json()).todayMs,75000);
 conn.sock.close();await pause(150);
 await terminate(instance.child);
 instance=await launch(port,filename);
 const same=await makeSession(instance.base,auth.token);
 assert.equal(same.id,auth.id,'same browser token still identifies same user');
 const restored=await connect(instance.base,same.token);
 const response=await fetch(instance.base+where,{headers:{authorization:'Bearer '+same.token}});
 const stats=await response.json();assert.equal(stats.todayMs,75000);assert.ok(stats.totalMs>=97222);
 const ranks=await fetch(instance.base+'/api/ranking',{headers:{authorization:'Bearer '+same.token}});
 assert.ok((await ranks.json()).count>=144,"virtual learners added without modifying stored user history");
 restored.sock.close();await terminate(instance.child);
});
