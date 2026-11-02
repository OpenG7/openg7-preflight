import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
if (!existsSync('.env')) throw new Error('Copiez .env.example en .env avant npm run dev.');
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const entry of ['apps/api/src/main.ts', 'apps/worker/src/main.ts']) {
  children.push(spawn(process.execPath, ['--env-file=.env', '--import', 'tsx', entry], { stdio: 'inherit', windowsHide: true }));
}
children.push(spawn(process.execPath, [path.resolve('node_modules/@angular/cli/bin/ng.js'), 'serve', '--host', '127.0.0.1', '--port', '4300', '--proxy-config', 'proxy.conf.json'], { cwd: path.resolve('apps/admin-web'), stdio: 'inherit', windowsHide: true }));
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code ?? 1); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
