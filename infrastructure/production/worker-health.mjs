import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export function workerHealthy(filename = process.env.WORKER_HEARTBEAT_FILE ?? path.join(os.tmpdir(), 'preflight-worker-heartbeat.json'), now = Date.now()) {
  try {
    const heartbeat = JSON.parse(readFileSync(filename, 'utf8'));
    const age = now - Date.parse(heartbeat.updatedAt);
    return Number.isInteger(heartbeat.pid) && heartbeat.pid > 0 && Number.isFinite(age) && age >= 0 && age < 45000;
  } catch { return false; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = workerHealthy() ? 0 : 1;
