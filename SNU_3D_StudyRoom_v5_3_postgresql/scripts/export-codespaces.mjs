// From a STOPPED Codespaces v5.1 server, export SQLite including WAL with
// node:sqlite's backup API, plus the original guest signer, outside Git.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {createSQLiteBackup,sqliteIntegrity} from './backup-sqlite.mjs';
import {statePaths} from '../server/state-paths.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.env.I_HAVE_STOPPED_THE_SERVER!=='YES'){
 console.error('서버를 종료한 다음 I_HAVE_STOPPED_THE_SERVER=YES 로 재실행하세요.');
 process.exit(2);
}
const sourceProject=process.argv[2]?path.resolve(process.argv[2]):root;
const paths=statePaths(sourceProject,{
 ...process.env,
 STUDYROOM_STATE_DIR:process.env.STUDYROOM_STATE_DIR||sourceProject,
 STUDYROOM_DB_PATH:process.env.STUDYROOM_DB_PATH||path.join(sourceProject,'data','studyroom.sqlite')
});
const stamp=new Date().toISOString().replaceAll(/[:.]/g,'-');
const dest=path.join(os.homedir(),'.config','snu-studyroom','deploy-export',stamp);
if(!fs.existsSync(paths.secret)&&!process.env.STUDYROOM_SECRET){
 console.error('기존 .guest-secret이 없습니다. 인증키 확인 후 이전하세요.');process.exit(2);
}
try{
 fs.mkdirSync(dest,{recursive:true,mode:0o700});
 const snapshot=await createSQLiteBackup({source:paths.db,backupDir:dest,secretPath:paths.secret,keep:1});
 const dbTarget=path.join(dest,'studyroom.sqlite');
 fs.renameSync(snapshot,dbTarget);
 const secretSource=fs.readdirSync(dest).find(n=>n.endsWith('.guest-secret'));
 if(secretSource)fs.renameSync(path.join(dest,secretSource),path.join(dest,'.guest-secret'));
 else if(process.env.STUDYROOM_SECRET){
  throw Error('환경변수 STUDYROOM_SECRET 사용 중입니다. 원본 서명키 파일 없이 자동 이전을 진행하지 마세요.');
 }
 if(!sqliteIntegrity(dbTarget))throw Error('출력 DB 무결성 검사 실패');
 const db=new DatabaseSync(dbTarget,{readOnly:true});
 try{
  const count=t=>db.prepare(`SELECT COUNT(*) AS count FROM ${t}`).get().count;
  console.log('읽기 전용 내보내기 성공 (코드·GitHub에 포함되지 않음)');
  console.log('공부 기록 행:',count('study_daily'),'계정:',count('accounts'),'친구 관계:',count('friends'));
 }finally{db.close();}
 console.log('내보낸 폴더:',dest);
 console.log('Railway 볼륨에 이 폴더의 studyroom.sqlite 와 .guest-secret 을 업로드하세요.');
}catch(e){console.error('내보내기 실패:',e.message);process.exitCode=1;}
