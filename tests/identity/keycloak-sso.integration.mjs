import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createApp } from '../../dist/apps/api/src/app.js';
import { loadApiConfig } from '../../dist/apps/api/src/auth.js';
import { reconcileSharedRealm } from '../../infrastructure/identity/shared-realm.mjs';

// Explicit, disposable local Docker rehearsal: no .env or existing realm is read.
const execute = promisify(execFile);
const image = 'openg7-keycloak:26.8.0-local';
const postgresImage = 'postgres:16-alpine';
const fundingRoot = process.env.FUNDING_SSO_ROOT;
const enabled = process.env.PREFLIGHT_KEYCLOAK_SSO_TEST === '1';
const run = async (args, env = process.env) => (await execute('docker', args, {
  env, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
})).stdout.trim();

async function eventually(operation, timeout = 120000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try { return await operation(); }
    catch { if (Date.now() >= deadline) throw new Error('disposable_service_not_ready'); }
    await setTimeout(500);
  }
}

function browser() {
  const cookies = new Map();
  return async (url, init = {}) => {
    const response = await fetch(url, { ...init, redirect: 'manual',
      headers: { ...init.headers, cookie: [...cookies.values()].join('; ') }, signal: AbortSignal.timeout(15000) });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';')[0]; cookies.set(pair.split('=')[0], pair);
    }
    return response;
  };
}

function totp(secret) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', secret).update(counter).digest(); const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

async function submit(exchange, response, id, fields) {
  const html = await response.text();
  const form = html.match(new RegExp(`<form[^>]*id="${id}"[^>]*>`));
  assert.ok(form, `expected_${id}`);
  const action = form[0].match(/action="([^"]+)"/); assert.ok(action, 'expected_form_action');
  return exchange(action[1].replaceAll('&amp;', '&'), { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
}

async function authorize(issuer, clientId, redirectUri, exchange, credentials) {
  const verifier = randomBytes(32).toString('base64url'), state = randomUUID(), nonce = randomUUID();
  const url = new URL(`${issuer}/protocol/openid-connect/auth`);
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: 'openid', state, nonce, code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
  let response = await exchange(url);
  // Only follow redirects inside the disposable provider; never visit callbacks.
  for (let hops = 0; hops < 5 && [302, 303].includes(response.status); hops++) {
    const location = response.headers.get('location');
    if (new URL(location).origin !== new URL(issuer).origin || new URL(location).pathname === new URL(redirectUri).pathname) break;
    response = await exchange(location);
  }
  if (credentials) {
    assert.equal(response.status, 200, 'fresh_browser_requires_authentication');
    response = await submit(exchange, response, 'kc-form-login', { username: credentials.username, password: credentials.password });
    response = await submit(exchange, response, 'kc-otp-login-form', { otp: totp(credentials.otp) });
  }
  assert.equal(response.status, 302, 'sso_returns_without_another_login_form');
  const callback = new URL(response.headers.get('location'));
  assert.equal(callback.origin + callback.pathname, new URL(redirectUri).origin + new URL(redirectUri).pathname);
  assert.equal(callback.searchParams.get('state'), state);
  assert.ok(callback.searchParams.get('code'), 'authorization_code_required');
  const form = { grant_type: 'authorization_code', client_id: clientId, code: callback.searchParams.get('code'), redirect_uri: redirectUri, code_verifier: verifier };
  if (credentials?.clientSecret) form.client_secret = credentials.clientSecret;
  return { form, nonce };
}

async function rehearse(t, migrate) {
  assert.ok(fundingRoot && path.isAbsolute(fundingRoot), 'FUNDING_SSO_ROOT_must_be_an_absolute_checkout');
  const context = await run(['context', 'show']);
  const endpoint = await run(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']);
  assert.match(endpoint, /^(?:npipe|unix):\/\//, 'local_docker_socket_required');
  const docker = (args, env) => run(['--context', context, ...args], env);
  assert.equal(await docker(['info', '--format', '{{.OSType}}']), 'linux');
  for (const fixtureImage of [image, postgresImage]) await docker(['image', 'inspect', fixtureImage, '--format', '{{.Id}}']);
  const directory = await mkdtemp(path.join(tmpdir(), 'preflight-keycloak-sso-'));
  const suffix = randomUUID(), network = `preflight-sso-${suffix}`;
  const containers = []; let networkCreated = false, tlsBridge;
  t.after(async () => {
    if (tlsBridge) await new Promise(resolve => tlsBridge.close(resolve));
    const results = await Promise.allSettled(containers.map(id => docker(['rm', '--force', id])));
    if (networkCreated) results.push(...await Promise.allSettled([docker(['network', 'rm', network])]));
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('preflight-keycloak-sso-'));
    await rm(directory, { recursive: true, force: true });
    assert.ok(results.every(result => result.status === 'fulfilled'), 'disposable_resources_cleaned');
  });
  let stage = 'fixture_setup';
  const migrationTrace = [];
  try {
    const realm = JSON.parse(await readFile(path.join(fundingRoot, 'docker/keycloak/openg7-realm.json'), 'utf8'));
    assert.equal(realm.browserFlow, 'openg7-browser-sso', 'funding_sso_flow_required');
    if (migrate) {
      // Rehearse migration of an existing strict realm, without a reimport.
      realm.browserFlow = 'openg7-password-otp';
      realm.authenticationFlows = realm.authenticationFlows.filter(flow => !['openg7-browser-sso', 'openg7-sso-password-otp'].includes(flow.alias));
      realm.authenticatorConfig = realm.authenticatorConfig.filter(config => !config.alias.startsWith('openg7-sso-'));
    } else realm.sslRequired = 'none';
    const password = randomBytes(24).toString('hex'), adminPassword = randomBytes(32).toString('hex');
    const fundingSecret = randomBytes(32).toString('hex'), serviceSecret = randomBytes(32).toString('hex');
    const users = ['funding-first', 'preflight-first', 'without-preflight-role'].map(username => ({ username, otp: Buffer.from(randomBytes(20).toString('hex')) }));
    realm.users = users.map(({ username, otp }) => ({ username, enabled: true, email: `${username}@example.invalid`, emailVerified: true,
      firstName: 'Synthetic', lastName: 'SSO', credentials: [
        { type: 'password', value: password, temporary: false },
        { type: 'otp', secretData: JSON.stringify({ value: otp.toString('utf8') }),
          credentialData: JSON.stringify({ digits: 6, counter: 0, period: 30, algorithm: 'HmacSHA1', subType: 'totp' }) },
      ] }));
    const callbackFunding = 'http://127.0.0.1:49871/funding-callback';
    realm.clients[0].clientId = 'synthetic-funding'; realm.clients[0].secret = fundingSecret;
    realm.clients[0].redirectUris = [callbackFunding];
    const mount = path.join(directory, 'import'); await mkdir(mount, { mode: 0o755 });
    await writeFile(path.join(mount, 'openg7-realm.json'), JSON.stringify(realm), { mode: 0o644 });
    const secretFile = path.join(directory, 'service-secret'); await writeFile(secretFile, serviceSecret, { mode: 0o600 });
    await docker(['network', 'create', network]); networkCreated = true;
    const dbPassword = randomBytes(32).toString('hex');
    const database = await docker(['run', '--detach', '--pull', 'never', '--name', `preflight-sso-db-${suffix}`, '--label', 'org.openg7.disposable-test=true',
      '--network', network, '--network-alias', 'identity-db', '--mount', 'type=tmpfs,destination=/var/lib/postgresql/data',
      '--env', 'POSTGRES_USER=keycloak', '--env', 'POSTGRES_DB=keycloak', '--env', 'POSTGRES_PASSWORD', postgresImage], { ...process.env, POSTGRES_PASSWORD: dbPassword });
    containers.unshift(database);
    await eventually(() => docker(['exec', database, 'pg_isready', '-U', 'keycloak', '-d', 'keycloak']), 30000);
    const provider = await docker(['run', '--detach', '--pull', 'never', '--name', `preflight-sso-keycloak-${suffix}`, '--label', 'org.openg7.disposable-test=true',
      '--network', network, '--publish', '127.0.0.1::8080', '--memory', '1536m', '--mount', `type=bind,source=${mount},destination=/opt/keycloak/data/import,readonly`,
      '--env', 'KC_DB_URL=jdbc:postgresql://identity-db:5432/keycloak', '--env', 'KC_DB_USERNAME=keycloak', '--env', 'KC_DB_PASSWORD',
      '--env', 'KC_HTTP_ENABLED=true', '--env', 'KC_HOSTNAME_STRICT=false', '--env', 'KC_BOOTSTRAP_ADMIN_USERNAME=synthetic-admin', '--env', 'KC_BOOTSTRAP_ADMIN_PASSWORD',
      image, 'start', '--optimized', '--import-realm'], { ...process.env, KC_DB_PASSWORD: dbPassword, KC_BOOTSTRAP_ADMIN_PASSWORD: adminPassword });
    containers.unshift(provider);
    const binding = await eventually(async () => {
      const match = /^127\.0\.0\.1:(\d+)$/.exec(await docker(['port', provider, '8080/tcp'])); assert.ok(match); return match[1];
    });
    const origin = `http://127.0.0.1:${binding}`, issuer = `${origin}/realms/openg7`;
    stage = 'provider_bootstrap';
    await eventually(async () => assert.equal((await fetch(`${origin}/realms/master/.well-known/openid-configuration`, { signal: AbortSignal.timeout(3000) })).status, 200));
    const tokenEndpoint = `${issuer}/protocol/openid-connect/token`;
    const tokens = async (form, endpoint = tokenEndpoint) => {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form), signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200, 'token_exchange_succeeds'); return response.json();
    };
    const bootstrap = await tokens({ grant_type: 'password', client_id: 'admin-cli', username: 'synthetic-admin', password: adminPassword }, `${origin}/realms/master/protocol/openid-connect/token`);
    const admin = async (resource, method = 'GET', body) => {
      const response = await fetch(`${origin}/admin/realms/openg7${resource}`, { method, headers: { authorization: `Bearer ${bootstrap.access_token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
      assert.ok(response.ok, 'fixture_admin_operation_succeeds'); return response.status === 204 ? undefined : response.json();
    };
    if (migrate) {
    stage = 'existing_realm_sso_certificate';
    const certificate = path.join(directory, 'tls.crt'), key = path.join(directory, 'tls.key');
    const openssl = process.env.PREFLIGHT_TEST_OPENSSL ?? (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
    await execute(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', certificate,
      '-subj', '/CN=Preflight Disposable SSO', '-days', '1', '-addext', 'subjectAltName=IP:127.0.0.1'], { windowsHide: true, timeout: 30000 });
    // TLS terminates only at this local test bridge. It forwards only Admin API
    // paths to our disposable provider; no TLS verification is disabled.
    tlsBridge = createHttpsServer({ key: await readFile(key), cert: await readFile(certificate) }, async (request, response) => {
      if (!request.url?.startsWith('/admin/realms/openg7')) { response.writeHead(404).end(); return; }
      try {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const upstream = await fetch(origin + request.url, { method: request.method, redirect: 'manual', signal: AbortSignal.timeout(15000),
          headers: { authorization: request.headers.authorization ?? '', 'content-type': 'application/json' }, ...(body.length ? { body } : {}) });
        const content = await upstream.text();
        migrationTrace.push({ method: request.method, path: request.url, status: upstream.status });
        response.writeHead(upstream.status, { 'content-type': 'application/json' }).end(content);
      } catch { response.writeHead(502).end(); }
    });
    tlsBridge.listen(0, '127.0.0.1'); await once(tlsBridge, 'listening');
    const { reconcileKeycloakSso } = await import(pathToFileURL(path.join(fundingRoot, 'scripts/lib/keycloak-sso.mjs')).href);
    const migration = { issuer: `https://127.0.0.1:${tlsBridge.address().port}/realms/openg7`, accessToken: bootstrap.access_token, ca: await readFile(certificate) };
    stage = 'existing_realm_sso_plan';
    assert.ok((await reconcileKeycloakSso(migration)).changes.length > 0);
    stage = 'existing_realm_sso_apply';
    await reconcileKeycloakSso({ ...migration, apply: true });
    stage = 'existing_realm_sso_repeat';
    assert.equal((await reconcileKeycloakSso({ ...migration, apply: true })).changes.length, 0, 'flow_migration_is_idempotent');
    assert.equal((await admin('')).browserFlow, 'openg7-browser-sso');
    // Browser HTTP is allowed only now, in this throwaway loopback fixture.
    await admin('', 'PUT', { sslRequired: 'none' });
    }
    const config = { issuer, consoleClientId: 'synthetic-preflight-console', audience: 'preflight-api', redirectUri: 'http://127.0.0.1:49872/preflight-callback',
      tenantId: 'synthetic-tenant', applications: ['funding-platform'], fundingService: { clientId: 'synthetic-funding-service', secretFile } };
    stage = 'shared_realm_provisioning';
    const options = { adminToken: bootstrap.access_token, allowInsecureLocal: true };
    const plan = await reconcileSharedRealm(config, options); assert.ok(plan.changes.length > 0);
    stage = 'shared_realm_apply';
    await reconcileSharedRealm(config, { ...options, apply: true });
    stage = 'shared_realm_idempotence';
    const repeated = await reconcileSharedRealm(config, options);
    if (repeated.changes.length) t.diagnostic(JSON.stringify({ remainingChanges: repeated.changes }));
    assert.equal(repeated.changes.length, 0, 'second_provisioning_is_idempotent');
    const [api] = await admin('/clients?clientId=preflight-api');
    stage = 'client_scope_drift_reconciliation';
    const [consoleClient] = await admin(`/clients?clientId=${config.consoleClientId}`);
    const profile = (await admin('/client-scopes')).find(scope => scope.name === 'profile'); assert.ok(profile);
    await admin(`/clients/${consoleClient.id}/default-client-scopes/${profile.id}`, 'PUT');
    assert.ok((await reconcileSharedRealm(config, options)).changes.length > 0);
    await reconcileSharedRealm(config, { ...options, apply: true });
    assert.equal((await admin(`/clients/${consoleClient.id}/default-client-scopes`)).length, 0, 'inherited_scope_removed_through_dedicated_api');
    assert.equal((await reconcileSharedRealm(config, options)).changes.length, 0);
    const viewer = await admin(`/clients/${api.id}/roles/viewer`);
    const assignedUsers = [];
    for (const user of users) {
      const [account] = await admin(`/users?username=${encodeURIComponent(user.username)}&exact=true`);
      assignedUsers.push(account);
      if (user.username !== 'without-preflight-role') await admin(`/users/${account.id}/role-mappings/clients/${api.id}`, 'POST', [viewer]);
    }
    const app = await createApp({ config: loadApiConfig({ NODE_ENV: 'test', AUTH_MODE: 'jwt', DATABASE_URL: 'postgres://unused:unused@127.0.0.1/unused_test',
      OIDC_ISSUER: issuer, OIDC_AUDIENCE: config.audience, OIDC_JWKS_URL: `${issuer}/protocol/openid-connect/certs`, OIDC_REQUIRE_MFA: 'true', API_RATE_LIMIT: '1000' }),
      service: {}, health: async () => undefined });
    t.after(() => app.close());
    const jwks = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));
    const exchange = async (clientId, redirectUri, jar, credentials, secret) => {
      const challenge = await authorize(issuer, clientId, redirectUri, jar, credentials);
      if (secret) challenge.form.client_secret = secret;
      const result = await tokens(challenge.form);
      const id = (await jwtVerify(result.id_token, jwks, { issuer, audience: clientId })).payload;
      assert.equal(id.nonce, challenge.nonce); return { ...result, claims: id };
    };
    const session = token => app.inject({ url: '/api/session', headers: { authorization: `Bearer ${token}` } });
    stage = 'funding_to_preflight_sso';
    const firstJar = browser();
    const funding = await exchange('synthetic-funding', callbackFunding, firstJar, { ...users[0], password }, fundingSecret);
    assert.ok(funding.claims.amr?.includes('mfa'), 'funding_receives_real_mfa');
    const preflight = await exchange(config.consoleClientId, config.redirectUri, firstJar);
    assert.equal(preflight.claims.sub, funding.claims.sub, 'same_keycloak_user');
    assert.ok(preflight.claims.amr?.includes('mfa'), 'sso_preserves_real_mfa');
    const accepted = await session(preflight.access_token); assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.json().subject, funding.claims.sub);
    assert.equal(accepted.json().tenantId, config.tenantId);
    assert.deepEqual(accepted.json().applications, ['funding-platform']); assert.deepEqual(accepted.json().roles, ['viewer']);
    assert.equal((await session(funding.access_token)).statusCode, 401, 'funding_token_has_no_preflight_audience');
    assert.equal((await app.inject({ method: 'POST', url: '/api/missions/synthetic/cancel', payload: {}, headers: { authorization: `Bearer ${preflight.access_token}` } })).statusCode, 403, 'viewer_cannot_operate');
    stage = 'preflight_to_funding_sso';
    const secondJar = browser();
    const reversePreflight = await exchange(config.consoleClientId, config.redirectUri, secondJar, { ...users[1], password });
    const reverseFunding = await exchange('synthetic-funding', callbackFunding, secondJar, undefined, fundingSecret);
    assert.equal(reverseFunding.claims.sub, reversePreflight.claims.sub);
    assert.ok(reverseFunding.claims.amr?.includes('mfa'), 'funding_sso_callback_satisfies_mfa');
    stage = 'independent_permissions';
    const unassigned = await exchange(config.consoleClientId, config.redirectUri, browser(), { ...users[2], password });
    assert.equal((await session(unassigned.access_token)).statusCode, 401, 'shared_account_does_not_grant_preflight_access');
    const machine = await tokens({ grant_type: 'client_credentials', client_id: config.fundingService.clientId, client_secret: serviceSecret });
    const machineSession = await session(machine.access_token); assert.equal(machineSession.statusCode, 200);
    assert.deepEqual(machineSession.json().roles, ['service_integration']);
    stage = 'revoked_sso_session';
    await admin(`/users/${assignedUsers[0].id}/logout`, 'POST');
    const fresh = new URL(`${issuer}/protocol/openid-connect/auth`);
    fresh.search = new URLSearchParams({ client_id: config.consoleClientId, redirect_uri: config.redirectUri, response_type: 'code', scope: 'openid',
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(randomUUID()).digest('base64url') }).toString();
    const revoked = await firstJar(fresh); assert.equal(revoked.status, 200);
    assert.match(await revoked.text(), /id="kc-form-login"/, 'revoked_session_requires_login');
    t.diagnostic(`Real Keycloak: ${migrate ? 'existing realm migration over TLS, ' : 'fresh realm, '}both SSO directions, same user, MFA, scoped rights, service identity, scope drift, idempotence and revoked session verified.`);
  } catch (error) {
    if (stage.startsWith('existing_realm_sso')) t.diagnostic(JSON.stringify({ migrationTrace }));
    const code = /^identity_[a-z0-9_]+$/.test(error?.message ?? '') ? error.message : error?.code === 'ERR_ASSERTION' ? 'assertion' : 'operation';
    throw new Error(`keycloak_sso_rehearsal_failed_at_${stage}_${code}`);
  }
}

const options = {
  skip: !enabled ? 'Set PREFLIGHT_KEYCLOAK_SSO_TEST=1 and FUNDING_SSO_ROOT for the disposable local rehearsal.' : false,
  timeout: 240000,
};
test('fresh realm shares one Keycloak user across Funding and Preflight with MFA and independent permissions', options, t => rehearse(t, false));
test('existing realm migrates to SSO over TLS and shares one user across both applications', options, t => rehearse(t, true));
