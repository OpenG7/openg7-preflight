import pg from 'pg';
import { PreflightService } from '../../../packages/engine/src/index.js';
import { createApp } from './app.js';
import { loadApiConfig } from './auth.js';

async function main(): Promise<void> {
  const config = loadApiConfig();
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 15000, idle_in_transaction_session_timeout: 15000 });
  pool.on('error', () => { process.stderr.write('{"level":"error","event":"database_pool_error"}\n'); });
  const app = await createApp({ service: new PreflightService(pool), config, health: async () => pool.query('SELECT EXISTS(SELECT 1 FROM public.missions), EXISTS(SELECT 1 FROM public.tasks)'), logger: true });
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await app.close(); await pool.end(); };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  try { await app.listen({ port: config.port, host: config.host }); }
  catch { await stop(); throw new Error('api_start_failed'); }
}
main().catch(() => { process.stderr.write('{"level":"error","event":"api_start_failed"}\n'); process.exitCode = 1; });
