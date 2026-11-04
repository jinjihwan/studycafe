import fs from 'node:fs';
import path from 'node:path';

// Keep legacy Codespaces paths unless STUDYROOM_STATE_DIR or explicit DB is configured.
// Production should mount one persistent volume at STUDYROOM_STATE_DIR.
export function statePaths(root, env=process.env) {
  const directory=path.resolve(env.STUDYROOM_STATE_DIR||root);
  const db=path.resolve(env.STUDYROOM_DB_PATH||path.join(root,'data','studyroom.sqlite'));
  const secret=path.join(directory,'.guest-secret');
  const backupDir=path.resolve(env.STUDYROOM_BACKUP_DIR||path.join(directory,'sqlite-backups'));
  return {directory,db,secret,backupDir};
}

export function assertExistingProductionData(paths,env=process.env) {
  if(env.DATABASE_URL)return true; // PostgreSQL stores account and study data outside the app container.
  if(env.STUDYROOM_REQUIRE_EXISTING_DATA!=='1')return true;
  if(!fs.existsSync(paths.db) || fs.statSync(paths.db).size===0)
    throw new Error('Deployment guard: SQLite DB is missing; upload a consistent backup to the persistent volume.');
  if(!env.STUDYROOM_SECRET && !fs.existsSync(paths.secret))
    throw new Error('Deployment guard: .guest-secret is missing; restore the original guest signing secret.');
  if(env.FIREBASE_PROJECT_ID && env.GOOGLE_APPLICATION_CREDENTIALS && !fs.existsSync(env.GOOGLE_APPLICATION_CREDENTIALS))
    throw new Error('Deployment guard: Firebase Admin credential file is missing.');
  return true;
}
