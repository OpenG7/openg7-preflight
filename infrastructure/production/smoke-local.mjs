import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import { checkProductionEnvironment } from './check-config.mjs';

// A disposable local rehearsal only: generates synthetic secrets/certificates,
// never starts the real-provider worker, and removes its own Compose project.
if (process.argv.length !== 3 || process.argv[2] !== '--execute-local') throw new Error('Use --execute-local for the disposable local rehearsal.');
const workspace = path.resolve('.local'); mkdirSync(workspace, { recursive: true });
const directory = mkdtempSync(path.join(workspace, 'preflight-production-smoke-'));
const project = `preflight-prod-smoke-${randomUUID().slice(0, 8)}`;
const envFile = path.join(directory, 'public.env');
const serverImage = process.env.PREFLIGHT_TEST_SERVER_IMAGE ?? 'preflight-vps-smoke:server';
const webImage = process.env.PREFLIGHT_TEST_WEB_IMAGE ?? 'preflight-vps-smoke:web';
const openssl = process.env.PREFLIGHT_TEST_OPENSSL ?? (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
const result = { event: 'production.local_rehearsal', project, serverImage, webImage, completed: false, checks: [] };
let cleanupNeeded = false;

function command(binary, args, code, timeout = 120000) {
  const run = spawnSync(binary, args, { encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  if (run.status !== 0 || run.error) throw new Error(code);
  return run.stdout.trim();
}
const compose = (...args) => command('docker', ['compose', '--project-name', project, '--env-file', envFile, '-f', 'compose.production.yml', ...args], 'compose_rehearsal_failed');
const put = (name, value) => { const file = path.join(directory, name); writeFileSync(file, value, { mode: 0o600 }); return file; };
const file = name => path.join(directory, name);
const securityHeaders = response => Object.entries({ 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' }).every(([name, expected]) => {
  const values = response.headers.get(name)?.split(',').map(value => value.trim());
  return values?.length && values.every(value => value === expected);
});
const listener = net.createServer();
await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen({ host: '127.0.0.1', port: 0 }, resolve); });
const address = listener.address();
const webPort = typeof address === 'object' && address ? address.port : 0;
await new Promise(resolve => listener.close(resolve));
if (!webPort) throw new Error('local_port_allocation_failed');

try {
  command(openssl, ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',file('ca.key'),'-out',file('ca.crt'),'-subj','/CN=Preflight Disposable Local CA','-days','1','-addext','basicConstraints=critical,CA:TRUE'], 'synthetic_ca_generation_failed');
  command(openssl, ['req','-newkey','rsa:2048','-nodes','-keyout',file('server.key'),'-out',file('server.csr'),'-subj','/CN=postgres','-addext','subjectAltName=DNS:postgres,DNS:localhost'], 'synthetic_certificate_request_failed');
  command(openssl, ['x509','-req','-in',file('server.csr'),'-CA',file('ca.crt'),'-CAkey',file('ca.key'),'-CAcreateserial','-out',file('server.crt'),'-days','1','-copy_extensions','copy'], 'synthetic_certificate_signing_failed');
  const appPassword = randomBytes(24).toString('hex');
  const env = {
    PREFLIGHT_SERVER_IMAGE: serverImage, PREFLIGHT_WEB_IMAGE: webImage, PREFLIGHT_WEB_PORT: String(webPort),
    PREFLIGHT_DATABASE_URL_FILE: put('database-url', `postgresql://preflight_app:${appPassword}@postgres:5432/preflight?sslmode=verify-full&sslrootcert=/run/secrets/postgres_ca`),
    PREFLIGHT_POSTGRES_ADMIN_PASSWORD_FILE: put('admin-password', randomBytes(24).toString('hex')),
    PREFLIGHT_POSTGRES_APP_PASSWORD_FILE: put('app-password', appPassword),
    PREFLIGHT_POSTGRES_CA_FILE: file('ca.crt'), PREFLIGHT_POSTGRES_CERT_FILE: file('server.crt'), PREFLIGHT_POSTGRES_KEY_FILE: file('server.key'),
    PREFLIGHT_OPENAI_API_KEY_FILE: put('unused-provider-key', 'synthetic-unused-local-key'),
    OIDC_ISSUER: 'https://identity.preflight-local.test/realms/synthetic', OIDC_AUDIENCE: 'preflight-api',
    OIDC_JWKS_URL: 'https://identity.preflight-local.test/jwks', OIDC_BROWSER_CLIENT_ID: 'preflight-console',
    OIDC_BROWSER_REDIRECT_URI: 'https://console.preflight-local.test/', OPENAI_MODEL: 'synthetic-unused-model',
    AI_INPUT_PRICE_PER_MILLION: '1', AI_OUTPUT_PRICE_PER_MILLION: '1',
  };
  const errors = checkProductionEnvironment(env);
  if (errors.length) throw new Error('synthetic_configuration_invalid');
  put('public.env', Object.entries(env).map(([key, value]) => `${key}='${value.replaceAll('\\','/')}'`).join('\n') + '\n');
  compose('config', '--quiet'); result.checks.push('production_config');
  cleanupNeeded = true;
  compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '120', 'postgres', 'migrate', 'api', 'web');
  const port = compose('port', 'web', '8080');
  result.webBinding = port;
  if (!/^127\.0\.0\.1:\d+$/.test(port)) throw new Error('web_not_bound_to_loopback');
  const base = `http://${port}`;
  const home = await fetch(base, { signal: AbortSignal.timeout(10000) });
  if (!home.ok || !(await home.text()).includes('OpenG7 Preflight')) throw new Error('static_console_unavailable');
  result.checks.push('static_console');
  if (!securityHeaders(home)) throw new Error('static_security_headers_missing');
  result.checks.push('web_security_headers');
  const session = await fetch(`${base}/api/session`, { signal: AbortSignal.timeout(10000) });
  if (session.status !== 401) throw new Error('unauthenticated_api_not_rejected');
  if (!securityHeaders(session)) throw new Error('api_security_headers_missing');
  result.checks.push('api_authentication_required');
  const metadata = await fetch(`${base}/api/auth/config`, { signal: AbortSignal.timeout(10000) });
  if (!metadata.ok) throw new Error('oidc_metadata_unavailable');
  if (!securityHeaders(metadata)) throw new Error('api_security_headers_missing');
  result.checks.push('api_security_headers');
  const publicMetadata = await metadata.text();
  if (publicMetadata.includes(appPassword)) throw new Error('secret_in_public_metadata');
  result.checks.push('public_oidc_configuration');
  const probe = `import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try { const tls=await pool.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()'); const role=await pool.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user'); const migrations=await pool.query('SELECT count(*)::int AS count FROM preflight_migrations'); console.log(JSON.stringify({tls:tls.rows[0]?.ssl,superuser:role.rows[0]?.rolsuper,migrations:migrations.rows[0]?.count})); } finally {await pool.end();}`;
  const observed = JSON.parse(compose('exec','-T','api','node','infrastructure/production/entrypoint.mjs','node','--input-type=module','-e',probe));
  if (observed.tls !== true || observed.superuser !== false || observed.migrations < 2) throw new Error('tls_role_or_migration_check_failed');
  result.checks.push('postgres_verified_tls','application_not_superuser','migrations_applied');
  const workerProbe = `import pg from 'pg';
import {PreflightService,startWorker} from './dist/packages/engine/src/index.js';
import {MockAiProvider} from './dist/packages/ai/src/index.js';
import {missionInputSchema} from './dist/packages/contracts/src/index.js';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});let worker;
try {
 const service=new PreflightService(pool);const scope={tenantId:'synthetic-tls',subject:'local-rehearsal',roles:['administrator','service_integration'],applications:['funding-platform'],correlationId:'synthetic-tls-rehearsal'};
 const input=missionInputSchema.parse({schemaVersion:'1.0',eventId:'synthetic-tls-event',tenantId:scope.tenantId,source:{application:'funding-platform',subjectType:'demonstration',subjectId:'synthetic-tls-subject',version:1},workflow:{type:'sponsorship-preparation-v1',version:'1.0'},constraints:{},input:{title:'Synthetic TLS rehearsal',description:'Disposable local worker fixture only',benefits:['Draft for inspection']}});
 const submitted=await service.submit(input,scope);
 worker=await startWorker({pool,connectionString:process.env.DATABASE_URL,provider:new MockAiProvider(),concurrency:2,pollIntervalSeconds:0.5,dispatchIntervalMs:50});
 const deadline=Date.now()+20000;let detail;
 do{detail=await service.detail(submitted.mission.id,scope);if(detail?.mission.status==='review_ready')break;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<deadline);
 console.log(JSON.stringify({ready:detail?.mission.status==='review_ready',results:detail?.results.length,proposals:detail?.proposals.length,simulated:detail?.results.some(result=>result.provenance?.simulated===true)}));
} finally {if(worker)await worker.stop();await pool.end();}`;
  const prepared = JSON.parse(compose('exec','-T','api','node','infrastructure/production/entrypoint.mjs','node','--input-type=module','-e',workerProbe));
  if (!prepared.ready || prepared.results !== 5 || prepared.proposals !== 1 || prepared.simulated !== true) throw new Error('application_role_worker_bootstrap_failed');
  result.checks.push('queue_bootstrap_by_application_role','worker_prepares_persistent_mission','provider_fixture_explicit');
  const plaintext = `import pg from 'pg';
const target=new URL(process.env.DATABASE_URL);target.searchParams.set('sslmode','disable');target.searchParams.delete('sslrootcert');
const pool=new pg.Pool({connectionString:target.href,connectionTimeoutMillis:3000});let rejected=false;try{await pool.query('SELECT 1');}catch{rejected=true;}finally{await pool.end();}console.log(JSON.stringify({rejected}));`;
  const rejected = JSON.parse(compose('exec','-T','api','node','infrastructure/production/entrypoint.mjs','node','--input-type=module','-e',plaintext));
  if (!rejected.rejected) throw new Error('plaintext_postgres_connection_accepted');
  result.checks.push('plaintext_postgres_rejected');
  const secondMigration = JSON.parse(compose('run','--rm','--no-deps','migrate'));
  if (!Array.isArray(secondMigration.migrations) || secondMigration.migrations.length !== 0) throw new Error('migrations_not_idempotent');
  result.checks.push('migrations_idempotent');
  result.completed = true;
} catch (error) {
  result.error = ['synthetic_ca_generation_failed','synthetic_certificate_request_failed','synthetic_certificate_signing_failed','synthetic_configuration_invalid','compose_rehearsal_failed','web_not_bound_to_loopback','static_console_unavailable','static_security_headers_missing','unauthenticated_api_not_rejected','api_security_headers_missing','oidc_metadata_unavailable','secret_in_public_metadata','tls_role_or_migration_check_failed','application_role_worker_bootstrap_failed','plaintext_postgres_connection_accepted','migrations_not_idempotent'].includes(error.message) ? error.message : 'local_rehearsal_failed';
  process.exitCode = 1;
} finally {
  if (cleanupNeeded) {
    if (!/^preflight-prod-smoke-[0-9a-f-]{8}$/.test(project)) throw new Error('cleanup_project_guard_failed');
    try { compose('down','--volumes','--remove-orphans'); result.cleaned = true; }
    catch { result.cleaned = false; process.exitCode = 1; }
  }
  if (result.cleaned !== false) {
    if (path.dirname(directory) !== workspace || !path.basename(directory).startsWith('preflight-production-smoke-')) throw new Error('cleanup_directory_guard_failed');
    rmSync(directory, { recursive: true, force: true });
  }
  writeFileSync(path.join(workspace, 'production-smoke-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}
