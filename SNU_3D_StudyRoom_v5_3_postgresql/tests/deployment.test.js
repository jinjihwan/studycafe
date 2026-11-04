import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {SQLiteStore} from '../server/store.js';
import {AccountsStore} from '../server/accounts-store.js';
import {statePaths,assertExistingProductionData} from '../server/state-paths.js';
import {createSQLiteBackup,sqliteIntegrity} from '../scripts/backup-sqlite.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'snu-v52-'));
const writeSecret=folder=>{fs.mkdirSync(folder,{recursive:true});const secret=Buffer.from('unchanged-existing-guest-signer');fs.writeFileSync(path.join(folder,'.guest-secret'),secret,{mode:0o600});return secret;};
function sampleDB(dir){
 const filename=path.join(dir,'studyroom.sqlite');
 const s=new SQLiteStore(filename);new AccountsStore(s);
 s.db.prepare('INSERT INTO guests(id,nickname) VALUES(?,?)').run('a'.repeat(32),'기존사용자');
 s.db.prepare('INSERT INTO study_daily(guest_id,day,milliseconds) VALUES(?,?,?)').run('a'.repeat(32),'2026-11-03',1234567);
 s.db.prepare('INSERT INTO study_daily(guest_id,day,milliseconds) VALUES(?,?,?)').run('a'.repeat(32),'2026-11-04',7654321);
 return {s,filename};
}
test('production guard rejects missing volume DB/secret and preserves v5 legacy default',()=>{
 const directory=tmp();
 const p=statePaths(root,{STUDYROOM_STATE_DIR:directory,STUDYROOM_DB_PATH:path.join(directory,'studyroom.sqlite')});
 assert.equal(p.secret,path.join(directory,'.guest-secret'));
 assert.throws(()=>assertExistingProductionData(p,{STUDYROOM_REQUIRE_EXISTING_DATA:'1'}),/DB is missing/);
 assertExistingProductionData(p,{});
 fs.writeFileSync(p.db,'x');
 assert.throws(()=>assertExistingProductionData(p,{STUDYROOM_REQUIRE_EXISTING_DATA:'1'}),/guest-secret is missing/);
 writeSecret(directory);assertExistingProductionData(p,{STUDYROOM_REQUIRE_EXISTING_DATA:'1'});
 assert.throws(()=>assertExistingProductionData(p,{STUDYROOM_REQUIRE_EXISTING_DATA:'1',FIREBASE_PROJECT_ID:'p',GOOGLE_APPLICATION_CREDENTIALS:path.join(directory,'missing.json')}),/Firebase Admin/);
 fs.rmSync(directory,{recursive:true,force:true});
});
test('live WAL backup preserves original date records, all friend tables and guest signing key',async()=>{
 const directory=tmp(),key=writeSecret(directory),{s,filename}=sampleDB(directory);
 const backupDir=path.join(directory,'snapshots');
 s.db.prepare('INSERT INTO guests(id,nickname) VALUES(?,?)').run('b'.repeat(32),'친구');
 s.db.prepare('INSERT INTO accounts(user_id,firebase_uid,friend_code) VALUES(?,?,?)').run('a'.repeat(32),'firebase-a','ST-AA');
 s.db.prepare('INSERT INTO accounts(user_id,firebase_uid,friend_code) VALUES(?,?,?)').run('b'.repeat(32),'firebase-b','ST-BB');
 s.db.prepare('INSERT INTO friends(a,b,created_at) VALUES(?,?,?)').run('a'.repeat(32),'b'.repeat(32),Date.now());
 assert.ok(fs.existsSync(filename+'-wal'));
 const backupFile=await createSQLiteBackup({source:filename,backupDir,secretPath:path.join(directory,'.guest-secret'),keep:2,clock:new Date('2026-11-04T00:00:00Z')});
 assert.equal(sqliteIntegrity(backupFile),true);
 const restored=new DatabaseSync(backupFile,{readOnly:true});
 try{
  assert.equal(restored.prepare('SELECT COUNT(*) AS c FROM friends').get().c,1);
  assert.equal(restored.prepare('SELECT COUNT(*) AS c FROM accounts').get().c,2);
  assert.equal(restored.prepare('SELECT milliseconds FROM study_daily WHERE day=?').get('2026-11-03').milliseconds,1234567);
 }finally{restored.close();}
 assert.deepEqual(fs.readFileSync(backupFile.replace(/\.sqlite$/,'.guest-secret')),key);
 assert.equal(fs.readdirSync(backupDir).filter(n=>n.includes('.partial')).length,0);
 s.db.prepare('UPDATE study_daily SET milliseconds=999 WHERE day=?').run('2026-11-03');
 const originalSnapshot=new DatabaseSync(backupFile,{readOnly:true});
 assert.equal(originalSnapshot.prepare('SELECT milliseconds FROM study_daily WHERE day=?').get('2026-11-03').milliseconds,1234567);
 originalSnapshot.close();
 await createSQLiteBackup({source:filename,backupDir,secretPath:path.join(directory,'.guest-secret'),keep:2,clock:new Date('2026-11-05T00:00:00Z')});
 await createSQLiteBackup({source:filename,backupDir,secretPath:path.join(directory,'.guest-secret'),keep:2,clock:new Date('2026-11-06T00:00:00Z')});
 assert.equal(fs.readdirSync(backupDir).filter(n=>n.endsWith('.sqlite')).length,2);
 assert.equal(fs.existsSync(backupFile),false);
 s.close();fs.rmSync(directory,{recursive:true,force:true});
});
test('Codespaces export produces standalone checked DB and secret outside repository',()=>{
 const directory=tmp(),home=path.join(directory,'home');fs.mkdirSync(home);
 const {s,filename}=sampleDB(directory);const key=writeSecret(directory);
 const result=spawnSync(process.execPath,[path.join(root,'scripts/export-codespaces.mjs')],{
  env:{...process.env,HOME:home,STUDYROOM_STATE_DIR:directory,STUDYROOM_DB_PATH:filename,STUDYROOM_SECRET:'',I_HAVE_STOPPED_THE_SERVER:'YES'},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/공부 기록 행: 2/);
 const exportRoot=path.join(home,'.config','snu-studyroom','deploy-export');
 const folder=path.join(exportRoot,fs.readdirSync(exportRoot)[0]);
 assert.ok(sqliteIntegrity(path.join(folder,'studyroom.sqlite')));
 assert.deepEqual(fs.readFileSync(path.join(folder,'.guest-secret')),key);
 s.close();fs.rmSync(directory,{recursive:true,force:true});
});
test('offline restoration refuses live mode and makes a rollback snapshot',async()=>{
 const dir=tmp();writeSecret(dir);const {s,filename}=sampleDB(dir);
 const b=await createSQLiteBackup({source:filename,backupDir:path.join(dir,'snapshots')});
 s.db.prepare('UPDATE study_daily SET milliseconds=555 WHERE day=?').run('2026-11-03');s.close();
 const args=[path.join(root,'scripts/restore-snapshot.mjs'),b];
 const env={...process.env,STUDYROOM_STATE_DIR:dir,STUDYROOM_DB_PATH:filename};
 assert.notEqual(spawnSync(process.execPath,args,{env,encoding:'utf8'}).status,0);
 const restored=spawnSync(process.execPath,args,{env:{...env,I_HAVE_STOPPED_THE_SERVER:'YES'},encoding:'utf8'});
 assert.equal(restored.status,0,restored.stderr);
 const db=new DatabaseSync(filename,{readOnly:true});
 assert.equal(db.prepare('SELECT milliseconds FROM study_daily WHERE day=?').get('2026-11-03').milliseconds,1234567);db.close();
 assert.ok(fs.readdirSync(path.join(dir,'sqlite-backups','rollback')).some(s=>s.endsWith('.sqlite')));
 fs.rmSync(dir,{recursive:true,force:true});
});
