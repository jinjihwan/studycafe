import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {once} from 'node:events';

const publicHost='example-3000.app.github.dev';
const publicOrigin='https://'+publicHost;
function req(port,pathname,headers={}){
  return new Promise((resolve,reject)=>{
    const r=http.request({hostname:'127.0.0.1',port,method:'POST',path:pathname,headers:{origin:'https://localhost:'+port,host:'localhost:'+port,'x-forwarded-host':publicHost,'x-forwarded-proto':'https','Content-Type':'application/json',...headers}},res=>{
      let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,json:JSON.parse(text)}));
    });r.on('error',reject);r.end('{}');
  });
}
async function findPort(){
  const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const p=listener.address().port;await new Promise(r=>listener.close(r));return p;
}
async function openUpgrade(port,origin,extra={}){
  const socket=net.connect(port,'127.0.0.1');await once(socket,'connect');
  const response=new Promise((resolve,reject)=>{
    let data=''; const timeout=setTimeout(()=>reject(new Error('upgrade timeout')),3000);
    socket.on('data',chunk=>{data+=chunk.toString('latin1');if(data.includes('\r\n\r\n')){clearTimeout(timeout);resolve(data.slice(0,data.indexOf('\r\n')));}});
    socket.on('error',e=>{clearTimeout(timeout);reject(e)});
  });
  const headers={Host:'localhost:'+port,Origin:origin,'X-Forwarded-Host':publicHost,'X-Forwarded-Proto':'https',...extra};
  const lines=['GET /ws HTTP/1.1',...Object.entries(headers).map(([k,v])=>`${k}: ${v}`), 'Upgrade: websocket','Connection: Upgrade','Sec-WebSocket-Version: 13','Sec-WebSocket-Key: '+crypto.randomBytes(16).toString('base64'),'',''];
  socket.write(lines.join('\r\n'));
  try{return await response}finally{socket.destroy()}
}

test('real v5 HTTP and WebSocket server accepts exact Codespaces proxy hop and rejects outsider',{timeout:15000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snu-origin-http-'));const port=await findPort();
  const env={...process.env,PORT:String(port),HOST:'127.0.0.1',STUDYROOM_PUBLIC_ORIGIN:publicOrigin,
    STUDYROOM_DB_PATH:path.join(dir,'studyroom.sqlite'),STUDYROOM_SECRET:'this-is-only-a-temporary-test-secret-not-production',FIREBASE_PROJECT_ID:''};
  delete env.DATABASE_URL;delete env.NODE_OPTIONS;
  const proc=spawn(process.execPath,['server/index.js'],{cwd:path.resolve(import.meta.dirname,'..'),env,stdio:['ignore','pipe','pipe']});
  let output='';proc.stdout.on('data',b=>output+=b);proc.stderr.on('data',b=>output+=b);
  t.after(async()=>{proc.kill('SIGTERM');await Promise.race([once(proc,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,2500))]);fs.rmSync(dir,{recursive:true,force:true});});
  const deadline=Date.now()+6500;
  while(Date.now()<deadline){if(proc.exitCode!==null)throw new Error('server exited: '+output);
    try{const x=await new Promise((resolve,reject)=>{const r=http.get({hostname:'127.0.0.1',port,path:'/health'},res=>{res.resume();resolve(res.statusCode)});r.on('error',reject);});if(x===200)break;}catch{}
    await new Promise(r=>setTimeout(r,80));
  }
  const accepted=await req(port,'/api/session');assert.equal(accepted.status,200,output);
  assert.ok(accepted.json.token,'guest session token issued');
  assert.equal((await req(port,'/api/session',{origin:'https://attacker.example'})).status,403);
  assert.equal((await req(port,'/api/session',{'x-forwarded-host':'attacker.example'})).status,403);
  assert.match(await openUpgrade(port,'https://localhost:'+port),/^HTTP\/1\.1 101/);
  assert.match(await openUpgrade(port,'https://attacker.example'),/^HTTP\/1\.1 403/);
});
