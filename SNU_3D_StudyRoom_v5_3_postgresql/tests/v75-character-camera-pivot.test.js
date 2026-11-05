import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.match(/function setAvatarCameraPivot\(target,root\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(source,'Avatar-centered camera pivot helper must exist');
const context={CAMERA_PIVOT_HEIGHT:1.25};
vm.createContext(context);
vm.runInContext(source,context);
const target=()=>({x:null,y:null,z:null,set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}});

test('camera initially targets avatar torso instead of a point forward of spawn',()=>{
 assert.match(html,/const CAMERA_PIVOT_HEIGHT=1\.25/);
 assert.match(html,/orbit\.target\.set\(0,CAMERA_PIVOT_HEIGHT,35\)/);
 assert.match(html,/player=new Character\(\{name:prefs\.nick,species:prefs\.species,hood:prefs\.hood,x:0,z:35\}\)/);
 assert.doesNotMatch(html,/player\.root\.position\.z-\(MOBILE\?/);
});

test('standing and seated follow pivots stay at the actual avatar torso center',()=>{
 const standing=target();
 context.setAvatarCameraPivot(standing,{position:{x:3,y:0,z:12},scale:{y:1}});
 assert.deepEqual([standing.x,standing.y,standing.z],[3,1.25,12]);
 const seated=target();
 context.setAvatarCameraPivot(seated,{position:{x:-6,y:.39,z:-8},scale:{y:.83}});
 assert.ok(Math.abs(seated.y-1.4275)<1e-9);
 assert.equal(seated.x,-6);assert.equal(seated.z,-8);
});

test('follow translates camera exactly with orbit target, maintaining angle and zoom',()=>{
 assert.match(html,/setAvatarCameraPivot\(targetFollow,player\.root\);\s*offsetFollow\.subVectors\(targetFollow,orbit\.target\);\s*orbit\.target\.copy\(targetFollow\);camera\.position\.add\(offsetFollow\);\s*orbit\.update\(\);/);
 assert.doesNotMatch(html,/offsetFollow\.subVectors\(targetFollow,orbit\.target\)\.multiplyScalar/);
 const orbitStart={x:0,y:1.25,z:35},camStart={x:3.2,y:7.13,z:47.0},follow={x:10,y:1.25,z:10};
 const delta={x:follow.x-orbitStart.x,y:follow.y-orbitStart.y,z:follow.z-orbitStart.z};
 const newCamera={x:camStart.x+delta.x,y:camStart.y+delta.y,z:camStart.z+delta.z};
 for(const [got,want] of [[newCamera.x-follow.x,3.2],[newCamera.y-follow.y,5.88],[newCamera.z-follow.z,12]])
  assert.ok(Math.abs(got-want)<1e-9);
});

test('starting positions preserve mobile/desktop camera distances and stay within room bounds',()=>{
 assert.match(html,/camera\.position\.set\(MOBILE\?3\.2:4\.2,MOBILE\?7\.13:5\.80,MOBILE\?47\.0:43\.5\)/);
 const mobile=Math.hypot(3.2,7.13-1.25,47.0-35);
 const desktop=Math.hypot(4.2,5.80-1.25,43.5-35);
 assert.ok(mobile>13&&mobile<15);
 assert.ok(desktop>10&&desktop<12);
 assert.ok(47.0<49-1.7);
 assert.match(html,/orbit\.minDistance=2\.7;orbit\.maxDistance=42/);
});
