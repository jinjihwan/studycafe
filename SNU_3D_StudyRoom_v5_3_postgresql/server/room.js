import crypto from 'node:crypto';

export const NPC_COUNT = 8;
export const RECONNECT_GRACE_MS = Math.max(500, Number(process.env.RECONNECT_GRACE_MS) || 20000);
export const RESERVATION_MS = 90000;
const SPAWN = { x: 0, z: 35 };
const COLORS = new Set(['rabbit','bear','cat','dog']);
const ROOM_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const validRoom = r => typeof r === 'string' && ROOM_RE.test(r);
export const validId = id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);
const bound = (v, min, max) => Math.min(max, Math.max(min, v));
const cleanText = (v, max) => typeof v === 'string' ? Array.from(v.trim().replace(/[\u0000-\u001f\u007f]/g, '')).slice(0,max).join('') : '';
// Korea Standard Time is UTC+09:00 (no daylight saving in current Korean time).
// Use the SAME date boundary for server records and all clients, regardless of local TZ.
const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;
export const koreaDay = (ms = Date.now()) => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
export const koreaMidnightUtc = ms => Math.floor((ms + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS;
const localDay = koreaDay;
const MAX_JSON_BYTES = 4096;
const MAX_MESSAGES_PER_SECOND = 35;


export function buildSeatsAndObstacles() {
  const seats = [], obstacles = [{x:0,z:-37.65,w:48,d:1.5}];
  // Client index.html must have precisely the same 8-table/48-seat geometry.
  for (const side of [-1,1]) for (let col=0;col<1;col++) for (let row=0;row<4;row++) {
    const x=side*(7.30+col*4.55), z=-27+row*17.4;
    obstacles.push({x,z,w:5.97,d:2.28});
    for (const sign of [-1,1]) for (const dx of [-1.68,0,1.68]) {
      const cx=x+dx, cz=z+sign*1.62;
      seats.push({id:seats.length,x:cx,z:cz,sign});
      obstacles.push({x:cx,z:cz,w:.84,d:.79});
    }
  }
  // BOTH feet of each photo-inspired triangular A-frame block walking.
  for(const z of [-25,-7,11,29])for(const side of [-1,1]){
    for(const footX of [side*13.0,side*22.2])obstacles.push({x:footX,z,w:1.8,d:1.65});
  }
  const npcIndices=[2,8,14,20,26,32,38,44];
  const npcSeats=new Set(npcIndices);
  return {seats,obstacles,npcSeats};
}
const layout=buildSeatsAndObstacles();
export const LAYOUT_SEATS=layout.seats;
export const NPC_SEATS=layout.npcSeats;
export function isWalkable(x,z) {
  if (!Number.isFinite(x)||!Number.isFinite(z)) return false;
  // Exact same 0.6-unit grid discretisation used by the front-end Navigator.
  const gx=Math.floor((x+23)/.6), gz=Math.floor((z+37)/.6);
  if (gx<0||gx>=Math.ceil(46/.6)||gz<0||gz>=Math.ceil(82/.6)) return false;
  const px=-23+(gx+.5)*.6, pz=-37+(gz+.5)*.6;
  if(Math.abs(px)>22||pz< -33.5||pz>44) return false;
  return !layout.obstacles.some(o=>Math.abs(px-o.x)<o.w/2+.32&&Math.abs(pz-o.z)<o.d/2+.32);
}

// Guest tokens are created and authenticated exclusively by the server.
// A client can reuse a token but cannot set or impersonate another guest ID.
export function createAuth(secret) {
  const sign = body => crypto.createHmac('sha256', secret).update(body).digest('base64url');
  function validate(token) {
    if(typeof token !== 'string'||token.length>250) return null;
    const [body,signature,extra] = token.split('.'); if(extra||!body||!signature) return null;
    const expected=sign(body); const a=Buffer.from(signature),b=Buffer.from(expected);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) return null;
    try {
      const data=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
      if(!validId(data.id)||!Number.isFinite(data.exp)||data.exp<Date.now()) return null;
      return data.id;
    } catch { return null; }
  }
  function reissue(id) {
    if(!validId(id))throw new Error('Invalid ID');
    const body=Buffer.from(JSON.stringify({id,exp:Date.now()+365*86400000})).toString('base64url');
    return {id,token:body+'.'+sign(body)};
  }
  function issue() {return reissue(crypto.randomBytes(16).toString('hex'));}
  return {issue,reissue,validate};
}

export class Rooms {
  constructor(auth,store,accounts=null) { this.auth=auth; this.store=store; this.accounts=accounts; this.rooms=new Map(); this.connections=new Set(); this.lastFlush=0; this.persistenceError=null; this.joinQueue=new Map(); }
  get(roomId) { if(!this.rooms.has(roomId)) this.rooms.set(roomId,{id:roomId,users:new Map(),locks:new Map()}); return this.rooms.get(roomId); }
  members(room) { return [...room.users.values()].filter(p=>p.online).length; }
  public(p) { return {id:p.id,nick:p.nick,species:p.species,hood:p.hood,x:p.x,z:p.z,yaw:p.yaw,
    seatId:p.seatId,pendingSeatId:p.pendingSeatId,studyMs:this.studyMs(p),studying:p.studying,paused:p.paused,online:p.online}; }
  studyMs(p,now=Date.now()) {
    // Legacy plain-object branch keeps the original v3 midnight regression test intact.
    if(!(p.pending instanceof Map)){
      this.ensureDay(p,now);
      return Math.round(p.studyMs+(p.studying&&!p.paused&&p.studyStartedAt?Math.max(0,now-p.studyStartedAt):0));
    }
    this.accrue(p,now);
    return Math.round(p.studyMs);
  }
  ensureDay(p,now=Date.now()) {
    if(p.pending instanceof Map){this.accrue(p,now);return;}
    const day=localDay(now);
    if(day!==p.day){p.studyMs=0;p.day=day;p.studyStartedAt=p.studying&&!p.paused?koreaMidnightUtc(now):0;}
  }
  // Commit elapsed milliseconds into a per-day pending ledger. Splitting at KST
  // midnight happens even if the worker was throttled / server tick delayed.
  accrue(p,now=Date.now()) {
    if(p.studying&&!p.paused&&p.lastAccruedAt>0&&now>=p.lastAccruedAt){
      let from=p.lastAccruedAt;
      while(from<now){
        const day=koreaDay(from),end=Math.min(now,koreaMidnightUtc(from)+DAY_MS);
        if(day!==p.day){p.day=day;p.studyMs=0;}
        const elapsed=end-from;
        if(elapsed>0){p.studyMs+=elapsed;p.pending.set(day,(p.pending.get(day)||0)+elapsed);}
        from=end;
      }
      p.lastAccruedAt=now;
    }
    if(p.day!==koreaDay(now)){p.day=koreaDay(now);p.studyMs=0;}
  }
  stopStudy(p){this.studyMs(p);p.studying=false;p.paused=false;p.lastAccruedAt=0;void this.persist(p);}
  async persist(p){
    if(!p.pending.size)return p.persistPromise||Promise.resolve();
    const segments=new Map(p.pending);p.pending.clear();
    const job=async()=>{
      try{await this.store.addSegments(p.id,segments);this.persistenceError=null;}
      catch(e){for(const [day,ms] of segments)p.pending.set(day,(p.pending.get(day)||0)+ms);
        this.persistenceError=String(e.message||e);console.error('[study storage] checkpoint failed:',this.persistenceError);throw e;}
    };
    p.persistPromise=(p.persistPromise||Promise.resolve()).then(job,job);
    return p.persistPromise;
  }
  async flushAll(force=false){
    const now=Date.now();if(!force&&!this.persistenceError&&now-this.lastFlush<4500)return;
    this.lastFlush=now;
    const tasks=[];
    for(const room of this.rooms.values())for(const p of room.users.values()){
      this.studyMs(p,now);if(p.pending?.size)tasks.push(this.persist(p));
      else if(p.persistPromise)tasks.push(p.persistPromise);
    }
    const result=await Promise.allSettled(tasks);
    if(result.some(r=>r.status==='rejected'))throw new Error('Study database temporarily unavailable');
  }
  async history(id){await this.flushAll(true);return this.store.getDays(id);}
  broadcast(room,message,except=null) { for(const p of room.users.values()) if(p.online&&p.peer!==except) p.peer.send(message); }
  error(peer,code,message,seatId) { peer.send({t:'error',code,message,seatId}); }
  connect(peer,accountId=null,accountExpiresAt=0) {
    const connection={accountId,accountExpiresAt,peer, player:null, room:null, joined:false, closed:false, created:Date.now(), windowStart:Date.now(), packetCount:0, lastProfileAt:0};
    this.connections.add(connection);
    peer.on('message',raw=>this.receive(connection,raw));
    peer.on('close',()=>{connection.closed=true;this.connections.delete(connection);this.disconnect(connection)});
    return connection;
  }
  receive(c,raw) {
    if(c.accountId&&Date.now()>c.accountExpiresAt){c.peer.close(1008,'Session expired');return;}
    if(Buffer.byteLength(raw,'utf8') > MAX_JSON_BYTES){c.peer.close(1009,'JSON too large');return;}
    const timestamp = Date.now();
    if (timestamp - c.windowStart >= 1000) { c.windowStart=timestamp; c.packetCount=0; }
    if (++c.packetCount > MAX_MESSAGES_PER_SECOND) {
      c.peer.close(1008,'Message rate exceeded'); return;
    }
    let m;try{m=JSON.parse(raw)}catch{return this.error(c.peer,'invalid_json','메시지를 해석할 수 없습니다.');}
    if(!m||typeof m!=='object'||Array.isArray(m)||typeof m.t!=='string') return;
    if(!c.joined){if(m.t==='join')void this.join(c,m).catch(e=>{console.error('join error:',e);this.error(c.peer,'database','데이터베이스 연결 오류입니다. 잠시 후 다시 접속해 주세요.');c.peer.close(1011,'Storage unavailable')});else this.error(c.peer,'join_required','먼저 방에 입장해야 합니다.');return;}
    const p=c.player,room=c.room;
    if(!p||p.peer!==c.peer) return;
    switch(m.t) {
      case 'move': this.move(c,m);break;
      case 'seat_request':this.requestSeat(c,m);break;
      case 'seat_sit':this.sit(c,m);break;
      case 'seat_cancel':this.cancelReservation(c);break;
      case 'stand':this.stand(c);break;
      case 'pause':this.pause(c,m);break;
      case 'chat':this.chat(c,m);break;
      case 'profile':this.profile(c,m);break;
      case 'sync':c.peer.send({t:'snapshot',serverNow:Date.now(),day:localDay(),players:[...room.users.values()].map(u=>this.public(u)),locks:this.getLocks(room),count:this.members(room),npcCount:NPC_COUNT});break;
      default: break;
    }
  }
  async join(c,m) {
    const id=c.accountId||this.auth.validate(m.token);
    if(!id||(!c.accountId&&this.accounts&&!await this.accounts.isGuestAvailable(id))){this.error(c.peer,'auth','사용자 인증에 실패했습니다. 다시 로그인하세요.');c.peer.close(1008,'Auth');return;}
    // Serialize joins for the SAME identity; two tabs joining simultaneously must
    // never create two separately accumulating player objects.
    const before=this.joinQueue.get(id)||Promise.resolve();
    const next=before.catch(()=>{}).then(()=>this.joinVerified(c,m,id));
    this.joinQueue.set(id,next);
    try{await next;}finally{if(this.joinQueue.get(id)===next)this.joinQueue.delete(id);}
  }
  async joinVerified(c,m,id) {
    if(c.closed)return;
    const roomId=m.room;
    if(!validRoom(roomId)){this.error(c.peer,'room','방 주소가 올바르지 않습니다.');c.peer.close(1008,'Room');return;}
    if(this.accounts&&!await this.accounts.canEnterRoom(roomId,id)){this.error(c.peer,'room_private','이 방에 입장할 권한이 없습니다.');c.peer.close(1008,'Room access denied');return;}
    // A Google account can own only one active 3D controller globally.
    // Explicit takeover confirmation is required BEFORE evicting a controller
    // even if the older connection belongs to another room.
    if(c.accountId&&!m.takeover){
      for(const r of this.rooms.values()){
        const current=r.users.get(id);
        if(current?.online&&current.peer!==c.peer){
          this.error(c.peer,'control_conflict','다른 기기에서 공부 중입니다. 제어권 이전을 확인해 주세요.');
          c.peer.close(4003,'Takeover confirmation required');return;
        }
      }
    }
    // At most one room membership per verified identity at a time.
    for(const r of this.rooms.values()) if(r.id!==roomId && r.users.has(id)){const old=r.users.get(id);this.studyMs(old);await this.persist(old);this.remove(r,old);}
    const room=this.get(roomId);
    if(!room.users.has(id)&&this.members(room)>=64){this.error(c.peer,'full','이 방은 최대 64명까지 입장할 수 있습니다.');c.peer.close(1008,'Full');return;}
    // Refuse new joins when the durable identity / study database is unavailable.
    const stored=await this.store.ensureGuest(id);
    let p=room.users.get(id), resumed=!!p;
    if(!p){const currentDay=koreaDay();const savedMs=await this.store.getDay(id,currentDay);p={id,x:SPAWN.x,z:SPAWN.z,yaw:Math.PI,seatId:null,pendingSeatId:null,
       nick:stored.nick,species:stored.species,hood:stored.hood,rankingPublic:stored.rankingPublic,studyMs:savedMs,studyStartedAt:0,
       studying:false,paused:false,day:currentDay,lastAccruedAt:0,pending:new Map(),persistPromise:null,online:false,offlineAt:0,peer:null,lastMoveAt:Date.now(),lastChatAt:0};room.users.set(id,p);}
    if(p.peer&&p.peer!==c.peer){
      if(c.accountId&&!m.takeover){this.error(c.peer,'control_conflict','다른 기기에서 이 계정으로 공부 중입니다. 제어권을 가져오려면 확인해 주세요.');c.peer.close(4003,'Takeover confirmation required');return;}
      p.peer.send({t:'replaced'});p.peer.close(4001,'New connection');
    }
    if(c.closed)return;
    p.peer=c.peer;p.online=true;p.offlineAt=0;p.lastMoveAt=Date.now();
    this.applyProfile(p,m.profile);
    await this.store.updateProfile(id,p);
    c.room=room;c.player=p;c.joined=true;
    c.peer.send({t:'welcome',serverNow:Date.now(),day:localDay(),id,room:roomId,resumed,players:[...room.users.values()].map(u=>this.public(u)),
      locks:this.getLocks(room),count:this.members(room),npcCount:NPC_COUNT});
    this.broadcast(room,{t:'player',player:this.public(p),count:this.members(room)},c.peer);
  }
  async stopIdentity(id){
    for(const room of [...this.rooms.values()]){const p=room.users.get(id);if(!p)continue;
      this.stopStudy(p);await this.persist(p);this.remove(room,p);
    }
  }
  getLocks(room) { return [...room.locks.entries()].map(([id,v])=>({id,ownerId:v.id,phase:v.phase})); }
  release(room,p) {
    let changed=false;
    for(const [id,v] of room.locks) if(v.id===p.id){room.locks.delete(id);this.broadcast(room,{t:'seat_lock',seatId:id,ownerId:null,phase:null});changed=true;}
    p.pendingSeatId=null;p.seatId=null;
    return changed;
  }
  requestSeat(c,m) {
    const p=c.player,room=c.room,s=layout.seats[m.seatId];
    if(!Number.isInteger(m.seatId)||!s||layout.npcSeats.has(s.id))
      return this.error(c.peer,'seat_unavailable','NPC 전용이거나 유효하지 않은 좌석입니다.',m.seatId);
    const occupant=room.locks.get(s.id);
    if(occupant&&occupant.id!==p.id)return this.error(c.peer,'seat_occupied','이미 사용 중이거나 예약된 좌석입니다.',s.id);
    if(p.seatId===s.id){return c.peer.send({t:'seat_granted',seatId:s.id,alreadySeated:true});}
    if(p.seatId!==null)this.stand(c);
    if(p.pendingSeatId!==null&&p.pendingSeatId!==s.id)this.cancelReservation(c);
    room.locks.set(s.id,{id:p.id,phase:'reserved',expiresAt:Date.now()+RESERVATION_MS});p.pendingSeatId=s.id;
    c.peer.send({t:'seat_granted',seatId:s.id,alreadySeated:false});
    this.broadcast(room,{t:'seat_lock',seatId:s.id,ownerId:p.id,phase:'reserved'});
  }
  sit(c,m) {
    const p=c.player,room=c.room,seatId=m.seatId;
    if(!Number.isInteger(seatId)||p.pendingSeatId!==seatId) return this.error(c.peer,'seat_not_reserved','이 좌석의 예약을 확인할 수 없습니다.',seatId);
    const lock=room.locks.get(seatId),s=layout.seats[seatId];
    if(!lock||lock.id!==p.id||lock.phase!=='reserved'||lock.expiresAt<Date.now())return this.error(c.peer,'seat_expired','좌석 예약이 만료되었습니다.',seatId);
    const approach={x:s.x,z:s.z+s.sign*2.62};
    if(Math.hypot(p.x-approach.x,p.z-approach.z)>2.3)return this.error(c.peer,'not_near_seat','좌석 근처로 이동한 후 착석할 수 있습니다.',seatId);
    p.seatId=seatId;p.pendingSeatId=null;p.x=s.x;p.z=s.z;p.yaw=s.sign===1?Math.PI:0;
    lock.phase='seated';lock.expiresAt=Infinity;
    this.ensureDay(p);p.studying=true;p.paused=false;p.lastAccruedAt=Date.now();
    this.broadcast(room,{t:'seat_lock',seatId,ownerId:p.id,phase:'seated'});
    this.broadcast(room,{t:'player',player:this.public(p),count:this.members(room)});
  }
  cancelReservation(c) {
    const p=c.player,sid=p.pendingSeatId;if(sid===null)return;
    const lock=c.room.locks.get(sid);
    if(lock?.id===p.id&&lock.phase==='reserved'){
      c.room.locks.delete(sid);this.broadcast(c.room,{t:'seat_lock',seatId:sid,ownerId:null,phase:null});
    }
    p.pendingSeatId=null;
  }
  stand(c) {
    const p=c.player,room=c.room;if(p.seatId===null){this.cancelReservation(c);return;}
    const sid=p.seatId,s=layout.seats[sid];this.stopStudy(p);
    p.seatId=null;p.pendingSeatId=null;
    if(room.locks.get(sid)?.id===p.id){room.locks.delete(sid);this.broadcast(room,{t:'seat_lock',seatId:sid,ownerId:null,phase:null});}
    // Server assigns a legal walkable emergence position; never trust a client teleport from a chair.
    const target={x:s.x,z:s.z+s.sign*2.63};
    const candidate=this.nearWalkable(target.x,target.z);
    p.x=candidate.x;p.z=candidate.z;p.lastMoveAt=Date.now();
    this.broadcast(room,{t:'player',player:this.public(p),count:this.members(room)});
  }
  nearWalkable(x,z) {
    if(isWalkable(x,z))return {x,z};
    for(let radius=.6;radius<=4;radius+=.6)for(let a=0;a<16;a++){
      const xx=x+radius*Math.cos(a*Math.PI/8),zz=z+radius*Math.sin(a*Math.PI/8);
      if(isWalkable(xx,zz))return {x:xx,z:zz};
    }
    return SPAWN;
  }
  move(c,m) {
    const p=c.player;
    if(p.seatId!==null)return;
    if(typeof m.x!=='number'||typeof m.z!=='number'||typeof m.yaw!=='number'||!Number.isFinite(m.yaw)||!isWalkable(m.x,m.z)){
      c.peer.send({t:'correction',x:p.x,z:p.z,yaw:p.yaw});return;
    }
    const now=Date.now(), dt=Math.min(2,(now-p.lastMoveAt)/1000);
    const dist=Math.hypot(m.x-p.x,m.z-p.z);
    if(dist>.55+5.8*dt){ c.peer.send({t:'correction',x:p.x,z:p.z,yaw:p.yaw});return; }
    const steps=Math.ceil(dist/.3);for(let i=1;i<=steps;i++){
      const f=i/steps;if(!isWalkable(p.x+(m.x-p.x)*f,p.z+(m.z-p.z)*f)){
       c.peer.send({t:'correction',x:p.x,z:p.z,yaw:p.yaw});return;
      }
    }
    p.x=m.x;p.z=m.z;p.yaw=bound(m.yaw,-Math.PI*10,Math.PI*10);p.lastMoveAt=now;
    this.broadcast(c.room,{t:'moved',id:p.id,x:p.x,z:p.z,yaw:p.yaw},c.peer);
  }
  pause(c,m) {
    const p=c.player;if(!p.studying||typeof m.paused!=='boolean')return;
    if(p.paused!==m.paused){this.studyMs(p);p.paused=m.paused;p.lastAccruedAt=m.paused?0:Date.now();void this.persist(p);}
    this.broadcast(c.room,{t:'clock',players:[{id:p.id,studyMs:this.studyMs(p),studying:p.studying,paused:p.paused}]});
  }
  chat(c,m) {
    const msg=cleanText(m.message,40);const p=c.player,now=Date.now();
    if(!msg||now-p.lastChatAt<900)return;
    p.lastChatAt=now;this.broadcast(c.room,{t:'chat',id:p.id,message:msg});
  }
  applyProfile(p,prefs) {
    if(!prefs||typeof prefs!=='object')return;
    const nick=cleanText(prefs.nick,15);p.nick=nick||'게스트';
    p.species=COLORS.has(prefs.species)?prefs.species:'rabbit';
    p.hood=typeof prefs.hood==='string'&&/^#[0-9a-fA-F]{6}$/.test(prefs.hood)?prefs.hood:'#f39bc4';
  }
  profile(c,m) {
    const now=Date.now();if(now-c.lastProfileAt<800)return;
    c.lastProfileAt=now;this.applyProfile(c.player,m.profile);
    void this.store.updateProfile(c.player.id,c.player).catch(e=>{this.persistenceError=e.message;console.error('profile storage:',e.message)});
    this.broadcast(c.room,{t:'player',player:this.public(c.player),count:this.members(c.room)});
  }
  disconnect(c) {
    const p=c.player;if(!p||p.peer!==c.peer)return;
    p.peer=null;p.online=false;p.offlineAt=Date.now();p.lastMoveAt=p.offlineAt;
    // Pause study offline but retain seat briefly for same-token reconnect.
    if(p.studying&&!p.paused){this.studyMs(p);p.paused=true;p.lastAccruedAt=0;}
    void this.persist(p);
    this.cancelReservation(c);
    this.broadcast(c.room,{t:'player',player:this.public(p),count:this.members(c.room)});
  }
  remove(room,p) {
    if(p.peer){const old=p.peer;p.peer=null;p.online=false;old.close(4002,'Room changed');}
    this.release(room,p);room.users.delete(p.id);
    this.broadcast(room,{t:'left',id:p.id,count:this.members(room)});
    if(!room.users.size)this.rooms.delete(room.id);
  }
  async tick() {
    const now=Date.now();
    for(const room of [...this.rooms.values()]) {
      for(const p of [...room.users.values()])if(!p.online&&now-p.offlineAt>RECONNECT_GRACE_MS){
        try{await this.persist(p);this.remove(room,p);}catch{
          // Even when DB is down, never keep a disconnected guest's chair locked.
          this.release(room,p); // retain only the pending study ledger for retry
        }
      }
      if(!this.rooms.has(room.id))continue;
      for(const [sid,lock] of [...room.locks])if(lock.phase==='reserved'&&now>lock.expiresAt){
        room.locks.delete(sid);const owner=room.users.get(lock.id);if(owner?.pendingSeatId===sid){owner.pendingSeatId=null;owner.peer?.send({t:'error',code:'seat_expired',seatId:sid,message:'좌석 예약이 만료되었습니다.'});}
        this.broadcast(room,{t:'seat_lock',seatId:sid,ownerId:null,phase:null});
      }
      this.broadcast(room,{t:'clock',serverNow:now,day:localDay(now),count:this.members(room),npcCount:NPC_COUNT,
        players:[...room.users.values()].map(p=>({id:p.id,studyMs:this.studyMs(p),studying:p.studying,paused:p.paused}))});
    }
    try{await this.flushAll();}catch{/* retry next tick; health reports degraded storage */}
    for(const c of this.connections){
      if(c.accountId&&now>c.accountExpiresAt){c.peer.close(1008,'Session expired');continue;}
      if(!c.joined&&now-c.created>12000)c.peer.close(1008,'Join timeout');
      if(now-c.peer.lastPongAt>55000){c.peer.close(1001,'Heartbeat timeout');c.peer.socket.destroy();}
      else if(now-c.peer.lastPingAt>20000)c.peer.ping();
    }
  }
}
