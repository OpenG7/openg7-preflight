import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { runMigrations } from '../scripts/migrate.js';
import { missionInputSchema, type AccessContext, type MissionInput } from '../packages/contracts/src/index.js';
import { AiProviderError, MockAiProvider, type AiProvider } from '../packages/ai/src/index.js';
import { PreflightService, startWorker, processTask, DomainError } from '../packages/engine/src/index.js';

const url=process.env['TEST_DATABASE_URL'];
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until<T>(read:()=>Promise<T>,accept:(value:T)=>boolean,timeout=20000):Promise<T>{
  const end=Date.now()+timeout;
  while(Date.now()<end){const value=await read();if(accept(value))return value;await pause(100);}
  throw new Error('condition_timeout');
}
const scope:AccessContext={tenantId:'integration',subject:'tester',roles:['administrator','service_integration'],applications:['funding-platform','openg7-social'],correlationId:randomUUID()};
function input(kind:'funding'|'social'='funding',overrides:Partial<MissionInput>={}):MissionInput{
  return missionInputSchema.parse({schemaVersion:'1.0',eventId:randomUUID(),tenantId:scope.tenantId,
    source:{application:kind==='funding'?'funding-platform':'openg7-social',subjectType:kind==='funding'?'sponsorship':'editorial-topic',subjectId:randomUUID(),version:1},
    workflow:{type:kind==='funding'?'sponsorship-preparation-v1':'editorial-brief-preparation-v1',version:'1.0'},constraints:{timeoutMs:2000,maxAttempts:3},
    input:kind==='funding'?{title:'Synthetic local agreement',description:'Community energy project',benefits:['Draft Web presentation only']}:{topic:'Community energy',audience:'Local community'},...overrides});
}

test('PostgreSQL durable engine: complete workflows, tenants, versions, batching, retries and recovery',{skip:!url,timeout:120000},async t=>{
  const schema=`engine_test_${randomUUID().replaceAll('-','')}`;
  const bossSchema=`boss_${schema}`;
  const bootstrap=new pg.Pool({connectionString:url});
  await bootstrap.query(`CREATE SCHEMA ${schema}`);
  const pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`,max:15});
  let worker:Awaited<ReturnType<typeof startWorker>>|undefined;
  const service=new PreflightService(pool);
  const boss=new PgBoss({connectionString:url,schema:bossSchema,monitorIntervalSeconds:1});
  try{
    assert.deepEqual(await runMigrations(pool),['001_preflight.sql','002_batch_selection_history.sql']);assert.deepEqual(await runMigrations(pool),[]);
    await t.test('submission is persistent, transactional and idempotent even under concurrent reception',async()=>{
      const mission=input();const [a,b]=await Promise.all([service.submit(mission,scope),service.submit(mission,scope)]);
      assert.equal(a.mission.id,b.mission.id);assert.equal(Number(a.duplicate)+Number(b.duplicate),1);
      const detail=await service.detail(a.mission.id,scope);assert.equal(detail?.tasks.length,5);assert.equal(detail?.mission.status,'ready');
      await assert.rejects(()=>service.submit({...mission,input:{...mission.input,title:'Changed'}},scope),/idempotency_conflict/);
      await assert.rejects(()=>service.submit({...mission,tenantId:'another'},scope),/tenant_forbidden/);
      assert.equal(await service.detail(a.mission.id,{...scope,tenantId:'another'}),null);
      assert.equal(await service.detail(a.mission.id,{...scope,applications:['openg7-social']}),null);
      await assert.rejects(()=>service.cancel(a.mission.id,{...scope,roles:['viewer']}),/forbidden/);
      await assert.rejects(()=>service.submit(input('social',{input:{topic:123}}),scope),/workflow_input_invalid/);
      const eventId=randomUUID();const one=input('social',{eventId});const two=input('social',{eventId});
      const concurrent=await Promise.allSettled([service.submit(one,scope),service.submit(two,scope)]);
      assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);
      assert.match(String((concurrent.find(result=>result.status==='rejected') as PromiseRejectedResult).reason),/idempotency_conflict/);
    });
    await t.test('source service cancellation is versioned, scoped and idempotent',async()=>{
      const mission=await service.submit(input(),scope);
      const sourceScope:AccessContext={...scope,roles:['service_integration']};
      await assert.rejects(()=>service.cancel(mission.mission.id,sourceScope),/source_version_required/);
      await assert.rejects(()=>service.cancel(mission.mission.id,sourceScope,{sourceVersion:2,eventId:randomUUID()}),/stale_source_version/);
      await assert.rejects(()=>service.cancel(mission.mission.id,{...sourceScope,tenantId:'other'},{sourceVersion:1,eventId:randomUUID()}),/mission_not_found/);
      const eventId=randomUUID();
      assert.equal((await service.cancel(mission.mission.id,sourceScope,{sourceVersion:1,eventId}))?.mission.status,'cancelled');
      assert.equal((await service.cancel(mission.mission.id,sourceScope,{sourceVersion:1,eventId}))?.mission.status,'cancelled');
      const second=await service.submit(input(),scope);
      await assert.rejects(()=>service.cancel(second.mission.id,sourceScope,{sourceVersion:1,eventId}),/idempotency_conflict/);
      assert.equal((await service.detail(second.mission.id,scope))?.mission.status,'ready');
    });
    worker=await startWorker({pool,boss,provider:new MockAiProvider(),concurrency:4,pollIntervalSeconds:0.5,dispatchIntervalMs:50});
    let firstProposalId='',secondProposalId='',socialProposalId='',firstMissionId='';
    await t.test('two unrelated workflows use real PostgreSQL and the same worker, results and briefing',async()=>{
      const funding=await service.submit(input(),scope);firstMissionId=funding.mission.id;
      const funding2=await service.submit(input(),scope);
      const social=await service.submit(input('social'),scope);
      for(const mission of [funding,funding2,social]){
        const detail=await until(()=>service.detail(mission.mission.id,scope),d=>d?.mission.status==='review_ready');
        assert.equal(detail?.results.length,5);assert.equal(detail?.tasks.filter(task=>task.status==='completed').length,5);
        assert.equal(detail?.proposals.length,1);assert.equal(detail?.proposals[0]?.status,'prepared');
        const draft=detail?.results.find(result=>result.kind==='draft');assert.equal(draft?.provenance['simulated'],true);assert.equal(draft?.provenance['provider'],'mock');
        assert.equal((detail?.proposals[0] as Record<string,unknown>)?.['businessDecisionExecuted'],false);
        if(mission===funding)firstProposalId=detail!.proposals[0]!.id;
        if(mission===funding2)secondProposalId=detail!.proposals[0]!.id;
        if(mission===social)socialProposalId=detail!.proposals[0]!.id;
      }
      const briefing=await service.briefing(scope);assert.ok(briefing.counts['review_ready']!>=3);assert.ok(briefing.recentActivity.length>0);
      await service.checkpoint(scope);const next=await service.briefing(scope);assert.equal(next.recentActivity.length,0);
      assert.equal(next.counts['review_ready'],briefing.counts['review_ready']);
      assert.equal(next.countsSince.prepared,0);assert.equal(next.metrics.costsAreEstimates,true);
    });
    await t.test('versioned homogeneous proposal batches allow exclusion and prevent direct business approval',async()=>{
      const batch=await service.buildBatch({proposalIds:[firstProposalId,secondProposalId]},scope);assert.equal(batch.items.length,2);
      const excluded=await service.excludeBatch(batch.id,secondProposalId,batch.version,scope);assert.equal(excluded.version,batch.version+1);
      assert.equal(excluded.selectionHistory.length,2);assert.equal(batch.selectionHistory.length,1);
      await assert.rejects(()=>service.exportBatch(batch.id,batch.version,scope),/version_conflict/);
      const exported=await service.exportBatch(batch.id,excluded.version,scope);assert.equal(exported.proposals.length,1);assert.equal(exported.businessDecisionExecuted,false);
      await assert.rejects(()=>service.recordDecision(firstMissionId,{sourceVersion:1,eventId:randomUUID(),decision:'approved'},{...scope,roles:['administrator']}),/forbidden/);
      await assert.rejects(()=>service.buildBatch({proposalIds:[firstProposalId,socialProposalId]},scope),/heterogeneous_batch/);
    });
    await t.test('new source versions invalidate proposals, results and previously prepared batches',async()=>{
      const batch=await service.buildBatch({proposalIds:[firstProposalId]},scope);
      const detail=await service.detail(firstMissionId,scope);assert.ok(detail);
      const update={eventId:randomUUID(),tenantId:scope.tenantId,source:{...detail.mission.source,version:2}};
      assert.equal((await service.sourceUpdate(update,scope)).invalidated,1);assert.equal((await service.sourceUpdate(update,scope)).duplicate,true);
      const obsolete=await service.detail(firstMissionId,scope);assert.equal(obsolete?.mission.status,'superseded');assert.ok(obsolete?.results.every(result=>result.obsolete));
      await assert.rejects(()=>service.exportBatch(batch.id,batch.version,scope),/obsolete_proposal/);
      const late=await service.submit(input('funding',{source:{...detail.mission.source,version:1},workflow:{...detail.mission.workflow,version:'1.0'},eventId:randomUUID(),missionId:randomUUID(),input:detail.mission.input,constraints:detail.mission.constraints,priority:detail.mission.priority as MissionInput['priority']}),scope);
      assert.equal(late.mission.status,'superseded');
      const unknownSource={application:'openg7-social',subjectType:'topic',subjectId:randomUUID(),version:5};
      await service.sourceUpdate({tenantId:scope.tenantId,eventId:randomUUID(),source:unknownSource},scope);
      const outOfOrder=await service.submit(input('social',{source:{...unknownSource,version:4}}),scope);
      assert.equal(outOfOrder.mission.status,'superseded');assert.equal((await service.detail(outOfOrder.mission.id,scope))?.tasks.length,0);
    });
    await t.test('missing inputs wait durably and resume without a second mission',async()=>{
      const mission=await service.submit(input('social',{input:{}}),scope);
      await until(()=>service.detail(mission.mission.id,scope),d=>d?.mission.status==='waiting_input');
      await service.provideInput(mission.mission.id,{topic:'A supplied topic'},scope);
      const ready=await until(()=>service.detail(mission.mission.id,scope),d=>d?.mission.status==='review_ready');assert.equal(ready?.proposals.length,1);
    });
    await t.test('cancellation prevents queued work and a restart resumes persisted submissions',async()=>{
      await worker!.stop();worker=undefined;
      const cancelled=await service.submit(input('social'),scope);await service.cancel(cancelled.mission.id,scope);
      const pending=await service.submit(input('social'),scope);
      worker=await startWorker({pool,boss,provider:new MockAiProvider(),pollIntervalSeconds:0.5,dispatchIntervalMs:50});
      await until(()=>service.detail(pending.mission.id,scope),d=>d?.mission.status==='review_ready');
      const detail=await service.detail(cancelled.mission.id,scope);assert.equal(detail?.mission.status,'cancelled');assert.equal(detail?.results.length,0);
    });
    await worker.stop();worker=undefined;
    await t.test('retry attempts preserve errors; invalid provider output is never persisted',async()=>{
      let calls=0;
      const provider:AiProvider={id:'mock',simulated:true,generate:async(i,o)=>{calls++;if(calls===1)throw new AiProviderError('temporary_failure',true);return new MockAiProvider().generate(i,o);}};
      const mission=await service.submit(input('social'),scope);
      worker=await startWorker({pool,boss,provider,pollIntervalSeconds:0.5,dispatchIntervalMs:50});
      const ready=await until(()=>service.detail(mission.mission.id,scope),d=>d?.mission.status==='review_ready');
      assert.equal(ready?.tasks.find(task=>task.kind==='draft')?.attempts,2);assert.ok(ready?.history.some(event=>event.action==='task.retry_scheduled'));
      await worker.stop();worker=undefined;
      const invalid:AiProvider={id:'mock',simulated:true,generate:async()=>({output:{title:''},provenance:{}} as never)};
      const bad=await service.submit(input('social'),scope);worker=await startWorker({pool,boss,provider:invalid,pollIntervalSeconds:0.5,dispatchIntervalMs:50});
      const failed=await until(()=>service.detail(bad.mission.id,scope),d=>d?.mission.status==='failed');
      assert.equal(failed?.mission.errorCode,'provider_output_invalid');assert.equal(failed?.results.filter(result=>result.kind==='draft').length,0);
    });
    await worker!.stop();worker=undefined;
    await t.test('timeouts are bounded, stale attempts are fenced, and conservative cost survives retries',async()=>{
      const timed=await service.submit(input('social',{constraints:{humanApprovalRequired:true,maxCostUsd:0.3,maxAttempts:1,timeoutMs:100}}),scope);
      const hanging:AiProvider={id:'mock',simulated:true,generate:()=>new Promise(()=>{})};
      worker=await startWorker({pool,boss,provider:hanging,pollIntervalSeconds:0.5,dispatchIntervalMs:50});
      const failed=await until(()=>service.detail(timed.mission.id,scope),d=>d?.mission.status==='failed');assert.equal(failed?.mission.errorCode,'task_timeout');
      await worker.stop();worker=undefined;
      const charged=await service.submit(input('social',{constraints:{humanApprovalRequired:true,maxCostUsd:0.3,maxAttempts:2,timeoutMs:1000}}),scope);
      const unavailable:AiProvider={id:'real-test',simulated:false,generate:async()=>{throw new AiProviderError('provider_unavailable',true);}};
      worker=await startWorker({pool,boss,provider:unavailable,pollIntervalSeconds:0.5,dispatchIntervalMs:50});
      const exhausted=await until(()=>service.detail(charged.mission.id,scope),d=>d?.mission.status==='failed');
      assert.ok(Math.abs(exhausted!.mission.reservedCostUsd-0.3)<1e-9);assert.equal(exhausted?.tasks.find(task=>task.kind==='draft')?.attempts,2);
    });
    await worker!.stop();worker=undefined;
    await t.test('an abandoned running lease can be reclaimed and original attempt cannot overwrite newer result',async()=>{
      const submitted=await service.submit(input('social'),scope);
      const task=(await pool.query('SELECT * FROM tasks WHERE tenant_id=$1 AND mission_id=$2 AND key=$3',[scope.tenantId,submitted.mission.id,'inspect'])).rows[0];
      await pool.query("UPDATE tasks SET status='running',attempts=1,attempt_token=$2,lease_until=now()-interval '1 second' WHERE id=$1",[task.id,randomUUID()]);
      await processTask(pool,{taskId:task.id,tenantId:scope.tenantId,missionId:submitted.mission.id,runRevision:1},new MockAiProvider());
      const detail=await service.detail(submitted.mission.id,scope);assert.equal(detail?.tasks.find(t=>t.key==='inspect')?.status,'completed');assert.equal(detail?.tasks.find(t=>t.key==='inspect')?.attempts,2);
      const policy=detail!.tasks.find(task=>task.key==='policy')!;
      await processTask(pool,{taskId:policy.id,tenantId:scope.tenantId,missionId:submitted.mission.id,runRevision:1},new MockAiProvider());
      const draft=(await service.detail(submitted.mission.id,scope))!.tasks.find(task=>task.key==='draft')!;
      const job={taskId:draft.id,tenantId:scope.tenantId,missionId:submitted.mission.id,runRevision:1};
      let release:(value:Awaited<ReturnType<AiProvider['generate']>>)=>void=()=>{};
      const delayed:AiProvider={id:'mock',simulated:true,generate:()=>new Promise(resolve=>{release=resolve;})};
      const oldAttempt=processTask(pool,job,delayed);
      await until(()=>service.detail(submitted.mission.id,scope),d=>d?.tasks.find(task=>task.id===draft.id)?.status==='running');
      await pool.query("UPDATE tasks SET lease_until=now()-interval '1 second' WHERE id=$1",[draft.id]);
      await processTask(pool,job,new MockAiProvider());
      release(await new MockAiProvider().generate({kind:'editorial-brief',data:{topic:'Stale draft'},maxCostUsd:0}));await oldAttempt;
      const fenced=await service.detail(submitted.mission.id,scope);assert.equal(fenced?.results.filter(result=>result.kind==='draft').length,1);
      assert.notEqual(fenced?.results.find(result=>result.kind==='draft')?.output['title'],'[Démonstration] Stale draft');
    });
    await t.test('list pagination and filters are server-side and unauthorized application is rejected',async()=>{
      const listed=await service.list(scope,{page:1,pageSize:2,application:'openg7-social'});assert.equal(listed.items.length,2);assert.ok(listed.total>=2);
      assert.ok(listed.items.every(m=>m.source.application==='openg7-social'));
      await assert.rejects(()=>service.list({...scope,applications:['openg7-social']},{application:'funding-platform'}),DomainError);
    });
  }finally{
    if(worker)await worker.stop();else{try{await boss.stop();}catch{}}
    await pool.end();
    await bootstrap.query(`DROP SCHEMA IF EXISTS ${bossSchema} CASCADE`);await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await bootstrap.end();
  }
});
