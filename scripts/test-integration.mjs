import { spawn } from 'node:child_process';
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL requis; utiliser une base PostgreSQL de test distincte.');
const target = new URL(process.env.TEST_DATABASE_URL);
if (!/test/i.test(target.pathname)) throw new Error('Le nom de la base doit contenir test pour cette suite.');
const child = spawn(process.execPath, ['--import', 'tsx', '--test', 'tests/integration.test.ts'], { stdio: 'inherit', env: process.env, windowsHide: true });
child.on('error', () => { process.stderr.write('integration_runner_failed\n'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
