// Browser transport only. The room server owns identity, seats, clocks and presence.
// A reconnect uses the server-signed guest token (never an asserted player ID).
export class NetworkClient {
  constructor({room,profile,onEvent,onStatus,isAccount=()=>false,ensureAccount=async()=>{},admission=null}) {
    this.room=room;this.admission=admission;this.profile=profile;this.onEvent=onEvent;this.onStatus=onStatus;this.isAccount=isAccount;this.ensureAccount=ensureAccount;this.takeover=false;
    this.connected=false;this.stopped=false;this.socket=null;this.retries=0;this.token=null;
    this.reconnectTimer=null;this.joinTimer=null;this.syncTimer=null;
    this.generation=0;this.lastMessageAt=0;
  }
  clearTimers() {
    clearTimeout(this.reconnectTimer);clearTimeout(this.joinTimer);clearTimeout(this.syncTimer);
  }
  async start() {
    this.stopped=false;clearTimeout(this.reconnectTimer);const generation=++this.generation;
    try {
      if(this.isAccount())await this.ensureAccount();
      if(this.stopped||generation!==this.generation)return;
      if(this.isAccount()){this.token=null;}else{
        let token='';try{token=localStorage.getItem('snu-study-guest-token-v2')||''}catch{}
        const response=await fetch('/api/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),cache:'no-store'});
        if(!response.ok){
          const payload=await response.json().catch(()=>({}));
          const reason=typeof payload.error==='string'?payload.error.slice(0,90):'서버 응답을 확인해 주세요.';
          throw new Error(`게스트 인증 HTTP ${response.status}: ${reason}`);
        }
        let result;
        try{result=await response.json();}catch{throw new Error('게스트 인증 응답이 JSON이 아닙니다. Codespaces 포트/접속 주소를 확인하세요.');}
        if(!result||typeof result.token!=='string'||!result.token)throw new Error('게스트 인증 응답에 토큰이 없습니다.');
        if(this.stopped||generation!==this.generation)return;
        this.token=result.token;try{localStorage.setItem('snu-study-guest-token-v2',this.token)}catch{}
      }
      this.open(generation);
    }catch(e){if(!this.stopped&&generation===this.generation)this.retry(e.message);}
  }
  open(generation) {
    if(this.stopped||generation!==this.generation)return;
    const scheme=location.protocol==='https:'?'wss:':'ws:';
    this.onStatus('서버 연결 중…');
    const socket=new WebSocket(scheme+'//'+location.host+'/ws?room='+encodeURIComponent(this.room));this.socket=socket;
    socket.onopen=()=>{
      if(this.stopped||generation!==this.generation){socket.close();return;}
      socket.send(JSON.stringify({t:'join',token:this.token,room:this.room,profile:this.profile(),takeover:this.takeover,admission:this.admission}));
      // A TCP/WebSocket handshake alone does not mean the room join succeeded.
      this.joinTimer=setTimeout(()=>{if(!this.connected&&this.socket===socket)socket.close();},10000);
    };
    socket.onmessage=e=>{
      if(this.stopped||generation!==this.generation)return;
      this.lastMessageAt=Date.now();
      let m;try{m=JSON.parse(e.data)}catch{return;}
      if(m.t==='welcome'){
        clearTimeout(this.joinTimer);this.connected=true;this.retries=0;this.admission=null;
        this.onStatus('온라인 연결됨');
      }
      if(m.t==='error'&&m.code==='full'){
        this.stop();
        const base=this.room.startsWith('korea')?'korea':this.room.startsWith('yonsei')?'yonsei':'main';
        const url=new URL(location.href);url.searchParams.set('room',base);url.searchParams.set('auto','1');
        this.onStatus('방이 가득 찼습니다. 빈 방으로 이동합니다.');
        location.replace(url.href);return;
      }
      if(m.t==='error'&&m.code==='control_conflict'){
        this.stop();this.onStatus('다른 기기에서 같은 계정으로 공부 중입니다.');
        if(confirm('다른 기기에서 공부 중입니다. 이 기기로 제어권을 이전할까요?')){this.takeover=true;this.start();}
        return;
      }
      if(m.t==='replaced'){
        this.stop();this.onStatus('같은 게스트가 다른 탭에서 접속했습니다. 새로고침하여 다시 입장하세요.');return;
      }
      this.onEvent(m);
    };
    socket.onclose=e=>{
      if(generation!==this.generation)return;
      this.connected=false;clearTimeout(this.joinTimer);clearTimeout(this.syncTimer);
      if(e.code===4003){this.stop();return;}
      if(e.code===4001){this.stop();this.onStatus('같은 게스트가 다른 탭에서 접속했습니다.');return;}
      this.onEvent({t:'offline'});
      if(!this.stopped)this.retry('연결이 끊어졌습니다. 재연결 중…');
    };
    socket.onerror=()=>{ /* close event owns retries */ };
  }
  retry(message) {
    this.onStatus(message);if(this.stopped)return;
    clearTimeout(this.reconnectTimer);
    const delay=Math.min(8000,500*Math.pow(1.7,this.retries++));
    this.reconnectTimer=setTimeout(()=>this.start(),delay);
  }
  send(data){if(!this.connected||this.socket?.readyState!==WebSocket.OPEN)return false;
    this.socket.send(JSON.stringify(data));return true;}
  refresh() {
    if(this.stopped)return;
    if(this.socket?.readyState!==WebSocket.OPEN||!this.connected)return;
    const socket=this.socket, previous=this.lastMessageAt;
    // A snapshot fixes clocks and occupancy after mobile browser suspension.
    if(!this.send({t:'sync'}))return;
    clearTimeout(this.syncTimer);
    this.syncTimer=setTimeout(()=>{
      // Force a reconnect only if NOTHING arrives; normal 1Hz clocks count as alive.
      if(this.socket===socket && this.connected && this.lastMessageAt<=previous)socket.close();
    },5500);
  }
  stop(){this.stopped=true;this.connected=false;this.generation++;this.clearTimers();this.socket?.close();}
}
