import { z } from 'zod';
export { editorialContextSchema, editorialPreparationSchema, type EditorialContext, type EditorialPreparation } from './editorial.js';

export const schemaVersion = '1.0' as const;
const identifier = z.string().trim().min(1).max(128);
export const roles = ['viewer', 'operator', 'administrator', 'service_integration'] as const;
export type Role = typeof roles[number];
export interface AccessContext {
  tenantId: string;
  subject: string;
  roles: Role[];
  applications: string[];
  correlationId: string;
}
export type Scope = AccessContext;

export const missionStates = ['received', 'planning', 'ready', 'running', 'waiting_input', 'waiting_dependency', 'review_ready', 'completed', 'failed', 'cancelled', 'superseded'] as const;
export type MissionState = typeof missionStates[number];
export const taskStates = ['pending', 'ready', 'running', 'waiting_input', 'waiting_dependency', 'completed', 'failed', 'cancelled', 'superseded', 'quarantined'] as const;
export type TaskState = typeof taskStates[number];
export const missionInputSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  missionId: identifier.optional(),
  eventId: identifier.optional(),
  tenantId: identifier,
  source: z.object({
    application: identifier,
    subjectType: identifier,
    subjectId: identifier,
    version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  }).strict(),
  workflow: z.object({ type: identifier, version: z.literal('1.0') }).strict(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  constraints: z.object({
    humanApprovalRequired: z.literal(true).default(true),
    maxCostUsd: z.number().finite().min(0).max(100).default(0.5),
    timeoutMs: z.number().int().min(100).max(120000).default(30000),
    maxAttempts: z.number().int().min(1).max(5).default(3),
  }).strict(),
  input: z.record(z.string(), z.unknown()).default({}),
}).strict();
export const MissionInputSchema = missionInputSchema;
export type MissionInput = z.infer<typeof missionInputSchema>;

export const sourceEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mission.submitted'), eventId: identifier, schemaVersion: z.literal(schemaVersion), mission: missionInputSchema }).strict(),
  z.object({ type: z.literal('source.updated'), eventId: identifier, schemaVersion: z.literal(schemaVersion), tenantId: identifier,
    source: z.object({ application: identifier, subjectType: identifier, subjectId: identifier, version: z.number().int().positive() }).strict(),
  }).strict(),
]);
export type SourceEvent = z.infer<typeof sourceEventSchema>;

export const preparationOutputSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(4000),
  body: z.string().min(1).max(20000),
  warnings: z.array(z.string().max(1000)).max(50),
}).strict();
export type PreparationOutput = z.infer<typeof preparationOutputSchema>;

export interface Provenance {
  provider: string;
  model: string;
  simulated: boolean;
  generatedAt: string;
  inputVersion?: number;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  limitations?: string[];
}
