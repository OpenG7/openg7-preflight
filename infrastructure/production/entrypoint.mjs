import { readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const supportedSecrets = ['DATABASE_URL', 'OPENAI_API_KEY'];

export function secretEnvironment(input = process.env) {
  const env = { ...input };
  for (const key of supportedSecrets) {
    const filename = env[`${key}_FILE`];
    if (!filename) continue;
    if (env[key]) throw new Error('ambiguous_secret_configuration');
    let value;
    try {
      const file = statSync(filename);
      if (!file.isFile() || file.size > 65536) throw new Error();
      value = readFileSync(filename, 'utf8').trim();
      if (!value || value.includes('\0')) throw new Error();
    } catch { throw new Error('secret_file_invalid'); }
    env[key] = value;
    delete env[`${key}_FILE`];
  }
  return env;
}

export function runContainer(command, input = process.env) {
  if (!command.length || command[0] !== 'node') throw new Error('container_command_invalid');
  const child = spawn(process.execPath, command.slice(1), { env: secretEnvironment(input), stdio: 'inherit' });
  let failed = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  child.once('error', () => { failed = true; process.stderr.write('{"event":"container_start_failed"}\n'); process.exitCode = 1; });
  child.once('exit', code => { if (!failed) process.exitCode = code ?? 1; });
  return child;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runContainer(process.argv.slice(2)); }
  catch { process.stderr.write('{"event":"container_configuration_invalid"}\n'); process.exitCode = 1; }
}
