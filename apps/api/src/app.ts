import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { JWTVerifyGetKey } from 'jose';
import { z, ZodError } from 'zod';
import { missionInputSchema, sourceEventSchema, missionStates, type AccessContext } from '../../../packages/contracts/src/index.js';
import type { PreflightService } from '../../../packages/engine/src/index.js';
import { ecosystemConnections } from '../../../packages/integrations/src/index.js';
import { createAuthenticator, developmentWebOrigin, HttpError, requireRole, type ApiConfig } from './auth.js';

declare module 'fastify' { interface FastifyRequest { access: AccessContext } }
const idSchema = z.string().min(1).max(128);
const proposalIdSchema = z.uuid();
const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().max(200).optional(), application: idSchema.optional(), status: z.enum(missionStates).optional(),
}).strict();
const briefingSchema = z.object({
  since: z.iso.datetime().optional(), application: idSchema.optional(), status: z.enum(missionStates).optional(),
}).strict();
const proposalQuerySchema = querySchema.omit({ status: true }).extend({ status: z.enum(['prepared', 'obsolete']).optional() });
const batchInputSchema = z.object({ name: z.string().min(1).max(200).optional(), proposalIds: z.array(proposalIdSchema).min(1).max(500) }).strict();
const readRoles = ['viewer', 'operator', 'administrator', 'service_integration'] as const;
const operateRoles = ['operator', 'administrator'] as const;
const submitRoles = ['operator', 'administrator', 'service_integration'] as const;
export interface AppOptions {
  service: PreflightService; config: ApiConfig; health: () => Promise<unknown>; logger?: boolean; jwtKey?: JWTVerifyGetKey;
}

export async function createApp(options: AppOptions) {
  const app = Fastify({
    logger: options.logger ? { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'] } : false,
    logController: new LogController({ disableRequestLogging: true }), trustProxy: false, bodyLimit: 128 * 1024,
    genReqId: () => randomUUID(),
  });
  const authenticate = createAuthenticator(options.config, options.jwtKey);
  const devOrigin = options.config.authMode === 'development' ? developmentWebOrigin(options.config) : undefined;
  app.decorateRequest('access', null as unknown as AccessContext);
  await app.register(rateLimit, { max: options.config.rateLimit, timeWindow: '1 minute' });
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-correlation-id', request.id);
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    return payload;
  });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({ correlationId: request.id, route: request.routeOptions.url, statusCode: reply.statusCode, durationMs: reply.elapsedTime }, 'request_completed');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'invalid_contract', correlationId: request.id, issues: error.issues.map(issue => ({ path: issue.path.join('.'), code: issue.code })) });
    const e = error as { statusCode?: unknown; code?: unknown };
    const status = typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500;
    const code = status < 500 && typeof e.code === 'string' ? e.code : 'internal_error';
    request.log[status >= 500 ? 'error' : 'warn']({ correlationId: request.id, code, statusCode: status }, 'request_failed');
    return reply.code(status).send({ error: code, correlationId: request.id });
  });
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try { await options.health(); return { status: 'ready' }; }
    catch { return reply.code(503).send({ status: 'not_ready' }); }
  });
  const service = options.service;
  await app.register(async api => {
    api.addHook('onRequest', async request => {
      if (options.config.authMode === 'development' && !['GET', 'HEAD'].includes(request.method) && request.headers.origin &&
        request.headers.origin !== devOrigin)
        throw new HttpError(403, 'development_origin_forbidden');
      request.access = await authenticate(request);
    });
    const scopeFor = (request: FastifyRequest, allowed = readRoles as readonly import('../../../packages/contracts/src/index.js').Role[]) => {
      requireRole(request.access, allowed); return request.access;
    };
    const missionId = (request: FastifyRequest) => z.object({ id: idSchema }).parse(request.params).id;
    const batchId = (request: FastifyRequest) => z.object({ id: proposalIdSchema }).parse(request.params).id;
    api.get('/session', async request => ({ ...scopeFor(request), authMode: options.config.authMode }));
    api.get('/missions', async request => service.list(scopeFor(request), querySchema.parse(request.query)));
    api.post('/missions', async (request, reply) => {
      const result = await service.submit(missionInputSchema.parse(request.body), scopeFor(request, submitRoles));
      return reply.code(result.duplicate ? 200 : 202).send(result);
    });
    api.get('/missions/:id', async (request, reply) => {
      const scope = scopeFor(request); const id = missionId(request); const result = await service.detail(id, scope);
      if (!result) return reply.code(404).send({ error: 'mission_not_found', correlationId: request.id });
      return result;
    });
    api.post('/missions/:id/cancel', async request => { const scope = scopeFor(request, operateRoles); z.object({}).strict().parse(request.body ?? {}); return service.cancel(missionId(request), scope); });
    api.post('/missions/:id/retry', async request => { const scope = scopeFor(request, operateRoles); z.object({}).strict().parse(request.body ?? {}); return service.retry(missionId(request), scope); });
    api.post('/missions/:id/input', async request => {
      const scope = scopeFor(request, submitRoles);
      const body = z.object({ input: z.record(z.string(), z.unknown()) }).strict().parse(request.body);
      return service.provideInput(missionId(request), body.input, scope);
    });
    api.post('/missions/:id/source-decision', async request => {
      const scope = scopeFor(request, ['service_integration']);
      const body = z.object({ sourceVersion: z.number().int().positive(), decision: z.string().min(1).max(200), eventId: idSchema }).strict().parse(request.body);
      return service.recordDecision(missionId(request), body, scope);
    });
    api.post('/events', async (request, reply) => {
      const scope = scopeFor(request, ['service_integration']); const event = sourceEventSchema.parse(request.body);
      if (event.type === 'mission.submitted') {
        const result = await service.submit({ ...event.mission, eventId: event.eventId }, scope);
        return reply.code(result.duplicate ? 200 : 202).send(result);
      }
      return service.sourceUpdate(event, scope);
    });
    api.get('/briefing', async request => {
      const scope = scopeFor(request); return service.briefing(scope, briefingSchema.parse(request.query));
    });
    api.post('/briefing/checkpoint', async request => { const scope = scopeFor(request); z.object({}).strict().parse(request.body ?? {}); return service.checkpoint(scope); });
    api.get('/proposals', async request => {
      const scope = scopeFor(request); return service.proposals(scope, proposalQuerySchema.parse(request.query));
    });
    api.get('/review-batches', async request => service.batches(scopeFor(request)));
    api.post('/review-batches', async (request, reply) => {
      const scope = scopeFor(request, operateRoles); const body = batchInputSchema.parse(request.body);
      return reply.code(201).send(await service.buildBatch(body, scope));
    });
    api.get('/review-batches/:id', async request => service.batchDetail(batchId(request), scopeFor(request)));
    api.post('/review-batches/:id/exclude', async request => {
      const scope = scopeFor(request, operateRoles);
      const body = z.object({ proposalId: proposalIdSchema, version: z.number().int().positive() }).strict().parse(request.body);
      return service.excludeBatch(batchId(request), body.proposalId, body.version, scope);
    });
    api.post('/review-batches/:id/export', async request => {
      const scope = scopeFor(request, submitRoles);
      const body = z.object({ version: z.number().int().positive() }).strict().parse(request.body);
      return service.exportBatch(batchId(request), body.version, scope);
    });
    api.get('/integrations', async request => {
      const scope = scopeFor(request); return { items: ecosystemConnections.filter(item => scope.applications.includes(item.application) || item.application.startsWith('openg7-') && !['openg7-social'].includes(item.application)) };
    });
    api.get('/config', async request => {
      const scope = scopeFor(request); return { ...await service.config(scope), authMode: options.config.authMode,
        limits: { maxPageSize: 100, maxBatchSize: 500, maxMissionCostUsd: 100, maxAttempts: 5 },
        authority: 'Business decisions belong exclusively to source applications.',
      };
    });
    api.get('/audit', async request => service.audit(scopeFor(request, ['administrator'])));
  }, { prefix: '/api' });
  return app;
}
