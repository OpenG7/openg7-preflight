import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { desiredSharedRealmClients, readProtectedIdentityFile, reconcileSharedRealm, validateSharedRealmConfig } from '../infrastructure/identity/shared-realm.mjs';

const configuration = {
  issuer: 'https://identity.example.test/realms/openg7', consoleClientId: 'preflight-console', audience: 'preflight-api',
  redirectUri: 'https://preflight.example.test/', tenantId: 'synthetic-tenant', applications: ['funding-platform'],
};
const adminToken = 'synthetic-admin-token';
const serviceSecret = 'synthetic-service-secret-never-print-123456';
const clone = value => structuredClone(value);

function fixture({ origin = 'https://identity.example.test' } = {}) {
  let serial = 0;
  const clients = new Map();
  const roles = new Map();
  const scopes = new Map();
  const grants = new Map();
  const requests = [];
  const realm = { realm: 'openg7', enabled: true, browserFlow: 'openg7-browser-sso' };
  const local = {};
  let interruptCreate = false;
  const reply = (data, status = 200) => new Response(data === undefined ? null : JSON.stringify(data), { status, headers: data === undefined ? { 'content-length': '0' } : { 'content-type': 'application/json' } });
  const fetcher = async (raw, options) => {
    const url = new URL(raw);
    assert.equal(url.origin, origin);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, `Bearer ${adminToken}`);
    const method = options.method;
    const body = options.body ? JSON.parse(options.body) : undefined;
    const route = url.pathname.slice('/admin/realms/openg7'.length);
    requests.push({ method, route });
    if (method === 'GET' && route === '') return reply(realm);
    if (method === 'GET' && route === '/clients') return reply([...clients.values()].filter(client => client.clientId === url.searchParams.get('clientId')).map(clone));
    if (method === 'POST' && route === '/clients') {
      if ([...clients.values()].some(client => client.clientId === body.clientId)) return reply({}, 409);
      const id = `client-${++serial}`;
      clients.set(id, { ...clone(body), id, protocolMappers: [], defaultClientScopes: body.serviceAccountsEnabled ? ['service_account'] : clone(body.defaultClientScopes) });
      if (interruptCreate) { interruptCreate = false; throw new Error('synthetic uncertain network response'); }
      return reply(undefined, 201);
    }
    const parts = route.split('/').slice(1);
    if (parts[0] === 'authentication' && parts[1] === 'flows') {
      if (method === 'GET' && parts.length === 3 && parts[2] === local.flow?.id) return reply(local.flow);
      if (method === 'GET' && parts.length === 4 && decodeURIComponent(parts[2]) === local.flow?.alias && parts[3] === 'executions') return reply(local.executions);
      return reply({}, 404);
    }
    if (parts[0] === 'clients') {
      const id = parts[1];
      const current = clients.get(id);
      if (!current) return reply({}, 404);
      if (parts.length === 2 && method === 'GET') return reply(clone(current));
      if (parts.length === 2 && method === 'PUT') {
        // Client update does not reconcile scope assignment representations.
        // Override bindings are merged by key: {} preserves them; null clears.
        const bindings = { ...current.authenticationFlowBindingOverrides };
        for (const [key, value] of Object.entries(body.authenticationFlowBindingOverrides ?? {})) {
          if (value === null) delete bindings[key];
          else bindings[key] = value;
        }
        clients.set(id, { ...clone(body), id, defaultClientScopes: current.defaultClientScopes, optionalClientScopes: current.optionalClientScopes,
          authenticationFlowBindingOverrides: bindings });
        return reply(undefined, 204);
      }
      if (['default-client-scopes', 'optional-client-scopes'].includes(parts[2])) {
        const key = parts[2] === 'default-client-scopes' ? 'defaultClientScopes' : 'optionalClientScopes';
        if (method === 'GET') return reply(current[key].map(name => ({ name, id: `scope-${name}` })));
        if (method === 'DELETE') { current[key] = current[key].filter(name => `scope-${name}` !== parts[3]); return reply(undefined, 204); }
      }
      if (parts[2] === 'protocol-mappers') {
        if (method === 'GET') return reply(clone(current.protocolMappers));
        // Keycloak omits this deprecated false flag from returned mapper models.
        const { consentRequired, ...mapperBody } = body;
        // Keycloak exposes effective defaults in GET mapper models: introspection
        // follows access.token.claim; userinfo follows id.token.claim unless set.
        mapperBody.config = {
          ...(body.config['access.token.claim'] !== undefined ? { 'introspection.token.claim': body.config['access.token.claim'] } : {}),
          ...(body.config['id.token.claim'] !== undefined ? { 'userinfo.token.claim': body.config['id.token.claim'] } : {}),
          ...body.config,
        };
        if (method === 'POST') current.protocolMappers.push({ ...clone(mapperBody), id: `mapper-${++serial}` });
        else if (method === 'PUT') current.protocolMappers[current.protocolMappers.findIndex(mapper => mapper.id === parts[4])] = { ...clone(mapperBody), id: parts[4] };
        return reply(undefined, 204);
      }
      if (parts[2] === 'roles') {
        const items = roles.get(id) ?? [];
        if (method === 'GET') return reply(clone(parts[3] ? items.find(role => role.name === parts[3]) : items));
        items.push({ ...clone(body), id: `role-${++serial}`, clientRole: true, containerId: id });
        roles.set(id, items);
        return reply(undefined, 201);
      }
      if (parts[2] === 'scope-mappings') {
        const key = `${id}/${parts[4]}`;
        if (method === 'GET') return reply(clone(scopes.get(key) ?? []));
        scopes.set(key, [...(scopes.get(key) ?? []), ...clone(body)]);
        return reply(undefined, 204);
      }
      if (parts[2] === 'client-secret') return reply({ type: 'secret', value: current.secret });
      if (parts[2] === 'service-account-user') return reply({ id: `account-${id}` });
    }
    if (parts[0] === 'users' && parts[2] === 'role-mappings') {
      const key = `${parts[1]}/${parts[4]}`;
      if (method === 'GET') return reply(clone(grants.get(key) ?? []));
      grants.set(key, [...(grants.get(key) ?? []), ...clone(body)]);
      return reply(undefined, 204);
    }
    throw new Error(`Unexpected synthetic endpoint: ${method} ${route}`);
  };
  return { fetcher, clients, roles, scopes, grants, requests, realm, local, interruptNextCreate: () => { interruptCreate = true; } };
}

test('shared realm plan performs no writes and never grants humans a role', async () => {
  const state = fixture();
  const plan = await reconcileSharedRealm(configuration, { adminToken, fetcher: state.fetcher });
  assert.equal(plan.applied, false);
  assert.ok(plan.changes.some(change => change.resource === 'client' && change.clientId === 'preflight-console'));
  assert.ok(state.requests.every(request => request.method === 'GET'));
  assert.equal(state.clients.size, 0);
  assert.equal(state.grants.size, 0);
});

test('provisioning confines claims and roles to Preflight clients and reruns without writes', async () => {
  const state = fixture();
  const applied = await reconcileSharedRealm(configuration, { adminToken, fetcher: state.fetcher, apply: true });
  assert.equal(applied.applied, true);
  const api = [...state.clients.values()].find(client => client.clientId === configuration.audience);
  const consoleClient = [...state.clients.values()].find(client => client.clientId === configuration.consoleClientId);
  assert.equal(api.bearerOnly, true);
  assert.equal(consoleClient.publicClient, true);
  assert.equal(consoleClient.fullScopeAllowed, false);
  assert.equal(consoleClient.attributes['pkce.code.challenge.method'], 'S256');
  assert.deepEqual(consoleClient.redirectUris, [configuration.redirectUri]);
  assert.deepEqual(consoleClient.optionalClientScopes, []);
  assert.equal(consoleClient.directAccessGrantsEnabled, false);
  const claims = consoleClient.protocolMappers;
  assert.equal(claims.find(mapper => mapper.name === 'preflight-roles').config['usermodel.clientRoleMapping.clientId'], configuration.audience);
  assert.equal(claims.find(mapper => mapper.name === 'preflight-roles').config['claim.name'], 'realm_access.roles');
  assert.deepEqual(JSON.parse(claims.find(mapper => mapper.name === 'preflight-applications').config['claim.value']), configuration.applications);
  assert.equal(claims.find(mapper => mapper.name === 'preflight-amr').protocolMapper, 'oidc-amr-mapper');
  assert.equal(claims.find(mapper => mapper.name === 'preflight-amr').config['access.token.claim'], 'true');
  assert.equal(claims.find(mapper => mapper.name === 'preflight-subject').protocolMapper, 'oidc-sub-mapper');
  assert.ok(claims.every(mapper => mapper.config['introspection.token.claim'] === 'false' && mapper.config['userinfo.token.claim'] === 'false'));
  assert.deepEqual([...state.scopes.values()][0].map(role => role.name).sort(), ['administrator', 'operator', 'viewer']);
  assert.equal(state.grants.size, 0);
  state.requests.length = 0;
  const repeated = await reconcileSharedRealm(configuration, { adminToken, fetcher: state.fetcher, apply: true });
  assert.deepEqual(repeated.changes, []);
  assert.ok(state.requests.every(request => request.method === 'GET'));
  assert.ok(!JSON.stringify(applied).includes(adminToken));
});

test('an unmigrated browser flow is visible in the plan and prevents apply', async () => {
  const state = fixture();
  state.realm.browserFlow = 'openg7-password-otp';
  const plan = await reconcileSharedRealm(configuration, { adminToken, fetcher: state.fetcher });
  assert.equal(plan.ssoReady, false);
  await assert.rejects(() => reconcileSharedRealm(configuration, { adminToken, fetcher: state.fetcher, apply: true }), /identity_sso_browser_flow_required/);
  assert.ok(state.requests.every(request => request.method === 'GET'));
});

test('tenant and application bindings prevent an audience granting access across deployments', async () => {
  const state = fixture();
  await reconcileSharedRealm(configuration, { adminToken, fetcher: state.fetcher, apply: true });
  for (const modified of [
    { ...configuration, tenantId: 'other-tenant', consoleClientId: 'other-console' },
    { ...configuration, applications: ['openg7-social'], consoleClientId: 'other-console' },
  ]) {
    state.requests.length = 0;
    await assert.rejects(() => reconcileSharedRealm(modified, { adminToken, fetcher: state.fetcher, apply: true }), /identity_client_(tenant|applications)_binding_mismatch/);
    assert.ok(state.requests.every(request => request.method === 'GET'));
    assert.equal(state.clients.size, 2);
  }
});

test('inherited scope drift is removed through its own endpoints and verified by a fresh plan', async () => {
  const state = fixture();
  await reconcileSharedRealm(configuration, { adminToken, fetcher: state.fetcher, apply: true });
  const client = [...state.clients.values()].find(item => item.clientId === configuration.consoleClientId);
  client.defaultClientScopes.push('foreign-default');
  client.optionalClientScopes.push('foreign-optional');
  state.requests.length = 0;
  const result = await reconcileSharedRealm(configuration, { adminToken, fetcher: state.fetcher, apply: true });
  assert.deepEqual(result.changes.map(change => change.resource), ['default-scope', 'optional-scope']);
  assert.equal(state.requests.filter(request => request.method === 'DELETE').length, 2);
  assert.deepEqual(client.defaultClientScopes, []);
  assert.deepEqual(client.optionalClientScopes, []);
  assert.deepEqual((await reconcileSharedRealm(configuration, { adminToken, fetcher: state.fetcher })).changes, []);
});

test('unmanaged existing clients and unexpected mappers fail before any writes', async () => {
  const state = fixture();
  state.clients.set('existing', { id: 'existing', clientId: configuration.consoleClientId, attributes: {} });
  await assert.rejects(() => reconcileSharedRealm(configuration, { adminToken, fetcher: state.fetcher, apply: true }), /identity_existing_client_not_managed/);
  assert.ok(state.requests.every(request => request.method === 'GET'));
  state.clients.clear();
  await reconcileSharedRealm(configuration, { adminToken, fetcher: state.fetcher, apply: true });
  const client = [...state.clients.values()].find(item => item.clientId === configuration.consoleClientId);
  client.protocolMappers.push({ name: 'foreign-mapper', id: 'foreign' });
  client.enabled = false;
  state.requests.length = 0;
  await assert.rejects(() => reconcileSharedRealm(configuration, { adminToken, fetcher: state.fetcher, apply: true }), /identity_unexpected_mapper/);
  assert.ok(state.requests.every(request => request.method === 'GET'));
  assert.equal(client.enabled, false);
});

test('an uncertain create stops and a fresh run reconciles the existing client', async () => {
  const state = fixture();
  state.interruptNextCreate();
  await assert.rejects(() => reconcileSharedRealm(configuration, { adminToken, fetcher: state.fetcher, apply: true }), /identity_request_uncertain_reconcile_before_retry/);
  assert.equal(state.clients.size, 1);
  await reconcileSharedRealm(configuration, { adminToken, fetcher: state.fetcher, apply: true });
  assert.equal(state.clients.size, 2);
  assert.equal(new Set([...state.clients.values()].map(client => client.clientId)).size, 2);
});

test('Funding service has its own secret, tenant and application with only service_integration', async () => {
  const state = fixture();
  const config = { ...configuration, applications: ['openg7-social'], fundingService: { clientId: 'funding-preflight', secretFile: pathForSyntheticSecret() } };
  const options = { adminToken, fetcher: state.fetcher, apply: true, readSecretFile: () => serviceSecret };
  const result = await reconcileSharedRealm(config, options);
  const service = [...state.clients.values()].find(client => client.clientId === config.fundingService.clientId);
  assert.equal(service.publicClient, false);
  assert.equal(service.standardFlowEnabled, false);
  assert.equal(service.directAccessGrantsEnabled, false);
  assert.equal(service.serviceAccountsEnabled, true);
  assert.deepEqual(service.defaultClientScopes, []);
  assert.equal(service.secret, serviceSecret);
  assert.deepEqual(JSON.parse(service.protocolMappers.find(mapper => mapper.name === 'preflight-applications').config['claim.value']), ['funding-platform']);
  assert.deepEqual([...state.grants.values()].flat().map(role => role.name), ['service_integration']);
  assert.ok(!JSON.stringify(result).includes(serviceSecret));
  state.requests.length = 0;
  assert.deepEqual((await reconcileSharedRealm(config, options)).changes, []);
  assert.ok(state.requests.every(request => request.method === 'GET'));
  state.requests.length = 0;
  await assert.rejects(() => reconcileSharedRealm(config, { ...options, readSecretFile: () => `${serviceSecret}-rotated` }), /identity_service_secret_rotation_requires_separate_operation/);
  assert.ok(state.requests.every(request => request.method === 'GET'));
});

function pathForSyntheticSecret() {
  return process.platform === 'win32' ? 'C:\\synthetic\\funding-service-secret' : '/synthetic/funding-service-secret';
}

test('unsafe URLs, wildcard callbacks, duplicate clients and unknown fields are rejected without leaking inputs', () => {
  for (const input of [
    { ...configuration, issuer: 'http://remote.example.test/realms/openg7' },
    { ...configuration, issuer: 'https://private:never-print@example.test/realms/openg7' },
    { ...configuration, issuer: 'https://identity.example.test/realms/openg7?secret=never-print' },
    { ...configuration, redirectUri: 'https://preflight.example.test/*' },
    { ...configuration, consoleClientId: configuration.audience },
    { ...configuration, applications: [] },
    { ...configuration, userRole: 'administrator' },
  ]) assert.throws(() => validateSharedRealmConfig(input), error => /^identity_/.test(error.message) && !error.message.includes('never-print'));
  assert.throws(() => validateSharedRealmConfig({ ...configuration, issuer: 'http://remote.example.test/realms/openg7' }, { allowInsecureLocal: true }), /identity_url_invalid/);
  assert.equal(validateSharedRealmConfig({ ...configuration, issuer: 'http://127.0.0.1:8080/realms/openg7' }, { allowInsecureLocal: true }).issuer, 'http://127.0.0.1:8080/realms/openg7');
  assert.equal(desiredSharedRealmClients(configuration).length, 2);
});

test('disabled TLS verification is refused by module and CLI before any request or file read', async () => {
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  let requests = 0;
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    await assert.rejects(() => reconcileSharedRealm(configuration, { adminToken, fetcher: () => { requests++; throw new Error('must not call'); } }), /identity_tls_verification_required/);
    assert.equal(requests, 0);
  } finally {
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
  }
  const cli = spawnSync(process.execPath, ['infrastructure/identity/shared-realm.mjs', '--config', 'nonexistent-public.json', '--admin-token-file', 'nonexistent-token'], {
    encoding: 'utf8', env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }, windowsHide: true,
  });
  assert.equal(cli.status, 1);
  assert.equal(JSON.parse(cli.stderr.trim()).code, 'identity_tls_verification_required');
  assert.equal(cli.stdout, '');
});

test('identity files must be small regular protected files and errors do not expose contents', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'preflight-identity-file-'));
  const file = path.join(directory, 'synthetic-token');
  const link = path.join(directory, 'synthetic-link');
  t.after(() => { rmSync(link, { force: true }); rmSync(file, { force: true }); rmdirSync(directory); });
  writeFileSync(file, `${adminToken}\n`, { mode: 0o600 });
  assert.equal(readProtectedIdentityFile(file), adminToken);
  assert.throws(() => readProtectedIdentityFile(directory), /identity_secret_file_unreadable/);
  writeFileSync(file, 'x'.repeat(16385));
  assert.throws(() => readProtectedIdentityFile(file), /identity_secret_file_unreadable/);
  writeFileSync(file, adminToken);
  if (process.platform !== 'win32') {
    chmodSync(file, 0o644);
    assert.throws(() => readProtectedIdentityFile(file), /identity_secret_file_unreadable/);
    chmodSync(file, 0o600);
    symlinkSync(file, link);
    assert.throws(() => readProtectedIdentityFile(link), /identity_secret_file_unreadable/);
  }
});

const localConfiguration = {
  ...configuration, issuer: 'https://auth.openg7.test/realms/openg7', redirectUri: 'https://localhost:8444/',
  localPasswordSso: { fundingClientId: 'openg7-funding-admin', flowId: '123e4567-e89b-12d3-a456-426614174000' },
};

function localFixture() {
  const state = fixture({ origin: 'https://auth.openg7.test' });
  state.local.flow = {
    id: localConfiguration.localPasswordSso.flowId,
    alias: 'openg7-local-password-only-' + createHash('sha256').update(localConfiguration.localPasswordSso.fundingClientId).digest('hex').slice(0, 12),
    providerId: 'basic-flow', topLevel: true, builtIn: false,
  };
  state.local.executions = [
    { id: 'local-cookie', providerId: 'auth-cookie', requirement: 'ALTERNATIVE', priority: 0 },
    { id: 'local-password', providerId: 'auth-username-password-form', requirement: 'ALTERNATIVE', priority: 10, authenticationConfig: 'local-password-reference' },
    { id: 'local-otp', providerId: 'auth-otp-form', requirement: 'DISABLED', priority: 20 },
  ];
  state.clients.set('funding-source', {
    id: 'funding-source', clientId: localConfiguration.localPasswordSso.fundingClientId,
    enabled: true, protocol: 'openid-connect', publicClient: false, clientAuthenticatorType: 'client-secret',
    standardFlowEnabled: true, implicitFlowEnabled: false, directAccessGrantsEnabled: false, serviceAccountsEnabled: false,
    authenticationFlowBindingOverrides: { browser: localConfiguration.localPasswordSso.flowId },
    redirectUris: ['https://localhost:8443/api/admin/auth/callback'],
  });
  return state;
}

test('localhost password SSO shares only a verified Funding override and remains idempotent', async () => {
  const state = localFixture();
  const fundingBefore = clone(state.clients.get('funding-source'));
  const options = { adminToken, fetcher: state.fetcher, apply: true };
  const result = await reconcileSharedRealm(localConfiguration, options);
  assert.equal(result.authenticationProfile, 'localhost_password_sso');
  const consoleClient = [...state.clients.values()].find(item => item.clientId === configuration.consoleClientId);
  assert.deepEqual(consoleClient.authenticationFlowBindingOverrides, { browser: localConfiguration.localPasswordSso.flowId });
  assert.deepEqual(state.clients.get('funding-source'), fundingBefore);
  state.requests.length = 0;
  assert.deepEqual((await reconcileSharedRealm(localConfiguration, options)).changes, []);
  assert.ok(state.requests.every(request => request.method === 'GET'));
  consoleClient.authenticationFlowBindingOverrides = {};
  await reconcileSharedRealm(localConfiguration, options);
  assert.deepEqual([...state.clients.values()].find(item => item.clientId === configuration.consoleClientId).authenticationFlowBindingOverrides, { browser: localConfiguration.localPasswordSso.flowId });
  assert.deepEqual(state.clients.get('funding-source'), fundingBefore);
});

test('local password SSO rejects other issuers, remote callbacks and malformed references before requests', async () => {
  for (const changed of [
    { issuer: configuration.issuer },
    { issuer: 'https://auth.openg7.test:8443/realms/openg7' },
    { redirectUri: 'https://preflight.example.test/' },
    { redirectUri: 'http://localhost:8444/' },
    { redirectUri: 'https://127.0.0.1:8444/' },
    { localPasswordSso: { ...localConfiguration.localPasswordSso, flowId: '../unsafe' } },
    { localPasswordSso: { ...localConfiguration.localPasswordSso, fundingClientId: configuration.consoleClientId } },
    { localPasswordSso: { ...localConfiguration.localPasswordSso, unexpected: true } },
  ]) {
    const state = localFixture();
    await assert.rejects(() => reconcileSharedRealm({ ...localConfiguration, ...changed }, { adminToken, fetcher: state.fetcher, apply: true }), /identity_/);
    assert.equal(state.requests.length, 0);
  }
});

test('removing local password SSO explicitly clears managed bindings and restores the realm MFA flow', async () => {
  const state = localFixture();
  const fundingBefore = clone(state.clients.get('funding-source'));
  const options = { adminToken, fetcher: state.fetcher, apply: true };
  await reconcileSharedRealm(localConfiguration, options);
  const consoleClient = [...state.clients.values()].find(item => item.clientId === configuration.consoleClientId);
  consoleClient.authenticationFlowBindingOverrides.direct_grant = 'unexpected-managed-override';
  const { localPasswordSso, ...standardConfig } = localConfiguration;
  const restored = await reconcileSharedRealm(standardConfig, options);
  assert.equal(restored.authenticationProfile, 'mfa_sso');
  assert.deepEqual([...state.clients.values()].find(item => item.clientId === configuration.consoleClientId).authenticationFlowBindingOverrides, {});
  assert.deepEqual(state.clients.get('funding-source'), fundingBefore);
  state.requests.length = 0;
  assert.deepEqual((await reconcileSharedRealm(standardConfig, options)).changes, []);
  assert.ok(state.requests.every(request => request.method === 'GET'));
});

test('local password SSO rejects source, alias and execution drift without any writes', async () => {
  for (const alter of [
    state => { state.local.flow.alias += '-foreign'; },
    state => { state.local.flow.builtIn = true; },
    state => { state.local.executions[0].authenticationConfig = 'fake-password-reference'; },
    state => { state.local.executions[1].requirement = 'REQUIRED'; },
    state => { state.local.executions[2].requirement = 'REQUIRED'; },
    state => { state.clients.get('funding-source').authenticationFlowBindingOverrides = {}; },
    state => { state.clients.get('funding-source').redirectUris = ['https://remote.example.test/api/admin/auth/callback']; },
  ]) {
    const state = localFixture();
    alter(state);
    await assert.rejects(() => reconcileSharedRealm(localConfiguration, { adminToken, fetcher: state.fetcher, apply: true }), /identity_local_password_sso_/);
    assert.ok(state.requests.every(request => request.method === 'GET'));
    assert.equal(state.clients.size, 1);
  }
});
