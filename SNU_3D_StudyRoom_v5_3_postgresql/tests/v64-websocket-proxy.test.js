import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {proxyRoomWebsocket} from '../server/ws-router.js';

async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;}
async function close(s){await new Promise(r=>s.close(r));}

test('same room routes to the same private worker through stateless HTTP upgrade', {timeout:8000}, async t=>{
 const workers=[];const allSockets=new Set();
 const watch=s=>s.on('connection',sock=>{allSockets.add(sock);sock.on('close',()=>allSockets.delete(sock));});
 for(let i=0;i<2;i++){
  const server=http.createServer((_req,res)=>res.end('health'));
  server.on('upgrade',(req,sock)=>{
    assert.equal(req.headers['x-studyroom-internal-secret'],'test-router-secret-32-characters!!!');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    sock.write('WORKER:'+i+' ROOM:'+new URL(req.url,'http://localhost').searchParams.get('room'));
    sock.on('error',()=>{});
  });
  watch(server);await listen(server);workers.push(server);
 }
 const gateway=http.createServer((_req,res)=>res.end('gateway'));
 gateway.on('upgrade',(req,sock,head)=>proxyRoomWebsocket(req,sock,head,workers.map(s=>new URL('http://127.0.0.1:'+s.address().port)), 'test-router-secret-32-characters!!!'));
 watch(gateway);const gatewayUrl=await listen(gateway);
 t.after(async()=>{for(const sock of allSockets)sock.destroy();await Promise.all([close(gateway),...workers.map(close)]);});
 const read=async room=>{
  const u=new URL(gatewayUrl);
  const conn=net.connect(Number(u.port),'127.0.0.1');await once(conn,'connect');
  return new Promise((resolve,reject)=>{
    let data='';let timer=setTimeout(()=>{conn.destroy();reject(Error('Timeout:'+data));},1800);
    conn.on('data',chunk=>{data+=chunk.toString();if(data.includes('WORKER:')){
      clearTimeout(timer);conn.destroy();resolve(data);
    }});
    conn.on('error',reject);
    conn.write(`GET /ws?room=${encodeURIComponent(room)} HTTP/1.1\r\nHost: public.example\r\nOrigin: https://public.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: SGVsbG8xMjM0NTY3OA==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  });
 };
 assert.match(await read('main'),/101 Switching Protocols/);
 assert.match(await read('main'),/WORKER:0 ROOM:main/);
 assert.match(await read('korea'),/WORKER:1 ROOM:korea/);
 assert.match(await read('main-2'),/WORKER:1 ROOM:main-2/);
 assert.match(await read('main-3'),/WORKER:0 ROOM:main-3/);
});
