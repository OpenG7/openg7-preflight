import { editorialContextSchema, type MissionInput } from '../../contracts/src/index.js';

export interface TaskDefinition { key: string; kind: string; dependencies: string[] }
export interface WorkflowDefinition {
  type: string;
  version: string;
  sourceApplication: string;
  requiredInput: string[];
  requiredInputFor?: (input: Record<string, unknown>) => string[];
  inputTypes?: Record<string,'string'|'string[]'>;
  validateInput?: (input: Record<string, unknown>) => string[];
  capability: 'web-presentation' | 'editorial-brief';
  policy: string;
}

/** Workflows supply source contracts and capabilities; the scheduler has no business rules. */
export const workflows: WorkflowDefinition[] = [
  { type: 'sponsorship-preparation-v1', version: '1.0', sourceApplication: 'funding-platform', requiredInput: ['title', 'description', 'benefits'], inputTypes:{title:'string',description:'string',benefits:'string[]'}, capability: 'web-presentation', policy: 'preparation-only-v1',
    requiredInputFor: input => input['editorialContext'] === undefined ? ['title', 'description', 'benefits'] : ['editorialContext'],
    validateInput: input => input['editorialContext'] === undefined || editorialContextSchema.safeParse(input['editorialContext']).success ? [] : ['editorialContext'] },
  { type: 'editorial-brief-preparation-v1', version: '1.0', sourceApplication: 'openg7-social', requiredInput: ['topic'], inputTypes:{topic:'string',audience:'string'}, capability: 'editorial-brief', policy: 'preparation-only-v1' },
];

export function registerWorkflow(definition: WorkflowDefinition): void {
  if(workflows.some(w=>w.type===definition.type&&w.version===definition.version&&w.sourceApplication===definition.sourceApplication)) throw new Error('workflow_already_registered');
  workflows.push({...definition,requiredInput:[...definition.requiredInput]});
}

export function resolveWorkflow(input: Pick<MissionInput, 'workflow' | 'source'>): WorkflowDefinition | undefined {
  return workflows.find(w => w.type === input.workflow.type && w.version === input.workflow.version && w.sourceApplication === input.source.application);
}

export function planWorkflow(_definition: WorkflowDefinition): TaskDefinition[] {
  return [
    { key: 'inspect', kind: 'completeness', dependencies: [] },
    { key: 'policy', kind: 'preparation-policy', dependencies: [] },
    { key: 'draft', kind: 'draft', dependencies: ['inspect', 'policy'] },
    { key: 'verify', kind: 'output-check', dependencies: ['draft'] },
    { key: 'proposal', kind: 'review-proposal', dependencies: ['verify'] },
  ];
}

export function missingInput(definition: WorkflowDefinition, input: Record<string, unknown>): string[] {
  return (definition.requiredInputFor?.(input) ?? definition.requiredInput).filter(key => {
    const value = input[key];
    return value == null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0);
  });
}

export function invalidInput(definition:WorkflowDefinition,input:Record<string,unknown>):string[]{
  return Object.entries(definition.inputTypes??{}).filter(([key,kind])=>{
    const value=input[key];if(value==null)return false;
    return kind==='string'?typeof value!=='string':!Array.isArray(value)||value.some(item=>typeof item!=='string');
  }).map(([key])=>key).concat(definition.validateInput?.(input) ?? []);
}

export function validatePlan(tasks: readonly TaskDefinition[]): void {
  const byKey = new Map(tasks.map(task => [task.key, task]));
  if (byKey.size !== tasks.length) throw new Error('duplicate_task_key');
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) throw new Error('cyclic_dependencies');
    if (done.has(key)) return;
    const task = byKey.get(key);
    if (!task) throw new Error('missing_dependency');
    visiting.add(key);
    task.dependencies.forEach(visit);
    visiting.delete(key);
    done.add(key);
  };
  tasks.forEach(task => visit(task.key));
}

export const allowedTransitions: Readonly<Record<string, readonly string[]>> = {
  received: ['planning', 'cancelled', 'superseded'], planning: ['ready', 'failed', 'cancelled', 'superseded'],
  ready: ['running', 'waiting_input', 'failed', 'cancelled', 'superseded'],
  running: ['ready', 'waiting_input', 'waiting_dependency', 'review_ready', 'failed', 'cancelled', 'superseded'],
  waiting_input: ['ready', 'cancelled', 'superseded'], waiting_dependency: ['ready', 'running', 'failed', 'cancelled', 'superseded'],
  review_ready: ['completed', 'cancelled', 'superseded'], completed: ['superseded'],
  failed: ['ready', 'cancelled', 'superseded'], cancelled: ['superseded'], superseded: [],
};

export function assertTransition(from: string, to: string): void {
  if (from !== to && !allowedTransitions[from]?.includes(to)) throw new Error(`invalid_transition:${from}:${to}`);
}
