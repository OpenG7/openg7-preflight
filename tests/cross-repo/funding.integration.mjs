import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from '../../dist/apps/api/src/app.js';
import { loadApiConfig } from '../../dist/apps/api/src/auth.js';
import { runMigrations } from '../../dist/scripts/migrate.js';
import { PreflightService, startWorker } from '../../dist/packages/engine/src/index.js';
import { MockAiProvider } from '../../dist/packages/ai/src/index.js';

const fundingRoot = process.env.FUNDING_CONNECTOR_ROOT;
if (!fundingRoot) throw new Error('FUNDING_CONNECTOR_ROOT must point to a built Funding checkout.');
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/test/i.test(new URL(databaseUrl).pathname)) throw new Error('A dedicated TEST_DATABASE_URL is required.');
const funding = relative => import(pathToFileURL(path.resolve(fundingRoot, relative)).href);
const [{ startDisposablePostgres }, { withPostgresTransaction }, offers, activation, transport, { PublicationWorkshopService }] = await Promise.all([
  funding('tests/integration/support/disposable-postgres.mjs'), funding('dist/apps/funding-api/src/postgres-transaction.js'),
  funding('dist/apps/funding-api/src/sponsorship-commitments/offers.js'), funding('dist/apps/funding-api/src/sponsorship-commitments/repository.js'),
  funding('dist/apps/funding-api/src/preflight/client.js'), funding('dist/apps/funding-api/src/preflight/workshop.js'),
]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (accept(value)) return value; await sleep(100); }
  assert.fail('The durable publication preparation did not reach its expected state.');
}

test('Funding publication workshop -> signed OAuth/JWKS -> real Preflight worker -> private versioned proposals', { timeout: 180000 }, async t => {
  // Funding is always a new local tmpfs container; Preflight uses only the explicit test URL.
  const sourceDb = await startDisposablePostgres();
  const schema = `cross_test_${randomUUID().replaceAll('-', '')}`, bossSchema = `boss_${schema}`;
  const bootstrap = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 12 });
  const tenantId = 'synthetic-publication-workshop';
  const keys = await generateKeyPair('RS256'), jwk = await exportJWK(keys.publicKey);
  jwk.kid = 'synthetic-workshop-key'; jwk.alg = 'RS256';
  let issuerUrl, baseUrl, tokenCalls = 0, worker, app;
  const sign = (tenant = tenantId, applications = ['funding-platform']) => new SignJWT({ tenant_id: tenant, applications, realm_access: { roles: ['service_integration'] } })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setSubject('synthetic-funding-service')
    .setIssuer(issuerUrl).setAudience('preflight-api').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  const issuer = createServer(async (req, res) => {
    if (req.url === '/keys') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); return; }
    if (req.url !== '/token' || req.method !== 'POST') { res.statusCode = 404; res.end(); return; }
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 16384) { res.statusCode = 413; res.end(); return; } }
    const params = new URLSearchParams(body);
    if (params.get('grant_type') !== 'client_credentials' || params.get('client_id') !== 'synthetic-funding-service' || params.get('client_secret') !== 'synthetic-test-only-secret') {
      res.statusCode = 401; res.end('{}'); return;
    }
    tokenCalls++; res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ access_token: await sign(), token_type: 'Bearer', expires_in: 300 }));
  });
  try {
    await bootstrap.query(`CREATE SCHEMA ${schema}`); await runMigrations(pool);
    await new Promise(resolve => issuer.listen(0, '127.0.0.1', resolve)); issuerUrl = `http://127.0.0.1:${issuer.address().port}`;
    const engine = new PreflightService(pool);
    app = await createApp({ service: engine, config: loadApiConfig({ NODE_ENV: 'test', AUTH_MODE: 'jwt', HOST: '127.0.0.1', DATABASE_URL: databaseUrl,
      OIDC_ISSUER: issuerUrl, OIDC_AUDIENCE: 'preflight-api', OIDC_JWKS_URL: `${issuerUrl}/keys`, API_RATE_LIMIT: '10000' }), health: () => pool.query('SELECT 1') });
    baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
    worker = await startWorker({ pool, boss: new PgBoss({ connectionString: databaseUrl, schema: bossSchema }), provider: new MockAiProvider(), pollIntervalSeconds: 0.5, dispatchIntervalMs: 25 });
    const config = { enabled: true, baseUrl, tenantId, tokenUrl: `${issuerUrl}/token`, clientId: 'synthetic-funding-service', clientSecret: 'synthetic-test-only-secret', requestTimeoutMs: 5000, maxCostUsd: 0.5 };
    let unavailable = true, loseSubmissionResponse = true;
    const client = new transport.PreflightClient(config, { fetch: async (url, init) => {
      if (String(url).startsWith(baseUrl + '/api') && unavailable) return new Response('{"error":"synthetic_unavailable"}', { status: 503, headers: { 'content-type': 'application/json' } });
      const response = await fetch(url, init);
      if (String(url) === baseUrl + '/api/missions' && init?.method === 'POST' && response.ok && loseSubmissionResponse) {
        loseSubmissionResponse = false; await response.arrayBuffer(); throw new Error('Synthetic response loss after durable reception.');
      }
      return response;
    } });
    let workshop = new PublicationWorkshopService(sourceDb.pool, config, { client }); await workshop.ready();
    const operationId = randomUUID(), sessionId = `cs_synthetic_${randomUUID()}`, paymentId = `pi_synthetic_${randomUUID()}`, reference = `SYNTHETIC-${randomUUID()}`;
    await sourceDb.pool.query("INSERT INTO checkout_operations(id,key_hash,request_hash,state,params,contribution_input) VALUES($1,$2,$3,'prepared','{}','{}')", [operationId, operationId, operationId]);
    await withPostgresTransaction(sourceDb.pool, db => offers.recordCheckoutSponsorshipOffer(db, operationId, { publicReference: reference, quote: offers.quoteSponsorshipOffer(25000, 'CAD') }));
    await sourceDb.pool.query("INSERT INTO stripe_checkout_sessions(stripe_session_id,stripe_payment_intent_id,contribution_type,amount_cents,currency,metadata,status) VALUES($1,$2,'sponsorship_interest',25000,'cad',$3,'paid')", [sessionId, paymentId, { openg7CheckoutOperationId: operationId }]);
    const contributionId = (await sourceDb.pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,public_reference,
      stripe_session_id,stripe_payment_intent_id,public_display_consent,display_amount_consent,sponsor_review_status,sponsor_site_visibility_held)
      VALUES('sponsorship_interest',25000,'cad','paid',NOW(),$1,$2,$3,FALSE,FALSE,'pending_review',TRUE) RETURNING id`, [reference, sessionId, paymentId])).rows[0].id;
    await withPostgresTransaction(sourceDb.pool, db => activation.activateSponsorshipCommitments(db, { stripeSessionId: sessionId, stripePaymentIntentId: paymentId,
      trustedPaymentFacts: { amountCents: 25000, currency: 'CAD', publicReference: reference } }));
    const countMissions = async () => (await sourceDb.pool.query('SELECT count(*)::int AS n FROM preflight_workshop_missions')).rows[0].n;
    const retryNow = async () => sourceDb.pool.query('UPDATE preflight_workshop_missions SET next_attempt_at=NOW() WHERE tenant_id=$1', [tenantId]);
    const assertNoBusinessDecision = async () => {
      const state = (await sourceDb.pool.query(`SELECT
        (SELECT count(*)::int FROM admin_preparation_approvals) AS approvals,(SELECT count(*)::int FROM sponsor_publication_drafts) AS drafts,
        (SELECT count(*)::int FROM social_publication_jobs) AS social_jobs,(SELECT count(*)::int FROM publication_deliveries) AS deliveries,
        (SELECT count(*)::int FROM sponsorship_fulfilment_evidence) AS evidence,
        (SELECT count(*)::int FROM sponsorship_obligations WHERE state='fulfilled' OR fulfilment_evidence_id IS NOT NULL) AS fulfilled`)).rows[0];
      assert.deepEqual(state, { approvals: 0, drafts: 0, social_jobs: 0, deliveries: 0, evidence: 0, fulfilled: 0 });
      const source = (await sourceDb.pool.query('SELECT sponsor_review_status,sponsor_details_submitted_at FROM fund_contributions WHERE id=$1', [contributionId])).rows[0];
      assert.equal(source.sponsor_review_status, 'pending_review');
      assert.equal(source.sponsor_details_submitted_at, null, 'Administrative correction never submits the sponsor form.');
    };
    let firstPayload, firstProposal;
    await t.test('activation persists work through unavailability and duplicate preparation commands', async () => {
      assert.equal((await sourceDb.pool.query('SELECT count(*)::int AS n FROM preflight_workshop_events WHERE contribution_id=$1', [contributionId])).rows[0].n, 1);
      await workshop.tick(); const state = await workshop.read(contributionId);
      assert.equal(state.sourceVersion, 1); assert.equal(state.mission.delivery, 'uncertain'); assert.equal(state.mission.errorCode, 'PREFLIGHT_TEMPORARILY_UNAVAILABLE');
      assert.equal(state.proposal, null); assert.equal(state.canAdopt, false);
      firstPayload = (await sourceDb.pool.query('SELECT payload FROM preflight_workshop_missions WHERE id=$1', [state.mission.id])).rows[0].payload;
      assert.equal(firstPayload.input.editorialContext.publicIdentity.consent, false); assert.deepEqual(firstPayload.input.editorialContext.sourceFacts, []);
      assert.deepEqual(new Set(firstPayload.input.editorialContext.destinations.map(value => value.destination)), new Set(['website', 'facebook']));
      const command = { contributionId, expectedSourceVersion: 1, requestId: randomUUID() };
      const prepared = await workshop.prepare(command, 'synthetic-administrator');
      assert.equal((await workshop.prepare(command, 'synthetic-administrator')).mission.id, prepared.mission.id);
      await assert.rejects(() => workshop.prepare(command, 'different-administrator'), error => error.code === 'PUBLICATION_WORKSHOP_REQUEST_CONFLICT');
      assert.equal(await countMissions(), 1); await assertNoBusinessDecision();
    });
    await t.test('lost submission response reconciles the same mission after restarting Funding service', async () => {
      unavailable = false; await retryNow(); await workshop.tick();
      assert.equal((await workshop.read(contributionId)).mission.delivery, 'uncertain');
      assert.equal((await client.getMission(firstPayload.missionId)).mission.id, firstPayload.missionId);
      workshop = new PublicationWorkshopService(sourceDb.pool, config, { client }); await retryNow();
      const ready = await until(async () => { await workshop.tick(); return workshop.read(contributionId); }, state => !!state.proposal); firstProposal = ready.proposal;
      assert.equal(firstProposal.missionId, firstPayload.missionId); assert.equal(firstProposal.sourceVersion, 1);
      assert.equal(firstProposal.provenance.simulated, true); assert.equal(firstProposal.provenance.provider, 'mock');
      assert.equal(firstProposal.editorialPreparation.state, 'partial'); assert.equal(firstProposal.editorialPreparation.publicationAuthorized, false);
      assert.ok(firstProposal.editorialPreparation.common.missingInformation.includes('contact_email')); assert.ok(firstProposal.editorialPreparation.common.missingInformation.includes('public_name_consent'));
      assert.ok(firstProposal.editorialPreparation.variants.every(value => !value.body && !value.publicationAuthorized));
      assert.equal((await client.submit(firstPayload)).duplicate, true); await workshop.tick(); assert.equal(await countMissions(), 1);
      assert.equal((await sourceDb.pool.query('SELECT count(*)::int AS n FROM preflight_workshop_proposals')).rows[0].n, 1); assert.equal(tokenCalls, 1);
      const scope = { tenantId, subject: 'synthetic-reviewer', roles: ['viewer'], applications: ['funding-platform'], correlationId: randomUUID() };
      assert.ok((await engine.briefing(scope)).proposals.some(value => value.id === firstProposal.id));
      await assert.rejects(() => workshop.adopt({ contributionId, proposalId: firstProposal.id, expectedSourceVersion: 1, requestId: randomUUID() }, 'synthetic-administrator'), error => error.code === 'PUBLICATION_WORKSHOP_PROPOSAL_NOT_CURRENT');
      await assertNoBusinessDecision();
    });
    await t.test('completed source facts supersede old proposals without approving or publishing', async () => {
      await sourceDb.pool.query(`UPDATE fund_contributions SET sponsor_company_name='Organisation synthétique',sponsor_contact_email='private-synthetic@example.invalid',
        email_private='billing-synthetic@example.invalid',sponsor_public_summary='Présentation publique synthétique autorisée.',public_display_consent=TRUE,updated_at=NOW() WHERE id=$1`, [contributionId]);
      const immediately = await workshop.read(contributionId); assert.equal(immediately.proposal, null); assert.ok(immediately.history.some(value => value.id === firstProposal.id && value.obsolete));
      const updated = await until(async () => { await workshop.tick(); return workshop.read(contributionId); }, state => state.proposal?.sourceVersion === 2);
      assert.equal(updated.proposal.editorialPreparation.state, 'ready_for_review'); assert.equal(updated.proposal.editorialPreparation.publicationAuthorized, false);
      assert.equal(updated.canAdopt, false, 'Preparing content never supplies the missing administrative review.'); assert.ok(updated.history.some(value => value.id === firstProposal.id && value.obsolete));
      const obsolete = await client.getMission(firstPayload.missionId); assert.equal(obsolete.mission.status, 'superseded'); assert.ok(obsolete.results.every(value => value.obsolete));
      const secondPayload = (await sourceDb.pool.query('SELECT payload FROM preflight_workshop_missions WHERE source_version=2')).rows[0].payload;
      assert.equal(JSON.stringify(secondPayload).includes('private-synthetic'), false); assert.equal(JSON.stringify(secondPayload).includes('billing-synthetic'), false);
      assert.ok(secondPayload.input.editorialContext.sourceFacts.every(value => !['amountMinor', 'currency'].includes(value.key)));
      assert.deepEqual(updated.proposal.editorialPreparation.variants.map(value => [value.obligationId, value.obligationVersion]), secondPayload.input.editorialContext.destinations.map(value => [value.obligationId, value.obligationVersion]));
      await workshop.tick(); assert.equal(await countMissions(), 2); await assertNoBusinessDecision();
    });
    await t.test('signed identities cannot cross tenants or applications and cancellation requires the exact source version', async () => {
      const separateId = randomUUID(), separate = { ...firstPayload, missionId: randomUUID(), eventId: randomUUID(), source: { ...firstPayload.source, subjectId: separateId },
        input: { ...firstPayload.input, editorialContext: { ...firstPayload.input.editorialContext, sourceCommitmentId: separateId } } };
      const created = await client.submit(separate); await assert.rejects(() => client.cancelMission(created.mission.id, 2, randomUUID()));
      assert.equal((await client.cancelMission(created.mission.id, 1, randomUUID())).mission.status, 'cancelled');
      const denied = new transport.PreflightClient({ ...config, tenantId: 'different-tenant' });
      await assert.rejects(() => denied.submit({ ...separate, tenantId: 'different-tenant', missionId: randomUUID(), eventId: randomUUID() }), error => error instanceof transport.PreflightClientError && error.status === 403);
      const response = await fetch(baseUrl + '/api/missions', { method: 'POST', headers: { authorization: `Bearer ${await sign(tenantId, ['openg7-social'])}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...separate, missionId: randomUUID(), eventId: randomUUID() }) });
      assert.equal(response.status, 403); await assertNoBusinessDecision();
    });
  } finally {
    await worker?.stop(); await app?.close(); await new Promise(resolve => issuer.close(resolve)); await pool.end();
    try { await bootstrap.query(`DROP SCHEMA IF EXISTS ${bossSchema} CASCADE`); await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await bootstrap.end(); await sourceDb.stop(); }
  }
});
