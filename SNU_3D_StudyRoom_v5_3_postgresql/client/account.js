// Optional official Firebase Web Auth integration. Public web config comes from
// /api/auth/config. No service-account credentials are ever sent to browsers.
const $=s=>document.querySelector(s);
export class AccountClient {
 constructor({onChange,onToast,getGuestToken}){this.onChange=onChange;this.onToast=onToast;this.getGuestToken=getGuestToken;this.account=null;this.csrf=null;this.config=null;this.firebase=null;}
 get signedIn(){return !!this.account;}
 clearAuthError(){const e=document.querySelector('#authError');if(e){e.hidden=true;e.textContent='';}}
 authError(message){const e=document.querySelector('#authError');if(e){e.textContent=String(message||'알 수 없는 오류').slice(0,240);e.hidden=false;}this.onToast(message);}
 async initialize(){
  try{const result=await (await fetch('/api/auth/config',{cache:'no-store'})).json();this.config=result.enabled?result.config:null;
    const me=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
    if(me.ok){const d=await me.json();this.account=d.account;this.csrf=d.csrf;}
  }catch(e){console.warn('계정 상태 확인 불가',e.name);}
  this.draw();
  // Preload Firebase SDK while the user is reading the page; login still works
  // only after configuration is complete, and popup starts from a user gesture.
  if(this.config)void this.loadFirebase().then(()=>this.resumeRedirect()).catch(e=>this.authError('Google 로그인 준비 오류: '+(e.code||e.message)));
 }
 async loadFirebase(){if(this.firebase)return this.firebase;
  const [{initializeApp,getApps},authSdk]=await Promise.all([
   import('https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js'),
   import('https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js')]);
  const app=getApps()[0]||initializeApp(this.config);
  const auth=authSdk.getAuth(app);
  await authSdk.setPersistence(auth,authSdk.browserLocalPersistence);
  this.firebase={auth,authSdk};return this.firebase;
 }
 async resumeRedirect(){const {auth,authSdk}=this.firebase;
  const result=await authSdk.getRedirectResult(auth);
  if(result?.user){await this.exchange(result.user);return;}
  // If the HttpOnly app session expired but Firebase remembers a valid login,
  // refresh the ID token and create a new application session.
  if(!this.account){await auth.authStateReady?.();if(auth.currentUser)await this.exchange(auth.currentUser,false);}
 }
 async exchange(user,withGuest=true){
  const idToken=await user.getIdToken();
  const r=await fetch('/api/auth/google',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({idToken,guestToken:withGuest?this.getGuestToken():null})});
  const d=await r.json();if(!r.ok)throw new Error(d.error||'Google 인증 오류');
  const was=this.account?.id;this.account=d.account;this.csrf=d.csrf;
  this.clearAuthError();this.draw();if(was!==this.account.id)this.onChange();
  this.onToast(d.merged?'게스트 기록이 Google 계정에 통합되었습니다.':'Google 계정으로 연결되었습니다.');
 }
 async login(){
  if(!this.config){this.onToast('Firebase 설정 전입니다. 게스트로 이용할 수 있습니다.');return;}
  if(!this.firebase){this.onToast('Google 로그인 모듈을 불러오는 중입니다.');return;}
  try{
   const {auth,authSdk}=this.firebase;
   // Popup first on Codespaces (redirect helper is often blocked by browsers
   // that restrict third-party storage). Do not silently fallback to redirect.
   const operation=authSdk.signInWithPopup(auth,new authSdk.GoogleAuthProvider());
   const result=await operation;await this.exchange(result.user,true);
  }catch(e){this.onToast('Google 로그인 실패: '+(e.code||e.message)+'. 브라우저 팝업·승인 도메인을 확인하세요.');}
 }
 async loginRedirect(){
  if(!this.firebase)return this.onToast('Google 모듈을 아직 불러오지 못했습니다.');
  const {auth,authSdk}=this.firebase;
  // Only use explicitly; third-party storage restrictions can prevent a
  // Codespaces URL from completing redirect sign-in.
  await authSdk.signInWithRedirect(auth,new authSdk.GoogleAuthProvider());
 }
 async ensureSession(){
  if(!this.account)return;
  const r=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
  if(r.ok)return;
  try{
   if(!this.firebase)await this.loadFirebase();
   await this.firebase.auth.authStateReady?.();
   if(!this.firebase.auth.currentUser)throw new Error('Firebase sign-in expired');
   await this.exchange(this.firebase.auth.currentUser,false);
  }catch(e){
   this.account=null;this.csrf=null;this.draw();this.onChange();
   this.onToast('로그인 세션이 만료되었습니다. 게스트로 전환합니다.');
   throw e;
  }
 }
 async request(path,method='GET',payload){
  if(!this.account)throw new Error('Google 로그인이 필요합니다.');
  // Multiple tabs may share the HttpOnly app cookie while an older tab still
  // holds the CSRF token from the previous login session. The server rejects
  // that request BEFORE changing data. Refresh only the token for the SAME
  // verified user and retry exactly once; never retry a generic 403.
  const expectedId=this.account.id;
  const send=async()=>{
   const opts={method,credentials:'same-origin',cache:'no-store',headers:{...(method!=='GET'?{'X-CSRF-Token':this.csrf,'Content-Type':'application/json'}:{})}};
   if(payload!==undefined)opts.body=JSON.stringify(payload);
   const r=await fetch(path,opts);const data=await r.json().catch(()=>({}));return {r,data};
  };
  let {r,data}=await send();
  if(method!=='GET'&&r.status===403&&typeof data.error==='string'&&data.error.startsWith('CSRF')){
   const me=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
   const fresh=me.ok?await me.json().catch(()=>null):null;
   if(fresh?.account?.id!==expectedId||!fresh?.csrf)throw new Error('로그인 계정이 변경되었습니다. 친구 탭을 다시 열어 주세요. (HTTP 403)');
   this.account=fresh.account;this.csrf=fresh.csrf;this.draw();
   ({r,data}=await send());
  }
  if(!r.ok){if(r.status===401){
    try{if(this.firebase?.auth.currentUser){await this.exchange(this.firebase.auth.currentUser,false);throw new Error('세션을 갱신했습니다. 요청을 다시 시도해 주세요.');}}catch(e){if(e.message.startsWith('세션을 갱신'))throw e;}
    this.account=null;this.csrf=null;this.draw();this.onChange();}
    throw new Error(`${data.error||'서버 요청 오류'} (HTTP ${r.status})`);}
  return data;
 }
 async logout(){
  try{await this.request('/api/auth/logout','POST',{});}catch(e){this.onToast(e.message);return;}
  try{if(this.firebase)await this.firebase.authSdk.signOut(this.firebase.auth);}catch{}
  this.account=null;this.csrf=null;this.draw();this.onChange();this.onToast('게스트로 전환되었습니다.');
 }
 async deleteAccount(){if(!this.account)return;
  if(!confirm('이 스터디룸의 공부 기록, 친구 관계, 계정 연결을 영구 삭제합니다. Google 계정 자체는 삭제되지 않습니다. 진행할까요?'))return;
  try{await this.request('/api/auth/delete','POST',{});try{if(this.firebase)await this.firebase.authSdk.signOut(this.firebase.auth);}catch{}
   this.account=null;this.csrf=null;this.draw();this.onChange();this.onToast('스터디룸 계정 데이터가 삭제되었습니다.');}
  catch(e){this.onToast(e.message);}
 }
 draw(){const b=$('#accountBtn');if(b){const text=this.signedIn?'Google · '+this.account.nick:'게스트 · 로그인';const caption=b.querySelector('.account-label');if(caption)caption.textContent=text;else b.textContent=text;b.setAttribute('aria-label',text);b.title=text;}
  const label=$('#accountStatus');if(label)label.textContent=this.signedIn?`Google 연결됨 · ${this.account.nick}`:'게스트 · 이 브라우저에서만 기록 접근 가능';
  const login=$('#googleLogin');if(login){login.disabled=!this.config||this.signedIn;login.textContent=this.signedIn?'Google 계정 연결됨':this.config?'Google로 계속하기':'Google 로그인 (Firebase 설정 필요)';}
  const logout=$('#logoutBtn');if(logout)logout.hidden=!this.signedIn;
  const del=$('#deleteAccountBtn');if(del)del.hidden=!this.signedIn;
 }
}
