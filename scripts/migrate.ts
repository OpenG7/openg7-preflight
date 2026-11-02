import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export async function runMigrations(pool: pg.Pool, directory = path.resolve('migrations')): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('preflight:migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS preflight_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const name of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
      const sql = await readFile(path.join(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query<{ checksum: string }>('SELECT checksum FROM preflight_migrations WHERE name=$1', [name]);
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Migration déjà appliquée et modifiée : ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO preflight_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
      applied.push(name);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let pool: pg.Pool | undefined;
  try {
    if (!process.env.DATABASE_URL) throw new Error('database_configuration_required');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
    pool.on('error', () => { process.stderr.write('{"event":"migrations.pool_error"}\n'); });
    console.log(JSON.stringify({ event: 'migrations.applied', migrations: await runMigrations(pool) }));
  } catch {
    process.stderr.write('{"event":"migrations.failed","hint":"Vérifier la configuration PostgreSQL, les droits et les checksums des migrations."}\n');
    process.exitCode = 1;
  } finally { await pool?.end(); }
}
