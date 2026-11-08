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
    cancel: async (_id: string, scope: AccessContext, input?:unknown) => { calls.push({ action: 'cancel', scope, input }); return { status: 'cancelled' }; },
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
  assert.throws(()=>loadApiConfig({...production,DATABASE_URL:'postgres://synthetic:strong-synthetic-only@db.example.test/test?sslmode=verify-full',OIDC_ISSUER:'https://identity.example.test/?token=synthetic'}),/oidc_url_invalid/);
  for (const password of ['%70reflight_local', 'password', 'postgres', ''])
    assert.throws(() => loadApiConfig({ ...production, DATABASE_URL: `postgres://synthetic:${password}@database.example.test/preflight?sslmode=verify-full` }), /production_database_tls_required/);
});
test('API validates contracts, query bounds, unknown fields, no approval endpoint', async t => {
  const { service, calls } = fixture(); const app = await createApp({ service, config: base, health: async () => undefined }); t.after(() => app.close());
  assert.deepEqual((await app.inject('/api/auth/config')).json(),{enabled:false});
  assert.equal((await app.inject('/health/live')).statusCode, 200);
  assert.equal((await app.inject('/health/ready')).statusCode, 200);
  const session = await app.inject('/api/session'); assert.equal(session.json().authMode, 'development');
  assert.equal((await app.inject('/api/missions?pageSize=501')).statusCode, 400);
  assert.equal((await app.inject('/api/missions?tenantId=other')).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/missions', payload: { schemaVersion: '9.0' } })).statusCode, 400);
  assert.equal(calls.length, 0);
  assert.equal((await app.inject('/api/missions/missing')).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/api/proposals/id/approve', payload: {} })).statusCode, 404);
  for(const payload of [null,[],false,0])assert.equal((await app.inject({method:'POST',url:'/api/missions/id/cancel',headers:{'content-type':'application/json'},payload:JSON.stringify(payload)})).statusCode,400);
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
  const sourceBearer=await token({realm_access:{roles:['service_integration']}});
  assert.equal((await app.inject({method:'POST',url:'/api/missions/id/cancel',headers:{authorization:`Bearer ${sourceBearer}`},payload:{}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/missions/id/cancel',headers:{authorization:`Bearer ${sourceBearer}`},payload:{sourceVersion:1,eventId:'source-cancel-1'}})).statusCode,200);
  assert.deepEqual(calls.find(call=>call.action==='cancel')?.input,{sourceVersion:1,eventId:'source-cancel-1'});
  assert.equal((await app.inject({ url: '/api/missions', headers: { authorization: `Bearer ${await token({}, 'wrong-audience')}` } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/missions', headers: { authorization: `Bearer ${await token({ applications: [] })}` } })).statusCode, 401);
  const wrongKeys = await generateKeyPair('RS256');
  const forged = await new SignJWT({ tenant_id: 'tenant-jwt', applications: ['funding-platform'], realm_access: { roles: ['administrator'] } }).setProtectedHeader({ alg: 'RS256' }).setSubject('jwt-user').setIssuer(jwtConfig.oidcIssuer!).setAudience('preflight-api').setIssuedAt().setExpirationTime('5m').sign(wrongKeys.privateKey);
  assert.equal((await app.inject({ url: '/api/missions', headers: { authorization: `Bearer ${forged}` } })).statusCode, 401);
  const expired = await new SignJWT({ tenant_id: 'tenant-jwt', applications: ['funding-platform'], realm_access: { roles: ['viewer'] } }).setProtectedHeader({ alg: 'RS256' }).setSubject('jwt-user').setIssuer(jwtConfig.oidcIssuer!).setAudience('preflight-api').setIssuedAt(Math.floor(Date.now()/1000)-120).setExpirationTime(Math.floor(Date.now()/1000)-60).sign(privateKey);
  assert.equal((await app.inject({ url: '/api/missions', headers: { authorization: `Bearer ${expired}` } })).statusCode, 401);
});

test('human JWTs require verified MFA in production, including mixed human and service roles', async t => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const production = { NODE_ENV: 'production', AUTH_MODE: 'jwt', DATABASE_URL: 'postgres://synthetic:strong-synthetic-only@database.example.test/preflight?sslmode=verify-full', OIDC_ISSUER: 'https://identity.example.test/realms/openg7', OIDC_AUDIENCE: 'preflight-api', OIDC_JWKS_URL: 'https://identity.example.test/keys' };
  assert.throws(() => loadApiConfig({ ...production, OIDC_REQUIRE_MFA: 'false' }), /production_mfa_required/);
  assert.equal(loadApiConfig(production).oidcRequireMfa, true);
  for (const environment of ['production', 'test'] as const) {
    const config: ApiConfig = { ...base, environment, authMode: 'jwt', oidcIssuer: production.OIDC_ISSUER, oidcAudience: production.OIDC_AUDIENCE, oidcJwksUrl: production.OIDC_JWKS_URL, oidcRequireMfa: environment === 'test' };
    const { service } = fixture();
    const app = await createApp({ service, config, health: async () => undefined, jwtKey: async () => publicKey });
    t.after(() => app.close());
    const request = async (extra: Record<string, unknown>) => {
      const token = await new SignJWT({ tenant_id: 'tenant-mfa', applications: ['funding-platform'], realm_access: { roles: ['viewer'] }, ...extra })
        .setProtectedHeader({ alg: 'RS256' }).setSubject('synthetic-user').setIssuer(config.oidcIssuer!).setAudience('preflight-api').setIssuedAt().setExpirationTime('5m').sign(privateKey);
      return app.inject({ url: '/api/session', headers: { authorization: `Bearer ${token}` } });
    };
    for (const extra of [{}, { amr: ['pwd'] }, { acr: 'mfa' }, { realm_access: { roles: ['service_integration', 'administrator'] } }]) {
      const response = await request(extra);
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().error, 'mfa_required');
    }
    assert.equal((await request({ amr: ['pwd', 'mfa'] })).statusCode, 200);
    assert.equal((await request({ amr: 'mfa' })).statusCode, 401);
    const machine = await request({ realm_access: { roles: ['service_integration'] } });
    assert.equal(machine.statusCode, 200);
    assert.deepEqual(machine.json().roles, ['service_integration']);
  }
});

test('an explicit local password policy rejects human JWTs without signed password assurance and cannot weaken production MFA',async t=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const environment={NODE_ENV:'development',AUTH_MODE:'jwt',DATABASE_URL:base.databaseUrl,OIDC_ISSUER:'https://identity.example.test/realms/openg7',OIDC_AUDIENCE:'preflight-api',OIDC_JWKS_URL:'https://identity.example.test/keys'};
  assert.equal(loadApiConfig(environment).oidcRequirePassword,false);
  assert.equal(loadApiConfig({...environment,OIDC_REQUIRE_PASSWORD:'true',OIDC_REQUIRE_MFA:'false'}).oidcRequirePassword,true);
  assert.throws(()=>loadApiConfig({...environment,OIDC_REQUIRE_PASSWORD:'yes'}));
  const production={...environment,NODE_ENV:'production',DATABASE_URL:'postgres://synthetic:strong-synthetic-only@database.example.test/preflight?sslmode=verify-full'};
  assert.equal(loadApiConfig({...production,OIDC_REQUIRE_PASSWORD:'false'}).oidcRequireMfa,true);
  assert.throws(()=>loadApiConfig({...production,OIDC_REQUIRE_PASSWORD:'true',OIDC_REQUIRE_MFA:'false'}),/production_mfa_required/);
  const config=loadApiConfig({...environment,OIDC_REQUIRE_PASSWORD:'true',OIDC_REQUIRE_MFA:'false'});
  const {service}=fixture();
  const app=await createApp({service,config,health:async()=>undefined,jwtKey:async()=>publicKey});t.after(()=>app.close());
  const request=async(extra:Record<string,unknown>,target=app)=>{
    const token=await new SignJWT({tenant_id:'synthetic-local-tenant',applications:['funding-platform'],realm_access:{roles:['viewer']},...extra})
      .setProtectedHeader({alg:'RS256'}).setSubject('synthetic-local-user').setIssuer(config.oidcIssuer!).setAudience('preflight-api').setIssuedAt().setExpirationTime('5m').sign(privateKey);
    return target.inject({url:'/api/session',headers:{authorization:`Bearer ${token}`}});
  };
  for(const extra of [{},{amr:[]},{amr:['mfa']},{acr:'pwd'},{realm_access:{roles:['service_integration','viewer']}}]){
    const response=await request(extra);assert.equal(response.statusCode,403);assert.equal(response.json().error,'password_required');
  }
  assert.equal((await request({amr:['pwd']})).statusCode,200);
  assert.equal((await request({amr:['pwd','mfa']})).statusCode,200);
  assert.equal((await request({amr:'pwd'})).statusCode,401);
  assert.equal((await request({realm_access:{roles:['service_integration']}})).statusCode,200);
  const combinedApp=await createApp({service,config:{...config,oidcRequireMfa:true},health:async()=>undefined,jwtKey:async()=>publicKey});t.after(()=>combinedApp.close());
  const missingMfa=await request({amr:['pwd']},combinedApp);assert.equal(missingMfa.statusCode,403);assert.equal(missingMfa.json().error,'mfa_required');
  const missingPassword=await request({amr:['mfa']},combinedApp);assert.equal(missingPassword.statusCode,403);assert.equal(missingPassword.json().error,'password_required');
  assert.equal((await request({amr:['pwd','mfa']},combinedApp)).statusCode,200);
  const productionApp=await createApp({service,config:{...config,environment:'production',oidcRequireMfa:false,oidcRequirePassword:false},health:async()=>undefined,jwtKey:async()=>publicKey});t.after(()=>productionApp.close());
  const passwordOnly=await request({amr:['pwd']},productionApp);assert.equal(passwordOnly.statusCode,403);assert.equal(passwordOnly.json().error,'mfa_required');
});

test('public browser configuration exposes only public identity settings and enforces production redirect security',async t=>{
  const {service}=fixture();
  const config:ApiConfig={...base,environment:'test',authMode:'jwt',oidcIssuer:'https://identity.example.test',oidcAudience:'preflight-api',oidcJwksUrl:'https://identity.example.test/keys',oidcBrowserClientId:'console',oidcBrowserRedirectUri:'https://console.example.test/'};
  const app=await createApp({service,config,health:async()=>undefined,jwtKey:async()=>{throw new Error('not_used');}});t.after(()=>app.close());
  const result=await app.inject('/api/auth/config');assert.equal(result.statusCode,200);
  assert.deepEqual(result.json(),{enabled:true,issuer:config.oidcIssuer,clientId:'console',redirectUri:'https://console.example.test/',allowInsecureLocal:true});
  const env={NODE_ENV:'production',AUTH_MODE:'jwt',OIDC_ISSUER:config.oidcIssuer,OIDC_AUDIENCE:config.oidcAudience,OIDC_JWKS_URL:config.oidcJwksUrl,DATABASE_URL:'postgres://synthetic:secure-example-not-a-real-secret@db.example.test/preflight?sslmode=verify-full',OIDC_BROWSER_CLIENT_ID:'console'};
  assert.throws(()=>loadApiConfig(env),/browser_configuration_required/);
  assert.throws(()=>loadApiConfig({...env,OIDC_BROWSER_REDIRECT_URI:'http://console.example.test/'}),/browser_redirect_invalid/);
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
