import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const markup=html.slice(0,html.indexOf('<script type="module">'));
const feedBody=html.match(/function appendChatFeed\(nick,message\)\{[\s\S]*?\n\}/)?.[0];

function mockFeed(){
 const children=[];
 const feed={children,get childElementCount(){return children.length;},get firstElementChild(){return children[0]}};
 const document={createElement(tag){
  const item={tagName:tag.toUpperCase(),textContent:'',className:'',children:[],append(...nodes){this.children.push(...nodes)},remove(){
   const i=children.indexOf(this);if(i>=0)children.splice(i,1);
  }};
  if(tag==='div')item.append=function(...nodes){this.children.push(...nodes)};
  return item;
 }};
 feed.appendChild=item=>children.push(item);
 return {feed,document,children};
}

test('received chats have a small temporary feed independently of nameplate range',()=>{
 assert.match(markup,/id="chatFeed" class="chat-feed" role="log"/);
 assert.match(markup,/#bottom \.chat-feed:empty\{display:none\}/);
 assert.match(markup,/#bottom \.chat-feed\{position:absolute/);
 assert.match(markup,/\.tag\[data-tier="mid"\] \.bubble,\.tag\[data-tier="far"\] \.bubble\{display:none!important\}/);
 assert.match(html,/case 'chat':\{[\s\S]*?appendChatFeed\(obj\?\.name\|\|'학습자',m\.message\)/);
 assert.ok(feedBody,'appendChatFeed helper exists');
});

test('feed renders untrusted chat safely, keeps only 3 newest messages and expires after 12 seconds',()=>{
 const {feed,document,children}=mockFeed(),timers=[];
 const ctx={$:selector=>selector==='#chatFeed'?feed:null,document,setTimeout:(fn,ms)=>{timers.push({fn,ms})}};
 vm.createContext(ctx);vm.runInContext(feedBody,ctx);
 ctx.appendChatFeed('<b>친구</b>','<img src=x onerror=alert(1)>');
 assert.equal(children[0].children[0].textContent,'<b>친구</b>');
 assert.equal(children[0].children[1].textContent,'<img src=x onerror=alert(1)>');
 for(let i=0;i<4;i++)ctx.appendChatFeed('친구'+i,'메시지 '+i);
 assert.equal(children.length,3,'older messages removed');
 assert.equal(children[0].children[1].textContent,'메시지 1');
 assert.equal(children[2].children[1].textContent,'메시지 3');
 assert.ok(timers.every(t=>t.ms===12000));
 for(const t of timers)t.fn();
 assert.equal(children.length,0,'feed fully clears itself');
});

test('server relays chat to same room including sender; client still imposes 40-character limit',()=>{
 const room=readFileSync(new URL('../server/room.js',import.meta.url),'utf8');
 assert.match(room,/this\.broadcast\(c\.room,\{t:'chat',id:p\.id,message:msg\}\)/);
 assert.match(room,/cleanText\(m\.message,40\)/);
 assert.match(markup,/id="chatInput" maxlength="40"/);
 assert.match(html,/appendChatFeed\(obj\?\.name\|\|'학습자',m\.message\)/);
});
