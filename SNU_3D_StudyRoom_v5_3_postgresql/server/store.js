import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const readMigration=name=>fs.readFileSync(path.join(root,'migrations',name),'utf8');
const isDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'));
const normalizeGuest=r=>r?{id:r.id,nick:r.nickname,species:r.species,hood:r.hood,rankingPublic:!!r.ranking_public}:null;
const integer=ms=>Math.max(0,Math.round(Number(ms)||0));
export class SQLiteStore {
  constructor(filename=process.env.STUDYROOM_DB_PATH||path.join(root,'data','studyroom.sqlite')) {
    this.filename=filename;
    if(filename!==':memory:')fs.mkdirSync(path.dirname(filename),{recursive:true});
    this.db=new DatabaseSync(filename,{timeout:5000});
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;'+readMigration('001_sqlite.sql'));
    this.kind='sqlite';
  }
  async ensureGuest(id) {
    this.db.prepare('INSERT OR IGNORE INTO guests (id) VALUES (?)').run(id);
    return normalizeGuest(this.db.prepare('SELECT * FROM guests WHERE id=?').get(id));
  }
  async updateProfile(id,{nick,species,hood}) {
    this.db.prepare("UPDATE guests SET nickname=?,species=?,hood=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(nick,species,hood,id);
  }
  async setVisibility(id,publicRanking) {
    this.db.prepare("UPDATE guests SET ranking_public=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(publicRanking?1:0,id);
    return this.getGuest(id);
  }
  async getGuest(id){return normalizeGuest(this.db.prepare('SELECT * FROM guests WHERE id=?').get(id));}
  async getDay(id,day) {return Number(this.db.prepare('SELECT milliseconds FROM study_daily WHERE guest_id=? AND day=?').get(id,day)?.milliseconds||0);}
  async addSegments(id,segments) {
    const pairs=[...segments].filter(([day,ms])=>isDay(day)&&integer(ms)>0);
    if(!pairs.length)return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const stmt=this.db.prepare("INSERT INTO study_daily(guest_id,day,milliseconds) VALUES(?,?,?) ON CONFLICT(guest_id,day) DO UPDATE SET milliseconds=study_daily.milliseconds+excluded.milliseconds,updated_at=CURRENT_TIMESTAMP");
      for(const [day,ms] of pairs)stmt.run(id,day,integer(ms));
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  async getDays(id){return this.db.prepare('SELECT day,milliseconds FROM study_daily WHERE guest_id=? ORDER BY day').all(id).map(r=>({day:r.day,ms:Number(r.milliseconds)}));}
  async getRanking(day){return this.db.prepare(`SELECT g.id,g.nickname AS nick,g.species,g.hood,d.milliseconds AS ms
     FROM study_daily d JOIN guests g ON g.id=d.guest_id WHERE d.day=? AND d.milliseconds>0 AND g.ranking_public=1
     ORDER BY d.milliseconds DESC,g.id ASC`).all(day).map(r=>({...r,ms:Number(r.ms)}));}
  close(){this.db.close();}
}

// Production adapter. It deliberately uses the identical high-level API as SQLite.
// Install optional dependency 'pg', set DATABASE_URL, persist secrets and TLS config outside source.
export class PostgresStore {
  constructor(pool){this.pool=pool;this.kind='postgres';}
  static async create(url) {
    let pg;try{pg=await import('pg')}catch{throw new Error('PostgreSQL 사용 시 먼저 npm install pg 를 실행하세요.');}
    const pool=new pg.default.Pool({connectionString:url,max:8,connectionTimeoutMillis:8000,idleTimeoutMillis:30000});
    // Apply each idempotent schema migration through one checked-out connection.
    // The SQL files have explicit BEGIN/COMMIT and do not interpolate user input.
    let client;
    try{
      client=await pool.connect();
      await client.query(readMigration('001_postgres.sql'));
      await client.query(readMigration('002_postgres.sql'));
      await client.query('SELECT 1');
    }catch(e){client?.release();await pool.end();throw e;}
    client.release();
    return new PostgresStore(pool);
  }
  async ensureGuest(id){await this.pool.query('INSERT INTO guests(id) VALUES($1) ON CONFLICT DO NOTHING',[id]);return this.getGuest(id);}
  async getGuest(id){return normalizeGuest((await this.pool.query('SELECT * FROM guests WHERE id=$1',[id])).rows[0]);}
  async updateProfile(id,{nick,species,hood}){await this.pool.query('UPDATE guests SET nickname=$1,species=$2,hood=$3,updated_at=NOW() WHERE id=$4',[nick,species,hood,id]);}
  async setVisibility(id,publicRanking){await this.pool.query('UPDATE guests SET ranking_public=$1,updated_at=NOW() WHERE id=$2',[publicRanking,id]);return this.getGuest(id);}
  async getDay(id,day){return Number((await this.pool.query('SELECT milliseconds FROM study_daily WHERE guest_id=$1 AND day=$2',[id,day])).rows[0]?.milliseconds||0);}
  async addSegments(id,segments) {
    const pairs=[...segments].filter(([day,ms])=>isDay(day)&&integer(ms)>0);
    if(!pairs.length)return;
    const c=await this.pool.connect();
    try{await c.query('BEGIN');
      for(const [day,ms] of pairs) await c.query(`INSERT INTO study_daily(guest_id,day,milliseconds) VALUES($1,$2,$3)
        ON CONFLICT(guest_id,day) DO UPDATE SET milliseconds=study_daily.milliseconds+excluded.milliseconds,updated_at=NOW()`,[id,day,integer(ms)]);
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async getDays(id){return (await this.pool.query('SELECT TO_CHAR(day,\'YYYY-MM-DD\') AS day,milliseconds FROM study_daily WHERE guest_id=$1 ORDER BY day',[id])).rows.map(r=>({day:r.day,ms:Number(r.milliseconds)}));}
  async getRanking(day){return (await this.pool.query(`SELECT g.id,g.nickname AS nick,g.species,g.hood,d.milliseconds AS ms
     FROM study_daily d JOIN guests g ON g.id=d.guest_id WHERE d.day=$1 AND d.milliseconds>0 AND g.ranking_public=TRUE
     ORDER BY d.milliseconds DESC,g.id ASC`,[day])).rows.map(r=>({...r,ms:Number(r.ms)}));}
  async close(){await this.pool.end();}
}
export async function createStore(){
 if(process.env.DATABASE_URL)return PostgresStore.create(process.env.DATABASE_URL);
 if(process.env.NODE_ENV==='production')throw new Error('Production deployment requires DATABASE_URL (PostgreSQL).');
 return new SQLiteStore();
}
