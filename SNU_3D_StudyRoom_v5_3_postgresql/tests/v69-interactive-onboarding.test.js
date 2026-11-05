import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const visible=html.slice(0,html.indexOf('<script type="module">'));

test('first-visit interactive tutorial is fully removed, not just hidden',()=>{
 assert.doesNotMatch(visible,/id="tutorialOverlay"|id="tutorialSkipStep"|#tutorialOverlay|tutorial-open/);
 assert.doesNotMatch(html,/\b(?:openTutorial|tutorialAction|tutorialSteps|tutorialSeen|tutorialActive|tutorialReplay|tutorialPointerDown|resumeTutorial|pauseTutorial|rememberTutorialRoomSwitch)\b/);
 assert.doesNotMatch(html,/snu-v69-tutorial-complete|snu-v69-tutorial-library-switch|snu-v68-tutorial-seen/);
});

test('first visit still chooses character once and joins with guest login without tutorial',()=>{
 assert.match(visible,/id="modal"[^>]*role="dialog"/);
 assert.match(visible,/id="enterBtn"[^>]*>3D 도서관 입장/);
 assert.match(html,/if\(!profileComplete\)showModal\(\)/);
 assert.match(html,/if\(profileComplete\)net\.start\(\)/);
 assert.match(html,/function showModal\(\)\{D\.modal\.classList\.add\('visible'\)\}/);
 assert.match(html,/player\.setAppearance\(prefs\.species,prefs\.hood,prefs\.nick\)/);
});

test('removing tutorial does not remove world interaction, chat, account or library change',()=>{
 assert.match(html,/player\.go\(target\);/);
 assert.match(html,/net\.send\(\{t:'seat_request',seatId:s\.id\}\)/);
 assert.match(html,/net\?\.send\(\{t:'chat',message:msg\}\)/);
 assert.match(html,/navigator\.clipboard\.writeText\(u\.href\)/);
 assert.match(html,/function openLibraryChooser\(\)/);
 assert.match(html,/account\.draw\(\);welcome\.hidden=false/);
});
