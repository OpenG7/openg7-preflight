import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { PgBoss } from 'pg-boss';
import { AiProviderError, aiTaskResultSchema, type AiProvider } from '../../ai/src/index.js';
import { missingInput, resolveWorkflow } from './workflows.js';
import { DomainError, enqueue, event, hashInput, terminalStates, transaction, transition, type MissionRow, type ResultRow, type TaskRow } from './service.js';

export const queueName='preflight-task-v1';
export const quarantineName='preflight-quarantine-v1';
interface TaskJob {taskId:string;tenantId:string;missionId:string;runRevision:number;application?:string;correlationId?:string}
interface Claim {mission:MissionRow;task:TaskRow;token:string;budget:number}
interface Output {output:Record<string,unknown>;provenance:Record<string,unknown>;proposal?:Record<string,unknown>}
class WaitingInput extends Error {constructor(public fields:string[]){super('missing_input');}}
export interface WorkerOptions {
  pool:Pool;provider:AiProvider;connectionString?:string;boss?:PgBoss;
  concurrency?:number;pollIntervalSeconds?:number;dispatchIntervalMs?:number;
  onError?:(code:string)=>void;
  onEvent?:(data:Record<string,unknown>)=>void;
}

/** Atomic PostgreSQL outbox -> pg-boss bridge. Transaction owns both job insertion and dispatch mark. */
export async function dispatchOutbox(pool:Pool,boss:PgBoss):Promise<number>{
  return transaction(pool,async client=>{
    const rows=await client.query<{id:string;task_id:string;tenant_id:string;mission_id:string;run_revision:number;max_attempts:number;constraints:{timeoutMs:number};priority:string;source_application:string;correlation_id:string}>(`SELECT o.*,t.max_attempts,m.constraints,m.priority,m.source_application,m.correlation_id FROM task_outbox o
      JOIN tasks t ON t.id=o.task_id JOIN missions m ON m.tenant_id=o.tenant_id AND m.id=o.mission_id
      WHERE o.dispatched_at IS NULL ORDER BY o.created_at LIMIT 50 FOR UPDATE OF o SKIP LOCKED`);
    for(const row of rows.rows){
      await boss.send(queueName,{taskId:row.task_id,tenantId:row.tenant_id,missionId:row.mission_id,runRevision:row.run_revision,application:row.source_application,correlationId:row.correlation_id},
        {id:row.id,retryLimit:row.max_attempts-1,retryDelay:1,retryBackoff:true,expireInSeconds:Math.ceil(row.constraints.timeoutMs/1000)+10,
          deadLetter:quarantineName,priority:{urgent:100,high:50,normal:10,low:0}[row.priority]??10,
          db:{executeSql:async(text:string,values:unknown[])=>{const result=await client.query(text,values);return {rows:result.rows,rowCount:result.rowCount??0};}}});
      await client.query('UPDATE task_outbox SET dispatched_at=now() WHERE id=$1',[row.id]);
    }
    return rows.rowCount??0;
  });
}

async function claimTask(pool:Pool,job:TaskJob,provider:AiProvider):Promise<Claim|null>{
  return transaction(pool,async client=>{
    const mission=(await client.query<MissionRow>('SELECT * FROM missions WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[job.tenantId,job.missionId])).rows[0];
    if(!mission)return null;
    const task=(await client.query<TaskRow>('SELECT * FROM tasks WHERE id=$1 AND tenant_id=$2 AND mission_id=$3 FOR UPDATE',[job.taskId,job.tenantId,job.missionId])).rows[0];
    if(mission.status==='failed'&&task?.status==='failed')throw new Error(task.error_code??'task_failed');
    if(terminalStates.has(mission.status))return null;
    if(!task||task.run_revision!==job.runRevision||['completed','cancelled','failed','waiting_input','waiting_dependency'].includes(task.status))return null;
    if(task.status==='running'&&task.lease_until&&new Date(task.lease_until).getTime()>Date.now())throw new AiProviderError('task_lease_active',true);
    if(task.attempts>=task.max_attempts){
      await client.query("UPDATE tasks SET status='failed',error_code='attempts_exhausted',updated_at=now() WHERE id=$1",[task.id]);
      await client.query("UPDATE missions SET error_code='attempts_exhausted' WHERE tenant_id=$1 AND id=$2",[mission.tenant_id,mission.id]);
      await transition(client,mission,'failed');return null;
    }
    const token=randomUUID();
    let budget=0;
    if(task.kind==='draft'&&!provider.simulated){
      const cap=mission.constraints.maxCostUsd;
      // Reserve before the external call. Reservations survive crashes and are never released after uncertain calls.
      budget=cap/mission.constraints.maxAttempts;
      const reserved=Number(mission.reserved_cost_usd);
      if(cap<=0||reserved+budget>cap+1e-9){
        await client.query("UPDATE tasks SET status='failed',error_code='budget_exceeded',updated_at=now() WHERE id=$1",[task.id]);
        await client.query("UPDATE missions SET error_code='budget_exceeded' WHERE tenant_id=$1 AND id=$2",[mission.tenant_id,mission.id]);
        await transition(client,mission,'failed');return null;
      }
      await client.query('UPDATE missions SET reserved_cost_usd=reserved_cost_usd+$3 WHERE tenant_id=$1 AND id=$2',[mission.tenant_id,mission.id,budget]);
    }
    await client.query("UPDATE tasks SET status='running',attempts=attempts+1,attempt_token=$2,lease_until=now()+($3::int * interval '1 millisecond'),started_at=now(),updated_at=now() WHERE id=$1",
      [task.id,token,mission.constraints.timeoutMs+5_000]);
    if(mission.status!=='waiting_input')await transition(client,mission,'running');
    await event(client,mission,'task.started','worker',{taskId:task.id,kind:task.kind,attempt:task.attempts+1});
    return {mission,task:{...task,attempts:task.attempts+1},token,budget};
  });
}

async function readResults(pool:Pool,mission:MissionRow):Promise<ResultRow[]>{
  const {rows}=await pool.query<ResultRow>('SELECT * FROM results WHERE tenant_id=$1 AND mission_id=$2 AND obsolete=false ORDER BY created_at',[mission.tenant_id,mission.id]);return rows;
}
function deterministicProvenance(mission:MissionRow,task:TaskRow){return {provider:'deterministic',model:`${task.kind}-v1`,simulated:false,generatedAt:new Date().toISOString(),inputHash:hashInput(mission.input),inputVersion:mission.source_version,estimatedCostUsd:0};}

async function execute(pool:Pool,claim:Claim,provider:AiProvider,signal:AbortSignal):Promise<Output>{
  const {mission,task}=claim;
  const definition=resolveWorkflow({source:{application:mission.source_application,subjectType:mission.subject_type,subjectId:mission.subject_id,version:mission.source_version},workflow:{type:mission.workflow_type,version:'1.0'}});
  if(!definition)throw new DomainError('unsupported_workflow',422);
  const provenance=deterministicProvenance(mission,task);
  if(task.kind==='completeness'){
    const missing=missingInput(definition,mission.input);if(missing.length)throw new WaitingInput(missing);
    return {output:{complete:true,checkedFields:definition.requiredInput},provenance};
  }
  if(task.kind==='preparation-policy'){
    if(mission.constraints.humanApprovalRequired!==true)throw new DomainError('human_review_required',422);
    return {output:{policy:definition.policy,preparationOnly:true,humanReviewRequired:true,externalPublicationAllowed:false,businessDecisionAllowed:false},provenance};
  }
  if(task.kind==='draft'){
    const raw=await provider.generate({kind:definition.capability,data:mission.input,maxCostUsd:provider.simulated?0:claim.budget,timeoutMs:mission.constraints.timeoutMs},{signal});
    const parsed=aiTaskResultSchema.safeParse(raw);
    if(!parsed.success)throw new AiProviderError('provider_output_invalid');
    if(parsed.data.provenance.simulated!==provider.simulated||parsed.data.provenance.provider!==provider.id)throw new AiProviderError('provider_provenance_invalid');
    if(parsed.data.provenance.estimatedCostUsd>(provider.simulated?0:claim.budget)+1e-9)throw new AiProviderError('budget_exceeded');
    return {output:parsed.data.output,provenance:{...parsed.data.provenance,inputVersion:mission.source_version,reservedCostUsd:claim.budget}};
  }
  const results=await readResults(pool,mission);
  const draft=results.find(result=>result.kind==='draft');
  if(!draft)throw new DomainError('draft_missing');
  if(task.kind==='output-check'){
    const parsed=aiTaskResultSchema.safeParse({output:draft.output,provenance:Object.fromEntries(Object.entries(draft.provenance).filter(([key])=>!['inputVersion','reservedCostUsd'].includes(key)))});
    if(!parsed.success)throw new AiProviderError('persisted_output_invalid');
    return {output:{passed:true,checks:['output-schema-v1','provenance-v1','human-review-required'],warnings:parsed.data.output.warnings,sourceVersion:mission.source_version},provenance};
  }
  if(task.kind==='review-proposal'){
    const checks=results.filter(result=>['completeness','preparation-policy','output-check'].includes(result.kind));
    if(checks.length!==3)throw new DomainError('checks_incomplete');
    const warnings=Array.isArray(draft.output['warnings'])?draft.output['warnings'] as string[]:[];
    const simulated=draft.provenance['simulated']===true;
    const anomalies=warnings.filter(warning=>!simulated||(!warning.startsWith('Simulation déterministe')&&!warning.startsWith('Les faits, droits')));
    const proposal={
      resultIds:results.map(result=>result.id),draftResultId:draft.id,sourceVersion:mission.source_version,
      checks:checks.map(check=>({resultId:check.id,kind:check.kind,passed:true})),anomalies,
      explanations:['Préparation terminée; aucune décision métier ni publication effectuée.'],
      provenance:draft.provenance,limitations:warnings,
      blockingConditions:simulated?['Résultat de démonstration; validation dans l’application source requise.']:['Autorisations, version et statut à revérifier par l’application source.'],
      authority:'source_application',businessDecisionExecuted:false,
    };
    return {output:{prepared:true,type:anomalies.length?'human_arbitration':'review',risk:anomalies.length?'exception':'normal'},provenance,proposal};
  }
  throw new DomainError('unknown_task_kind',422);
}

async function advance(client:PoolClient,mission:MissionRow):Promise<void>{
  const {rows}=await client.query<TaskRow>('SELECT * FROM tasks WHERE tenant_id=$1 AND mission_id=$2',[mission.tenant_id,mission.id]);
  const done=new Set(rows.filter(task=>task.status==='completed').map(task=>task.key));
  for(const task of rows.filter(task=>task.status==='waiting_dependency'&&task.dependencies.every(key=>done.has(key)))){
    await client.query("UPDATE tasks SET status='ready',updated_at=now() WHERE id=$1",[task.id]);await enqueue(client,task);
  }
  if(rows.every(task=>task.status==='completed'))await transition(client,mission,'review_ready');
  else if(rows.some(task=>task.status==='waiting_input')&&mission.status!=='waiting_input')await transition(client,mission,'waiting_input');
}

async function settle(pool:Pool,claim:Claim,result:Output):Promise<void>{
  await transaction(pool,async client=>{
    const {mission,task,token}=claim;
    const current=(await client.query<MissionRow>('SELECT * FROM missions WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[mission.tenant_id,mission.id])).rows[0];
    if(!current||terminalStates.has(current.status))return;
    const owned=(await client.query<TaskRow>("SELECT * FROM tasks WHERE id=$1 AND status='running' AND attempt_token=$2 FOR UPDATE",[task.id,token])).rows[0];
    if(!owned)return;
    await client.query('INSERT INTO results(id,tenant_id,mission_id,task_id,kind,output,provenance,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(task_id,version) DO NOTHING',
      [randomUUID(),mission.tenant_id,mission.id,task.id,task.kind,result.output,result.provenance,task.run_revision]);
    if(result.proposal)await client.query(`INSERT INTO review_proposals(id,tenant_id,mission_id,type,risk,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,mission_id) DO NOTHING`,
      [randomUUID(),mission.tenant_id,mission.id,result.output['type'],result.output['risk'],result.proposal]);
    await client.query("UPDATE tasks SET status='completed',attempt_token=NULL,lease_until=NULL,error_code=NULL,finished_at=now(),updated_at=now() WHERE id=$1",[task.id]);
    await event(client,current,'task.completed','worker',{taskId:task.id,kind:task.kind,attempt:task.attempts,estimatedCostUsd:result.provenance['estimatedCostUsd']??0});
    await advance(client,current);
  });
}

function safeCode(error:unknown):string{
  if(error instanceof AiProviderError||error instanceof DomainError)return error.code;
  if(error instanceof Error&&(error.name==='TimeoutError'||error.name==='AbortError'))return 'task_timeout';
  return 'task_execution_failed';
}
async function fail(pool:Pool,claim:Claim,error:unknown):Promise<{retry:boolean;code:string}>{
  return transaction(pool,async client=>{
    const {mission,task,token}=claim;
    const current=(await client.query<MissionRow>('SELECT * FROM missions WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[mission.tenant_id,mission.id])).rows[0];
    if(!current||terminalStates.has(current.status))return {retry:false,code:'stale_task'};
    const owned=await client.query<TaskRow>("SELECT * FROM tasks WHERE id=$1 AND attempt_token=$2 AND status='running' FOR UPDATE",[task.id,token]);
    if(!owned.rows[0])return {retry:false,code:'stale_task'};
    if(error instanceof WaitingInput){
      await client.query("UPDATE tasks SET status='waiting_input',attempt_token=NULL,lease_until=NULL,error_code='missing_input',updated_at=now() WHERE id=$1",[task.id]);
      await event(client,current,'task.waiting_input','worker',{taskId:task.id,missingFields:error.fields});
      if(current.status!=='waiting_input')await transition(client,current,'waiting_input');
      return {retry:false,code:'missing_input'};
    }
    const code=safeCode(error);
    const retryable=error instanceof AiProviderError?error.retryable:!(error instanceof DomainError);
    const retry=retryable&&task.attempts<task.max_attempts;
    await client.query('UPDATE tasks SET status=$2,attempt_token=NULL,lease_until=NULL,error_code=$3,updated_at=now() WHERE id=$1',[task.id,retry?'ready':'failed',code]);
    await event(client,current,retry?'task.retry_scheduled':'task.quarantined','worker',{taskId:task.id,kind:task.kind,attempt:task.attempts,maxAttempts:task.max_attempts,errorCode:code});
    if(!retry){await client.query('UPDATE missions SET error_code=$3 WHERE tenant_id=$1 AND id=$2',[mission.tenant_id,mission.id,code]);await transition(client,current,'failed');}
    return {retry,code};
  });
}

export async function processTask(pool:Pool,job:TaskJob,provider:AiProvider):Promise<void>{
  const claim=await claimTask(pool,job,provider);if(!claim)return;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(new DOMException('Task timeout','TimeoutError')),claim.mission.constraints.timeoutMs);
  let abort:()=>void=()=>{};
  try{
    const expired=new Promise<never>((_,reject)=>{abort=()=>reject(new DOMException('Task timeout','TimeoutError'));controller.signal.addEventListener('abort',abort,{once:true});});
    const result=await Promise.race([execute(pool,claim,provider,controller.signal),expired]);
    await settle(pool,claim,result);
  }catch(error){
    const state=await fail(pool,claim,error);
    if(state.retry)throw new Error(state.code);
    if(state.code!=='missing_input'&&state.code!=='stale_task'){
      // Let pg-boss retain the failed job/dead-letter. Its retries become harmless no-ops for terminal tasks.
      throw new Error(state.code);
    }
  }finally{clearTimeout(timeout);controller.signal.removeEventListener('abort',abort);}
}

export async function startWorker(options:WorkerOptions){
  const boss=options.boss??new PgBoss({connectionString:options.connectionString??process.env['DATABASE_URL'],monitorIntervalSeconds:1});
  boss.on('error',()=>options.onError?.('queue_error'));
  await boss.start();
  await boss.createQueue(quarantineName);
  await boss.createQueue(queueName,{retryLimit:2,retryDelay:1,retryBackoff:true,deadLetter:quarantineName});
  const workIds:string[]=[];
  for(let n=0;n<(options.concurrency??4);n++)workIds.push(await boss.work<TaskJob>(queueName,{batchSize:1,pollingIntervalSeconds:options.pollIntervalSeconds??1},async jobs=>{
    for(const job of jobs){
      const started=Date.now();options.onEvent?.({event:'task.delivery.started',...job.data});
      try{await processTask(options.pool,job.data,options.provider);options.onEvent?.({event:'task.delivery.settled',...job.data,durationMs:Date.now()-started});}
      catch(error){options.onEvent?.({event:'task.delivery.failed',...job.data,durationMs:Date.now()-started,errorCode:'task_delivery_failed'});throw error;}
    }
  }));
  let stopped=false,dispatching=false;
  const dispatch=async()=>{
    if(stopped||dispatching)return;
    dispatching=true;
    try{await dispatchOutbox(options.pool,boss);}catch{options.onError?.('outbox_dispatch_error');}finally{dispatching=false;}
  };
  await dispatch();
  const timer=setInterval(()=>void dispatch(),options.dispatchIntervalMs??300);
  return {boss,dispatch,stop:async()=>{stopped=true;clearInterval(timer);await boss.stop({graceful:true,timeout:15000});}};
}
