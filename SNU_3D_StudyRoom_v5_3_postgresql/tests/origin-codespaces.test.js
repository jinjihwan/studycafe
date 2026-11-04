import {test} from 'node:test';
import assert from 'node:assert/strict';
import {originDecision} from '../server/origin.js';

const publicOrigin='https://example-3000.app.github.dev';
const allowed=new Set([publicOrigin]);
const request=(origin, {host='localhost:3000', fwd='example-3000.app.github.dev', ip='127.0.0.1', proto='https'}={}) => ({
  headers:{origin,host,'x-forwarded-host':fwd,'x-forwarded-proto':proto},
  socket:{remoteAddress:ip}
});

test('Codespaces local hop accepts only exact forwarded public domain',()=>{
  const verdict=originDecision(request('https://localhost:3000'), allowed);
  assert.deepEqual(verdict,{ok:true,reason:'trusted Codespaces local proxy'});
  assert.equal(originDecision(request(publicOrigin), allowed).ok,true);
});

test('rejects forged Origin and forwarded-domain variations',()=>{
  const cases=[
    request('https://evil.example'),
    request('https://localhost:3000',{fwd:'evil.example'}),
    request('https://localhost:3000',{fwd:'example-3000.app.github.dev.evil.example'}),
    request('https://localhost:3000',{fwd:null}),
    request('https://localhost:3000',{host:'evil.example'}),
    request('https://localhost:3001'),
    request('http://localhost:3000'),
    request('https://localhost:3000',{ip:'192.0.2.50'}),
    request('https://localhost:3000',{proto:'http'}),
    request('https://localhost:3000',{fwd:'example-3000.app.github.dev,evil.example'}),
    request('null'),
  ];
  for(const c of cases)assert.equal(originDecision(c, allowed).ok,false,JSON.stringify(c.headers));
});

test('preserves original local and no-Origin compatibility',()=>{
  const noPublic=new Set();
  assert.equal(originDecision(request('http://localhost:3000'),noPublic).ok,true);
  assert.equal(originDecision(request('http://evil.example'),noPublic).ok,false);
  assert.equal(originDecision(request(null),allowed).ok,true);
});
