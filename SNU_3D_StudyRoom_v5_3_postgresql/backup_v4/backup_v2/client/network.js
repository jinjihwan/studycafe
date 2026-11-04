// Browser WebSocket transport with server-issued guest token and reconnect handling.
// No 3D code here: all events are passed to the existing index.html scene.
export class NetworkClient {
  constructor({room,profile,onEvent,onStatus}) {
    this.room=room;this.profile=profile;this.onEvent=onEvent;this.onStatus=onStatus;
    this.connected=false;this.stopped=false;this.socket=null;this.retries=0;this.token=null;
    this.reconnectTimer=null;this.generation=0;
  }
  async start() {
    this.stopped=false;const generation=++this.generation;
    try {
      let token='';try{token=localStorage.getItem('snu-study-guest-token-v2')||''}catch{}
      const response=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
      if(!response.ok)throw new Error('게스트 인증 서버 응답 오류');
      const result=await response.json();if(this.stopped||generation!==this.generation)return;
      this.token=result.token;try{localStorage.setItem('snu-study-guest-token-v2',this.token)}catch{}
      this.open(generation);
    }catch(e){if(!this.stopped&&generation===this.generation)this.retry(e.message);}
  }
  open(generation) {
    if(this.stopped||generation!==this.generation)return;
    const scheme=location.protocol==='https:'?'wss:':'ws:';
    this.onStatus('서버 연결 중…');
    const socket=new WebSocket(scheme+'//'+location.host+'/ws');this.socket=socket;
    socket.onopen=()=>{
      if(this.stopped||generation!==this.generation){socket.close();return;}
      socket.send(JSON.stringify({t:'join',token:this.token,room:this.room,profile:this.profile()}));
    };
    socket.onmessage=e=>{
      if(this.stopped||generation!==this.generation)return;
      let m;try{m=JSON.parse(e.data)}catch{return;}
      if(m.t==='welcome'){this.connected=true;this.retries=0;this.onStatus('온라인 연결됨');}
      if(m.t==='replaced'){this.stop();this.onStatus('같은 게스트가 다른 탭에서 접속했습니다. 새로고침하여 다시 입장하세요.');return;}
      this.onEvent(m);
    };
    socket.onclose=e=>{if(generation!==this.generation)return;this.connected=false;
      if(e.code===4001){this.stop();this.onStatus('같은 게스트가 다른 탭에서 접속했습니다.');return;}
      this.onEvent({t:'offline'});if(!this.stopped)this.retry('연결이 끊어졌습니다. 재연결 중…');};
    socket.onerror=()=>{ /* close event schedules reconnection */ };
  }
  retry(message) {
    this.onStatus(message);if(this.stopped)return;
    clearTimeout(this.reconnectTimer);
    const delay=Math.min(8000,500*Math.pow(1.7,this.retries++));
    this.reconnectTimer=setTimeout(()=>this.start(),delay);
  }
  send(data){if(!this.connected||this.socket?.readyState!==WebSocket.OPEN)return false;
    this.socket.send(JSON.stringify(data));return true;}
  stop(){this.stopped=true;this.connected=false;this.generation++;clearTimeout(this.reconnectTimer);this.socket?.close();}
}
