import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const markup=html.slice(0,html.indexOf('<script type="module">'));

test('V7.11 removes the detached lower-screen chat feed entirely',()=>{
 assert.doesNotMatch(markup,/id="chatFeed"|\.chat-feed/);
 assert.doesNotMatch(html,/appendChatFeed/);
 assert.match(markup,/<section id="bottom"[^>]*><div class="controls">/);
});

test('chat bubble is immediately above speaker name and study time inside their projected label',()=>{
 assert.match(html,/this\.label\.innerHTML='<div class="bubble"><\/div><div class="plate"><div class="name"><\/div><div class="clock"><\/div><\/div>'/);
 assert.match(html,/say\(message\)\{const bubble=this\.label\.querySelector\('\.bubble'\);bubble\.textContent=String\(message\)\.slice\(0,40\)/);
 assert.match(html,/case 'chat':\{[\s\S]*?if\(obj\)obj\.say\(m\.message\)/);
 assert.doesNotMatch(markup,/\.tag\[data-tier="mid"\] \.bubble,\.tag\[data-tier="far"\] \.bubble\{display:none!important\}/);
});

test('server continues broadcasting room-local chat including sender with 40-character limit',()=>{
 const room=readFileSync(new URL('../server/room.js',import.meta.url),'utf8');
 assert.match(room,/this\.broadcast\(c\.room,\{t:'chat',id:p\.id,message:msg\}\)/);
 assert.match(room,/cleanText\(m\.message,40\)/);
 assert.match(markup,/id="chatInput" maxlength="40"/);
});
