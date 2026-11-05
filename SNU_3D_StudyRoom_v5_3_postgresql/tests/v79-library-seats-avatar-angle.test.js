import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {librarySeatTotals} from '../server/library-seats.js';
import {buildSeatsAndObstacles,isWalkable} from '../server/room.js';
import {virtualPresent} from '../server/virtual-learners.js';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const server=readFileSync(new URL('../server/index.js',import.meta.url),'utf8');
const markup=html.slice(0,html.indexOf('<script type="module">'));

test('library choice reports school-wide learners / physical seats, with a 48 seat baseline',()=>{
 assert.deepEqual(librarySeatTotals('main',new Map(),5),{learners:5,seats:48});
 assert.deepEqual(librarySeatTotals('main',new Map([['main',20]]),10),{learners:30,seats:48});
 assert.deepEqual(librarySeatTotals('korea',new Map([['korea',26],['korea-2',12]]),8),{learners:46,seats:96});
 assert.deepEqual(librarySeatTotals('yonsei',new Map([['yonsei',30],['yonsei-2',20],['yonsei-3',10],['main',32]]),16),{learners:76,seats:144});
 assert.deepEqual(librarySeatTotals('korea',new Map([['korea',1],['korea-2',0],['korea-3',2]]),3),{learners:6,seats:96});
});

test('server computes virtual activity with real presence and exposes only total learner count in chooser fields',()=>{
 assert.match(server,/librarySeatTotals\(library,counts,virtualPresent\(library,Date\.now\(\)\)\.length\)/);
 assert.match(server,/data\[library\]=\{\.\.\.totals,users:/);
 for(const library of ['main','korea','yonsei']){
  const count=virtualPresent(library,Date.now()).length;
  assert.ok(count>=0&&count<=16);
 }
});

test('chooser refreshes real counts on open and periodically, without inventing counts on failure',()=>{
 for(const library of ['main','korea','yonsei']){
  assert.match(markup,new RegExp(`data-library="${library}"[^>]*><strong>[^<]+</strong><small class="library-seat-count"`));
 }
 assert.match(html,/fetch\('\/api\/rooms\/status',\{cache:'no-store'\}\)/);
 assert.match(html,/status\.textContent=`\$\{Math\.max\(0,Math\.floor\(data\.learners\)\)\}명\/\$\{Math\.max\(48,Math\.floor\(data\.seats\)\)\}석`/);
 assert.match(html,/status\.textContent='인원 확인 불가'/);
 assert.match(html,/setInterval\(\(\)=>\{if\(!chooser\.hidden\)void refreshLibrarySeatCounts\(\);\},15000\)/);
});

test('character chooser can close without saving and keeps initial visitor from joining without a profile',()=>{
 assert.match(markup,/id="avatarClose" title="캐릭터 선택 닫기" aria-label="캐릭터 선택 닫기"/);
 assert.match(html,/function closeAvatarModal\(\)/);
 assert.match(html,/\$\('#avatarClose'\)\.addEventListener\('click',closeAvatarModal\)/);
 assert.match(html,/if\(!profileComplete\)toast\('/);
 assert.match(html,/if\(!profileComplete\)showModal\(\)/);
 assert.match(html,/if\(profileComplete\)net\.start\(\)/);
});

test('Google account sheet omits virtual learner notice but welcome room disclosure remains',()=>{
 const account=markup.slice(markup.indexOf('id="accountOverlay"'),markup.indexOf('id="bottom"'));
 assert.doesNotMatch(account,/가상 학습자/);
 assert.match(markup,/도서관에는 가상 학습자가 함께 참여할 수 있습니다/);
});

test('SNU four supports make approximately 45° from floor, and collision matches the feet',()=>{
 assert.match(html,/const x=side\*17\.6, gap=\.92, spread=gap\+\(H-\.88\)/);
 const rise=16.2-.63-.25,horizontal=(.92+(16.2-.88))-.92;
 const degree=Math.atan2(rise,horizontal)*180/Math.PI;
 assert.ok(Math.abs(degree-45)<.1,`angle ${degree}`);
 const obstacles=buildSeatsAndObstacles().obstacles;
 const foot=obstacles.filter(o=>Math.abs(o.x)===17.6&&o.w===1.8&&o.d===1.65);
 assert.equal(foot.length,8);
 for(const z of [-18,20])for(const side of [-1,1])for(const dir of [-1,1]){
  const x=side*17.6,footZ=z+dir*(.92+(16.2-.88));
  assert.ok(foot.some(o=>o.x===x&&o.z===footZ));
  assert.equal(isWalkable(x,footZ,'main'),false);
 }
});
