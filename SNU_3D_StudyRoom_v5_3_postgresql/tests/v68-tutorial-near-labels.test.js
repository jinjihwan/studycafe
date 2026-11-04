import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const markup=html.slice(0,html.indexOf('<script type="module">'));

test('onboarding retains all eight steps and preserves first-visit storage',()=>{
  assert.match(markup,/id="tutorialOverlay" hidden role="region"/);
  assert.match(html,/const TUTORIAL_STORAGE = 'snu-v69-tutorial-complete'/);
  assert.match(html,/const tutorialSteps=\[/);
  for(const title of ['화면 움직이기','도서관 바꿔보기','나만의 캐릭터 만들기','바닥 터치로 걷기','의자에 앉아 공부 시작','메시지 보내기','친구 초대해 보기','Google 로그인 알아보기'])assert.match(html,new RegExp(title));
  assert.match(html,/if\(profileComplete&&!tutorialSeen\)setTimeout\(openTutorial,420\)/);
  assert.match(html,/else setTimeout\(openTutorial,220\)/);
});

test('labels now keep only nearby subset while retaining name and time together',()=>{
  const excerpt=html.slice(html.indexOf('function labelTier(obj,d){'),html.indexOf('// Lightweight frame diagnostics'));
  assert.match(html,/const LABEL_CAP=MOBILE\?7:14/);
  assert.match(excerpt,/if\(obj!==player&&\(tier>=2\|\|otherCount>=LABEL_CAP\)\)/);
  const mk=(px,py,depth,dist)=>{
    const clock={textContent:'',style:{}},bubble={style:{}};
    const label={style:{display:'none'},dataset:{},querySelector(sel){return sel==='.clock'?clock:bubble;}};
    return { model:{headAnchor:{getWorldPosition(v){v.projectX=px;v.projectY=py;v.projectZ=depth;v.distance=dist;}}}, label, bubbleUntil:0,getTimer(){return dist*1000;},clock};
  };
  const makeContext=(entries)=>({CONFIG:{width:48},LABEL_LIMITS:[10.56,18.24],LABEL_HYSTERESIS:1.8,LABEL_CAP:7,MOBILE:true,player:entries.player,remotePlayers:entries.map,npcList:[],innerWidth:390,innerHeight:844,performance:{now:()=>1000},camera:{position:{distanceTo:v=>v.distance}},tempVec:{project(){this.x=this.projectX;this.y=this.projectY;this.z=this.projectZ;return this;}},fmt:n=>String(n)});

  const me1=mk(0,.1,0,2),nearA=mk(.2,0,0,6),nearB=mk(.25,0,0,9),mid=mk(.3,0,0,15),far=mk(.35,0,0,28);
  const ctx1=makeContext({player:me1,map:new Map([['a',nearA],['b',nearB],['m',mid],['f',far]])});
  vm.createContext(ctx1);vm.runInContext(excerpt,ctx1);ctx1.updateLabels();
  assert.equal(me1.label.style.display,'block');
  assert.equal(nearA.label.style.display,'block');
  assert.equal(mid.label.style.display,'block');
  assert.equal(mid.clock.textContent,'◷ 15000');
  assert.equal(far.label.style.display,'none','far labels are hidden completely');

  const me2=mk(0,.1,0,2),crowd=Array.from({length:9},(_,i)=>mk(.1+i*.01,0,0,6+i*.35));
  const ctx2=makeContext({player:me2,map:new Map(crowd.map((v,i)=>['c'+i,v]))});
  vm.createContext(ctx2);vm.runInContext(excerpt,ctx2);ctx2.updateLabels();
  const visibleOthers=crowd.filter(v=>v.label.style.display==='block');
  assert.ok(visibleOthers.length<=7,'only a nearby subset of other labels remains');
});
