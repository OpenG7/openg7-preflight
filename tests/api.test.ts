import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { createApp } from '../apps/api/src/app.js';
import { loadApiConfig, type ApiConfig } from '../apps/api/src/auth.js';
import type { PreflightService } from '../packages/engine/src/index.js';
import type { AccessContext } from '../packages/contracts/src/index.js';

const base: ApiConfig = { environment: 'development', host: '127.0.0.1', port: 3000, databaseUrl: 'postgres://synthetic:synthetic@127.0.0.1/test', authMode: 'development', devTenantId: 'tenant-a', devSubject: 'local-test', devApplications: ['openg7-social'], devRoles: ['administrator'], rateLimit: 100 };
function fixture() {
  const calls: { action: string; scope: AccessContext; input?: unknown }[] = [];
  const service = {
    list: async (scope: AccessContext, input: unknown) => { calls.push({ action: 'list', scope, input }); return { items: [], total: 0, page: 1, pageSize: 25 }; },
    submit: async (input: unknown, scope: AccessContext) => { calls.push({ action: 'submit', scope, input }); return { mission: { id: 'fixture' }, duplicate: false }; },
    detail: async () => null,
    cancel: async (_id: string, scope: AccessContext) => { calls.push({ action: 'cancel', scope }); return { status: 'cancelled' }; },
  } as unknown as PreflightService;
  return { service, calls };
}
test('development auth is impossible in production or on a network binding', () => {
  const env = { DATABASE_URL: base.databaseUrl, AUTH_MODE: 'development' };
  assert.throws(() => loadApiConfig({ ...env, NODE_ENV: 'production' }), /insecure_development_auth/);
  assert.throws(() => loadApiConfig({ ...env, NODE_ENV: 'development', HOST: '0.0.0.0' }), /insecure_development_auth/);
  assert.throws(() => loadApiConfig({ ...env, NODE_ENV: 'development', DEV_WEB_ORIGIN: 'https://external.example.test' }), /development_web_origin_invalid/);
  assert.throws(() => loadApiConfig({ ...env, NODE_ENV: 'development', DEV_WEB_ORIGIN: 'ftp://127.0.0.1:4300' }), /development_web_origin_invalid/);
  assert.equal(loadApiConfig({ ...env, NODE_ENV: 'development', DEV_WEB_ORIGIN: 'http://127.0.0.1:4300' }).devWebOrigin, 'http://127.0.0.1:4300');
  assert.throws(() => loadApiConfig({ NODE_ENV: 'production', DATABASE_URL: base.databaseUrl }), /oidc_configuration_required/);
  const production = { NODE_ENV: 'production', AUTH_MODE: 'jwt', OIDC_ISSUER: 'https://identity.example.test/realms/example', OIDC_AUDIENCE: 'preflight-api', OIDC_JWKS_URL: 'https://identity.example.test/keys' };
  for (const password of ['%70reflight_local', 'password', 'postgres', ''])
    assert.throws(() => loadApiConfig({ ...production, DATABASE_URL: `postgres://synthetic:${password}@database.example.test/preflight?sslmode=verify-full` }), /production_database_tls_required/);
});
test('API validates contracts, query bounds, unknown fields, no approval endpoint', async t => {
  const { service, calls } = fixture(); const app = await createApp({ service, config: base, health: async () => undefined }); t.after(() => app.close());
  assert.equal((await app.inject('/health/live')).statusCode, 200);
  assert.equal((await app.inject('/health/ready')).statusCode, 200);
  const session = await app.inject('/api/session'); assert.equal(session.json().authMode, 'development');
  assert.equal((await app.inject('/api/missions?pageSize=501')).statusCode, 400);
  assert.equal((await app.inject('/api/missions?tenantId=other')).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/missions', payload: { schemaVersion: '9.0' } })).statusCode, 400);
  assert.equal(calls.length, 0);
  assert.equal((await app.inject('/api/missions/missing')).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/api/proposals/id/approve', payload: {} })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/api/review-batches', payload: { proposalIds: ['not-a-uuid'] } })).statusCode, 400);
  assert.equal((await app.inject('/api/review-batches/not-a-uuid')).statusCode, 400);
  const list = await app.inject('/api/missions?page=1&pageSize=10&q=example'); assert.equal(list.statusCode, 200);
  assert.equal(calls[0]?.scope.tenantId, 'tenant-a'); assert.deepEqual(calls[0]?.scope.applications, ['openg7-social']);
  assert.ok(list.headers['x-correlation-id']); assert.equal(list.headers['cache-control'], 'no-store');
});
test('development endpoint rejects non-loopback clients and cannot trust scope headers', async t => {
  const { service, calls } = fixture(); const app = await createApp({ service, config: base, health: async () => undefined }); t.after(() => app.close());
  assert.equal((await app.inject({ url: '/api/missions', remoteAddress: '192.0.2.1' })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/missions/id/cancel', headers: { origin: 'https://untrusted.example.test' }, payload: {} })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/missions/id/cancel', headers: { origin: 'http://127.0.0.1:4300' }, payload: {} })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/missions/id/cancel', headers: { origin: 'http://127.0.0.1:4200' }, payload: {} })).statusCode, 403);
  const result = await app.inject({ url: '/api/missions', headers: { 'x-tenant-id': 'tenant-b', 'x-roles': 'administrator', 'x-forwarded-for': '192.0.2.1' } });
  assert.equal(result.statusCode, 200); assert.equal(calls[0]?.scope.tenantId, 'tenant-a');
});
test('verified JWT claims define tenant/application scope; viewer mutations forbidden', async t => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwtConfig: ApiConfig = { ...base, environment: 'test', authMode: 'jwt', oidcIssuer: 'https://identity.example.test/realms/preflight', oidcAudience: 'preflight-api', oidcJwksUrl: 'https://identity.example.test/keys' };
  const token = async (extra: Record<string, unknown> = {}, audience = 'preflight-api') => new SignJWT({ tenant_id: 'tenant-jwt', applications: ['funding-platform'], realm_access: { roles: ['viewer'] }, ...extra }).setProtectedHeader({ alg: 'RS256' }).setSubject('jwt-user').setIssuer(jwtConfig.oidcIssuer!).setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const { service, calls } = fixture(); const app = await createApp({ service, config: jwtConfig, health: async () => undefined, jwtKey: async () => publicKey }); t.after(() => app.close());
  assert.equal((await app.inject('/api/missions')).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/missions', headers: { authorization: 'Bearer invalid' } })).statusCode, 401);
  const bearer = await token();
  assert.equal((await app.inject({ url: '/api/missions', headers: { authorization: `Bearer ${bearer}`, 'x-tenant-id': 'attacker' } })).statusCode, 200);
  assert.equal(calls[0]?.scope.tenantId, 'tenant-jwt'); assert.deepEqual(calls[0]?.scope.applications, ['funding-platform']);
  assert.equal((await app.inject({ method: 'POST', url: '/api/missions/id/cancel', headers: { authorization: `Bearer ${bearer}` }, payload: {} })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/missions', headers: { authorization: `Bearer ${await token({}, 'wrong-audience')}` } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/missions', headers: { authorization: `Bearer ${await token({ applications: [] })}` } })).statusCode, 401);
  const wrongKeys = await generateKeyPair('RS256');
  const forged = await new SignJWT({ tenant_id: 'tenant-jwt', applications: ['funding-platform'], realm_access: { roles: ['administrator'] } }).setProtectedHeader({ alg: 'RS256' }).setSubject('jwt-user').setIssuer(jwtConfig.oidcIssuer!).setAudience('preflight-api').setIssuedAt().setExpirationTime('5m').sign(wrongKeys.privateKey);
  assert.equal((await app.inject({ url: '/api/missions', headers: { authorization: `Bearer ${forged}` } })).statusCode, 401);
  const expired = await new SignJWT({ tenant_id: 'tenant-jwt', applications: ['funding-platform'], realm_access: { roles: ['viewer'] } }).setProtectedHeader({ alg: 'RS256' }).setSubject('jwt-user').setIssuer(jwtConfig.oidcIssuer!).setAudience('preflight-api').setIssuedAt(Math.floor(Date.now()/1000)-120).setExpirationTime(Math.floor(Date.now()/1000)-60).sign(privateKey);
  assert.equal((await app.inject({ url: '/api/missions', headers: { authorization: `Bearer ${expired}` } })).statusCode, 401);
});
test('rate limits reject excess requests with a structured error', async t => {
  const { service } = fixture(); const app = await createApp({ service, config: { ...base, rateLimit: 2 }, health: async () => undefined }); t.after(() => app.close());
  assert.equal((await app.inject('/api/session')).statusCode, 200);
  assert.equal((await app.inject('/api/session')).statusCode, 200);
  const excess = await app.inject('/api/session'); assert.equal(excess.statusCode, 429);
  assert.ok(excess.json().error); assert.ok(excess.headers['retry-after']);
});
test('readiness failures and internal errors do not expose database details', async t => {
  const { service } = fixture(); service.list = async () => { throw new Error('private connection and source contents'); };
  const app = await createApp({ service, config: base, health: async () => { throw new Error('private host'); } }); t.after(() => app.close());
  assert.equal((await app.inject('/health/ready')).statusCode, 503);
  const result = await app.inject('/api/missions'); assert.equal(result.statusCode, 500); assert.equal(result.json().error, 'internal_error');
  assert.doesNotMatch(result.body, /private|connection|contents/);
});
