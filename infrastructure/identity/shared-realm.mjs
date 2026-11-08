import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const managedBy = 'openg7-preflight/shared-realm-v1';
const marker = 'openg7.preflight.managed-by';
const tenantMarker = 'openg7.preflight.tenant-id';
const applicationsMarker = 'openg7.preflight.applications';
const humanRoles = ['viewer', 'operator', 'administrator'];
const serviceRole = 'service_integration';
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const flowIdentifier = /^[a-zA-Z0-9_.:-]{1,255}$/;
const flowUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = code => { throw new Error(code); };
const array = value => Array.isArray(value) ? value : fail('identity_response_invalid');
const secureTls = () => {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('identity_tls_verification_required');
};

function safeUrl(raw, allowInsecureLocal) {
  try {
    const url = new URL(raw);
    const local = allowInsecureLocal && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash || url.href.includes('*')) throw new Error();
    return url;
  } catch { fail('identity_url_invalid'); }
}

/** One deployment/client owns one tenant and an explicit set of applications. */
export function validateSharedRealmConfig(value, { allowInsecureLocal = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('identity_configuration_invalid');
  const known = new Set(['issuer', 'consoleClientId', 'audience', 'redirectUri', 'tenantId', 'applications', 'fundingService', 'localPasswordSso']);
  if (Object.keys(value).some(key => !known.has(key))) fail('identity_configuration_unknown_field');
  const issuer = safeUrl(value.issuer, allowInsecureLocal);
  const match = /^\/realms\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,127})$/.exec(issuer.pathname);
  if (!match) fail('identity_issuer_invalid');
  const redirect = safeUrl(value.redirectUri, allowInsecureLocal);
  for (const key of ['consoleClientId', 'audience', 'tenantId']) if (typeof value[key] !== 'string' || !identifier.test(value[key])) fail('identity_identifier_invalid');
  if (!Array.isArray(value.applications) || value.applications.length < 1 || value.applications.length > 100 || value.applications.some(app => typeof app !== 'string' || !identifier.test(app)) || new Set(value.applications).size !== value.applications.length) fail('identity_applications_invalid');
  const config = {
    issuer: issuer.href, consoleClientId: value.consoleClientId, audience: value.audience,
    redirectUri: redirect.href, tenantId: value.tenantId, applications: [...value.applications].sort(),
  };
  if (value.fundingService !== undefined) {
    const service = value.fundingService;
    if (!service || typeof service !== 'object' || Array.isArray(service) || Object.keys(service).some(key => !['clientId', 'secretFile'].includes(key)) || typeof service.clientId !== 'string' || !identifier.test(service.clientId) || typeof service.secretFile !== 'string' || !path.isAbsolute(service.secretFile)) fail('identity_service_configuration_invalid');
    config.fundingService = { clientId: service.clientId, secretFile: service.secretFile };
  }
  if (value.localPasswordSso !== undefined) {
    const local = value.localPasswordSso;
    if (config.issuer !== 'https://auth.openg7.test/realms/openg7' || redirect.protocol !== 'https:' || redirect.hostname !== 'localhost' ||
      !local || typeof local !== 'object' || Array.isArray(local) || Object.keys(local).some(key => !['fundingClientId', 'flowId'].includes(key)) ||
      typeof local.fundingClientId !== 'string' || !identifier.test(local.fundingClientId) || typeof local.flowId !== 'string' || !flowUuid.test(local.flowId)) fail('identity_local_password_sso_configuration_invalid');
    config.localPasswordSso = { fundingClientId: local.fundingClientId, flowId: local.flowId };
  }
  const clients = [config.consoleClientId, config.audience, config.fundingService?.clientId].filter(Boolean);
  if (config.localPasswordSso) clients.push(config.localPasswordSso.fundingClientId);
  if (new Set(clients).size !== clients.length) fail('identity_clients_must_be_distinct');
  return config;
}

const mapper = (name, protocolMapper, config) => ({ name: `preflight-${name}`, protocol: 'openid-connect', protocolMapper, consentRequired: false,
  config: { 'introspection.token.claim': 'false', 'userinfo.token.claim': 'false', ...config } });
const accessClaim = (name, value, type = 'String') => mapper(name, 'oidc-hardcoded-claim-mapper', {
  'claim.name': name, 'claim.value': value, 'jsonType.label': type,
  'access.token.claim': 'true', 'id.token.claim': 'false', 'userinfo.token.claim': 'false',
});

function tokenMappers(config, applications) {
  return [
    mapper('subject', 'oidc-sub-mapper', { 'access.token.claim': 'true' }),
    accessClaim('tenant_id', config.tenantId),
    accessClaim('applications', JSON.stringify(applications), 'JSON'),
    mapper('audience', 'oidc-audience-mapper', { 'included.client.audience': config.audience, 'access.token.claim': 'true', 'id.token.claim': 'false' }),
    mapper('roles', 'oidc-usermodel-client-role-mapper', {
      'usermodel.clientRoleMapping.clientId': config.audience, 'claim.name': 'realm_access.roles',
      'multivalued': 'true', 'jsonType.label': 'String', 'access.token.claim': 'true', 'id.token.claim': 'false', 'userinfo.token.claim': 'false',
    }),
  ];
}

/** Public representations contain no user grants, secrets, or Funding changes. */
export function desiredSharedRealmClients(config) {
  const base = { enabled: true, protocol: 'openid-connect', fullScopeAllowed: false, consentRequired: false,
    standardFlowEnabled: false, implicitFlowEnabled: false, directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false, publicClient: false, bearerOnly: false,
    defaultClientScopes: [], optionalClientScopes: [], redirectUris: [], webOrigins: [], authenticationFlowBindingOverrides: {},
    attributes: { [marker]: managedBy, [tenantMarker]: config.tenantId, [applicationsMarker]: JSON.stringify([...config.applications].sort()),
      'oauth2.device.authorization.grant.enabled': 'false', 'oidc.ciba.grant.enabled': 'false' } };
  const clients = [
    { ...base, clientId: config.audience, name: 'Preflight API', bearerOnly: true, protocolMappers: [] },
    { ...base, clientId: config.consoleClientId, name: 'Preflight console', publicClient: true, standardFlowEnabled: true,
      redirectUris: [config.redirectUri], webOrigins: [new URL(config.redirectUri).origin],
      authenticationFlowBindingOverrides: config.localPasswordSso ? { browser: config.localPasswordSso.flowId } : {},
      attributes: { ...base.attributes, 'pkce.code.challenge.method': 'S256', 'use.refresh.tokens': 'false' },
      protocolMappers: [...tokenMappers(config, config.applications), mapper('amr', 'oidc-amr-mapper', { 'access.token.claim': 'true', 'id.token.claim': 'true' })] },
  ];
  if (config.fundingService) clients.push({ ...base, clientId: config.fundingService.clientId, name: 'Funding to Preflight service',
    serviceAccountsEnabled: true, clientAuthenticatorType: 'client-secret', attributes: { ...base.attributes, [applicationsMarker]: '["funding-platform"]', 'use.refresh.tokens': 'false' },
    protocolMappers: tokenMappers(config, ['funding-platform']) });
  return clients;
}

export function readProtectedIdentityFile(file) {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384 || (process.platform !== 'win32' && stat.mode & 0o077)) throw new Error();
    return readFileSync(file, 'utf8').trim();
  } catch { fail('identity_secret_file_unreadable'); }
}

const pick = (value, expected) => Object.fromEntries(Object.entries(expected).map(([key, item]) => [key,
  key === 'attributes' ? Object.fromEntries(Object.keys(item).map(name => [name, value?.[key]?.[name]])) :
    key === 'consentRequired' && value?.[key] === undefined ? false : value?.[key],
]));
const same = (actual, expected) => isDeepStrictEqual(pick(actual, expected), expected);

/**
 * Read-only plan by default. Apply makes bounded, independently repeatable Admin
 * API writes. On uncertainty, stop; rerunning starts by reading server state.
 */
export async function reconcileSharedRealm(input, { adminToken, fetcher = fetch, apply = false, allowInsecureLocal = false, readSecretFile = readProtectedIdentityFile } = {}) {
  secureTls();
  const config = validateSharedRealmConfig(input, { allowInsecureLocal });
  if (typeof adminToken !== 'string' || !adminToken.trim() || /[\s\0]/.test(adminToken)) fail('identity_admin_token_invalid');
  // Detect existing collisions/drift before writing, then re-read on apply. A
  // concurrent change can still interrupt the run; never blindly retry writes.
  if (apply) {
    const plan = await reconcileSharedRealm(config, { adminToken, fetcher, allowInsecureLocal, readSecretFile });
    if (!plan.ssoReady) fail('identity_sso_browser_flow_required');
  }
  const issuer = new URL(config.issuer);
  const realm = issuer.pathname.slice('/realms/'.length);
  const baseUrl = `${issuer.origin}/admin/realms/${encodeURIComponent(realm)}`;
  const changes = [];
  const change = (action, resource, clientId, name) => changes.push({ action, resource, clientId, ...(name ? { name } : {}) });
  const request = async (method, resource, body) => {
    let response;
    try {
      response = await fetcher(`${baseUrl}${resource}`, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { authorization: `Bearer ${adminToken}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch { fail('identity_request_uncertain_reconcile_before_retry'); }
    if (!response.ok) fail(response.status === 409 ? 'identity_conflict_reconcile_before_retry' : `identity_request_rejected_${response.status}`);
    if (response.status === 204 || response.headers.get('content-length') === '0') return undefined;
    const content = await response.text();
    if (!content) return undefined;
    try { return JSON.parse(content); } catch { fail('identity_response_invalid'); }
  };
  const realmState = await request('GET', '');
  if (!realmState || realmState.realm !== realm || realmState.enabled !== true) fail('identity_realm_unavailable');
  const ssoReady = realmState.browserFlow === 'openg7-browser-sso';
  if (apply && !ssoReady) fail('identity_sso_browser_flow_required');
  if (config.localPasswordSso) {
    const { fundingClientId, flowId } = config.localPasswordSso;
    const alias = 'openg7-local-password-only-' + createHash('sha256').update(fundingClientId).digest('hex').slice(0, 12);
    const flow = await request('GET', `/authentication/flows/${encodeURIComponent(flowId)}`);
    if (flow?.id !== flowId || flow.alias !== alias || flow.providerId !== 'basic-flow' || flow.topLevel !== true || flow.builtIn !== false) fail('identity_local_password_sso_flow_mismatch');
    const executions = array(await request('GET', `/authentication/flows/${encodeURIComponent(alias)}/executions`));
    const password = executions.find(item => item.providerId === 'auth-username-password-form');
    const cookie = executions.find(item => item.providerId === 'auth-cookie');
    const otp = executions.find(item => item.providerId === 'auth-otp-form');
    if (!password || !cookie || executions.length !== 2 + Number(Boolean(otp)) ||
      new Set(executions.map(item => item.id)).size !== executions.length || executions.some(item => !flowIdentifier.test(item.id ?? '') || item.authenticationFlow === true) ||
      password.requirement !== 'ALTERNATIVE' || password.priority !== 10 || !flowIdentifier.test(password.authenticationConfig ?? '') ||
      cookie.requirement !== 'ALTERNATIVE' || cookie.priority !== 0 || cookie.authenticationConfig || (otp && otp.requirement !== 'DISABLED')) fail('identity_local_password_sso_executions_mismatch');
    const sources = array(await request('GET', `/clients?clientId=${encodeURIComponent(fundingClientId)}`)).filter(client => client.clientId === fundingClientId);
    if (sources.length !== 1 || !flowIdentifier.test(sources[0].id ?? '')) fail('identity_local_password_sso_source_mismatch');
    const source = await request('GET', `/clients/${encodeURIComponent(sources[0].id)}`);
    let callback;
    try { callback = new URL(source?.redirectUris?.[0]); } catch { fail('identity_local_password_sso_source_mismatch'); }
    if (source.clientId !== fundingClientId || source.enabled !== true || source.protocol !== 'openid-connect' || source.publicClient !== false || source.clientAuthenticatorType !== 'client-secret' ||
      source.standardFlowEnabled !== true || source.implicitFlowEnabled !== false || source.directAccessGrantsEnabled !== false || source.serviceAccountsEnabled !== false ||
      source.authenticationFlowBindingOverrides?.browser !== flowId || source.redirectUris.length !== 1 || callback.protocol !== 'https:' || callback.hostname !== 'localhost' ||
      callback.username || callback.password || callback.search || callback.hash || callback.pathname !== '/api/admin/auth/callback') fail('identity_local_password_sso_source_mismatch');
  }
  const desired = desiredSharedRealmClients(config);
  const found = new Map();
  // Preflight every client collision before the first mutation.
  for (const expected of desired) {
    const matches = array(await request('GET', `/clients?clientId=${encodeURIComponent(expected.clientId)}`)).filter(client => client.clientId === expected.clientId);
    if (matches.length > 1) fail('identity_client_ambiguous');
    const current = matches[0];
    if (current && current.attributes?.[marker] !== managedBy) fail('identity_existing_client_not_managed');
    if (current && current.attributes?.[tenantMarker] !== expected.attributes[tenantMarker]) fail('identity_client_tenant_binding_mismatch');
    if (current && current.attributes?.[applicationsMarker] !== expected.attributes[applicationsMarker]) fail('identity_client_applications_binding_mismatch');
    if (current && (typeof current.id !== 'string' || !current.id)) fail('identity_response_invalid');
    found.set(expected.clientId, current);
  }
  let serviceSecret;
  if (config.fundingService) {
    serviceSecret = readSecretFile(config.fundingService.secretFile);
    if (typeof serviceSecret !== 'string' || serviceSecret.length < 32 || serviceSecret.length > 4096 || /[\s\0]/.test(serviceSecret)) fail('identity_service_secret_invalid');
    if (serviceSecret === adminToken) fail('identity_service_secret_must_be_distinct');
  }
  for (const expected of desired) {
    let current = found.get(expected.clientId);
    const { protocolMappers, ...settings } = expected;
    // Scope assignments have dedicated endpoints; PUT ClientRepresentation does
    // not reliably reconcile them, and service creation may add service_account.
    const { defaultClientScopes, optionalClientScopes, ...comparableSettings } = settings;
    if (!current) {
      change('create', 'client', expected.clientId);
      if (apply) {
        await request('POST', '/clients', { ...settings, ...(expected.clientId === config.fundingService?.clientId ? { secret: serviceSecret } : {}) });
        const matches = array(await request('GET', `/clients?clientId=${encodeURIComponent(expected.clientId)}`)).filter(client => client.clientId === expected.clientId);
        if (matches.length !== 1 || !matches[0]?.id || matches[0].attributes?.[marker] !== managedBy) fail('identity_client_create_unconfirmed');
        current = matches[0];
        found.set(expected.clientId, current);
      }
    } else if (!same(current, comparableSettings)) {
      change('update', 'client', expected.clientId);
      if (apply) await request('PUT', `/clients/${encodeURIComponent(current.id)}`, {
        ...current, ...settings, attributes: { ...current.attributes, ...settings.attributes },
        // Keycloak merges override keys and ignores an empty map. Explicit null
        // clears an existing override when returning to the realm's MFA flow.
        authenticationFlowBindingOverrides: {
          ...Object.fromEntries(Object.keys(current.authenticationFlowBindingOverrides ?? {}).map(key => [key, null])),
          ...settings.authenticationFlowBindingOverrides,
        },
      });
    }
    for (const kind of ['default', 'optional']) {
      const scopes = current ? array(await request('GET', `/clients/${encodeURIComponent(current.id)}/${kind}-client-scopes`)) : [];
      for (const scope of scopes) {
        if (typeof scope.id !== 'string' || typeof scope.name !== 'string') fail('identity_response_invalid');
        change('remove', `${kind}-scope`, expected.clientId, scope.name);
        if (apply) await request('DELETE', `/clients/${encodeURIComponent(current.id)}/${kind}-client-scopes/${encodeURIComponent(scope.id)}`);
      }
    }
    const existingMappers = current ? array(await request('GET', `/clients/${encodeURIComponent(current.id)}/protocol-mappers/models`)) : [];
    if (existingMappers.some(item => !protocolMappers.some(known => known.name === item.name))) fail('identity_unexpected_mapper');
    for (const expectedMapper of protocolMappers) {
      const matches = existingMappers.filter(item => item.name === expectedMapper.name);
      if (matches.length > 1) fail('identity_mapper_ambiguous');
      const currentMapper = matches[0];
      if (!currentMapper || !same(currentMapper, expectedMapper)) {
        change(currentMapper ? 'update' : 'create', 'mapper', expected.clientId, expectedMapper.name);
        if (apply) await request(currentMapper ? 'PUT' : 'POST', `/clients/${encodeURIComponent(current.id)}/protocol-mappers/models${currentMapper ? `/${encodeURIComponent(currentMapper.id)}` : ''}`, expectedMapper);
      }
    }
    if (expected.clientId === config.fundingService?.clientId && current) {
      const existingSecret = await request('GET', `/clients/${encodeURIComponent(current.id)}/client-secret`);
      if (existingSecret?.value !== serviceSecret) fail('identity_service_secret_rotation_requires_separate_operation');
    }
  }
  const api = found.get(config.audience);
  const existingRoles = api ? array(await request('GET', `/clients/${encodeURIComponent(api.id)}/roles`)) : [];
  if (existingRoles.some(role => ![...humanRoles, serviceRole].includes(role.name) || role.composite)) fail('identity_unexpected_or_composite_role');
  const roles = new Map(existingRoles.map(role => [role.name, role]));
  for (const name of [...humanRoles, serviceRole]) {
    if (roles.has(name)) continue;
    change('create', 'role', config.audience, name);
    if (apply) {
      await request('POST', `/clients/${encodeURIComponent(api.id)}/roles`, { name, composite: false });
      const created = await request('GET', `/clients/${encodeURIComponent(api.id)}/roles/${name}`);
      if (!created?.id || created.name !== name || created.composite) fail('identity_role_create_unconfirmed');
      roles.set(name, created);
    }
  }
  for (const [clientId, allowedRoles] of [[config.consoleClientId, humanRoles], ...(config.fundingService ? [[config.fundingService.clientId, [serviceRole]]] : [])]) {
    const client = found.get(clientId);
    const scope = client && api ? array(await request('GET', `/clients/${encodeURIComponent(client.id)}/scope-mappings/clients/${encodeURIComponent(api.id)}`)) : [];
    if (scope.some(role => !allowedRoles.includes(role.name))) fail('identity_unexpected_scope_role');
    const missing = allowedRoles.filter(name => !scope.some(role => role.name === name));
    if (missing.length) {
      change('grant', 'client-scope', clientId, missing.join(','));
      if (apply) await request('POST', `/clients/${encodeURIComponent(client.id)}/scope-mappings/clients/${encodeURIComponent(api.id)}`, missing.map(name => roles.get(name)));
    }
    if (clientId === config.fundingService?.clientId) {
      const account = client ? await request('GET', `/clients/${encodeURIComponent(client.id)}/service-account-user`) : undefined;
      const grants = account && api ? array(await request('GET', `/users/${encodeURIComponent(account.id)}/role-mappings/clients/${encodeURIComponent(api.id)}`)) : [];
      if (grants.some(role => role.name !== serviceRole || role.composite)) fail('identity_service_role_conflict');
      if (!grants.some(role => role.name === serviceRole)) {
        change('grant', 'service-role', clientId, serviceRole);
        if (apply) await request('POST', `/users/${encodeURIComponent(account.id)}/role-mappings/clients/${encodeURIComponent(api.id)}`, [roles.get(serviceRole)]);
      }
    }
  }
  if (apply) {
    const observed = await reconcileSharedRealm(config, { adminToken, fetcher, allowInsecureLocal, readSecretFile });
    if (!observed.ssoReady || observed.changes.length) fail('identity_apply_not_converged');
  }
  return { event: 'identity.realm', applied: apply, realm, ssoReady,
    authenticationProfile: config.localPasswordSso ? 'localhost_password_sso' : 'mfa_sso', changes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    secureTls();
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const positional = args.filter(arg => arg !== '--apply');
    if (positional.length !== 4 || positional[0] !== '--config' || positional[2] !== '--admin-token-file' || args.filter(arg => arg === '--apply').length > 1) fail('identity_usage_config_and_admin_token_file_required');
    const config = JSON.parse(readFileSync(positional[1], 'utf8'));
    const adminToken = readProtectedIdentityFile(positional[3]);
    console.log(JSON.stringify(await reconcileSharedRealm(config, { adminToken, apply })));
  } catch (error) {
    const code = /^identity_[a-z0-9_]+$/.test(error?.message ?? '') ? error.message : 'identity_configuration_or_file_invalid';
    console.error(JSON.stringify({ event: 'identity.realm', valid: false, code }));
    process.exitCode = 1;
  }
}
