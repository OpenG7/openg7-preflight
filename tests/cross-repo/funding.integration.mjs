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

const root=process.env.FUNDING_CONNECTOR_ROOT;
if(!root)throw new Error('FUNDING_CONNECTOR_ROOT must point to a built Funding checkout.');
if(!process.env.TEST_DATABASE_URL||!/test/i.test(new URL(process.env.TEST_DATABASE_URL).pathname))throw new Error('A dedicated TEST_DATABASE_URL is required.');
const funding=relative=>import(pathToFileURL(path.resolve(root,relative)).href);
const [{startDisposablePostgres},repo,offers,activation,transport,relayModule]=await Promise.all([
  funding('tests/integration/support/disposable-postgres.mjs'),funding('dist/apps/funding-api/src/preflight/repository.js'),
  funding('dist/apps/funding-api/src/sponsorship-commitments/offers.js'),funding('dist/apps/funding-api/src/sponsorship-commitments/repository.js'),
  funding('dist/apps/funding-api/src/preflight/client.js'),funding('dist/apps/funding-api/src/preflight/worker.js'),
]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('Funding activation -> OAuth/JWKS HTTP -> Preflight PG worker -> private Funding preparation', {timeout:120000}, async t=>{
  const sourceDb=await startDisposablePostgres();
  const schema=`cross_test_${randomUUID().replaceAll('-','')}`,bossSchema=`boss_${schema}`;
  const bootstrap=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
  await bootstrap.query(`CREATE SCHEMA ${schema}`);
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`,max:12});
  const old={PREFLIGHT_ENABLED:process.env.PREFLIGHT_ENABLED,PREFLIGHT_TENANT_ID:process.env.PREFLIGHT_TENANT_ID};
  const tenantId='synthetic-cross-repo';
  process.env.PREFLIGHT_ENABLED='true';process.env.PREFLIGHT_TENANT_ID=tenantId;
  const keys=await generateKeyPair('RS256');const jwk=await exportJWK(keys.publicKey);jwk.kid='synthetic-cross-key';jwk.alg='RS256';
  let issuerUrl,tokenCalls=0,worker,app,relay;
  const issuer=createServer(async(req,res)=>{
    if(req.url==='/keys'){res.setHeader('content-type','application/json');res.end(JSON.stringify({keys:[jwk]}));return;}
    if(req.url!=='/token'||req.method!=='POST'){res.statusCode=404;res.end();return;}
    let body='';for await(const chunk of req){body+=chunk;if(body.length>16384){res.statusCode=413;res.end();return;}}
    const params=new URLSearchParams(body);
    if(params.get('grant_type')!=='client_credentials'||params.get('client_id')!=='synthetic-funding-service'||params.get('client_secret')!=='synthetic-test-only-secret'){
      res.statusCode=401;res.end('{}');return;
    }
    tokenCalls++;
    const accessToken=await new SignJWT({tenant_id:tenantId,applications:['funding-platform'],realm_access:{roles:['service_integration']}})
      .setProtectedHeader({alg:'RS256',kid:jwk.kid}).setSubject('synthetic-funding-service').setIssuer(issuerUrl).setAudience('preflight-api').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
    res.setHeader('content-type','application/json');res.end(JSON.stringify({access_token:accessToken,token_type:'Bearer',expires_in:300}));
  });
  try{
    await runMigrations(pool);
    await new Promise(resolve=>issuer.listen(0,'127.0.0.1',resolve));issuerUrl=`http://127.0.0.1:${issuer.address().port}`;
    const service=new PreflightService(pool);
    app=await createApp({service,config:loadApiConfig({NODE_ENV:'test',AUTH_MODE:'jwt',HOST:'127.0.0.1',DATABASE_URL:process.env.TEST_DATABASE_URL,OIDC_ISSUER:issuerUrl,OIDC_AUDIENCE:'preflight-api',OIDC_JWKS_URL:`${issuerUrl}/keys`,API_RATE_LIMIT:'10000'}),health:()=>pool.query('SELECT 1')});
    const baseUrl=await app.listen({host:'127.0.0.1',port:0});
    worker=await startWorker({pool,boss:new PgBoss({connectionString:process.env.TEST_DATABASE_URL,schema:bossSchema}),provider:new MockAiProvider(),pollIntervalSeconds:0.5,dispatchIntervalMs:25});
    const client=new transport.PreflightClient({enabled:true,baseUrl,tenantId,tokenUrl:`${issuerUrl}/token`,clientId:'synthetic-funding-service',clientSecret:'synthetic-test-only-secret',requestTimeoutMs:5000,maxCostUsd:0.5});
    const settings={enabled:true,tenantId,maxCostUsd:0.5};
    relay=relayModule.createPreflightConnectorWorker({pool:sourceDb.pool,settings,client,pollIntervalMs:50});
    const operationId=randomUUID(),sessionId=`cs_synthetic_${randomUUID()}`,paymentId=`pi_synthetic_${randomUUID()}`,reference=`SYNTHETIC-${randomUUID()}`;
    await sourceDb.pool.query("INSERT INTO checkout_operations(id,key_hash,request_hash,state,params,contribution_input) VALUES($1,$2,$3,'prepared','{}','{}')",[operationId,operationId,operationId]);
    await repo.preflightTransaction(sourceDb.pool,db=>offers.recordCheckoutSponsorshipOffer(db,operationId,{publicReference:reference,quote:offers.quoteSponsorshipOffer(50000,'CAD')}));
    await sourceDb.pool.query("INSERT INTO stripe_checkout_sessions(stripe_session_id,stripe_payment_intent_id,contribution_type,amount_cents,currency,metadata,status) VALUES($1,$2,'sponsorship_interest',50000,'cad',$3,'paid')",[sessionId,paymentId,{openg7CheckoutOperationId:operationId}]);
    const contributionId=(await sourceDb.pool.query("INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,public_reference,stripe_session_id,stripe_payment_intent_id,public_display_consent,sponsor_company_name,email_private) VALUES('sponsorship_interest',50000,'cad','paid',NOW(),$1,$2,$3,TRUE,'Synthetic cross-repo organization','private-never-exported@example.invalid') RETURNING id",[reference,sessionId,paymentId])).rows[0].id;
    const facts={stripeSessionId:sessionId,stripePaymentIntentId:paymentId,trustedPaymentFacts:{amountCents:50000,currency:'CAD',publicReference:reference}};
    await repo.preflightTransaction(sourceDb.pool,db=>activation.activateSponsorshipCommitments(db,facts));
    const submitted=(await sourceDb.pool.query("SELECT payload FROM preflight_outbox WHERE event_type='mission.submitted'")).rows[0].payload;
    let first;
    await t.test('a real Funding activation becomes a validated private proposal over authenticated HTTP',async()=>{
      const deadline=Date.now()+25000;
      while(Date.now()<deadline){await relay.tick();first=(await repo.listPreparations(sourceDb.pool,contributionId,tenantId)).items[0];if(first)break;await sleep(150);}
      assert.ok(first,'A proposal must be imported from the real Preflight engine.');
      assert.equal(first.status,'proposed');assert.equal(first.businessDecisionExecuted,false);assert.equal(first.provenance.simulated,true);
      assert.equal(first.missionId,submitted.missionId);assert.equal(first.sourceVersion,1);assert.equal(tokenCalls,1);
      const replay=await client.submit(submitted);assert.equal(replay.duplicate,true);assert.equal(replay.mission.id,first.missionId);
      assert.ok((await client.listProposals()).items.some(item=>item.id===first.proposalId));
      const scope={tenantId,subject:'cross-reviewer',roles:['viewer'],applications:['funding-platform'],correlationId:randomUUID()};
      assert.ok((await service.briefing(scope)).proposals.some(item=>item.id===first.proposalId));
      assert.equal(JSON.stringify(submitted).includes('private-never-exported'),false);
      assert.equal((await sourceDb.pool.query('SELECT count(*)::int AS n FROM admin_preparation_approvals')).rows[0].n,0);
    });
    await t.test('source revision changes invalidate the old Preflight proposal and import a new version',async()=>{
      await sourceDb.pool.query("UPDATE fund_contributions SET sponsor_company_name='Synthetic revised organization' WHERE id=$1",[contributionId]);
      let imported=[];const deadline=Date.now()+25000;
      while(Date.now()<deadline){await relay.tick();imported=(await repo.listPreparations(sourceDb.pool,contributionId,tenantId)).items;if(imported.some(item=>item.sourceVersion===2&&!item.obsolete))break;await sleep(150);}
      assert.ok(imported.some(item=>item.sourceVersion===1&&item.obsolete));assert.ok(imported.some(item=>item.sourceVersion===2&&!item.obsolete));
      assert.equal((await client.getMission(first.missionId)).mission.status,'superseded');
      assert.equal((await sourceDb.pool.query('SELECT count(*)::int AS n FROM admin_preparation_approvals')).rows[0].n,0);
    });
    await t.test('a service can cancel only its versioned mission and cannot cross a tenant boundary',async()=>{
      const separate={...submitted,missionId:randomUUID(),eventId:randomUUID(),source:{...submitted.source,subjectId:randomUUID()}};
      const created=await client.submit(separate);
      await assert.rejects(()=>client.cancelMission(created.mission.id,2,randomUUID()));
      assert.equal((await client.cancelMission(created.mission.id,1,randomUUID())).mission.status,'cancelled');
      const denied=new transport.PreflightClient({enabled:true,baseUrl,tenantId:'other-tenant',tokenUrl:`${issuerUrl}/token`,clientId:'synthetic-funding-service',clientSecret:'synthetic-test-only-secret',requestTimeoutMs:5000,maxCostUsd:0.5});
      await assert.rejects(()=>denied.submit({...separate,tenantId:'other-tenant',missionId:randomUUID(),eventId:randomUUID()}),error=>error instanceof transport.PreflightClientError&&error.status===403);
    });
  }finally{
    await relay?.stop();await worker?.stop();await app?.close();
    await new Promise(resolve=>issuer.close(resolve));
    await pool.end();await bootstrap.query(`DROP SCHEMA IF EXISTS ${bossSchema} CASCADE`);await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await bootstrap.end();
    await sourceDb.stop();
    for(const[key,value]of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
