import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isOperatorAccount,createOperatorAPI} from '../server/operator-access.js';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const server=readFileSync(new URL('../server/index.js',import.meta.url),'utf8');
const markup=html.slice(0,html.indexOf('<script type="module">'));

function operatorFixture({session,profile,origin=true,permit=true,code='ST-AAAABBBBCC'}={}){
 let lookup=0;
 const replies=[];
 const route=createOperatorAPI({
  accounts:{async account(id){lookup++;return profile?.id===id?profile:null;}},
  accountContext:async()=>session,
  json:(res,status,value)=>{replies.push({status,value});},
  sameOrigin:()=>origin,
  permit:()=>permit,
  configuredCode:code
 });
 async function call({method='GET',path='/api/operator/access'}={}){
  replies.length=0;
  const handled=await route({method}, {},path);
  return {handled,reply:replies[0],lookups:lookup};
 }
 return {call};
}

test('operator access is opt-in and bound to the Google account session, never to a query string',async()=>{
 assert.equal(isOperatorAccount({code:'ST-AAAABBBBCC'},undefined),false);
 assert.equal(isOperatorAccount({code:'ST-AAAABBBBCC'},'invalid'),false);
 assert.equal(isOperatorAccount(null,'ST-AAAABBBBCC'),false);
 assert.equal(isOperatorAccount({code:'ST-AAAABBBBCC'},' st-aaaabbbbcc '),true);
 assert.equal(isOperatorAccount({code:'ST-0000000000'},'ST-AAAABBBBCC'),false);
 const owner={id:'owner',code:'ST-AAAABBBBCC'};
 const anonymous=operatorFixture({session:null,profile:owner});
 assert.equal((await anonymous.call()).reply.status,401);
 const wrong=operatorFixture({session:{id:'attacker'},profile:owner});
 assert.equal((await wrong.call()).reply.status,403);
 const wrongCode=operatorFixture({session:{id:'owner'},profile:owner,code:''});
 assert.equal((await wrongCode.call()).reply.status,403);
 const own=operatorFixture({session:{id:'owner'},profile:owner});
 assert.deepEqual((await own.call()).reply,{status:200,value:{authorized:true}});
 assert.equal((await own.call({path:'/api/auth/me'})).handled,false);
});

test('operator route protects against non-GET, cross-origin and rate-limited callers',async()=>{
 const owner={id:'owner',code:'ST-AAAABBBBCC'};
 assert.equal((await operatorFixture({session:{id:'owner'},profile:owner}).call({method:'POST'})).reply.status,405);
 assert.equal((await operatorFixture({session:{id:'owner'},profile:owner,origin:false}).call()).reply.status,403);
 assert.equal((await operatorFixture({session:{id:'owner'},profile:owner,permit:false}).call()).reply.status,429);
 assert.match(server,/if\(await operatorAPI\(req,res,pathname\)\)return/);
 assert.match(server,/configuredCode:process\.env\.STUDYROOM_OPERATOR_FRIEND_CODE/);
});

test('public heading shows one combined participant count and operator details remain hidden by default',()=>{
 assert.match(markup,/id="onlineCount"[^>]*>.*?학습자 0명/s);
 assert.doesNotMatch(markup,/id="onlineCount"[^>]*>[^<]*가상\s*\d+명/);
 assert.match(markup,/id="operatorPresence" hidden/);
 assert.match(markup,/실제 접속 이용자 수와는 다릅니다/);
 assert.match(html,/credentials:'same-origin',cache:'no-store'/);
 const excerpt=html.slice(html.indexOf('let lastRealCount=0,lastVirtualCount=0;'),html.indexOf('// The server sends the canonical NPC positions'));
 const fields={};for(const name of ['#onlineCount','#operatorPresence','#operatorPresenceCount'])fields[name]={innerHTML:'',textContent:'',hidden:true};
 let renderCalled=0;
 const context={$:sel=>fields[sel],renderOperatorPresence:()=>{renderCalled++}};
 vm.createContext(context);vm.runInContext(excerpt,context);
 context.updatePlayerCount(2,5);
 assert.match(fields['#onlineCount'].innerHTML,/학습자 7명/);
 assert.doesNotMatch(fields['#onlineCount'].innerHTML,/접속 2명|가상 5명/);
 context.updatePlayerCount(3);
 assert.match(fields['#onlineCount'].innerHTML,/학습자 8명/);
 context.updatePlayerCount(0,0);
 assert.match(fields['#onlineCount'].innerHTML,/학습자 0명/);
 assert.equal(renderCalled,3);
});

test('operator split is presented only after a successful server authorization',()=>{
 const excerpt=html.slice(html.indexOf('function renderOperatorPresence(){'),html.indexOf("$('#accountClose').onclick"));
 assert.match(excerpt,/res=await fetch\('\/api\/operator\/access'/);
 assert.match(excerpt,/if\(!res\.ok\|\|account\.account\?\.id!==expectedId\|\|welcome\.hidden\)return/);
 assert.match(excerpt,/panel\.hidden=false;renderOperatorPresence\(\)/);
 assert.match(excerpt,/`실제 \$\{lastRealCount\}명 · 가상 \$\{lastVirtualCount\}명 · 합계/);
});
