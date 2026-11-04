import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkClient } from '../client/network.js';

test('browser guest auth displays HTTP status and server reason instead of hiding it',async()=>{
  const originalFetch=globalThis.fetch, originalStorage=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>'',setItem:()=>{}};
  globalThis.fetch=async()=>new Response(JSON.stringify({error:'Wrong origin'}),{status:403,headers:{'Content-Type':'application/json'}});
  const messages=[];
  const net=new NetworkClient({room:'main',profile:()=>({}),onEvent:()=>{},onStatus:m=>messages.push(m)});
  try{await net.start(); assert.ok(messages.some(m=>m.includes('HTTP 403')&&m.includes('Wrong origin')));}
  finally{net.stop();globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;}
});

test('browser guest auth shows a clear message if Codespaces proxy returns HTML',async()=>{
  const originalFetch=globalThis.fetch, originalStorage=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>'',setItem:()=>{}};
  globalThis.fetch=async()=>new Response('<html>sign in</html>',{status:200,headers:{'Content-Type':'text/html'}});
  const messages=[];
  const net=new NetworkClient({room:'main',profile:()=>({}),onEvent:()=>{},onStatus:m=>messages.push(m)});
  try{await net.start();assert.ok(messages.some(m=>m.includes('JSON')&&m.includes('Codespaces')));}
  finally{net.stop();globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;}
});
