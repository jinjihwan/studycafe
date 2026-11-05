import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {VIRTUAL_CAMPUSES,VIRTUAL_POPULATION,virtualProfile} from '../server/virtual-learners.js';
const dashboard=readFileSync(new URL('../client/dashboard.js',import.meta.url),'utf8');

// Ranking only displays rank, nickname and verified study duration.
test('ranking contains no animal, hood, HEX, or emoji avatar in each entry',()=>{
  const ranking=dashboard.slice(dashboard.indexOf('function drawRanking(data){'),dashboard.indexOf('// The server updates the live timer'));
  assert.match(ranking,/const name=el\('div','dash-rank-name'\);name\.append\(el\('strong','',r\.nick\+/);
  assert.match(ranking,/item\.append\(number,name,el\('strong','dash-rank-time',dur\(r\.ms\)\)\)/);
  assert.doesNotMatch(ranking,/r\.species|r\.hood|dash-avatar|speciesIcon|el\('small'/);
  assert.doesNotMatch(dashboard,/speciesIcon/);
  assert.match(dashboard,/heading\('오늘의 공부 랭킹'/);
});

test('ranking display simplification does not change 144 NPC identities or colors in 3D',()=>{
 const profiles=VIRTUAL_CAMPUSES.flatMap(campus=>Array.from({length:VIRTUAL_POPULATION},(_,id)=>virtualProfile(campus,id)));
 assert.equal(profiles.length,144);
 assert.equal(new Set(profiles.map(p=>p.virtualId)).size,profiles.length);
 assert.equal(new Set(profiles.map(p=>p.nick)).size,profiles.length);
 assert.ok(profiles.every(p=>typeof p.hood==='string'&&p.hood.startsWith('#')));
});
