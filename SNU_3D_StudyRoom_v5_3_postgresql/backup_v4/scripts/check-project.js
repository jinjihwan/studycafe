// Deterministically check the deliverable layout, not just syntax of one HTML tag.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const required=['index.html','client/network.js','server/index.js','server/websocket.js','server/room.js',
  'package.json','README.md','TEST_REPORT.md','start_server.bat','start_server.sh',
  'server/store.js','server/stats.js','client/dashboard.js','migrations/001_sqlite.sql','migrations/001_postgres.sql',
  'tests/persistence.test.js','tests/restart.test.js','tests/v4-api.test.js',
  'scripts/check-html.js','tests/multiplayer.test.js','tests/stability.test.js',
  'backup_v1/index.html','backup_v2/index.html','backup_v3/index.html','backup_v3/server/room.js'];
for(const file of required){const full=path.join(root,file);
  if(!fs.existsSync(full)||!fs.statSync(full).isFile())throw new Error('Missing project file: '+file);
}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const importmap=html.match(/<script type="importmap">\s*([\s\S]*?)<\/script>/);
if(!importmap)throw new Error('Missing Three.js import map');
const imports=JSON.parse(importmap[1]).imports;
for(const key of ['three','three/addons/'])if(!imports[key]?.includes('three@0.161.0'))throw new Error('Unexpected Three.js import '+key);
function checkLocalImports(source,relative){
  for(const match of source.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?['"](\.[^'"]+)['"]/g)){
    const resolved=path.resolve(root,path.dirname(relative),match[1]);
    if(!fs.existsSync(resolved))throw new Error(`Missing import ${match[1]} in ${relative}`);
  }
}
checkLocalImports(html,'index.html');
for(const file of required.filter(p=>p.endsWith('.js')))checkLocalImports(fs.readFileSync(path.join(root,file),'utf8'),file);
console.log(`Project assets: OK (${required.length} required files); imported local modules present`);

const danger=['.guest-secret','data/studyroom.sqlite','.env'];for(const f of danger)if(fs.existsSync(path.join(root,f)))console.log('Private runtime asset present (ignored by git/archive): '+f);
