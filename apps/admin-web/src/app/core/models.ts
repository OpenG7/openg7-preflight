export type Data = Record<string, unknown>;
export interface Session {
  subject: string;
  tenantId: string;
  roles: string[];
  applications: string[];
  authMode: string;
}
export interface Source { application: string; subjectId: string; subjectType: string; version: number; }
export interface Mission {
  id: string;
  missionId?: string;
  source: Source;
  tenantId: string;
  workflow: {type: string; version: string};
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  title?: string;
}
export interface Task {
  id: string;
  key?: string;
  type?: string;
  status: string;
  attempts: number;
  error?: unknown;
  errorCode?: string;
  kind?: string;
  maxAttempts?: number;
  dependencies?: string[];
}
export interface Result {
  id: string;
  taskId: string;
  type?: string;
  kind?: string;
  content?: unknown;
  output?: unknown;
  provenance?: Data;
  createdAt?: string;
  obsolete?: boolean;
}
export interface Proposal {
  id: string;
  missionId: string;
  source?: Source;
  type?: string;
  recommendation?: string;
  status?: string;
  priority?: string;
  explanation?: string;
  anomalies?: unknown[];
  conditions?: unknown[];
  createdAt?: string;
  [key: string]: unknown;
}
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number; }
export interface Detail { mission: Mission; tasks: Task[]; results: Result[]; proposals: Proposal[]; history: Data[]; }
export interface Briefing {
  counts: Record<string, number>;
  countsSince?: {received: number; prepared: number; proposalsReady: number};
  since?: string;
  lastViewedAt?: string;
  missions?: Mission[];
  proposals?: Proposal[];
  blocked?: Mission[];
  recentActivity?: Data[];
  priorities?: Mission[];
  [key: string]: unknown;
}
export interface Batch {
  id: string;
  version: number;
  criteria?: Data;
  proposals?: Proposal[];
  proposalIds?: string[];
  items?: Data[];
  createdAt?: string;
  [key: string]: unknown;
}
export const statusLabels: Record<string, string> = {
  received: 'Reçue', planning: 'Planification', ready: 'Prête à traiter', running: 'En cours',
  waiting_input: 'Information manquante', waiting_dependency: 'Dépendance attendue',
  review_ready: 'Prête pour examen', completed: 'Terminée', failed: 'Échec',
  cancelled: 'Annulée', superseded: 'Remplacée', queued: 'En attente', pending: 'En attente',
  succeeded: 'Terminée', quarantined: 'En quarantaine', invalidated: 'Obsolète',
};
export function label(status: string): string { return statusLabels[status] ?? status; }
export function json(value: unknown): string { return JSON.stringify(value, null, 2) ?? ''; }
