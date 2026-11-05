import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const labelScript=html.slice(html.indexOf('function labelTier(obj,d){'),html.indexOf('// Lightweight frame diagnostics'));

function makeActor({x=0,z=0,projectX=0,dist=5,until=0}={}){
 const bubble={style:{display:'none'},textContent:''};
 const clock={style:{},textContent:''};
 const label={style:{display:'none'},dataset:{},querySelector(sel){return sel==='.clock'?clock:bubble;}};
 return {root:{position:{x,z}},clock,model:{headAnchor:{getWorldPosition(v){v.worldX=x;v.worldZ=z;v.projectX=projectX;v.projectY=0;v.projectZ=0;v.distance=dist;}}},label,bubble,bubbleUntil:until,getTimer(){return 123000;}};
}
function run(actors,{now=1000,cap=7,range=10.56}={}){
 const context={CONFIG:{width:48},LABEL_LIMITS:[10.56,18.24],LABEL_HYSTERESIS:1.8,LABEL_CAP:cap,CHAT_RANGE:range,
  MOBILE:true,player:actors[0],remotePlayers:new Map(actors.slice(1).map((a,i)=>['c'+i,a])),npcList:[],
  innerWidth:390,innerHeight:844,performance:{now:()=>now},camera:{position:{distanceTo:v=>v.distance}},
  tempVec:{project(){this.x=this.projectX;this.y=this.projectY;this.z=this.projectZ;return this;}},fmt:n=>String(n)};
 vm.createContext(context);vm.runInContext(labelScript,context);context.updateLabels();
 return context;
}

test('speaker chat appears above their nameplate only when physically near and on screen',()=>{
 const self=makeActor(),close=makeActor({x:3,z:4,dist:50,until:6000}),distant=makeActor({x:20,z:0,dist:8,until:6000});
 run([self,close,distant]);
 assert.equal(close.label.style.display,'block','nearby speaker is shown even when camera classifies them far');
 assert.equal(close.bubble.style.display,'block','nearby chat bubble is visible');
 assert.equal(close.label.dataset.tier,'far','camera tier does not determine chat proximity');
 assert.equal(close.clock.textContent,'◷ 123000','time remains visible');
 assert.equal(distant.bubble.style.display,'none','distant speaker chat is not displayed');
});

test('speaking people have priority over nearby idle NPC nameplates when cap is reached',()=>{
 const self=makeActor(),npc=Array.from({length:8},(_,i)=>makeActor({x:1+i*.4,dist:4+i}));
 const speaker=makeActor({x:5,z:1,dist:30,until:6000});
 run([self,...npc,speaker]);
 assert.equal(speaker.label.style.display,'block');
 assert.equal(speaker.bubble.style.display,'block');
 assert.ok(npc.filter(n=>n.label.style.display==='block').length<=6);
});

test('bubble follows the speaker, disappears when they walk away, and expires after five seconds',()=>{
 const self=makeActor(),friend=makeActor({x:2,z:0,dist:8,until:6000});
 let ctx=run([self,friend]);
 assert.equal(friend.bubble.style.display,'block');
 const xBefore=friend.label.style.left;
 friend.root.position.x=4;
 friend.model.headAnchor.getWorldPosition=v=>{v.projectX=.4;v.projectY=0;v.projectZ=0;v.distance=9;};
 ctx.updateLabels();
 assert.notEqual(friend.label.style.left,xBefore,'nameplate and chat follow the head projection');
 friend.root.position.x=20;ctx.updateLabels();
 assert.equal(friend.bubble.style.display,'none','chat hides when speaker leaves nearby range');
 friend.root.position.x=2;ctx=run([self,friend],{now:6001});
 assert.equal(friend.bubble.style.display,'none','chat expires after its time limit');
});

test('chat event is bound to an actual speaker and is never added to a bottom feed',()=>{
 assert.match(html,/case 'chat':\{\s*const obj=m\.id===selfId\?player:remotePlayers\.get\(m\.id\);\s*if\(obj\)obj\.say\(m\.message\);/);
 assert.doesNotMatch(html,/appendChatFeed|id="chatFeed"/);
 assert.match(html,/bubble\.textContent=String\(message\)\.slice\(0,40\)/);
});
