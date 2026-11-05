import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const html=readFileSync(path.join(root,'index.html'),'utf8');
const jpg=readFileSync(path.join(root,'assets/guide.jpg'));
const guideLogic=html.slice(html.indexOf('// Highlight the guide until this browser opens it'),html.indexOf("$('#inviteBtn').onclick="));
const style=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));

test('the user-provided portrait tutorial JPEG replaces the former guide without changing the served URL',()=>{
 assert.deepEqual([...jpg.subarray(0,3)],[0xff,0xd8,0xff]);
 assert.ok(jpg.length>300_000);
 assert.match(html,/id="guideImage" src="\/assets\/guide\.jpg"/);
 assert.match(html,/id="guideClose" aria-label="안내 닫기"/);
 assert.match(html,/온라인스카 이용 안내: 바닥 터치 이동/);
});

test('guide emphasis remembers first opening and never blocks opening when storage is denied',()=>{
 assert.match(guideLogic,/const GUIDE_SEEN_KEY='onlineSkaGuideOpened_v1'/);
 assert.match(guideLogic,/localStorage\.getItem\(GUIDE_SEEN_KEY\)/);
 assert.match(guideLogic,/localStorage\.setItem\(GUIDE_SEEN_KEY,'1'\)/);
 assert.match(guideLogic,/guideButton\.classList\.add\('guide-unseen'\)/);
 assert.match(guideLogic,/guideButton\.classList\.remove\('guide-unseen'\)/);
 assert.match(guideLogic,/guideOverlay\.hidden=false/);
 assert.match(guideLogic,/catch\{\/\* storage access is optional \*\//);
 assert.match(style,/#guideBtn\.guide-unseen\{/);
 assert.match(style,/#guideBtn\.guide-unseen::after\{/);
 assert.match(style,/@media\(prefers-reduced-motion:reduce\)/);
});

test('startup uses onlineSka branded copy instead of network/Three.js warnings',()=>{
 assert.match(html,/<div id="loading" role="status" aria-live="polite">온라인스카 입장하는 중\.\.\.<\/div>/);
 assert.doesNotMatch(html,/Three\.js 다운로드를 위해 인터넷 연결이 필요합니다/);
 assert.match(html, /\$\('#loading'\)\.remove\(\)/);
});

test('room summary content-width final CSS rule overrides old v7.8 mobile fill rule',()=>{
 const last=style.slice(style.lastIndexOf('/* V7.13:'));
 assert.match(last,/#topbar \.room-summary\{\s*flex:0 1 auto;/);
 assert.match(last,/width:max-content/);
 assert.match(last,/max-width:min\(360px,calc\(100vw - 154px\)\)/);
 assert.match(last,/#libraryBrand\{flex:0 1 auto;max-width:100%\}/);
});
