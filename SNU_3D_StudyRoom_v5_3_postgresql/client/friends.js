const $=s=>document.querySelector(s);
const elem=(tag,className,text)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;};
const avatar={rabbit:'🐰',bear:'🐻',cat:'🐱',dog:'🐶'};
const fmt=ms=>{const s=Math.max(0,Math.floor(ms/1000));return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(i=>String(i).padStart(2,'0')).join(':');};
export function createFriendsPanel({account,onToast,onAllRanking}){
 let tab='friends',active=false,lastRank=0,lastFriends=0;
 const panel=$('#dashboardBody');
 const head=(s,desc)=>{const box=elem('div','dash-heading');box.append(elem('h2','',s),elem('p','',desc));return box;};
 const button=(label,action)=>{const b=elem('button','friend-action',label);b.type='button';b.addEventListener('click',async()=>{b.disabled=true;try{await action();}catch(e){onToast(e.message);}finally{b.disabled=false;}});return b;};
 const action=async(path,payload)=>account.request(path,'POST',payload);
 const row=(name,description)=>{const x=elem('div','friend-row');const t=elem('div','friend-info');t.append(elem('strong','',name),elem('small','',description));x.append(t);return x;};
 const checkbox=(label,checked,key)=>{const wrap=elem('label','friend-setting'),input=elem('input');input.type='checkbox';input.checked=checked;wrap.append(input,elem('span','',label));input.onchange=async()=>{input.disabled=true;try{await action('/api/friends/privacy',{[key]:input.checked});onToast('공개 설정을 저장했습니다.');}catch(e){input.checked=!input.checked;onToast(e.message);}finally{input.disabled=false;}};return wrap;};
 async function render(){
  if(!active||tab!=='friends')return;
  if(!account.signedIn){showGoogleLoginPrompt('친구');return;}
  panel.replaceChildren(elem('p','dash-loading','친구 정보를 조회하는 중…'));
  const data=await account.request('/api/friends/list');lastFriends=Date.now();
  const root=document.createDocumentFragment();root.append(head('친구','상호 수락한 친구만 활동 상태와 합류 정보를 볼 수 있습니다.'));
  const code=elem('section','dash-card');code.append(elem('h3','','내 친구 코드'));
  const cr=elem('div','friend-row');cr.append(elem('strong','',data.account.code),button('복사',async()=>{await navigator.clipboard.writeText(data.account.code);onToast('친구 코드를 복사했습니다.');}));code.append(cr);
  const input=elem('input','friend-code-input');input.placeholder='ST-XXXXXXXXXX';input.maxLength=13;input.autocapitalize='characters';const search=elem('div','friend-search');search.append(input,
   button('친구 검색',async()=>{const d=await account.request('/api/friends/find?code='+encodeURIComponent(input.value.trim().toUpperCase()));
    if(!d.user)return onToast('해당 친구 코드의 사용자를 찾을 수 없습니다.');
    if(confirm(`${d.user.nick} (${d.user.species})님께 친구 신청을 보낼까요?`)){await action('/api/friends/request',{code:d.user.code});onToast('친구 신청을 보냈습니다.');await render();}}));code.append(search);root.append(code);
  const requests=elem('section','dash-card');requests.append(elem('h3','','친구 신청'));
  const requestFeedback=elem('p','dash-note','');requestFeedback.setAttribute('role','status');requests.append(requestFeedback);
  const respond=async(req,kind)=>{
   requestFeedback.textContent=kind==='accept'?'친구 신청을 수락하는 중…':kind==='reject'?'친구 신청을 거절하는 중…':'친구 신청을 취소하는 중…';
   try{
    const result=await action('/api/friends/respond',{requestId:Number(req.id),action:kind});
    requestFeedback.textContent=kind==='accept'?'친구 신청을 수락했습니다.':kind==='reject'?'친구 신청을 거절했습니다.':'친구 신청을 취소했습니다.';
    onToast(requestFeedback.textContent);
    try{await render();}catch(e){requestFeedback.textContent='친구 신청은 처리됐지만 목록을 새로고치지 못했습니다: '+e.message;onToast(requestFeedback.textContent);}
    return result;
   }catch(e){requestFeedback.textContent='친구 신청 처리 실패: '+e.message;onToast(requestFeedback.textContent);}
  };
  if(!data.requests.length)requests.append(elem('p','dash-note','대기 중인 신청이 없습니다.'));
  for(const req of data.requests){const inbound=req.target===data.account.id;const r=row(inbound?req.sender_nick:req.target_nick,inbound?'받은 신청':'보낸 신청');
   if(inbound){r.append(button('수락',async()=>respond(req,'accept')),button('거절',async()=>respond(req,'reject')));}
   else r.append(button('취소',async()=>respond(req,'cancel')));requests.append(r);}
  root.append(requests);
  const list=elem('section','dash-card');list.append(elem('h3','','친구 목록'));
  if(!data.friends.length)list.append(elem('p','dash-note','아직 친구가 없습니다. 코드를 공유해 함께 공부해 보세요.'));
  for(const f of data.friends){const state=f.online===null?'활동 비공개':f.online?(f.studying?'온라인 · 공부 중':'온라인 · 휴식 중'):'오프라인';
   const r=row(`${avatar[f.species]||'🐾'} ${f.nick}`,`후드 ${f.hood} · ${state}${f.sameRoom?' · 같은 방':''}`);
   if(f.room)r.append(button('함께 공부하기',async()=>{const d=await action('/api/friends/join',{id:f.id});
    if(!confirm(`${f.nick}님 방으로 이동할까요? 추천 빈 좌석: ${d.seats.map(s=>s.id+1).join(', ')||'없음'}`))return;
    const url=new URL(location.href);url.searchParams.set('room',d.room);if(d.seats[0])url.searchParams.set('suggestSeat',d.seats[0].id);location.href=url.href;}));
   r.append(button('삭제',async()=>{if(confirm('친구 관계를 삭제할까요?')){await action('/api/friends/remove',{id:f.id});await render();}}),
    button('차단',async()=>{if(confirm('차단하면 친구 관계가 끊어지고 활동 정보가 숨겨집니다.')){await action('/api/friends/block',{id:f.id});await render();}}));list.append(r);}
  root.append(list);
  const blocked=elem('section','dash-card');blocked.append(elem('h3','','차단 목록'));
  if(!data.blocks.length)blocked.append(elem('p','dash-note','차단한 사용자가 없습니다.'));
  for(const b of data.blocks){const r=row(b.nick,'차단됨');r.append(button('차단 해제',async()=>{await action('/api/friends/unblock',{id:b.id});await render();}));blocked.append(r);}root.append(blocked);
  const privacy=elem('section','dash-card');privacy.append(elem('h3','','친구 공개 설정'));
  privacy.append(checkbox('친구에게 접속·공부 상태 공개',data.account.activityPublic,'activityPublic'),
   checkbox('친구가 내 방으로 합류 허용',data.account.joinAllowed,'joinAllowed'),
   checkbox('친구 랭킹에 내 공부 시간 공개',data.account.friendRankingPublic,'friendRankingPublic'));
  root.append(privacy,elem('p','dash-footer','친구 코드는 인증 수단이 아닙니다. 신청은 수락한 뒤에만 친구 관계가 됩니다.'));
  panel.replaceChildren(root);
 }
 async function ranking(){if(!active||!account.signedIn)return;
  lastRank=Date.now();const data=await account.request('/api/friends/ranking');
  const root=document.createDocumentFragment();root.append(head('오늘의 친구 랭킹',data.day+' 한국시간 · 본인 및 친구의 허용된 공부 기록'));
  const switcher=elem('div','friend-switch');switcher.append(button('전체 랭킹',onAllRanking),button('친구 랭킹 ✓',async()=>{}));root.append(switcher);
  root.append(elem('div','dash-ranking-summary',data.myRank?`내 순위 ${data.myRank}위 · 오늘 ${fmt(data.myStudyMs)}`:'내 순위: 오늘 기록 없음'));
  if(!data.friends)root.append(elem('p','dash-note','아직 친구가 없습니다. 친구 탭에서 친구 코드를 공유하세요.'));
  const list=elem('div','dash-rank-list');for(const r of data.entries){const item=elem('article','dash-rank');if(r.isMe)item.classList.add('is-me');
   const head=elem('span','dash-avatar',avatar[r.species]||'🐾');head.style.background=r.hood;
   item.append(elem('b','dash-rank-num',String(r.rank)),head,elem('span','dash-rank-name',r.nick+(r.isMe?' (나)':'')),elem('b','dash-rank-time',fmt(r.ms)));list.append(item);}
  root.append(list);panel.replaceChildren(root);
 }
 function showGoogleLoginPrompt(title){
  const root=document.createDocumentFragment();
  root.append(head(title,'친구 기능은 Google 계정으로 로그인해야 사용할 수 있습니다.'));
  const gate=elem('section','dash-card');
  gate.append(elem('p','dash-note','지금은 게스트로 이용 중입니다. 공부와 전체 랭킹은 게스트 상태에서도 계속 사용할 수 있습니다.'));
  gate.append(button('Google 로그인하고 친구 기능 사용',async()=>{
   await account.login(); // popup starts ONLY from the user's click
   if(!account.signedIn)return;
   if(tab==='friends')await render();else await ranking();
  }));
  root.append(gate);panel.replaceChildren(root);
 }
 async function showFriends(){active=true;tab='friends';await render();}
 async function showFriendRanking(){active=true;tab='friend-ranking';if(!account.signedIn){showGoogleLoginPrompt('친구 랭킹');return;}await ranking();}
 function refresh(){if(!active||document.hidden)return;if(tab==='friends'&&Date.now()-lastFriends>20000)void render().catch(e=>onToast(e.message));
  if(tab==='friend-ranking'&&Date.now()-lastRank>30000)void ranking().catch(e=>onToast(e.message));}
 document.addEventListener('visibilitychange',refresh);setInterval(refresh,30000);
 return {showFriends,showFriendRanking,refresh,hide(){active=false;},get current(){return tab;}};
}
