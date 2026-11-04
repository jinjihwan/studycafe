import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const markup=html.slice(0,html.indexOf('<script type="module">'));

test('top summary uses content width; library, room and online count remain available',()=>{
 assert.match(markup,/<div class="room-titleline"><span id="libraryBrand"/);
 assert.match(markup,/<div class="room-subline"><small class="room-pill" id="roomBadge"[^>]*>[^<]*<\/small><span class="count" id="onlineCount"/);
 assert.match(markup,/#topbar \.room-summary\{flex:0 1 auto;width:max-content/);
 assert.match(html,/function updatePlayerCount\(count,virtualCount=null\)/);
});
test('chat controls have transparent shell; both icons and send are grid-centered',()=>{
 assert.match(markup,/#bottom\.glass\{padding:0;background:transparent;border:0;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none\}/);
 assert.match(markup,/#bottom \.controls \.chat-action,#bottom \.controls #sendBtn\{display:grid;place-items:center/);
 assert.match(markup,/#bottom \.controls \.chat-action \.ui-icon,#bottom \.controls #sendBtn \.ui-icon\{display:block;margin:0;justify-self:center;align-self:center\}/);
 for(const id of ['switchLibraryBtn','avatarBtn','chatInput','sendBtn'])assert.match(markup,new RegExp('id="'+id+'"'));
});
test('send availability changes only presentation; keep transport, 40 character limit and duplicate guard',()=>{
 assert.match(html,/function updateSendAvailability\(\)\{D\.send\.disabled=!D\.chat\.value\.trim\(\);\}/);
 assert.match(html,/D\.chat\.addEventListener\('input',updateSendAvailability\);updateSendAvailability\(\)/);
 assert.match(markup,/id="chatInput" maxlength="40"/);
 assert.match(html,/net\?\.send\(\{t:'chat',message:msg\}\)/);
 assert.match(html,/performance\.now\(\)-lastChatSentAt<250/);
});

test('projected nearby nameplates keep their screen position and clocks without forced screen-edge clamping',()=>{
 const excerpt=html.slice(html.indexOf('function labelTier(obj,d){'),html.indexOf('// Lightweight frame diagnostics'));
 assert.doesNotMatch(excerpt,/placed\.some|x=clamp\(|y=clamp\(|safeTop|safeBottom/);
 assert.match(excerpt,/tag\.querySelector\('\.clock'\)\.textContent='◷ '\+fmt\(obj\.getTimer\(\)\)/);
 assert.doesNotMatch(markup,/\.tag\[data-tier="mid"\] \.clock,\.tag\[data-tier="far"\] \.clock\{display:none\}/);
 const mk=(px,py,depth,dist)=>{
  const clock={textContent:'',style:{}},bubble={style:{}};
  const label={style:{display:'none'},dataset:{},querySelector(sel){return sel==='.clock'?clock:bubble;}};
  return { model:{headAnchor:{getWorldPosition(v){v.projectX=px;v.projectY=py;v.projectZ=depth;v.distance=dist;}}}, label, bubbleUntil:0,getTimer(){return dist*1000;},clock};
 };
 const me=mk(0,.1,0,2),a=mk(.3,0,0,10),b=mk(.3,0,0,17),edge=mk(-1.08,0,0,15),gone=mk(-2.1,0,0,60),far=mk(.1,0,0,28);
 const context={CONFIG:{width:48},LABEL_LIMITS:[10.56,18.24],LABEL_HYSTERESIS:1.8,LABEL_CAP:7,
  MOBILE:true,player:me,remotePlayers:new Map([['one',a],['two',b],['edge',edge],['gone',gone],['far',far]]),npcList:[],
  innerWidth:390,innerHeight:844,performance:{now:()=>1000},camera:{position:{distanceTo:v=>v.distance}},
  tempVec:{project(){this.x=this.projectX;this.y=this.projectY;this.z=this.projectZ;return this;}},fmt:n=>String(n)};
 vm.createContext(context);vm.runInContext(excerpt,context);context.updateLabels();
 assert.equal(me.label.style.display,'block');
 assert.equal(a.label.style.display,'block');assert.equal(b.label.style.display,'block','nearby labels remain attached to their characters');
 assert.equal(b.label.dataset.tier,'mid');assert.equal(b.clock.textContent,'◷ 17000','visible nearby label retains time');
 assert.equal(a.label.style.left,b.label.style.left,'overlapping labels never shift from the head projection');
 assert.equal(edge.label.style.display,'block','partially clipped nearby label may leave the viewport naturally');
 assert.ok(Number.parseFloat(edge.label.style.left)<0,'no snapping the edge label into view');
 assert.equal(far.label.style.display,'none','distant labels are hidden completely');
 assert.equal(gone.label.style.display,'none','completely offscreen label skips work');
});
