import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {visibleSegment,smoothWaypoints} from '../client/navigation-smooth.js';
import {buildSeatsAndObstacles,isWalkable} from '../server/room.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const server=readFileSync(new URL('../server/room.js',import.meta.url),'utf8');
const serverIndex=readFileSync(new URL('../server/index.js',import.meta.url),'utf8');
const walkable=(x,z)=>x>=0&&x<=20&&z>=0&&z<=20&&!(x>7&&x<11&&z>7&&z<13);

test('camera starts near avatar, follow target aligned, and HTML supports closing login',()=>{
 assert.match(html,/camera\.position\.set\(4\.2,6\.0,42\.2\)/);
 assert.match(html,/orbit\.target\.set\(0,1\.45,33\.7\)/);
 assert.match(html,/id="accountClose"/);
 assert.match(html,/\$\('#accountClose'\)\.onclick=closeAccountOverlay/);
 assert.match(html,/keydown.*Escape.*welcome\.hidden/s);
 assert.match(serverIndex,/\['\/client\/navigation-smooth\.js','client\/navigation-smooth\.js'\]/);
 assert.match(html,/camera\.position\.z=clamp\(camera\.position\.z,CONFIG\.frontZ\+2\.7,CONFIG\.rearZ-1\.7\)/);
});
test('ceiling, glazing, diagonal X support and exact 8 tables with 48 seats',()=>{
 assert.match(html,/height:18\.6, frontZ:-43, rearZ:55/);
 assert.match(html,/const rz=CONFIG\.rearZ;/);
 assert.match(html,/new THREE\.PlaneGeometry\(4\.0,H-1\.4\)/);
 assert.match(html,/for\(let row=0;row<CONFIG\.rows;row\+\+\)/);
 const layout=buildSeatsAndObstacles();
 assert.equal(layout.seats.length,48);
 assert.equal(layout.npcSeats.size,8);
 assert.equal(new Set(layout.seats.map(s=>`${Math.sign(s.x)}:${Math.round((s.z+30)/19.4)}`)).size,8);
 assert.ok(layout.seats.every(s=>Math.abs(s.x)<11 && Math.abs(s.x)>5));
 assert.match(html,/rows:4, columnsPerSide:1/);
 assert.match(html,/for\(const dx of \[-1\.68,0,1\.68\]\)addChair/);
 assert.match(html,/batch\.segment\('steel',\[innerX,\.25,z\],\[outerX,H-\.5,z\],1\.02\)/);
 assert.match(html,/npcCount:8/);
});
test('server and client enforce matching front/rear walk bounds',()=>{
 assert.match(server,/pz< -37\.5\|\|pz>49/);
 assert.equal(isWalkable(0,-38.1),false);
 assert.equal(isWalkable(0,-36.5),true);
 assert.equal(isWalkable(0,48),true);
 assert.equal(isWalkable(0,50),false);
 assert.match(html,/frontWalkLimit:-37\.5, rearWalkLimit:49/);
 assert.match(html,/const target=\{x:clamp\(p\.x,-24\.8,24\.8\),z:clamp\(p\.z,CONFIG\.frontWalkLimit\+\.22,CONFIG\.rearWalkLimit-\.2\)\}/);
});
test('open floor uses a direct short waypoint and no right-angle detour',()=>{
 const raw=[{x:2,z:1},{x:4,z:2},{x:6,z:4}];
 assert.deepEqual(smoothWaypoints({x:1,z:1},raw,walkable),[{x:6,z:4}]);
});
test('obstacle rejects shortcut and preserves intermediate turns',()=>{
 const start={x:4,z:10},end={x:16,z:10};
 assert.equal(visibleSegment(start,end,walkable),false);
 const route=[{x:4,z:5},{x:14,z:5},{x:16,z:10}];
 const smooth=smoothWaypoints(start,route,walkable);
 assert.ok(smooth.length>=2);
 let prev=start;
 for(const p of smooth){assert.equal(visibleSegment(prev,p,walkable),true);prev=p;}
 assert.deepEqual(smooth.at(-1),end);
});
test('navigation does not allow shortcuts through diagonal obstacle corners',()=>{
 assert.equal(visibleSegment({x:6,z:6},{x:12,z:14},walkable),false);
 assert.equal(visibleSegment({x:1,z:1},{x:4,z:4},walkable),true);
});


test('eight six-seat tables stay aligned between browser and server; central aisle stays clear',()=>{
 const layout=buildSeatsAndObstacles();
 const ids=layout.seats.map(s=>s.id);
 assert.deepEqual(ids,Array.from({length:48},(_,i)=>i));
 for(const side of [-1,1])for(let row=0;row<4;row++){
   const z=-30+row*19.4;
   const tableSeats=layout.seats.filter(s=>Math.sign(s.x)===side && Math.abs(s.z-z)<3);
   assert.equal(tableSeats.length,6,`side=${side}, row=${row}`);
 }
 assert.equal(layout.npcSeats.size,8);
 assert.ok(!layout.npcSeats.has(0));
 for(const z of [-30,-10.6,8.8,28.2,35])assert.equal(isWalkable(0,z),true);
 for(const z of [-29,-7,15,37])assert.equal(isWalkable(14,z),false);
});
