import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
// Deployment helpers are JavaScript so the runtime image needs no TS loader.
// Resolve from the documented repository-root invocation in source and dist tests.
const { secretEnvironment } = await import(pathToFileURL(path.resolve('infrastructure/production/entrypoint.mjs')).href);
const { workerHealthy } = await import(pathToFileURL(path.resolve('infrastructure/production/worker-health.mjs')).href);
const { checkProductionEnvironment } = await import(pathToFileURL(path.resolve('infrastructure/production/check-config.mjs')).href);

function fixture(t: { after: (callback: () => void) => void }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'preflight-production-test-'));
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('preflight-production-test-'));
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test('secret files are loaded without mutating the caller environment or retaining file variables', t => {
  const dir = fixture(t);
  const file = path.join(dir, 'synthetic-secret');
  writeFileSync(file, 'synthetic-local-only\n', { mode: 0o600 });
  const input = { DATABASE_URL_FILE: file, NODE_ENV: 'production' };
  const env = secretEnvironment(input);
  assert.equal(env.DATABASE_URL, 'synthetic-local-only');
  assert.equal(env.DATABASE_URL_FILE, undefined);
  assert.equal(input.DATABASE_URL_FILE, file);
});

test('missing, empty, oversized, non-file and ambiguous secrets fail without exposing values or paths', t => {
  const dir = fixture(t);
  const file = path.join(dir, 'synthetic-secret');
  for (const value of ['', ' '.repeat(3), 'x'.repeat(65537), 'bad\0value']) {
    writeFileSync(file, value);
    assert.throws(() => secretEnvironment({ OPENAI_API_KEY_FILE: file }), /^Error: secret_file_invalid$/);
  }
  const directory = path.join(dir, 'directory'); mkdirSync(directory);
  assert.throws(() => secretEnvironment({ OPENAI_API_KEY_FILE: directory }), /^Error: secret_file_invalid$/);
  assert.throws(() => secretEnvironment({ OPENAI_API_KEY_FILE: path.join(dir, 'absent') }), /^Error: secret_file_invalid$/);
  assert.throws(() => secretEnvironment({ OPENAI_API_KEY: 'must-not-appear', OPENAI_API_KEY_FILE: file }), /^Error: ambiguous_secret_configuration$/);
});

test('worker health rejects absent, stale, future, malformed and invalid process heartbeats', t => {
  const dir = fixture(t); const file = path.join(dir, 'heartbeat.json');
  const now = Date.parse('2026-11-02T00:00:00Z');
  assert.equal(workerHealthy(file, now), false);
  for (const value of ['bad', JSON.stringify({ updatedAt: new Date(now - 45000).toISOString(), pid: 42 }), JSON.stringify({ updatedAt: new Date(now + 1).toISOString(), pid: 42 }), JSON.stringify({ updatedAt: new Date(now).toISOString(), pid: -1 })]) {
    writeFileSync(file, value); assert.equal(workerHealthy(file, now), false);
  }
  writeFileSync(file, JSON.stringify({ updatedAt: new Date(now - 10000).toISOString(), pid: 42 }));
  assert.equal(workerHealthy(file, now), true);
});

test('entrypoint reports only a safe error code for an unreadable secret', () => {
  const result = spawnSync(process.execPath, ['infrastructure/production/entrypoint.mjs', 'node', '-e', 'process.exit(0)'], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: '', DATABASE_URL_FILE: '/synthetic-private-marker/not-present' },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /container_configuration_invalid/);
  assert.equal(result.stderr.includes('synthetic-private-marker'), false);
});

test('public production configuration rejects placeholders, insecure identity, untagged images and inline secrets', () => {
  const config = {
    PREFLIGHT_SERVER_IMAGE: 'preflight:release-1', PREFLIGHT_WEB_IMAGE: 'preflight-web:release-1',
    OIDC_ISSUER: 'https://identity.test.invalid/realms/local', OIDC_JWKS_URL: 'https://identity.test.invalid/jwks',
    OIDC_BROWSER_REDIRECT_URI: 'https://console.test.invalid/', OIDC_AUDIENCE: 'preflight-api', OIDC_BROWSER_CLIENT_ID: 'console',
    OPENAI_MODEL: 'synthetic-config-only', AI_INPUT_PRICE_PER_MILLION: '1', AI_OUTPUT_PRICE_PER_MILLION: '1',
    ...Object.fromEntries(['DATABASE_URL','POSTGRES_ADMIN_PASSWORD','POSTGRES_APP_PASSWORD','POSTGRES_CA','POSTGRES_CERT','POSTGRES_KEY','OPENAI_API_KEY'].map(key => [`PREFLIGHT_${key}_FILE`, path.resolve('synthetic-not-read')])),
  };
  assert.deepEqual(checkProductionEnvironment(config, { requireFiles: false }), []);
  for (const patch of [{ DATABASE_URL: 'synthetic-secret' }, { OPENAI_API_KEY: 'synthetic-secret' }, { OIDC_ISSUER: 'http://identity.test.invalid/' }, { OIDC_ISSUER: 'https://identity.test.invalid/?token=synthetic' }, { OIDC_JWKS_URL: 'https://identity.test.invalid/jwks#synthetic' }, { OIDC_BROWSER_REDIRECT_URI: 'https://console.test.invalid/?synthetic=1' }, { OIDC_BROWSER_REDIRECT_URI: 'https://console.test.invalid/#synthetic' }, { OIDC_BROWSER_REDIRECT_URI: 'https://synthetic@console.test.invalid/' }, { PREFLIGHT_SERVER_IMAGE: 'preflight:latest' }, { OPENAI_MODEL: 'replace-with-model' }, { AI_INPUT_PRICE_PER_MILLION: 'NaN' }, { WORKER_CONCURRENCY: '99' }]) {
    assert.ok(checkProductionEnvironment({ ...config, ...patch }, { requireFiles: false }).length > 0);
  }
});
