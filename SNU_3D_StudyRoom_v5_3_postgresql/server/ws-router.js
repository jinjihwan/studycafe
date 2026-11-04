import http from 'node:http';
import {parsedPublicRoom,workerForRoom} from './room-routing.js';
import {validRoom} from './room.js';

// A stateless WS router. The same room is always sent to the same worker.
// No sticky load-balancing or shared in-process room maps are required.
export function parseWorkerTargets(value){
  if(!value)return [];
  const list=value.split(',').map(s=>s.trim()).filter(Boolean);
  if(list.length<1||list.length>32)throw new Error('Configure 1..32 private worker URLs');
  return list.map(item=>{
    const u=new URL(item);
    if(u.protocol!=='http:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||
       !(u.hostname.endsWith('.railway.internal')||['localhost','127.0.0.1','[::1]'].includes(u.hostname)))
       throw new Error('Worker targets must be private *.railway.internal or local HTTP origins');
    return u;
  });
}
export function proxyRoomWebsocket(req,clientSocket,head,targets,internalSecret){
  let url;
  try{url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);}catch{clientSocket.destroy();return;}
  const room=url.searchParams.get('room');
  if(url.pathname!=='/ws'||!validRoom(room)){
    clientSocket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');return;
  }
  // Public room family instances are restricted; custom private rooms use validRoom.
  const parsed=parsedPublicRoom(room);
  if(!parsed && /^(main|korea|yonsei)-/.test(room)){
    clientSocket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');return;
  }
  const worker=targets[workerForRoom(room,targets.length)];
  const headers={...req.headers};
  // Preserve public Host + Origin to retain the app's existing same-origin policy.
  delete headers['proxy-authorization'];delete headers['proxy-connection'];
  headers['x-studyroom-internal-secret']=internalSecret;
  const upstream=http.request({hostname:worker.hostname,port:worker.port||80,path:`/ws?room=${encodeURIComponent(room)}`,
    method:'GET',headers,timeout:8000});
  let settled=false;
  const fail=(status=502)=>{
    if(settled)return;settled=true;
    if(!clientSocket.destroyed)clientSocket.end(`HTTP/1.1 ${status} Bad Gateway\r\nConnection: close\r\n\r\n`);
    upstream.destroy();
  };
  upstream.on('upgrade',(res,upstreamSocket,upstreamHead)=>{
    if(settled){upstreamSocket.destroy();return;}
    settled=true;
    let response='HTTP/1.1 101 Switching Protocols\r\n';
    for(const [key,value] of Object.entries(res.headers))if(value!==undefined)
      response+=`${key}: ${Array.isArray(value)?value.join(', '):value}\r\n`;
    clientSocket.write(response+'\r\n');
    if(upstreamHead?.length)clientSocket.write(upstreamHead);
    if(head?.length)upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket);clientSocket.pipe(upstreamSocket);
    const cleanup=()=>{clientSocket.destroy();upstreamSocket.destroy();};
    upstreamSocket.on('error',cleanup);clientSocket.on('error',cleanup);
    upstreamSocket.on('close',()=>clientSocket.destroy());clientSocket.on('close',()=>upstreamSocket.destroy());
  });
  upstream.on('response',res=>{res.resume();fail(res.statusCode===503?503:502);});
  upstream.on('timeout',()=>fail(504));upstream.on('error',()=>fail(502));
  clientSocket.on('close',()=>upstream.destroy());
  upstream.end();
}
