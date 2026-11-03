import { writeFile, rename, readFile, unlink } from 'node:fs/promises';
import type { Pool } from 'pg';

/** A fresh heartbeat proves a completed database round-trip, not just a live timer. */
export async function startWorkerHeartbeat(pool:Pick<Pool,'query'>,file:string,onError:()=>void,intervalMs=10000):Promise<()=>Promise<void>>{
  let stopped=false;let active:Promise<void>|undefined;
  const update=async()=>{
    await pool.query('SELECT 1');
    if(stopped)return;
    const temporary=`${file}.${process.pid}.tmp`;
    await writeFile(temporary,JSON.stringify({updatedAt:new Date().toISOString(),pid:process.pid}),{mode:0o600});
    await rename(temporary,file);
  };
  await update();
  const timer=setInterval(()=>{
    if(stopped||active)return;
    active=update().catch(onError).finally(()=>{active=undefined;});
  },intervalMs);
  timer.unref();
  return async()=>{
    stopped=true;clearInterval(timer);await active;
    try{const own=JSON.parse(await readFile(file,'utf8')) as {pid?:number};if(own.pid===process.pid)await unlink(file);}catch{/* No heartbeat remains to remove. */}
  };
}
