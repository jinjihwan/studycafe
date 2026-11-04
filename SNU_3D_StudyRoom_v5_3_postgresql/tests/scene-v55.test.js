import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSeatsAndObstacles,isWalkable} from '../server/room.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const friends=readFileSync(new URL('../client/friends.js',import.meta.url),'utf8');
const seats=buildSeatsAndObstacles().seats;
test('48 authoritative seats remain eight 6-chair tables with clear central path',()=>{
 assert.equal(seats.length,48);
 assert.equal(new Set(seats.map(s=>`${Math.sign(s.x)}:${Math.round((s.z+27)/17.4)}`)).size,8);
 for(const z of [-27,-9.6,7.8,25.2,35])assert.equal(isWalkable(0,z),true);
 assert.equal(isWalkable(24,0),false);
});
test('Seoul triangular supports rotated into depth, tips separated and no visible apex',()=>{
 assert.match(html,/const x=side\*17\.6, gap=\.92, spread=4\.60/);
 assert.match(html,/const footZ=z\+dir\*spread, tipZ=z\+dir\*gap/);
 assert.match(html,/batch\.segment\('steel',\[x,\.25,footZ\],\[x,H-\.63,tipZ\],\.91\)/);
 assert.doesNotMatch(html,/const innerX=side\*13\.0, outerX=side\*22\.2, apexX=side\*17\.6/);
});
test('floor and chair taps emit exact location ripples; chair marker not behind chair',()=>{
 assert.match(html,/function showTapRipple\(x,z,chair=false\)/);
 assert.match(html,/showTapRipple\(s\.x,s\.z,true\)/);
 assert.match(html,/showTapRipple\(floorHits\[0\]\.point\.x,floorHits\[0\]\.point\.z\)/);
 assert.match(html,/ring\.position\.set\(s\.x,\.805,s\.z\)/);
 assert.match(html,/updateTapRipples\(dt\)/);
});
test('newcomers see avatar modal and directly enter as guests, not auth chooser',()=>{
 assert.match(html,/let profileComplete=!!saved\.nick&&saved\.profileComplete!==false/);
 assert.match(html,/if\(!profileComplete\)showModal\(\)/);
 assert.match(html,/if\(profileComplete\)net\.start\(\)/);
 assert.match(html,/welcome\.hidden=true;/);
 assert.match(html,/JSON\.stringify\(\{\.\.\.prefs,profileComplete\}\)/);
 assert.match(html,/profileComplete=true;player\.setAppearance/);
 assert.doesNotMatch(html,/id="guestEnter"/);
 assert.doesNotMatch(html,/if\(!localStorage\.getItem\('snu-v5-intro-seen'\)/);
});
test('guest friend and friend ranking panels provide interactive Google button',()=>{
 assert.match(friends,/showGoogleLoginPrompt\('친구'\)/);
 assert.match(friends,/showGoogleLoginPrompt\('친구 랭킹'\)/);
 assert.match(friends,/Google 로그인하고 친구 기능 사용/);
 assert.match(friends,/await account\.login\(\)/);
});
