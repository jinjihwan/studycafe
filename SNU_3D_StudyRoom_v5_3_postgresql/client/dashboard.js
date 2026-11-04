// Accessible, mobile-first study records / ranking panels; no Three.js dependency.
// The existing library scene stays mounted. Server-issued guest bearer token is
// read only when making same-origin API calls.
const $=s=>document.querySelector(s);
const dur=ms=>{let s=Math.floor(Math.max(0,ms||0)/1000);return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,'0')).join(':');};
const speciesIcon={rabbit:'🐰',bear:'🐻',cat:'🐱',dog:'🐶'};
const labelTime=ms=>dur(ms);
const timeStr=day=>`${Number(day.slice(5,7))}/${Number(day.slice(8,10))}`;
const monthShift=(month,off)=>{const [y,m]=month.split('-').map(Number);const d=new Date(Date.UTC(y,m-1+off,1));return d.toISOString().slice(0,7);};
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};

export function initDashboard({getToken,onToast,onFriends,onFriendRanking,onHideFriends}){
  const nav=$('#appNav'),panel=$('#dashboard'),body=$('#dashboardBody');
  nav.hidden=false;
  let view='library',month='',selectedDay='',lastFetch=0,inFlight=false,queued=false;
  let rankingPublic=true,visibleRequest=0,rankingMode='all';
  const tabs=[...nav.querySelectorAll('[data-tab]')];
  const statsButtons=()=>nav.querySelector('[data-tab="records"]');
  function choose(tab){
    if(tab!=='library'&&tab!=='records'&&tab!=='ranking'&&tab!=='friends')return;
    onHideFriends?.();view=tab;if(tab==='ranking')rankingMode='all';document.body.classList.toggle('panel-visible',view!=='library');
    nav.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===view;b.classList.toggle('selected',active);b.setAttribute('aria-selected',String(active));});
    panel.hidden=view==='library';
    if(view==='friends')onFriends();else if(view!=='library')refresh(true);
  }
  for(const tab of tabs)tab.addEventListener('click',()=>choose(tab.dataset.tab));
  async function api(path,method='GET',payload){
    const token=getToken();if(!token)throw new Error('서버 접속을 확인해 주세요.');
    const res=await fetch(path,{method,cache:'no-store',headers:{'Authorization':'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});
    const json=await res.json().catch(()=>({}));if(!res.ok)throw new Error(json.error||'서버 조회 실패 ('+res.status+')');return json;
  }
  function status(message){body.replaceChildren(el('div','dash-loading',message));}
  function heading(title,subtitle){const h=el('div','dash-heading');h.append(el('h2','',title),el('p','',subtitle));return h;}
  function metric(name,ms,raw=false){const div=el('article','dash-metric');div.append(el('span','',name),el('strong','',raw?String(ms):labelTime(ms)));return div;}
  async function refresh(force=false){
    if(view==='library'||view==='friends'||(view==='ranking'&&rankingMode==='friends')||document.hidden||!getToken())return;
    if(inFlight){queued=true;return;}
    if(!force&&Date.now()-lastFetch<25000)return;
    inFlight=true;const req=++visibleRequest,kind=view;
    if(force)status('서버 기록을 조회하는 중…');
    try{
      const result=kind==='records'?await api('/api/me/stats?month='+encodeURIComponent(month||new Date(Date.now()+9*3600000).toISOString().slice(0,7))):await api('/api/ranking?limit=20');
      if(req!==visibleRequest||view!==kind)return;
      if(kind==='records')drawRecords(result);else drawRanking(result);
      lastFetch=Date.now();
    }catch(e){if(req===visibleRequest&&view===kind){status('조회 오류: '+e.message);onToast('기록 서버를 확인해 주세요.');}}
    finally{inFlight=false;if(queued){queued=false;void refresh(true);}}
  }
  function drawRecords(data){
    const root=document.createDocumentFragment();
    month=data.month;rankingPublic=!!data.rankingPublic;
    root.append(heading('내 공부 기록','한국시간 기준 · 서버에서 확인한 착석 공부 시간만 저장됩니다.'));
    const metrics=el('div','dash-metrics');
    for(const [name,ms] of [['오늘',data.todayMs],['어제',data.yesterdayMs],['이번 주',data.weekMs],['이번 달',data.monthMs],['전체 누적',data.totalMs]])metrics.append(metric(name,ms));
    metrics.append(metric('연속 공부 일수',data.streak+'일',true));root.append(metrics);
    const columns=el('div','dash-columns');
    const calendar=el('section','dash-card');
    const row=el('div','dash-title-row');const prev=el('button','dash-small','‹');prev.title='이전 달';const next=el('button','dash-small','›');next.title='다음 달';
    const title=el('h3','',data.month.replace('-','년 ')+'월');
    row.append(prev,title,next);calendar.append(row);
    prev.addEventListener('click',()=>{month=monthShift(month,-1);selectedDay='';refresh(true);});
    next.addEventListener('click',()=>{month=monthShift(month,1);selectedDay='';refresh(true);});
    const grid=el('div','dash-calendar');
    for(const name of ['월','화','수','목','금','토','일'])grid.append(el('b','weekday',name));
    if(!selectedDay||!data.calendar.some(d=>d.day===selectedDay))selectedDay=data.month===data.day.slice(0,7)?data.day:data.month+'-01';
    for(const d of data.calendar){const b=el('button','dash-day',String(Number(d.day.slice(8))));b.classList.toggle('outside',!d.inMonth);b.classList.toggle('has-study',d.ms>0);b.classList.toggle('chosen',selectedDay===d.day);
      b.title=d.day+': '+dur(d.ms);b.setAttribute('aria-label',d.day+', '+dur(d.ms));
      b.addEventListener('click',()=>{selectedDay=d.day;const detail=$('#dashSelectedDay');if(detail)detail.textContent=selectedDay+' · '+dur(d.ms);grid.querySelectorAll('.dash-day').forEach(e=>e.classList.remove('chosen'));b.classList.add('chosen');});grid.append(b);}
    calendar.append(grid);const chosen=data.calendar.find(d=>d.day===selectedDay);const selected=el('p','dash-note',selectedDay+' · '+dur(chosen?.ms||0));selected.id='dashSelectedDay';calendar.append(selected);
    const chart=el('section','dash-card');chart.append(el('h3','','최근 7일 공부 시간'));
    const barWrap=el('div','dash-bars');const top=Math.max(60000,...data.last7.map(d=>d.ms));
    for(const d of data.last7){const wrap=el('div','dash-bar');const value=el('small','',d.ms?dur(d.ms):'0');const column=el('div','dash-bar-track');const fill=el('div','dash-bar-fill');fill.style.height=(d.ms?Math.max(3,100*d.ms/top):0)+'%';column.append(fill);wrap.append(value,column,el('span','',timeStr(d.day)));barWrap.append(wrap);}
    chart.append(barWrap,el('p','dash-note','공부 기록이 없는 날짜는 0시간으로 표시됩니다.'));
    columns.append(calendar,chart);root.append(columns);
    const privacy=el('section','dash-privacy');const label=el('label','dash-privacy-label');const input=el('input');input.type='checkbox';input.checked=rankingPublic;
    label.append(input,el('span','','오늘의 공개 랭킹에 참여'));
    privacy.append(label,el('p','dash-note','끄면 닉네임과 기록이 공개 랭킹에서 제외됩니다. 내 공부 기록은 계속 저장됩니다.'));
    input.addEventListener('change',async()=>{input.disabled=true;try{const v=await api('/api/me/privacy','POST',{rankingPublic:input.checked});rankingPublic=v.rankingPublic;onToast(rankingPublic?'랭킹 공개 참여':'랭킹 비공개 설정');}catch(e){input.checked=!input.checked;onToast(e.message);}finally{input.disabled=false;}});
    root.append(privacy,el('p','dash-footer','게스트 기록은 이 브라우저의 인증 토큰에 연결됩니다. 브라우저 데이터를 삭제하거나 서버 인증 비밀키를 잃으면 기존 기록에 접근하지 못할 수 있습니다.'));
    body.replaceChildren(root);
  }
  function drawRanking(data){
    const root=document.createDocumentFragment();
    root.append(heading('오늘의 공부 랭킹',data.day+' (한국시간) · NPC 제외 · 약 30초 간격 자동 갱신'));
    const friendSwitch=el('div','friend-switch');const all=el('button','friend-action selected','전체 랭킹'),friends=el('button','friend-action','친구 랭킹');friends.addEventListener('click',()=>{rankingMode='friends';onFriendRanking();});friendSwitch.append(all,friends);root.append(friendSwitch);
    root.append(el('div','dash-ranking-summary',data.myRank?`내 순위 ${data.myRank}위 · ${dur(data.myStudyMs)} · 참여 사용자 ${data.count}명`:'내 순위: 비공개 또는 아직 공부 기록 없음 · 참여 사용자 '+data.count+'명'));
    if(!data.entries.length)root.append(el('p','dash-empty','오늘 공개 랭킹 기록이 없습니다.'));
    const list=el('div','dash-rank-list');
    for(const r of data.entries){const item=el('article','dash-rank');if(r.isMe)item.classList.add('is-me');
      const number=el('span','dash-rank-num',String(r.rank));
      const avatar=el('span','dash-avatar',speciesIcon[r.species]||'🐾');avatar.style.background=r.hood;
      avatar.title=r.species+' · '+r.hood;
      const name=el('div','dash-rank-name');name.append(el('strong','',r.nick+(r.isMe?' (나)':'')),el('small','',r.species+' · 후드 '+r.hood));
      item.append(number,avatar,name,el('strong','dash-rank-time',dur(r.ms)));list.append(item);}
    root.append(list,el('p','dash-footer','동일 공부 시간은 서버 게스트 ID 오름차순으로 순위를 정합니다. 랭킹은 한국시간 00:00에 새로 시작합니다.'));
    body.replaceChildren(root);
  }
  // The server updates the live timer independently of any client navigation.
  const interval=setInterval(()=>{if(view!=='library')void refresh(false);},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&view!=='library'){lastFetch=0;void refresh(true);}});
  return {get view(){return view;},onReconnect(){if(view!=='library'){lastFetch=0;void refresh(true);}},open:choose,dispose(){clearInterval(interval)}};
}
