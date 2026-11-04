// OFFLINE ONLY: restore a checked snapshot, preserving rollback copy.
// Never run while the web service is using the SQLite DB.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {statePaths} from '../server/state-paths.js';
import {createSQLiteBackup,sqliteIntegrity} from './backup-sqlite.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const paths=statePaths(root);
const source=process.argv[2];
if(process.env.I_HAVE_STOPPED_THE_SERVER!=='YES'||!source){
 console.error('서버를 중지한 뒤 I_HAVE_STOPPED_THE_SERVER=YES node scripts/restore-snapshot.mjs <snapshot.sqlite> 로 실행하세요.');
 process.exit(2);
}
try{
 const file=path.resolve(source);
 if(!fs.existsSync(file)||!sqliteIntegrity(file))throw Error('복원 파일이 없거나 SQLite 무결성 검사 실패');
 if(fs.existsSync(paths.db)){
  const rollback=await createSQLiteBackup({source:paths.db,backupDir:path.join(paths.backupDir,'rollback'),secretPath:paths.secret,keep:6});
  console.log('복원 전 백업:',rollback);
 }
 fs.mkdirSync(path.dirname(paths.db),{recursive:true});
 const tmp=paths.db+'.restore-temp';
 fs.copyFileSync(file,tmp);
 fs.chmodSync(tmp,0o600);
 fs.renameSync(tmp,paths.db);
 // Server must have been stopped, otherwise deleting active WAL would corrupt data.
 for(const suffix of ['-wal','-shm'])fs.rmSync(paths.db+suffix,{force:true});
 console.log('복원 성공:',paths.db);
}catch(e){console.error('복원 실패:',e.message);process.exitCode=1;}
