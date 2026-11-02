import { existsSync } from 'node:fs';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { createAiProvider } from '../../../packages/ai/src/index.js';
import { startWorker } from '../../../packages/engine/src/index.js';

const logError=(code:string)=>console.error(JSON.stringify({level:'error',service:'worker',code}));

async function main():Promise<void>{
  let pool:pg.Pool|undefined;
  let boss:PgBoss|undefined;
  let worker:Awaited<ReturnType<typeof startWorker>>|undefined;
  let stopping=false;
  const shutdown=async()=>{
    if(stopping)return;stopping=true;
    try{if(worker)await worker.stop();else if(boss)await boss.stop({graceful:false,timeout:5000});}
    finally{if(pool)await pool.end();}
  };
  try{
    if(existsSync('.env'))process.loadEnvFile('.env');
    const databaseUrl=process.env['DATABASE_URL'];
    if(!databaseUrl)throw new Error('DATABASE_URL_required');
    if(process.env['NODE_ENV']==='production'){
      const target=new URL(databaseUrl);
      if(target.searchParams.get('sslmode')!=='verify-full'||['preflight_local','password','postgres'].includes(decodeURIComponent(target.password)))throw new Error('production_database_tls_and_credentials_required');
      if(process.env['AI_PROVIDER']==='mock')throw new Error('mock_provider_forbidden_in_production');
    }
    const provider=createAiProvider();
    const concurrency=Number(process.env['WORKER_CONCURRENCY']??4);
    if(!Number.isInteger(concurrency)||concurrency<1||concurrency>16)throw new Error('WORKER_CONCURRENCY_must_be_integer_1_to_16');
    pool=new pg.Pool({connectionString:databaseUrl,max:10,application_name:'preflight-worker',connectionTimeoutMillis:5000,statement_timeout:15000,idle_in_transaction_session_timeout:15000});
    pool.on('error',()=>logError('database_pool_error'));
    // Retain the boss instance so even a partially failed queue bootstrap can be closed safely.
    boss=new PgBoss({connectionString:databaseUrl,monitorIntervalSeconds:1});
    worker=await startWorker({pool,boss,provider,concurrency,onError:logError,
      onEvent:data=>console.info(JSON.stringify({level:'info',service:'worker',...data}))});
    console.info(JSON.stringify({level:'info',service:'worker',event:'started',provider:provider.id,simulated:provider.simulated}));
    const handleSignal=()=>{void shutdown().catch(()=>{logError('worker_shutdown_failed');process.exitCode=1;});};
    process.once('SIGINT',handleSignal);process.once('SIGTERM',handleSignal);
  }catch{
    try{await shutdown();}catch{logError('worker_cleanup_failed');}
    throw new Error('worker_start_failed');
  }
}

void main().catch(()=>{logError('worker_start_failed');process.exitCode=1;});
