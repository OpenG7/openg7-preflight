import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { missionInputSchema, type MissionInput, type AccessContext } from '../../contracts/src/index.js';
import { assertTransition, invalidInput, planWorkflow, resolveWorkflow, validatePlan, workflows } from './workflows.js';

export class DomainError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 409) { super(code); }
}
export interface MissionRow extends QueryResultRow {
  tenant_id: string; id: string; source_application: string; subject_type: string; subject_id: string;
  source_version: number; workflow_type: string; workflow_version: string; priority: string;
  status: string; input: Record<string, unknown>; constraints: MissionInput['constraints'];
  input_hash: string; correlation_id: string; revision: number; error_code: string | null; reserved_cost_usd: string;
  created_at: Date; updated_at: Date;
}
export interface TaskRow extends QueryResultRow {
  id: string; tenant_id: string; mission_id: string; key: string; kind: string; dependencies: string[];
  status: string; attempts: number; max_attempts: number; run_revision: number; attempt_token: string | null;
  lease_until: Date | null; error_code: string | null; created_at: Date; updated_at: Date;started_at:Date|null;finished_at:Date|null;
}
export interface ResultRow extends QueryResultRow {
  id: string; task_id: string; kind: string; output: Record<string, unknown>;
  provenance: Record<string, unknown>; version: number; obsolete: boolean; created_at: Date;
}
interface ProposalRow extends MissionRow {
  proposal_id: string; proposal_type: string; risk: string; proposal_status: string; proposal_version: number;
  data: Record<string, unknown>; proposal_created_at: Date;
}
interface BatchMember extends QueryResultRow {
  proposalId:string;proposalVersion:number;sourceVersion:number;excluded:boolean;proposalStatus:string;
  currentProposalVersion:number;missionId:string;currentSourceVersion:number;missionStatus:string;blocked:boolean;
}
interface BatchRow extends QueryResultRow {id:string;name:string;version:number;criteria:Record<string,unknown>;createdAt:Date;updatedAt:Date}
export interface ListFilters { page?: number; pageSize?: number; q?: string; status?: string; application?: string }
export const terminalStates = new Set(['completed', 'failed', 'cancelled', 'superseded', 'review_ready']);
export const iso = (value: Date | string | null): string | null => value == null ? null : new Date(value).toISOString();
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const hashInput = (input: unknown): string => createHash('sha256').update(stable(input)).digest('hex');
export const missionDto = (row: MissionRow) => ({
  id: row.id, tenantId: row.tenant_id,
  source: { application: row.source_application, subjectType: row.subject_type, subjectId: row.subject_id, version: row.source_version },
  workflow: { type: row.workflow_type, version: row.workflow_version }, priority: row.priority,
  status: row.status, input: row.input, constraints: row.constraints, correlationId: row.correlation_id,
  revision: row.revision, errorCode: row.error_code, reservedCostUsd:Number(row.reserved_cost_usd), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
});
export const taskDto = (row: TaskRow) => ({
  id: row.id, key: row.key, kind: row.kind, dependencies: row.dependencies, status: row.status,
  attempts: row.attempts, maxAttempts: row.max_attempts, errorCode: row.error_code,
  startedAt:iso(row.started_at),finishedAt:iso(row.finished_at),durationMs:row.started_at&&row.finished_at?new Date(row.finished_at).getTime()-new Date(row.started_at).getTime():null,
  createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
});
export const resultDto = (row: ResultRow) => ({
  id: row.id, taskId: row.task_id, kind: row.kind, output: row.output, provenance: row.provenance,
  version: row.version, obsolete: row.obsolete, createdAt: iso(row.created_at),
});
const proposalSelect = `SELECT m.*,p.id AS proposal_id,p.type AS proposal_type,p.risk,p.status AS proposal_status,
  p.version AS proposal_version,p.data,p.created_at AS proposal_created_at FROM review_proposals p
  JOIN missions m ON m.tenant_id=p.tenant_id AND m.id=p.mission_id`;
export const proposalDto = (row: ProposalRow) => {
  const result={
  ...row.data, id: row.proposal_id, missionId: row.id, tenantId: row.tenant_id,
  source: missionDto(row).source, workflow: missionDto(row).workflow, priority: row.priority,
  type: row.proposal_type, risk: row.risk, status: row.proposal_status,
  version: row.proposal_version, createdAt: iso(row.proposal_created_at),
  };
  return result as typeof result & Record<string,unknown>;
};
export async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await action(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function event(client: PoolClient, mission: Pick<MissionRow, 'id'|'tenant_id'|'correlation_id'>, action: string, actor: string, data: Record<string, unknown> = {}): Promise<void> {
  await client.query('INSERT INTO mission_events(id,tenant_id,mission_id,action,actor,correlation_id,data) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(),mission.tenant_id,mission.id,action,actor,mission.correlation_id,data]);
}
export async function enqueue(client: PoolClient, task: Pick<TaskRow,'id'|'tenant_id'|'mission_id'|'run_revision'>): Promise<void> {
  await client.query('INSERT INTO task_outbox(id,task_id,tenant_id,mission_id,run_revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT(task_id,run_revision) DO NOTHING',
    [randomUUID(),task.id,task.tenant_id,task.mission_id,task.run_revision]);
}
export async function transition(client: PoolClient, mission: MissionRow, status: string, actor = 'worker'): Promise<void> {
  assertTransition(mission.status,status);
  if (mission.status === status) return;
  await client.query('UPDATE missions SET status=$3,updated_at=now(),revision=revision+1 WHERE tenant_id=$1 AND id=$2',[mission.tenant_id,mission.id,status]);
  await event(client,mission,'mission.transition',actor,{from:mission.status,to:status});
  mission.status=status;
}
async function snapshotSelection(client:PoolClient,batchId:string,actor:string):Promise<void>{
  await client.query(`INSERT INTO batch_selection_history(batch_id,version,selection,actor)
    SELECT b.id,b.version,coalesce(jsonb_agg(jsonb_build_object('proposalId',m.proposal_id,'proposalVersion',m.proposal_version,'sourceVersion',m.source_version,'excluded',m.excluded) ORDER BY m.proposal_id) FILTER(WHERE m.proposal_id IS NOT NULL),'[]'::jsonb),$2
    FROM proposal_batches b LEFT JOIN batch_members m ON m.batch_id=b.id WHERE b.id=$1 GROUP BY b.id`,[batchId,actor]);
}
export function authorize(scope: AccessContext, roles?: readonly string[], application?: string): void {
  if (!scope.tenantId || !scope.subject || !scope.applications.length || !scope.roles.length) throw new DomainError('forbidden',403);
  if (roles && !scope.roles.some(role => roles.includes(role))) throw new DomainError('forbidden',403);
  if (application && !scope.applications.includes(application)) throw new DomainError('application_forbidden',403);
}

/** Public application service. Every query is constrained by the authenticated tenant AND applications. */
export class PreflightService {
  constructor(public readonly pool: Pool) {}
  async recordAccess(scope: AccessContext, action: string, objectId?: string): Promise<void> {
    await this.pool.query('INSERT INTO access_audit(id,tenant_id,actor,source_applications,action,object_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(),scope.tenantId,scope.subject,scope.applications,action,objectId??null,scope.correlationId]);
  }
  private async locked(client: PoolClient, id: string, scope: AccessContext): Promise<MissionRow> {
    authorize(scope);
    const {rows}=await client.query<MissionRow>('SELECT * FROM missions WHERE tenant_id=$1 AND id=$2 AND source_application=ANY($3::text[]) FOR UPDATE',[scope.tenantId,id,scope.applications]);
    if (!rows[0]) throw new DomainError('mission_not_found',404);
    return rows[0];
  }
  async submit(raw: MissionInput, scope: AccessContext) {
    const input = missionInputSchema.parse(raw);
    authorize(scope,['operator','administrator','service_integration'],input.source.application);
    if (input.tenantId !== scope.tenantId) throw new DomainError('tenant_forbidden',403);
    const workflow=resolveWorkflow(input);
    if (!workflow) throw new DomainError('unsupported_workflow',422);
    if(invalidInput(workflow,input.input).length)throw new DomainError('workflow_input_invalid',422);
    const plan=planWorkflow(workflow); validatePlan(plan);
    const canonical={tenantId:input.tenantId,source:input.source,workflow:input.workflow,priority:input.priority,constraints:input.constraints,input:input.input};
    const digest=hashInput(canonical);
    const result=await transaction(this.pool,async client=>{
      // Lock event ids before source objects: concurrent reuse across objects is a stable 409, not a unique-key race.
      if(input.eventId)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`event:${scope.tenantId}:${input.source.application}:${input.eventId}`]);
      // Serializes versions of the same source object, including out-of-order submissions.
      const sourceKey=hashInput([input.tenantId,input.source.application,input.source.subjectType,input.source.subjectId]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[sourceKey]);
      if(input.eventId){
        const seen=await client.query<{mission_id:string;input_hash:string}>('SELECT mission_id,input_hash FROM inbound_events WHERE tenant_id=$1 AND source_application=$2 AND event_id=$3',[scope.tenantId,input.source.application,input.eventId]);
        if(seen.rows[0]){
          if(seen.rows[0].input_hash!==digest) throw new DomainError('idempotency_conflict');
          return {mission:missionDto(await this.locked(client,seen.rows[0].mission_id,scope)),duplicate:true};
        }
      }
      const existing=await client.query<MissionRow>('SELECT * FROM missions WHERE tenant_id=$1 AND source_application=$2 AND subject_type=$3 AND subject_id=$4 AND source_version=$5 AND workflow_type=$6 AND workflow_version=$7',
        [scope.tenantId,input.source.application,input.source.subjectType,input.source.subjectId,input.source.version,input.workflow.type,input.workflow.version]);
      if(existing.rows[0]){
        if(existing.rows[0].input_hash!==digest) throw new DomainError('source_version_conflict');
        if(input.eventId) await client.query('INSERT INTO inbound_events(tenant_id,source_application,event_id,input_hash,mission_id) VALUES($1,$2,$3,$4,$5)',[scope.tenantId,input.source.application,input.eventId,digest,existing.rows[0].id]);
        return {mission:missionDto(existing.rows[0]),duplicate:true};
      }
      const siblings=await client.query<MissionRow>('SELECT * FROM missions WHERE tenant_id=$1 AND source_application=$2 AND subject_type=$3 AND subject_id=$4 ORDER BY id FOR UPDATE',
        [scope.tenantId,input.source.application,input.source.subjectType,input.source.subjectId]);
      const cursor=await client.query<{version:number}>('SELECT version FROM source_versions WHERE tenant_id=$1 AND source_application=$2 AND subject_type=$3 AND subject_id=$4',[scope.tenantId,input.source.application,input.source.subjectType,input.source.subjectId]);
      const stale=siblings.rows.some(m=>m.source_version>input.source.version)||(cursor.rows[0]?.version??0)>input.source.version;
      await client.query(`INSERT INTO source_versions(tenant_id,source_application,subject_type,subject_id,version) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(tenant_id,source_application,subject_type,subject_id) DO UPDATE SET version=GREATEST(source_versions.version,EXCLUDED.version),updated_at=now()`,[scope.tenantId,input.source.application,input.source.subjectType,input.source.subjectId,input.source.version]);
      const id=input.missionId??randomUUID();
      const created=await client.query<MissionRow>(`INSERT INTO missions(tenant_id,id,source_application,subject_type,subject_id,source_version,workflow_type,workflow_version,priority,status,input,constraints,input_hash,correlation_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'received',$10,$11,$12,$13) ON CONFLICT(tenant_id,id) DO NOTHING RETURNING *`,
        [scope.tenantId,id,input.source.application,input.source.subjectType,input.source.subjectId,input.source.version,input.workflow.type,input.workflow.version,input.priority,input.input,input.constraints,digest,scope.correlationId]);
      const mission=created.rows[0]; if(!mission) throw new DomainError('mission_id_conflict');
      await event(client,mission,'mission.received',scope.subject,{sourceVersion:input.source.version});
      if(input.eventId) await client.query('INSERT INTO inbound_events(tenant_id,source_application,event_id,input_hash,mission_id) VALUES($1,$2,$3,$4,$5)',[scope.tenantId,input.source.application,input.eventId,digest,id]);
      if(stale){ await transition(client,mission,'superseded',scope.subject); }
      else {
        for(const previous of siblings.rows.filter(m=>m.source_version<input.source.version)){
          await transition(client,previous,'superseded',scope.subject);
          await this.invalidate(client,previous);
        }
        await transition(client,mission,'planning',scope.subject);
        for(const definition of plan){
          const task=await client.query<TaskRow>(`INSERT INTO tasks(id,tenant_id,mission_id,key,kind,dependencies,status,max_attempts) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [randomUUID(),scope.tenantId,id,definition.key,definition.kind,definition.dependencies,definition.dependencies.length?'waiting_dependency':'ready',input.constraints.maxAttempts]);
          if(!definition.dependencies.length) await enqueue(client,task.rows[0]!);
        }
        await transition(client,mission,'ready',scope.subject);
      }
      return {mission:missionDto(mission),duplicate:false};
    });
    await this.recordAccess(scope,'mission.submit',result.mission.id); return result;
  }
  private async invalidate(client: PoolClient, mission: MissionRow): Promise<void> {
    await client.query("UPDATE tasks SET status='cancelled',attempt_token=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND mission_id=$2 AND status<>'completed'",[mission.tenant_id,mission.id]);
    await client.query('UPDATE results SET obsolete=true WHERE tenant_id=$1 AND mission_id=$2',[mission.tenant_id,mission.id]);
    await client.query("UPDATE review_proposals SET status='obsolete',version=version+1,updated_at=now() WHERE tenant_id=$1 AND mission_id=$2",[mission.tenant_id,mission.id]);
  }
  async list(scope: AccessContext, filters: ListFilters={}) {
    authorize(scope); if(filters.application) authorize(scope,undefined,filters.application);
    const page=Math.max(1,filters.page??1),pageSize=Math.min(100,Math.max(1,filters.pageSize??20));
    const args=[scope.tenantId,scope.applications,filters.status??null,filters.application??null,filters.q??null];
    const where=`tenant_id=$1 AND source_application=ANY($2::text[]) AND ($3::text IS NULL OR status=$3) AND ($4::text IS NULL OR source_application=$4)
      AND ($5::text IS NULL OR id ILIKE '%'||$5||'%' OR subject_id ILIKE '%'||$5||'%' OR workflow_type ILIKE '%'||$5||'%')`;
    const [items,total]=await Promise.all([
      this.pool.query<MissionRow>(`SELECT * FROM missions WHERE ${where} ORDER BY created_at DESC,id LIMIT $6 OFFSET $7`,[...args,pageSize,(page-1)*pageSize]),
      this.pool.query<{count:string}>(`SELECT count(*) FROM missions WHERE ${where}`,args),
    ]);
    await this.recordAccess(scope,'mission.list');
    return {items:items.rows.map(missionDto),total:Number(total.rows[0]!.count),page,pageSize};
  }
  async detail(id:string,scope:AccessContext){
    authorize(scope);
    const {rows}=await this.pool.query<MissionRow>('SELECT * FROM missions WHERE tenant_id=$1 AND id=$2 AND source_application=ANY($3::text[])',[scope.tenantId,id,scope.applications]);
    const mission=rows[0];if(!mission)return null;
    const [tasks,results,proposals,history]=await Promise.all([
      this.pool.query<TaskRow>('SELECT * FROM tasks WHERE tenant_id=$1 AND mission_id=$2 ORDER BY created_at,key',[scope.tenantId,id]),
      this.pool.query<ResultRow>('SELECT * FROM results WHERE tenant_id=$1 AND mission_id=$2 ORDER BY created_at',[scope.tenantId,id]),
      this.pool.query<ProposalRow>(`${proposalSelect} WHERE p.tenant_id=$1 AND p.mission_id=$2`,[scope.tenantId,id]),
      this.pool.query('SELECT id,action,actor,correlation_id AS "correlationId",data,created_at AS "createdAt" FROM mission_events WHERE tenant_id=$1 AND mission_id=$2 ORDER BY created_at,id',[scope.tenantId,id]),
    ]);
    await this.recordAccess(scope,'mission.detail',id);
    return {mission:missionDto(mission),tasks:tasks.rows.map(taskDto),results:results.rows.map(resultDto),proposals:proposals.rows.map(proposalDto),history:history.rows};
  }
  async cancel(id:string,scope:AccessContext,source?:{sourceVersion:number;eventId:string}){
    authorize(scope,['operator','administrator','service_integration']);
    if(!scope.roles.some(role=>['operator','administrator'].includes(role))&&!source)throw new DomainError('source_version_required',400);
    await transaction(this.pool,async client=>{
      if(source){
        const owner=(await client.query<{source_application:string}>('SELECT source_application FROM missions WHERE tenant_id=$1 AND id=$2 AND source_application=ANY($3::text[])',[scope.tenantId,id,scope.applications])).rows[0];
        if(!owner)throw new DomainError('mission_not_found',404);
        // Match event-before-mission lock ordering used by source updates and reception.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`event:${scope.tenantId}:${owner.source_application}:${source.eventId}`]);
      }
      const mission=await this.locked(client,id,scope);
      if(source){
        if(mission.source_version!==source.sourceVersion)throw new DomainError('stale_source_version');
        const digest=hashInput({type:'mission.cancelled',missionId:id,sourceVersion:source.sourceVersion});
        const seen=await client.query<{input_hash:string}>('SELECT input_hash FROM source_notifications WHERE tenant_id=$1 AND source_application=$2 AND event_id=$3',[scope.tenantId,mission.source_application,source.eventId]);
        if(seen.rows[0]){if(seen.rows[0].input_hash!==digest)throw new DomainError('idempotency_conflict');return;}
        await client.query('INSERT INTO source_notifications(tenant_id,source_application,event_id,input_hash) VALUES($1,$2,$3,$4)',[scope.tenantId,mission.source_application,source.eventId,digest]);
        await event(client,mission,'source.cancellation_reported',scope.subject,{eventId:source.eventId,sourceVersion:source.sourceVersion});
      }
      if(mission.status==='cancelled')return;
      if(['completed','superseded'].includes(mission.status))throw new DomainError('mission_not_cancellable');
      await transition(client,mission,'cancelled',scope.subject);await this.invalidate(client,mission);
    });
    await this.recordAccess(scope,'mission.cancel',id);return this.detail(id,scope);
  }
  async retry(id:string,scope:AccessContext){
    authorize(scope,['operator','administrator']);
    await transaction(this.pool,async client=>{
      const mission=await this.locked(client,id,scope);
      if(mission.status!=='failed')throw new DomainError('mission_not_retryable');
      const tasks=await client.query<TaskRow>(`UPDATE tasks SET status='ready',attempts=0,error_code=NULL,attempt_token=NULL,lease_until=NULL,run_revision=run_revision+1,updated_at=now()
        WHERE tenant_id=$1 AND mission_id=$2 AND status IN ('failed','ready','running') RETURNING *`,[scope.tenantId,id]);
      for(const task of tasks.rows)await enqueue(client,task);
      await client.query('UPDATE missions SET error_code=NULL WHERE tenant_id=$1 AND id=$2',[scope.tenantId,id]);
      await transition(client,mission,'ready',scope.subject);
    });
    await this.recordAccess(scope,'mission.retry',id);return this.detail(id,scope);
  }
  async provideInput(id:string,input:Record<string,unknown>,scope:AccessContext){
    authorize(scope,['operator','administrator','service_integration']);
    await transaction(this.pool,async client=>{
      const mission=await this.locked(client,id,scope);
      if(mission.status!=='waiting_input')throw new DomainError('mission_not_waiting_input');
      const definition=resolveWorkflow({source:{application:mission.source_application,subjectType:mission.subject_type,subjectId:mission.subject_id,version:mission.source_version},workflow:{type:mission.workflow_type,version:'1.0'}});
      if(!definition||invalidInput(definition,{...mission.input,...input}).length)throw new DomainError('workflow_input_invalid',422);
      await client.query('UPDATE missions SET input=input || $3::jsonb,error_code=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2',[scope.tenantId,id,JSON.stringify(input)]);
      const tasks=await client.query<TaskRow>(`UPDATE tasks SET status='ready',attempts=0,error_code=NULL,run_revision=run_revision+1,updated_at=now() WHERE tenant_id=$1 AND mission_id=$2 AND status='waiting_input' RETURNING *`,[scope.tenantId,id]);
      for(const task of tasks.rows)await enqueue(client,task);
      await event(client,mission,'mission.input_provided',scope.subject,{fields:Object.keys(input)});
      await transition(client,mission,'ready',scope.subject);
    });
    await this.recordAccess(scope,'mission.input',id);return this.detail(id,scope);
  }
  async sourceUpdate(input:{eventId:string;tenantId:string;source:MissionInput['source']},scope:AccessContext){
    authorize(scope,['service_integration','operator','administrator'],input.source.application);
    if(input.tenantId!==scope.tenantId)throw new DomainError('tenant_forbidden',403);
    const digest=hashInput(input.source);
    const result=await transaction(this.pool,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`event:${scope.tenantId}:${input.source.application}:${input.eventId}`]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[hashInput([input.tenantId,input.source.application,input.source.subjectType,input.source.subjectId])]);
      const seen=await client.query<{input_hash:string}>('SELECT input_hash FROM source_notifications WHERE tenant_id=$1 AND source_application=$2 AND event_id=$3',[scope.tenantId,input.source.application,input.eventId]);
      if(seen.rows[0]){if(seen.rows[0].input_hash!==digest)throw new DomainError('idempotency_conflict');return {duplicate:true,invalidated:0};}
      await client.query('INSERT INTO source_notifications(tenant_id,source_application,event_id,input_hash) VALUES($1,$2,$3,$4)',[scope.tenantId,input.source.application,input.eventId,digest]);
      await client.query(`INSERT INTO source_versions(tenant_id,source_application,subject_type,subject_id,version) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(tenant_id,source_application,subject_type,subject_id) DO UPDATE SET version=GREATEST(source_versions.version,EXCLUDED.version),updated_at=now()`,[scope.tenantId,input.source.application,input.source.subjectType,input.source.subjectId,input.source.version]);
      const prior=await client.query<MissionRow>('SELECT * FROM missions WHERE tenant_id=$1 AND source_application=$2 AND subject_type=$3 AND subject_id=$4 AND source_version<$5 ORDER BY id FOR UPDATE',[scope.tenantId,input.source.application,input.source.subjectType,input.source.subjectId,input.source.version]);
      for(const mission of prior.rows){if(mission.status!=='superseded')await transition(client,mission,'superseded',scope.subject);await this.invalidate(client,mission);}
      return {duplicate:false,invalidated:prior.rowCount??0};
    });
    await this.recordAccess(scope,'source.updated',input.source.subjectId);return result;
  }
  async recordDecision(id:string,input:{sourceVersion:number;decision:string;eventId:string},scope:AccessContext){
    authorize(scope,['service_integration']);
    await transaction(this.pool,async client=>{
      const mission=await this.locked(client,id,scope);
      if(mission.source_version!==input.sourceVersion)throw new DomainError('stale_source_version');
      const duplicate=await client.query<{data:Record<string,unknown>}>('SELECT data FROM mission_events WHERE tenant_id=$1 AND mission_id=$2 AND action=$3 AND data->>\'eventId\'=$4',[scope.tenantId,id,'source.decision_reported',input.eventId]);
      if(duplicate.rows[0]){
        if(duplicate.rows[0].data['sourceVersion']!==input.sourceVersion||duplicate.rows[0].data['decision']!==input.decision)throw new DomainError('idempotency_conflict');
        return;
      }
      if(mission.status!=='review_ready')throw new DomainError('mission_not_review_ready');
      await event(client,mission,'source.decision_reported',scope.subject,{...input,authority:'source_application'});
      await transition(client,mission,'completed',scope.subject);
    });
    await this.recordAccess(scope,'source.decision_reported',id);return this.detail(id,scope);
  }
  async proposals(scope:AccessContext,filters:ListFilters={}){
    authorize(scope);if(filters.application)authorize(scope,undefined,filters.application);
    const page=Math.max(1,filters.page??1),pageSize=Math.min(100,Math.max(1,filters.pageSize??20));
    const args=[scope.tenantId,scope.applications,filters.application??null,filters.status??null,filters.q??null];
    const where=`p.tenant_id=$1 AND m.source_application=ANY($2::text[]) AND ($3::text IS NULL OR m.source_application=$3) AND ($4::text IS NULL OR p.status=$4)
      AND ($5::text IS NULL OR m.id ILIKE '%'||$5||'%' OR m.subject_id ILIKE '%'||$5||'%' OR m.workflow_type ILIKE '%'||$5||'%')`;
    const rows=await this.pool.query<ProposalRow>(`${proposalSelect} WHERE ${where} ORDER BY p.created_at DESC,p.id LIMIT $6 OFFSET $7`,[...args,pageSize,(page-1)*pageSize]);
    const total=await this.pool.query<{count:string}>(`SELECT count(*) FROM review_proposals p JOIN missions m ON m.tenant_id=p.tenant_id AND m.id=p.mission_id WHERE ${where}`,args);
    await this.recordAccess(scope,'proposal.list');return {items:rows.rows.map(proposalDto),total:Number(total.rows[0]!.count),page,pageSize};
  }
  async buildBatch(input:{proposalIds:string[];name?:string},scope:AccessContext){
    authorize(scope,['operator','administrator']);
    const ids=[...new Set(input.proposalIds)];if(!ids.length||ids.length>500)throw new DomainError('invalid_batch_size',422);
    const id=await transaction(this.pool,async client=>{
      await client.query(`SELECT m.id FROM missions m JOIN review_proposals p ON p.tenant_id=m.tenant_id AND p.mission_id=m.id WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[]) AND m.source_application=ANY($3::text[]) ORDER BY m.id FOR UPDATE OF m`,[scope.tenantId,ids,scope.applications]);
      const selected=await client.query<ProposalRow>(`${proposalSelect} WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[]) AND m.source_application=ANY($3::text[]) ORDER BY p.id FOR UPDATE OF p`,[scope.tenantId,ids,scope.applications]);
      if(selected.rows.length!==ids.length)throw new DomainError('proposal_not_found',404);
      if(selected.rows.some(p=>p.proposal_status!=='prepared'||p.status!=='review_ready'))throw new DomainError('obsolete_proposal');
      const criteria=(p:ProposalRow)=>({application:p.source_application,workflow:p.workflow_type,workflowVersion:p.workflow_version,policy:'preparation-only-v1',checks:'output-check-v1',type:p.proposal_type,priority:p.priority,risk:p.risk});
      const first=selected.rows[0]!;const group=criteria(first);
      if(selected.rows.some(p=>hashInput(criteria(p))!==hashInput(group)))throw new DomainError('heterogeneous_batch');
      const batchId=randomUUID();
      await client.query('INSERT INTO proposal_batches(id,tenant_id,source_application,name,criteria,created_by) VALUES($1,$2,$3,$4,$5,$6)',[batchId,scope.tenantId,first.source_application,input.name??'Lot de propositions',group,scope.subject]);
      for(const proposal of selected.rows)await client.query('INSERT INTO batch_members(batch_id,proposal_id,proposal_version,source_version) VALUES($1,$2,$3,$4)',[batchId,proposal.proposal_id,proposal.proposal_version,proposal.source_version]);
      await snapshotSelection(client,batchId,scope.subject);
      return batchId;
    });
    await this.recordAccess(scope,'batch.create',id);return this.batchDetail(id,scope);
  }
  async batches(scope:AccessContext){
    authorize(scope);
    const {rows}=await this.pool.query('SELECT id,name,version,criteria,created_at AS "createdAt",updated_at AS "updatedAt" FROM proposal_batches WHERE tenant_id=$1 AND source_application=ANY($2::text[]) ORDER BY created_at DESC LIMIT 100',[scope.tenantId,scope.applications]);
    await this.recordAccess(scope,'batch.list');return {items:rows,total:rows.length};
  }
  async batchDetail(id:string,scope:AccessContext){
    authorize(scope);
    const {rows}=await this.pool.query<BatchRow>('SELECT id,name,version,criteria,created_at AS "createdAt",updated_at AS "updatedAt" FROM proposal_batches WHERE id=$1 AND tenant_id=$2 AND source_application=ANY($3::text[])',[id,scope.tenantId,scope.applications]);
    if(!rows[0])throw new DomainError('batch_not_found',404);
    const members=await this.pool.query<BatchMember>(`SELECT b.proposal_id AS "proposalId",b.proposal_version AS "proposalVersion",b.source_version AS "sourceVersion",b.excluded,
      p.status AS "proposalStatus",p.version AS "currentProposalVersion",m.id AS "missionId",m.source_version AS "currentSourceVersion",m.status AS "missionStatus",
      (p.status<>'prepared' OR m.status<>'review_ready' OR p.version<>b.proposal_version OR m.source_version<>b.source_version) AS blocked
      FROM batch_members b JOIN review_proposals p ON p.id=b.proposal_id JOIN missions m ON m.tenant_id=p.tenant_id AND m.id=p.mission_id
      WHERE b.batch_id=$1 AND p.tenant_id=$2 AND m.source_application=ANY($3::text[]) ORDER BY b.proposal_id`,[id,scope.tenantId,scope.applications]);
    const history=await this.pool.query('SELECT version,selection,actor,created_at AS "createdAt" FROM batch_selection_history WHERE batch_id=$1 ORDER BY version',[id]);
    await this.recordAccess(scope,'batch.detail',id);return {...rows[0],items:members.rows,selectionHistory:history.rows};
  }
  async excludeBatch(id:string,proposalId:string,version:number,scope:AccessContext){
    authorize(scope,['operator','administrator']);
    await transaction(this.pool,async client=>{
      const batch=await client.query('SELECT * FROM proposal_batches WHERE id=$1 AND tenant_id=$2 AND source_application=ANY($3::text[]) FOR UPDATE',[id,scope.tenantId,scope.applications]);
      if(!batch.rows[0])throw new DomainError('batch_not_found',404);
      if(batch.rows[0].version!==version)throw new DomainError('batch_version_conflict');
      const member=await client.query('UPDATE batch_members SET excluded=true WHERE batch_id=$1 AND proposal_id=$2 RETURNING proposal_id',[id,proposalId]);
      if(!member.rowCount)throw new DomainError('batch_member_not_found',404);
      await client.query('UPDATE proposal_batches SET version=version+1,updated_at=now() WHERE id=$1',[id]);
      await snapshotSelection(client,id,scope.subject);
    });
    await this.recordAccess(scope,'batch.exclude',id);return this.batchDetail(id,scope);
  }
  async exportBatch(id:string,version:number,scope:AccessContext){
    authorize(scope,['operator','administrator','service_integration']);
    const exported=await transaction(this.pool,async client=>{
      const batch=(await client.query<BatchRow>('SELECT * FROM proposal_batches WHERE id=$1 AND tenant_id=$2 AND source_application=ANY($3::text[]) FOR UPDATE',[id,scope.tenantId,scope.applications])).rows[0];
      if(!batch)throw new DomainError('batch_not_found',404);
      if(batch.version!==version)throw new DomainError('batch_version_conflict');
      // Lock missions before proposals, like worker settlement and source invalidation; exclusion locks the batch first.
      await client.query(`SELECT m.id FROM missions m JOIN review_proposals p ON p.tenant_id=m.tenant_id AND p.mission_id=m.id JOIN batch_members b ON b.proposal_id=p.id
        WHERE b.batch_id=$1 AND b.excluded=false AND m.tenant_id=$2 AND m.source_application=ANY($3::text[]) ORDER BY m.id FOR UPDATE OF m`,[id,scope.tenantId,scope.applications]);
      const selected=await client.query<ProposalRow&{snapshot_proposal_version:number;snapshot_source_version:number}>(`${proposalSelect} JOIN batch_members b ON b.proposal_id=p.id
        WHERE b.batch_id=$1 AND b.excluded=false AND p.tenant_id=$2 AND m.source_application=ANY($3::text[]) ORDER BY p.id FOR UPDATE OF p`,[id,scope.tenantId,scope.applications]);
      const snapshots=await client.query<{proposal_id:string;proposal_version:number;source_version:number}>('SELECT proposal_id,proposal_version,source_version FROM batch_members WHERE batch_id=$1 AND excluded=false',[id]);
      if(selected.rows.length!==snapshots.rows.length||selected.rows.some(p=>{
        const snap=snapshots.rows.find(s=>s.proposal_id===p.proposal_id);
        return !snap||p.proposal_status!=='prepared'||p.status!=='review_ready'||p.proposal_version!==snap.proposal_version||p.source_version!==snap.source_version;
      }))throw new DomainError('batch_contains_obsolete_proposal');
      return {schemaVersion:'1.0',batchId:id,selectionVersion:version,criteria:batch.criteria,proposals:selected.rows.map(proposalDto),authority:'source_application',businessDecisionExecuted:false};
    });
    await this.recordAccess(scope,'batch.export',id);
    return exported;
  }
  async checkpoint(scope:AccessContext){
    authorize(scope);
    const {rows}=await this.pool.query('INSERT INTO briefing_checkpoints(tenant_id,subject,last_viewed_at) VALUES($1,$2,now()) ON CONFLICT(tenant_id,subject) DO UPDATE SET last_viewed_at=EXCLUDED.last_viewed_at RETURNING last_viewed_at AS "lastViewedAt"',[scope.tenantId,scope.subject]);
    await this.recordAccess(scope,'briefing.checkpoint');return rows[0];
  }
  async briefing(scope:AccessContext,filters:{since?:string;application?:string;status?:string}={}){
    authorize(scope);if(filters.application)authorize(scope,undefined,filters.application);
    const checkpoint=await this.pool.query('SELECT last_viewed_at FROM briefing_checkpoints WHERE tenant_id=$1 AND subject=$2',[scope.tenantId,scope.subject]);
    const since=filters.since??iso(checkpoint.rows[0]?.last_viewed_at??null)??'1970-01-01T00:00:00.000Z';
    const args=[scope.tenantId,scope.applications,filters.application??null,filters.status??null];
    const where='m.tenant_id=$1 AND m.source_application=ANY($2::text[]) AND ($3::text IS NULL OR m.source_application=$3) AND ($4::text IS NULL OR m.status=$4)';
    const grouped=await this.pool.query<{status:string;count:string}>(`SELECT m.status,count(*) FROM missions m WHERE ${where} GROUP BY m.status`,args);
    const counts:Record<string,number>={total:0,received:0,planning:0,ready:0,running:0,waiting_input:0,waiting_dependency:0,review_ready:0,completed:0,failed:0,cancelled:0,superseded:0,proposalsReady:0,errors:0};
    for(const row of grouped.rows){counts[row.status]=Number(row.count);counts.total!+=Number(row.count);}
    counts.proposalsReady=counts.review_ready!;counts.errors=counts.failed!;
    const [missions,proposalRows,activity,blockedRows,period,taskMetrics,costMetrics]=await Promise.all([
      this.pool.query<MissionRow>(`SELECT m.* FROM missions m WHERE ${where} ORDER BY CASE m.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,m.updated_at DESC LIMIT 30`,args),
      this.pool.query<ProposalRow>(`${proposalSelect} WHERE p.tenant_id=$1 AND m.source_application=ANY($2::text[]) AND ($3::text IS NULL OR m.source_application=$3) AND ($4::text IS NULL OR m.status=$4) AND p.status='prepared' ORDER BY p.created_at DESC LIMIT 30`,args),
      this.pool.query(`SELECT e.id,e.mission_id AS "missionId",e.action,e.actor,e.data,e.created_at AS "createdAt",m.source_application AS application FROM mission_events e JOIN missions m ON m.tenant_id=e.tenant_id AND m.id=e.mission_id WHERE ${where} AND e.created_at>$5::timestamptz ORDER BY e.created_at DESC LIMIT 50`,[...args,since]),
      this.pool.query<MissionRow>(`SELECT m.* FROM missions m WHERE ${where} AND m.status IN ('waiting_input','waiting_dependency','failed') ORDER BY m.updated_at DESC LIMIT 30`,args),
      this.pool.query<{received:string;prepared:string}>(`SELECT count(*) FILTER(WHERE m.created_at>$5::timestamptz) AS received,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM mission_events e WHERE e.tenant_id=m.tenant_id AND e.mission_id=m.id AND e.action='mission.transition' AND e.data->>'to'='review_ready' AND e.created_at>$5::timestamptz)) AS prepared
        FROM missions m WHERE ${where}`,[...args,since]),
      this.pool.query(`SELECT count(*) FILTER(WHERE t.status='failed')::int AS "failedTasks",count(*) FILTER(WHERE t.status IN ('ready','running','waiting_dependency','waiting_input'))::int AS "pendingTasks",
        coalesce(sum(t.attempts),0)::int AS attempts,avg(extract(epoch from(t.finished_at-t.started_at))*1000) FILTER(WHERE t.status='completed')::float8 AS "averageTaskDurationMs"
        FROM tasks t JOIN missions m ON m.tenant_id=t.tenant_id AND m.id=t.mission_id WHERE ${where}`,args),
      this.pool.query(`SELECT coalesce(sum(m.reserved_cost_usd),0)::float8 AS "reservedCostUsd",coalesce((SELECT sum((r.provenance->>'estimatedCostUsd')::numeric) FROM results r JOIN missions m ON m.tenant_id=r.tenant_id AND m.id=r.mission_id WHERE ${where} AND r.kind='draft'),0)::float8 AS "estimatedCostUsd" FROM missions m WHERE ${where}`,args),
    ]);
    await this.recordAccess(scope,'briefing.read');
    const items=missions.rows.map(missionDto);
    return {generatedAt:new Date().toISOString(),since,counts,countsSince:{received:Number(period.rows[0]?.received??0),prepared:Number(period.rows[0]?.prepared??0)},
      metrics:{...taskMetrics.rows[0],...costMetrics.rows[0],costsAreEstimates:true},missions:items,proposals:proposalRows.rows.map(proposalDto),blocked:blockedRows.rows.map(missionDto),recentActivity:activity.rows,checkpoint:iso(checkpoint.rows[0]?.last_viewed_at??null)};
  }
  async integrations(scope:AccessContext){authorize(scope);return {items:workflows.filter(w=>scope.applications.includes(w.sourceApplication)).map(w=>({application:w.sourceApplication,connected:false,mode:'simulated',workflow:w.type,version:w.version,capabilities:[w.capability]}))};}
  async config(scope:AccessContext){authorize(scope);return {schemaVersion:'1.0',workflows:workflows.filter(w=>scope.applications.includes(w.sourceApplication)),policy:'preparation-only-v1',businessDecisionAuthority:'source_application',maxBatchSize:500};}
  async audit(scope:AccessContext){authorize(scope,['administrator']);const {rows}=await this.pool.query('SELECT id,actor,action,object_id AS "objectId",correlation_id AS "correlationId",created_at AS "createdAt" FROM access_audit WHERE tenant_id=$1 AND source_applications <@ $2::text[] ORDER BY created_at DESC LIMIT 100',[scope.tenantId,scope.applications]);return {items:rows};}
}
