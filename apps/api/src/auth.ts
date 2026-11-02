import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { roles, type AccessContext, type Role } from '../../../packages/contracts/src/index.js';

export class HttpError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string) { super(code); }
}
export interface ApiConfig {
  environment: 'development' | 'test' | 'production'; host: string; port: number;
  databaseUrl: string; authMode: 'development' | 'jwt';
  devTenantId: string; devSubject: string; devApplications: string[]; devRoles: Role[];
  devWebOrigin?: string;
  oidcIssuer?: string; oidcAudience?: string; oidcJwksUrl?: string;
  rateLimit: number;
}
const nonempty = z.string().trim().min(1).max(128);
export function developmentWebOrigin(config: Pick<ApiConfig, 'devWebOrigin'>): string {
  const url = new URL(config.devWebOrigin ?? 'http://127.0.0.1:4300');
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new HttpError(500, 'development_web_origin_invalid');
  return url.origin;
}
const claimsSchema = z.object({
  sub: nonempty, tenant_id: nonempty, applications: z.array(nonempty).min(1).max(100),
  realm_access: z.object({ roles: z.array(z.string()).max(100) }),
});

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const environment = z.enum(['development', 'test', 'production']).parse(env['NODE_ENV'] ?? 'production');
  const host = env['HOST'] ?? '127.0.0.1';
  const authMode = z.enum(['development', 'jwt']).parse(env['AUTH_MODE'] ?? 'jwt');
  if (authMode === 'development' && (environment !== 'development' || !['127.0.0.1', '::1', 'localhost'].includes(host)))
    throw new HttpError(500, 'insecure_development_auth');
  const devWebOrigin = developmentWebOrigin({ devWebOrigin: env['DEV_WEB_ORIGIN'] });
  const oidcIssuer = env['OIDC_ISSUER'];
  const oidcAudience = env['OIDC_AUDIENCE'];
  const oidcJwksUrl = env['OIDC_JWKS_URL'] ?? env['JWKS_URL'];
  if (authMode === 'jwt') {
    if (!oidcIssuer || !oidcAudience || !oidcJwksUrl) throw new HttpError(500, 'oidc_configuration_required');
    for (const raw of [oidcIssuer, oidcJwksUrl]) {
      const url = new URL(raw);
      if (environment === 'production' && url.protocol !== 'https:') throw new HttpError(500, 'oidc_https_required');
      if (url.username || url.password) throw new HttpError(500, 'oidc_credentials_in_url');
    }
  }
  const databaseUrl = env['DATABASE_URL'] ?? '';
  if (!databaseUrl) throw new HttpError(500, 'database_configuration_required');
  const db = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(db.protocol)) throw new HttpError(500, 'database_configuration_invalid');
  const password = decodeURIComponent(db.password);
  if (environment === 'production' && (db.searchParams.get('sslmode') !== 'verify-full' || !password || ['preflight_local', 'password', 'postgres'].includes(password)))
    throw new HttpError(500, 'production_database_tls_required');
  return {
    environment, host, authMode, databaseUrl, devWebOrigin,
    port: z.coerce.number().int().min(1).max(65535).parse(env['PORT'] ?? '3000'),
    devTenantId: nonempty.parse(env['DEV_TENANT_ID'] ?? 'openg7-demo'), devSubject: nonempty.parse(env['DEV_SUBJECT'] ?? 'local-administrator'),
    devApplications: z.array(nonempty).min(1).max(100).parse((env['DEV_APPLICATIONS'] ?? 'funding-platform,openg7-social').split(',').map(value => value.trim()).filter(Boolean)),
    devRoles: z.array(z.enum(roles)).min(1).parse((env['DEV_ROLES'] ?? 'administrator').split(',')),
    rateLimit: z.coerce.number().int().min(1).max(10000).parse(env['API_RATE_LIMIT'] ?? '120'),
    ...(oidcIssuer ? { oidcIssuer } : {}), ...(oidcAudience ? { oidcAudience } : {}), ...(oidcJwksUrl ? { oidcJwksUrl } : {}),
  };
}

export function createAuthenticator(config: ApiConfig, testKey?: JWTVerifyGetKey): (request: FastifyRequest) => Promise<AccessContext> {
  // Enforce again here; an injected config cannot bypass production restrictions.
  if (config.authMode === 'development' && (config.environment !== 'development' || !['127.0.0.1', '::1', 'localhost'].includes(config.host)))
    throw new HttpError(500, 'insecure_development_auth');
  if (config.authMode === 'jwt' && (!config.oidcIssuer || !config.oidcAudience || !config.oidcJwksUrl))
    throw new HttpError(500, 'oidc_configuration_required');
  const key = config.authMode === 'jwt'
    ? testKey ?? createRemoteJWKSet(new URL(config.oidcJwksUrl ?? 'https://invalid.invalid/jwks')) : undefined;
  return async request => {
    if (config.authMode === 'development') {
      const peer = request.ip;
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) throw new HttpError(403, 'development_loopback_required');
      return { tenantId: config.devTenantId, subject: config.devSubject, applications: [...config.devApplications], roles: [...config.devRoles], correlationId: request.id };
    }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ') || !key) throw new HttpError(401, 'authentication_required');
    try {
      const verified = await jwtVerify(authorization.slice(7), key, {
        issuer: config.oidcIssuer, audience: config.oidcAudience, algorithms: ['RS256', 'ES256'],
        requiredClaims: ['sub','exp','iat','tenant_id','applications'], clockTolerance: 5,
      });
      const claims = claimsSchema.parse(verified.payload);
      const allowed = claims.realm_access.roles.filter((role): role is Role => (roles as readonly string[]).includes(role));
      if (!allowed.length) throw new Error('no_roles');
      return { tenantId: claims.tenant_id, subject: claims.sub, applications: claims.applications, roles: allowed, correlationId: request.id };
    } catch { throw new HttpError(401, 'invalid_access_token'); }
  };
}

export function requireRole(scope: AccessContext, allowed: readonly Role[]): void {
  if (!scope.roles.some(role => allowed.includes(role))) throw new HttpError(403, 'permission_denied');
}
