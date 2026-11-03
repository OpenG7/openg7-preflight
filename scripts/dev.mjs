import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
if (!existsSync('.env')) throw new Error('Copiez .env.example en .env avant npm run dev.');
// Node preserves variables already provided by the caller (including isolated tests).
process.loadEnvFile('.env');
function port(value, fallback) {
  const result = Number(value ?? fallback);
  if (!Number.isInteger(result) || result < 1 || result > 65535) throw new Error('Port de développement invalide.');
  return result;
}
const apiPort = port(process.env.PREFLIGHT_DEV_API_PORT ?? process.env.PORT, 3000);
const webPort = port(process.env.PREFLIGHT_DEV_WEB_PORT, 4300);
if (apiPort === webPort) throw new Error('Les ports API et console doivent être distincts.');
const webHost = process.env.PREFLIGHT_DEV_WEB_HOST ?? '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(webHost)) throw new Error('La console de développement doit rester sur loopback.');
const hostForUrl = webHost === '::1' ? '[::1]' : webHost;
const webOrigin = new URL(`http://${hostForUrl}:${webPort}`).origin;
const apiTarget = new URL(`http://127.0.0.1:${apiPort}`);
if (apiTarget.hostname !== '127.0.0.1' || apiTarget.username || apiTarget.password) throw new Error('Cible du proxy de développement invalide.');
const proxyDirectory = path.resolve('.local');
mkdirSync(proxyDirectory, { recursive: true });
const proxyFile = path.join(proxyDirectory, `dev-proxy-${apiPort}-${webPort}.json`);
writeFileSync(proxyFile, JSON.stringify({
  '/api': { target: apiTarget.origin, secure: false },
  '/health': { target: apiTarget.origin, secure: false },
}, null, 2) + '\n');
const childEnvironment = {
  ...process.env,
  PORT: String(apiPort),
  HOST: '127.0.0.1',
  DEV_WEB_ORIGIN: webOrigin,
};
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const entry of ['apps/api/src/main.ts', 'apps/worker/src/main.ts']) {
  children.push(spawn(process.execPath, ['--env-file=.env', '--import', 'tsx', entry], { stdio: 'inherit', windowsHide: true, env: childEnvironment }));
}
children.push(spawn(process.execPath, [path.resolve('node_modules/@angular/cli/bin/ng.js'), 'serve', '--host', webHost, '--port', String(webPort), '--proxy-config', proxyFile], { cwd: path.resolve('apps/admin-web'), stdio: 'inherit', windowsHide: true, env: childEnvironment }));
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code ?? 1); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
