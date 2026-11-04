import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const matched=html.match(/<script type="module">([\s\S]*?)<\/script>/);
if(!matched)throw new Error('No module script found in index.html');
const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:matched[1],encoding:'utf8'});
if(result.status!==0){process.stderr.write(result.stderr);process.exit(result.status||1);}
console.log('index.html module syntax: OK');
