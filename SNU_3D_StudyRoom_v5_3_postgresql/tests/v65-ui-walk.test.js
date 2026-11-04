import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advanceWalkState } from '../client/walk-animation.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const visible=html.slice(0,html.indexOf('<script type="module">'));

test('UI contains chat only in lower control bar; no timer/pause/stand/status elements',()=>{
 const bar=visible.match(/<section id="bottom"[\s\S]*?<\/section>/)?.[0];
 assert.ok(bar);
 assert.match(bar,/id="chatInput"/);
 assert.match(bar,/id="sendBtn"/);
 for(const id of ['timeDisplay','pauseBtn','standBtn','status'])assert.doesNotMatch(visible,new RegExp(`id="${id}"`));
 assert.doesNotMatch(bar,/오늘|일시정지|자리에서 일어나기|목적지|공부 시간/);
 assert.match(html,/\.clock'\)\.textContent='◷ '\+fmt\(obj\.getTimer\(\)\)/);
 assert.match(html,/study\.totalMs=Math\.max\(0,Number\(record\.studyMs\)\|\|0\)/);
 assert.match(html,/t:'chat',message:msg/);
});

test('camera always follows, input works, and guidance/promotional copy is not presented',()=>{
 for(const id of ['followBtn','helpBtn','hints','librarySubtitle'])assert.doesNotMatch(visible,new RegExp(`id="${id}"`));
 assert.doesNotMatch(visible,/비공식 3D|파란 카펫|붉은 커튼|정면 통창|WASD/);
 assert.doesNotMatch(html,/function followToggle\(/);
 assert.match(html,/targetFollow\.set\(player\.root\.position\.x,MOBILE\?1\.72:1\.35,player\.root\.position\.z-\(MOBILE\?3\.4:1\.3\)\)/);
 assert.match(html,/window\.addEventListener\('keydown'/);
 assert.match(html,/function keyboardMove\(dt\)/);
 assert.match(html,/function goToFloor\(p\)/);
 assert.match(html,/function goToSeat\(s\)/);
 for(const room of ['main','korea','yonsei'])assert.match(visible,new RegExp(`data-library="${room}"`));
});

test('all movement channels drive the same locomotion animation and use hinged limbs',()=>{
 assert.match(html,/player\.update\(dt,elapsed\);keyboardMove\(dt\);sendPosition\(\);updateRemoteMovement\(dt\)/);
 assert.match(html,/updateNpcVisuals\(dt\);[\s\S]*player\.animateLocomotion\(dt,elapsed\);[\s\S]*obj\.animateLocomotion\(dt,elapsed\);[\s\S]*npc\.animateLocomotion\(dt,elapsed\)/);
 assert.match(html,/this\.model\.legs\[0\]\.rotation\.x=swing/);
 assert.match(html,/this\.model\.arms\[0\]\.rotation\.x=-swing\*\.85/);
 assert.match(html,/const shoulder=new THREE\.Group\(\)/);
 assert.match(html,/const hip=new THREE\.Group\(\)/);
 assert.match(html,/if\(jumped\)obj\.resetWalkSample\(\)/);
 assert.match(html,/obj\.serverTarget=\{x:m\.x,z:m\.z,yaw:m\.yaw\}/);
 const server=readFileSync(new URL('../server/index.js',import.meta.url),'utf8');
 assert.match(server,/\['\/client\/walk-animation\.js','client\/walk-animation\.js'\]/);
});

test('a moving avatar swings both arms and legs; faster movement advances more phase',()=>{
 const slow={phase:0,blend:0},fast={phase:0,blend:0};
 for(let frame=0;frame<20;frame++){
  advanceWalkState(slow,1.4/60,1/60);
  advanceWalkState(fast,3.1/60,1/60);
 }
 assert.ok(slow.blend>.2);
 assert.ok(fast.blend>slow.blend);
 assert.ok(fast.phase>slow.phase);
 assert.equal(advanceWalkState(fast,3/60,1/60),fast,'stride state is reused to avoid frame allocations');
 assert.ok(Math.abs(advanceWalkState(fast,3/60,1/60).swing)>0);
});

test('idle and seated poses decay smoothly to neutral after walking',()=>{
 const state={phase:1.3,blend:1};
 const firstSwing=advanceWalkState(state,0,1/60).swing;
 for(let frame=0;frame<50;frame++)advanceWalkState(state,0,1/60);
 const last=advanceWalkState(state,0,1/60);
 assert.ok(Math.abs(last.swing)<Math.abs(firstSwing));
 assert.ok(Math.abs(last.swing)<.0001);
 assert.ok(last.bob<.0001);
 const seated=advanceWalkState({phase:1,blend:0},1,1/60,true);
 assert.equal(seated.swing,0);
 assert.equal(seated.speed,0);
});

test('invalid frame durations and network values cannot make animation NaN',()=>{
 const state={phase:0,blend:0};
 for(const [meters,dt] of [[NaN,-1],[Infinity,0],[.12,1/60]]){
  const {swing,bob,speed}=advanceWalkState(state,meters,dt);
  assert.ok([swing,bob,speed].every(Number.isFinite));
 }
});
