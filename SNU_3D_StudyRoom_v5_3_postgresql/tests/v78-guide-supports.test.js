import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildSeatsAndObstacles,isWalkable} from '../server/room.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const html=readFileSync(path.join(root,'index.html'),'utf8');
const dashboard=readFileSync(path.join(root,'client/dashboard.js'),'utf8');
const serverIndex=readFileSync(path.join(root,'server/index.js'),'utf8');
const markup=html.slice(0,html.indexOf('<script type="module">'));

test('guide button, image, close action, backdrop and keyboard dismissal are present',()=>{
 assert.match(markup,/id="inviteBtn"[\s\S]*?id="guideBtn"[\s\S]*?id="accountBtn"/);
 assert.match(markup,/id="guideOverlay" hidden role="dialog" aria-modal="true"/);
 assert.match(markup,/id="guideClose" aria-label="안내 닫기"/);
 assert.match(markup,/id="guideImage" src="\/assets\/guide\.jpg"/);
 assert.match(markup,/#guideOverlay\[hidden\]\{display:none!important\}/);
 assert.match(html,/guideButton\.addEventListener\('click',\(\)=>\{/);
 assert.match(html,/guideOverlay\.addEventListener\('click',event=>\{/);
 assert.match(html,/if\(event\.key==='Escape'\)/);
 assert.match(html,/if\(event\.key==='Tab'\)/);
 const image=readFileSync(path.join(root,'assets/guide.jpg'));
 assert.equal(image[0],0xff);assert.equal(image[1],0xd8);
 assert.ok(image.length>50_000);
});

test('server allowlists exactly the guide JPG with correct image/jpeg MIME and no arbitrary file serving',()=>{
 assert.match(serverIndex,/\['\/assets\/guide\.jpg','assets\/guide\.jpg'\]/);
 assert.match(serverIndex,/allowed\.endsWith\('\.jpg'\)\?'image\/jpeg'/);
 assert.match(serverIndex,/if\(!allowed\)return json\(res,404/);
});

test('Seoul has four A-shaped supports, matching both client meshes and server collision feet',()=>{
 const clientSupports=html.match(/for\(const z of \[-18,20\]\)for\(const side of \[-1,1\]\)/g)||[];
 const server=readFileSync(path.join(root,'server/room.js'),'utf8');
 assert.equal(clientSupports.length,1);
 assert.equal((server.match(/for\(const z of \[-18,20\]\)for\(const side of \[-1,1\]\)/g)||[]).length,1);
 const obstacles=buildSeatsAndObstacles().obstacles;
 const feet=obstacles.filter(o=>Math.abs(o.x)===17.6&&o.w===1.8&&o.d===1.65);
 assert.equal(feet.length,8,'four A-shaped supports have two feet each');
 for(const z of [-18,20])for(const side of [-1,1])for(const dir of [-1,1]){
   const x=side*17.6,footZ=z+dir*(.92+(16.2-.88));
   assert.ok(feet.some(o=>o.x===x&&o.z===footZ));
   assert.equal(isWalkable(x,footZ,'main'),false);
 }
 for(const z of [-25,-7,11,29])for(const side of [-1,1]){
   assert.equal(feet.some(o=>o.x===side*17.6&&o.z===z-4.6),false,'old feet removed');
 }
 assert.equal(buildSeatsAndObstacles().seats.length,48,'study seats unchanged');
});

test('ranking includes only ordinary date/refresh and tie-break notices, with no virtual learner notice',()=>{
 const ranking=dashboard.slice(dashboard.indexOf('function drawRanking(data){'),dashboard.indexOf('// The server updates the live timer'));
 assert.doesNotMatch(ranking,/가상 학습자 포함|가상 학습자가 포함/);
 assert.match(ranking,/약 30초 간격 자동 갱신/);
 assert.match(ranking,/동률은 고유 ID/);
 assert.match(ranking,/한국시간 00:00에 초기화/);
 assert.doesNotMatch(markup.slice(markup.indexOf('id="accountOverlay"'),markup.indexOf('id="bottom"')), /상단의 학습자 인원에는 가상 학습자가 포함/,'account text is concise');
});

test('real static HTTP endpoint returns exact guide JPEG bytes, HEAD and rejects arbitrary paths',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'v78-static-'));
 try{
   const program=`import {server,shutdown} from ${JSON.stringify(new URL('../server/index.js',import.meta.url).href)};
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
try {
 const img=await fetch(base+'/assets/guide.jpg');
 if(img.status!==200||img.headers.get('content-type')!=='image/jpeg')throw Error('JPEG GET invalid: '+img.status);
 const bytes=new Uint8Array(await img.arrayBuffer());
 if(bytes.length<50000||bytes[0]!==255||bytes[1]!==216)throw Error('JPEG bytes missing');
 const head=await fetch(base+'/assets/guide.jpg',{method:'HEAD'});
 if(head.status!==200||head.headers.get('content-type')!=='image/jpeg')throw Error('JPEG HEAD invalid');
 const missing=await fetch(base+'/assets/../../.env');
 if(missing.status!==404)throw Error('Arbitrary file path not blocked: '+missing.status);
} finally {await shutdown();}
`;
   const result=spawnSync(process.execPath,['--input-type=module','-e',program],{
     env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'test-autostart-disabled',STUDYROOM_STATE_DIR:temp,STUDYROOM_DB_PATH:path.join(temp,'studyroom.sqlite'),STUDYROOM_SECRET:'v78-local-validation-test-secret-minimum-32'},encoding:'utf8',timeout:15000});
   assert.equal(result.status,0,result.stderr||result.stdout);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
