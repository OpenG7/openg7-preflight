import type { AccessContext, MissionInput } from '../../contracts/src/index.js';
import type { AiProvider } from '../../ai/src/index.js';

/** Public extension points. No presumed API path or invented ecosystem contract. */
export interface SourceApplicationAdapter {
  readonly application: string;
  readonly connected: boolean;
  toMission(event: unknown, context: AccessContext): Promise<MissionInput>;
  deliverProposal(proposal: unknown, idempotencyKey: string, context: AccessContext): Promise<{ receiptId: string }>;
}
export interface ModelGatewayAdapter extends AiProvider { readonly gatewayContractVersion: string }
export interface AgentRuntimeAdapter {
  readonly connected: boolean;
  prepare(request: { missionId: string; tenantId: string; capability: string; input: unknown; idempotencyKey: string }): Promise<{ taskId: string }>;
}
export const ecosystemConnections = [
  { application: 'funding-platform', connected: false, mode: 'simulator', capabilities: ['sponsorship-preparation-v1'] },
  { application: 'openg7-social', connected: false, mode: 'simulator', capabilities: ['editorial-brief-preparation-v1'] },
  { application: 'openg7-agent-runtime', connected: false, mode: 'extension-port', capabilities: [] },
  { application: 'openg7-model-gateway', connected: false, mode: 'extension-port', capabilities: [] },
  { application: 'openg7-knowledge-core', connected: false, mode: 'not-connected', capabilities: [] },
  { application: 'openg7-ai-policy-engine', connected: false, mode: 'not-connected', capabilities: [] },
  { application: 'openg7-ai-evals', connected: false, mode: 'not-connected', capabilities: [] },
  { application: 'openg7-identity', connected: false, mode: 'jwt-contract-only', capabilities: [] },
] as const;
