#!/usr/bin/env node
// Staging-only small smoke test. Never run a load test against public production.
// For actual 2,000-user qualification use distributed load generators and
// monitor Railway PostgreSQL/CPU/RAM, WS latency, error rate and egress.
const args=Object.fromEntries(process.argv.slice(2).filter(x=>x.startsWith('--')).map(x=>x.slice(2).split('=',2)));
if(args['confirm-staging']!=='yes'){
 console.error('SAFETY_STOP: specify --confirm-staging=yes (staging only)');process.exit(2);
}
if(!args.url){console.error('Specify --url=https://YOUR-STAGING-HOST');process.exit(2);}
const origin=new URL(args.url);
if(!['https:','http:'].includes(origin.protocol)||!(/staging|localhost|127\.0\.0\.1/i.test(origin.hostname))){
 console.error('SAFETY_STOP: refusing to load-test a URL not explicitly named staging/localhost.');process.exit(2);
}
const users=Number(args.users||10);
if(!Number.isInteger(users)||users<1||users>40){console.error('SAFETY_STOP: smoke test accepts only 1..40 sessions.');process.exit(2);}
const hold=Math.min(30_000,Math.max(2_000,Number(args['hold-ms']||8000)));
const open=[],results=[],start=Date.now();
function connect(url,token,admission,room,id){return new Promise(resolve=>{
 let closed=false,settled=false,ws,timeout;
 const finish=(ok,detail)=>{
  if(settled)return;settled=true;clearTimeout(timeout);
  results.push({id,room,ok,detail,elapsed:Date.now()-start});resolve();
 };
 try{
   const dest=new URL('/ws?room='+encodeURIComponent(room),url);dest.protocol=url.protocol==='https:'?'wss:':'ws:';
   ws=new WebSocket(dest.href);open.push(ws);
   timeout=setTimeout(()=>{finish(false,'welcome timeout');ws.close();},8000);
   ws.onopen=()=>ws.send(JSON.stringify({t:'join',room,token,admission,profile:{nick:'staging-test-'+id,species:'cat',hood:'#aabbcc'}}));
   ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return;}
     if(m.t==='welcome')finish(true,'joined');if(m.t==='error')finish(false,m.code||'error');};
   ws.onerror=()=>finish(false,'websocket error');ws.onclose=()=>{if(!settled)finish(false,'closed before join');};
 }catch(e){finish(false,e.message);}
});}
try{
 for(let i=0;i<users;i++){
  // Two requests: first the admission reservation, then the guest identity.
  const admit=await fetch(new URL('/?room=main&auto=1',origin),{redirect:'manual'});
  if(admit.status!==303)throw new Error('Auto assignment HTTP '+admit.status);
  const assigned=new URL(admit.headers.get('location'),origin);
  const sess=await fetch(new URL('/api/session',origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
  if(!sess.ok)throw new Error('Guest session HTTP '+sess.status);
  const {token}=await sess.json();
  await connect(origin,token,assigned.searchParams.get('admission'),assigned.searchParams.get('room'),i+1);
  // Same public IP is rate limited. Pace requests so the safety limit remains active.
  await new Promise(r=>setTimeout(r,1600));
 }
 await new Promise(r=>setTimeout(r,hold));
}finally{for(const ws of open)try{ws.close()}catch{}}
const good=results.filter(r=>r.ok).length;
console.log(JSON.stringify({target:origin.origin,requested:users,successful:good,failed:results.length-good,
 rooms:[...new Set(results.map(r=>r.room))],elapsedSeconds:Math.round((Date.now()-start)/1000),results:results.filter(r=>!r.ok)},null,2));
if(good!==users)process.exitCode=1;
