// Real PostgreSQL connection and schema verification. Requires DATABASE_URL, never logs credentials.
import {PostgresStore} from '../server/store.js';
import {PostgresAccountsStore} from '../server/postgres-accounts-store.js';
if(!process.env.DATABASE_URL){console.error('DATABASE_URL is required. Configure a Railway PostgreSQL service variable.');process.exitCode=1;}
else{
 let store;
 try{
  store=await PostgresStore.create(process.env.DATABASE_URL);
  const accounts=new PostgresAccountsStore(store);
  await accounts.isAccount('0'.repeat(32));
  const rows=await store.pool.query('SELECT CURRENT_DATABASE() AS database, current_setting($1) AS version',['server_version']);
  console.log('PostgreSQL connection OK; study, accounts and friends schema available; server version:',String(rows.rows[0]?.version).split(' ')[0]);
 }catch(err){console.error('PostgreSQL check FAILED:',err.code||err.name||'error');process.exitCode=1;}
 finally{await store?.close();}
}
