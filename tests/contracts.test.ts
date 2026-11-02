import assert from 'node:assert/strict';
import { test } from 'node:test';
import { missionInputSchema, preparationOutputSchema, sourceEventSchema } from '../packages/contracts/src/index.js';
const mission = {
  schemaVersion: '1.0', tenantId: 'tenant-a',
  source: { application: 'openg7-social', subjectType: 'editorial-topic', subjectId: 'subject-1', version: 1 },
  workflow: { type: 'editorial-brief-preparation-v1', version: '1.0' },
  constraints: {}, input: { topic: 'Un sujet synthétique' },
};
test('mission v1 applies bounded defaults and never permits autonomous business approval', () => {
  const result = missionInputSchema.parse(mission);
  assert.equal(result.constraints.humanApprovalRequired, true);
  assert.equal(result.constraints.maxAttempts, 3);
  assert.equal(missionInputSchema.safeParse({ ...mission, constraints: { humanApprovalRequired: false } }).success, false);
});
test('unknown versions, extra envelope fields and invalid source versions are rejected', () => {
  for (const value of [{ ...mission, schemaVersion: '2.0' }, { ...mission, approved: true }, { ...mission, source: { ...mission.source, version: 0 } }]) {
    assert.equal(missionInputSchema.safeParse(value).success, false);
  }
});
test('cost and attempt limits are validated before admission', () => {
  for (const constraints of [{ maxCostUsd: -1 }, { maxCostUsd: Infinity }, { maxAttempts: 100 }, { timeoutMs: 0 }]) {
    assert.equal(missionInputSchema.safeParse({ ...mission, constraints }).success, false);
  }
});
test('structured model output and versioned event envelopes reject invented authority', () => {
  assert.equal(preparationOutputSchema.safeParse({ title: 'Titre', summary: 'Résumé', body: 'Brouillon', warnings: [], approved: true }).success, false);
  assert.equal(sourceEventSchema.safeParse({ schemaVersion: '1.0', eventId: 'evt', type: 'mission.submitted', mission }).success, true);
  assert.equal(sourceEventSchema.safeParse({ schemaVersion: '1.0', eventId: 'evt', type: 'business.approved', mission }).success, false);
});
