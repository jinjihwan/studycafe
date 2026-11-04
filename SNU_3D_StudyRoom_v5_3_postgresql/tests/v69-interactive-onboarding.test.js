import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const markup=html.slice(0,html.indexOf('<script type="module">'));
const script=html.slice(html.indexOf('const tutorialSteps=['),html.indexOf('// ─────────────────────────────────────────────────────────────────────────────\n// 2. Three renderer'));

function harness(initialStorage={}){
 const nodes=new Map();
 function node(id){
  if(!nodes.has(id))nodes.set(id,{id,hidden:id!=='#tutorialOverlay'&&id!=='#librarySelect'&&id!=='#accountOverlay'?false:true,
   textContent:'',className:'',style:{},dataset:{},classList:{values:new Set(),add(x){this.values.add(x)},remove(x){this.values.delete(x)},contains(x){return this.values.has(x)}},
   append(){},replaceChildren(){},querySelector(){return null}});
  return nodes.get(id);
 }
 for(const id of ['#tutorialOverlay','#tutorialStepCount','#tutorialTitle','#tutorialBody','#tutorialHint','#tutorialBars','#tutorialSkipStep','#modal','#librarySelect','#accountOverlay'])node(id);
 node('#tutorialOverlay').hidden=true;node('#librarySelect').hidden=true;node('#accountOverlay').hidden=true;
 const listeners={};
 const canvas={addEventListener(type,handler){(listeners[type]??=[]).push(handler)}};
 const storage=new Map(Object.entries(initialStorage));
 const localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
 const sessionStorage={getItem:k=>storage.get('session:'+k)??null,setItem:(k,v)=>storage.set('session:'+k,v),removeItem:k=>storage.delete('session:'+k)};
 const context={D:{canvas,modal:node('#modal')},profileComplete:true,prefs:{nick:'A',species:'rabbit',gender:'female',hood:'#f39bc4'},BASE_LIBRARY:'main',TUTORIAL_STORAGE:'snu-v69-tutorial-complete',TUTORIAL_RESUME_KEY:'snu-v69-tutorial-library-switch',query:new URLSearchParams(),localStorage,sessionStorage,
  location:{href:'https://example.org/?room=main'},history:{replaceState(){}},
  $:node,document:{querySelector:node,querySelectorAll(){return []},createElement(){return {className:''}},body:null},
  window:{},URL,URLSearchParams};
 const body={classList:{add(){},remove(){}}};context.document.body=body;
 vm.createContext(context);vm.runInContext(script,context);
 return {ctx:context,nodes,listeners,storage};
}

test('action-only tutorial: no next button, real interaction hooks are wired',()=>{
 assert.match(markup,/id="tutorialSkipStep"/);assert.match(markup,/id="tutorialEnd"/);
 assert.doesNotMatch(markup,/id="tutorialNext"/);
 assert.match(html,/rememberTutorialRoomSwitch\(room\)/);
 assert.match(html,/player\.go\(target,\(\)=>tutorialAction\('floor-arrived'\)\)/);
 assert.match(html,/tutorialAction\('study-started'\)/);
 assert.match(html,/tutorialAction\('chat-sent'\)/);
 assert.match(html,/tutorialAction\('invite-opened'\)/);
 assert.match(html,/tutorialAction\('account-opened'\)/);
 assert.match(html,/tutorialAction\('avatar-changed'\)/);
 assert.match(html,/!tutorialSeen\)setTimeout\(openTutorial,420\)/);
});

test('camera stage requires both distinct real gestures; unrelated actions do not advance',()=>{
 const h=harness(),ctx=h.ctx;
 ctx.openTutorial();assert.equal(ctx.tutorialIndex,undefined,'lexical state is not exposed on global');
 assert.equal(h.nodes.get('#tutorialStepCount').textContent,'1 / 8');
 ctx.tutorialAction('chat-sent');assert.equal(h.nodes.get('#tutorialStepCount').textContent,'1 / 8');
 for(const fn of h.listeners.pointerdown)fn({pointerId:1,clientX:110,clientY:180});
 for(const fn of h.listeners.pointermove)fn({pointerId:1,clientX:150,clientY:180});
 assert.equal(h.nodes.get('#tutorialStepCount').textContent,'1 / 8');
 assert.match(h.nodes.get('#tutorialHint').textContent,/✓ 화면 드래그/);
 for(const fn of h.listeners.pointerup)fn({pointerId:1});
 for(const fn of h.listeners.wheel)fn({deltaY:150});
 assert.equal(h.nodes.get('#tutorialStepCount').textContent,'2 / 8');
 ctx.tutorialAction('chat-sent');assert.equal(h.nodes.get('#tutorialStepCount').textContent,'2 / 8');
 ctx.rememberTutorialRoomSwitch('korea');
 assert.match(h.storage.get('session:snu-v69-tutorial-library-switch'),/"nextIndex":2/);
 ctx.nextTutorialStep();assert.equal(h.nodes.get('#tutorialStepCount').textContent,'3 / 8');
 ctx.tutorialAction('avatar-changed');assert.equal(h.nodes.get('#tutorialStepCount').textContent,'4 / 8');
 ctx.tutorialAction('floor-arrived');assert.equal(h.nodes.get('#tutorialStepCount').textContent,'5 / 8');
 ctx.tutorialAction('study-started');assert.equal(h.nodes.get('#tutorialStepCount').textContent,'5 / 8','study only completes after request flag');
 vm.runInContext('tutorialSeatRequested=true',ctx);
 ctx.tutorialAction('study-started');assert.equal(h.nodes.get('#tutorialStepCount').textContent,'6 / 8');
 ctx.tutorialAction('chat-sent');assert.equal(h.nodes.get('#tutorialStepCount').textContent,'7 / 8');
 ctx.tutorialAction('invite-opened');assert.equal(h.nodes.get('#tutorialStepCount').textContent,'8 / 8');
 assert.equal(h.storage.get('snu-v69-tutorial-complete'),undefined);
 ctx.tutorialAction('account-opened');assert.equal(h.storage.get('snu-v69-tutorial-complete'),'1');
});


test('room navigation resumes at character selection even when older tutorial was marked complete',()=>{
 const h=harness({'snu-v68-tutorial-seen':'1','session:snu-v69-tutorial-library-switch':JSON.stringify({library:'main',nextIndex:2})});
 h.ctx.openTutorial();
 assert.equal(h.nodes.get('#tutorialStepCount').textContent,'3 / 8');
 assert.equal(h.storage.has('session:snu-v69-tutorial-library-switch'),false);
});
test('mobile coach card passes touches to game canvas and real buttons',()=>{
 assert.match(markup,/#tutorialOverlay\{[^}]*pointer-events:none/);
 assert.match(markup,/#tutorialOverlay \.dialog\{pointer-events:auto/);
 assert.doesNotMatch(markup,/body\.tutorial-open #topbar,body\.tutorial-open #bottom[^\n]*pointer-events:none/);
 assert.match(html,/if\(tutorialActive&&tutorialIndex===4\)tutorialSeatRequested=true/);
 assert.match(html,/if\(player\.seated&&study\.running&&!study\.paused&&net\?\.connected\)tutorialAction\('study-started'\)/);
});
