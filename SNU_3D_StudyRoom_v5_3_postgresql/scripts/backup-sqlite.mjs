// Live, WAL-safe SQLite backup. This module does not change the study database.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync,backup} from 'node:sqlite';
import {statePaths} from '../server/state-paths.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function sqliteIntegrity(dbPath){
 const db=new DatabaseSync(dbPath,{readOnly:true});
 try{return db.prepare('PRAGMA integrity_check').all().every(row=>Object.values(row).every(value=>value==='ok'));}
 finally{db.close();}
}
export async function createSQLiteBackup({source,backupDir,secretPath=null,keep=28,clock=new Date()}={}) {
 if(!source||!backupDir)throw new Error('source and backupDir required');
 if(!fs.existsSync(source))throw new Error('Backup source DB is missing');
 fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
 const timestamp=clock.toISOString().replaceAll(':','-').replaceAll('.','-');
 const stem=`studyroom-${timestamp}`;
 const destination=path.join(backupDir,`${stem}.sqlite`);
 const temp=destination+'.partial';
 let database;
 try{
  database=new DatabaseSync(source,{readOnly:true});
  await backup(database,temp);
  database.close();database=null;
  if(!sqliteIntegrity(temp))throw new Error('SQLite integrity_check failed');
  // read-only integrity checks on a WAL-mode snapshot can leave empty -wal/-shm files.
  for(const suffix of ['-wal','-shm'])fs.rmSync(temp+suffix,{force:true});
  fs.chmodSync(temp,0o600);
  fs.renameSync(temp,destination);
  if(secretPath && fs.existsSync(secretPath)){
   const secretOut=path.join(backupDir,`${stem}.guest-secret`);
   fs.copyFileSync(secretPath,secretOut,fs.constants.COPYFILE_EXCL);
   fs.chmodSync(secretOut,0o600);
  }
  // Retain N snapshots, pruning only files created by this backup utility.
  const names=fs.readdirSync(backupDir).filter(n=>/^studyroom-\d{4}-\d\d-\d\dT.+Z\.sqlite$/.test(n)).sort().reverse();
  for(const n of names.slice(Math.max(1,keep))){
   fs.rmSync(path.join(backupDir,n),{force:true});
   fs.rmSync(path.join(backupDir,n.replace(/\.sqlite$/,'.guest-secret')),{force:true});
  }
  return destination;
 }catch(error){database?.close();for(const suffix of ['', '-wal','-shm'])fs.rmSync(temp+suffix,{force:true});throw error;}
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const paths=statePaths(root);
 try{
  const filename=await createSQLiteBackup({source:paths.db,backupDir:paths.backupDir,secretPath:paths.secret});
  console.log('백업 및 integrity_check 성공:',filename);
 }catch(error){console.error('백업 실패:',error.message);process.exitCode=1;}
}
