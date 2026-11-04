import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const account=readFileSync(new URL('../client/account.js',import.meta.url),'utf8');
const markup=html.slice(0,html.indexOf('<script type="module">'));

test('mobile room header retains library, live count, room and accessible account / invite controls',()=>{
 assert.match(markup,/<header id="topbar"[^>]*>.*?<span id="libraryBrand"[^>]*>.*?id="roomBadge".*?id="onlineCount".*?id="inviteBtn".*?id="accountBtn"/s);
 assert.match(markup,/id="accountBtn"[^>]*aria-label="게스트 · 로그인"/);
 assert.match(markup,/id="inviteBtn"[^>]*aria-label="같은 방 초대 링크 복사"/);
 assert.match(html,/function updatePlayerCount\(count,virtualCount=null\)/);
 assert.match(html,/#libraryBrand\{[^}]*text-overflow:ellipsis/);
 assert.doesNotMatch(markup,/id="onlineCount"[^<]*>[^<]*NPC \d+명/);
});
test('chat bar contains two accessible existing action buttons and a send SVG; no old send label',()=>{
 const bar=markup.match(/<section id="bottom"[\s\S]*?<\/section>/)?.[0];assert.ok(bar);
 assert.match(bar,/id="switchLibraryBtn"/);assert.match(bar,/id="avatarBtn"/);
 assert.match(bar,/id="chatInput" maxlength="40"/);
 assert.match(bar,/id="sendBtn"[^>]*aria-label="메시지 전송"/);
 assert.doesNotMatch(bar,/>말하기</);
 assert.match(html,/\$\('#switchLibraryBtn'\)\.addEventListener\('click',openLibraryChooser\)/);
 assert.match(html,/\$\('#avatarBtn'\)\.onclick=\(\)=>showModal\(\)/);
 assert.match(html,/if\(!net\?\.send\(\{t:'chat',message:msg\}\)\)/);
 assert.match(html,/performance\.now\(\)-lastChatSentAt<250/);
});
test('account caption updates without destroying profile SVG, including Google login state',()=>{
 assert.match(account,/const caption=b\.querySelector\('\.account-label'\)/);
 assert.match(account,/if\(caption\)caption\.textContent=text;else b\.textContent=text/);
 assert.match(account,/b\.setAttribute\('aria-label',text\)/);
 assert.match(markup,/<span class="sr-only account-label">게스트 · 로그인<\/span>/);
});
test('navigation keeps records/ranking/friends/library behavior, visually hides unfinished tab',()=>{
 for(const tab of ['library','records','ranking','friends'])assert.match(markup,new RegExp(`data-tab="${tab}"`));
 assert.match(markup,/role="tab" disabled aria-disabled="true" hidden>커뮤니티 · 준비 중/);
 assert.match(html,/#appNav button\[disabled\]\{display:none!important\}/);
});
test('distance label boundaries are room-relative and apply hysteresis; self is always near',()=>{
 assert.match(html,/const LABEL_LIMITS=\[CONFIG\.width\*\.22,CONFIG\.width\*\.38\]/);
 const body=html.match(/function labelTier\(obj,d\)\{[\s\S]*?\n\}/)?.[0];assert.ok(body);
 const ctx={CONFIG:{width:48},LABEL_LIMITS:[10.56,18.24],LABEL_HYSTERESIS:1.8,player:{}};
 vm.createContext(ctx);vm.runInContext(body,ctx);
 const p={};assert.equal(ctx.labelTier(ctx.player,200),0);
 assert.equal(ctx.labelTier(p,5),0);
 assert.equal(ctx.labelTier(p,11),0,'within hysteresis remains near');
 assert.equal(ctx.labelTier(p,13),1);
 assert.equal(ctx.labelTier(p,10),1,'reverse transition must not flicker');
 assert.equal(ctx.labelTier(p,8),0);
 assert.equal(ctx.labelTier(p,21),2);
 assert.equal(ctx.labelTier(p,19),2,'far tier remains latched until hysteresis allows return');
 assert.equal(ctx.labelTier(p,16),1,'far tier returns to mid after hysteresis');
});
test('labels keep head attachment, visible time, screen-edge clipping and bounded count',()=>{
 assert.match(html,/const LABEL_CAP=MOBILE\?7:14/);
 assert.match(html,/tempVec\.project\(camera\)/);
 assert.match(html,/candidates\.sort\(/);
 assert.match(html,/otherCount>=LABEL_CAP/);
 assert.match(html,/tag\.style\.display='none'/);
 assert.doesNotMatch(markup,/\.clock\{display:none\}/);
 assert.doesNotMatch(html,/x=clamp\(x,halfWidth/);
});
test('mobile viewport handling supports keyboard and system safe area with compact tab/chat layout',()=>{
 assert.match(html,/function updateKeyboardInset\(\)/);
 assert.match(html,/window\.visualViewport\.addEventListener\('resize',updateKeyboardInset\)/);
 assert.match(markup,/body\.keyboard-open #appNav\{display:none!important\}/);
 assert.match(markup,/env\(safe-area-inset-bottom\)/);
 assert.match(markup,/@media\(max-width:360px\)/);
 assert.match(markup,/#bottom \.controls #chatInput\{height:42px/);
});
test('only the existing camera framing changes on mobile; no new protocol or data model',()=>{
 assert.match(html,/camera\.position\.set\(MOBILE\?3\.2:4\.2/);
 assert.match(html,/targetFollow\.set\(player\.root\.position\.x,MOBILE\?1\.72:1\.35/);
 assert.match(html,/camera\.position\.z=clamp\(camera\.position\.z,CONFIG\.frontZ\+2\.7,CONFIG\.rearZ-1\.7\)/);
 assert.match(html,/function syncNpcStates\(states\)/);
 assert.match(html,/function updateRemoteRecord\(p,initial=false\)/);
 assert.match(html,/study\.totalMs=Math\.max\(0,Number\(record\.studyMs\)\|\|0\)/);
});
