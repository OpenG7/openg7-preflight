import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editorialContextSchema, editorialPreparationSchema, missionInputSchema, preparationOutputSchema, sourceEventSchema } from '../packages/contracts/src/index.js';
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

const context = {
  schemaVersion: '1.0', sourceCommitmentId: 'commitment-synthetic', sourceSnapshotDigest: 'a'.repeat(64), commitmentVersion: 2,
  publicIdentity: { consent: false }, sourceFacts: [], missingInformation: ['organization_name', 'contact_email'],
  destinations: [
    { destination: 'website', obligationId: 'web-synthetic', obligationVersion: 3, format: 'individual' },
    { destination: 'facebook', obligationId: 'social-synthetic', obligationVersion: 4, format: 'collective' },
  ], mediaReferences: [],
};

test('optional editorial snapshot permits missing identity and preserves independent obligation versions', () => {
  const value = editorialContextSchema.parse(context);
  assert.equal(value.publicIdentity.consent, false);
  assert.deepEqual(value.destinations.map(destination => destination.obligationVersion), [3, 4]);
  assert.equal(missionInputSchema.safeParse({ ...mission, input: { editorialContext: context } }).success, true);
});

test('editorial snapshot rejects unconsented names, private fields, duplicate obligations and unknown destinations', () => {
  for (const value of [
    { ...context, publicIdentity: { consent: false, displayName: 'Nom privé synthétique' } },
    { ...context, privateEmail: 'synthetic@example.invalid' },
    { ...context, destinations: [context.destinations[0], context.destinations[0]] },
    { ...context, destinations: [{ ...context.destinations[0], destination: 'linkedin' }] },
    { ...context, destinations: [{ ...context.destinations[0], format: 'collective' }] },
    { ...context, commitmentVersion: 0 },
    { ...context, mediaReferences: [{ id: 'media-synthetic', publicUseAllowed: false }] },
  ]) assert.equal(editorialContextSchema.safeParse(value).success, false);
});

test('editorial result contracts never accept publication authority or completed delivery', () => {
  const preparation = {
    schemaVersion: '1.0', sourceVersion: 7, sourceCommitmentId: context.sourceCommitmentId,
    sourceSnapshotDigest: context.sourceSnapshotDigest, commitmentVersion: 2, state: 'partial', publicationAuthorized: false,
    common: { version: 1, title: 'Partiel', presentation: '', recognition: '', sourceFacts: [], mediaReferences: [], missingInformation: ['public_name_consent'] },
    variants: context.destinations.map(destination => ({ ...destination, version: 1, title: 'Partiel', body: '', summary: '', mediaReferences: [], publicationAuthorized: false })),
  };
  assert.equal(editorialPreparationSchema.safeParse(preparation).success, true);
  assert.equal(editorialPreparationSchema.safeParse({ ...preparation, publicationAuthorized: true }).success, false);
  assert.equal(editorialPreparationSchema.safeParse({ ...preparation, state: 'published' }).success, false);
  assert.equal(editorialPreparationSchema.safeParse({ ...preparation, state: 'ready_for_review' }).success, false);
  assert.equal(editorialPreparationSchema.safeParse({ ...preparation, variants: [{ ...preparation.variants[0], delivered: true }] }).success, false);
});
