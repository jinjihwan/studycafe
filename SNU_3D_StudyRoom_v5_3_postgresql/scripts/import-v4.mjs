// Safe one-time mobile Codespaces migration from a STOPPED v4 server.
// Consistent SQLite backup handles WAL files correctly. Refuses to overwrite v5.
import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const from=process.argv[2]?path.resolve(process.argv[2]):null;
if(!from){console.error('사용법: node scripts/import-v4.mjs ../SNU_3D_StudyRoom_v4');process.exit(2);}
const source=path.join(from,'data','studyroom.sqlite');
const secret=path.join(from,'.guest-secret');
const target=path.join(root,'data','studyroom.sqlite');
const targetSecret=path.join(root,'.guest-secret');
if(!fs.existsSync(source)){console.error('v4 데이터베이스를 찾지 못했습니다:',source);process.exit(2);}
if(!fs.existsSync(secret)&&!process.env.STUDYROOM_SECRET){console.error('v4 .guest-secret 파일이 없습니다. 게스트 ID 유지를 위해 기존 STUDYROOM_SECRET 환경변수 또는 원본 비밀키가 필요합니다.');process.exit(2);}
if(fs.existsSync(target)||fs.existsSync(targetSecret)){
 console.error('v5 DB 또는 .guest-secret이 이미 있습니다. 자동 덮어쓰기를 거부했습니다. 현재 자료를 별도 백업한 뒤 수동 이전하세요.');process.exit(2);
}
fs.mkdirSync(path.join(root,'private-backups'),{recursive:true,mode:0o700});
const folder=path.join(root,'private-backups','v4-'+new Date().toISOString().replaceAll(/[:.]/g,'-'));
fs.mkdirSync(folder,{recursive:false,mode:0o700});
let db;
try{
 db=new DatabaseSync(source,{readOnly:true});
 await backup(db,path.join(folder,'studyroom.sqlite'));
 db.close();db=null;
 if(fs.existsSync(secret))fs.copyFileSync(secret,path.join(folder,'.guest-secret'));
 fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.copyFileSync(path.join(folder,'studyroom.sqlite'),target,fs.constants.COPYFILE_EXCL);
 if(fs.existsSync(secret)){fs.copyFileSync(secret,targetSecret,fs.constants.COPYFILE_EXCL);fs.chmodSync(targetSecret,0o600);}
 console.log('v4 원본 유지, 일관된 DB 백업 및 v5 복사 완료.');
 console.log('비공개 백업 위치:',folder);
 console.log('다음: npm run check && npm test && npm start');
}catch(e){db?.close();if(fs.existsSync(target)&&!fs.existsSync(targetSecret)&&fs.existsSync(secret))fs.rmSync(target,{force:true});console.error('이전 중단:',e.message);process.exitCode=1;}
