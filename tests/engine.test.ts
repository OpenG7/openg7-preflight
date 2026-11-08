import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTransition, hashInput, missingInput, planWorkflow, resolveWorkflow, validatePlan, workflows } from '../packages/engine/src/index.js';
import { missionInputSchema } from '../packages/contracts/src/index.js';
import { invalidInput } from '../packages/engine/src/workflows.js';
import { editorialProviderData, missingEditorialInformation, prepareEditorialProposal } from '../packages/engine/src/editorial.js';

test('workflow definitions share one DAG with independent checks and acyclic dependencies',()=>{
  for(const workflow of workflows){
    const plan=planWorkflow(workflow);validatePlan(plan);
    assert.deepEqual(plan.filter(task=>!task.dependencies.length).map(task=>task.key),['inspect','policy']);
    assert.deepEqual(plan.find(task=>task.key==='draft')?.dependencies,['inspect','policy']);
  }
  assert.deepEqual(planWorkflow(workflows[0]!),planWorkflow(workflows[1]!));
});
test('invalid DAGs fail before execution',()=>{
  assert.throws(()=>validatePlan([{key:'a',kind:'x',dependencies:['b']},{key:'b',kind:'x',dependencies:['a']}]),/cyclic/);
  assert.throws(()=>validatePlan([{key:'a',kind:'x',dependencies:['b']}]),/missing_dependency/);
  assert.throws(()=>validatePlan([{key:'a',kind:'x',dependencies:[]},{key:'a',kind:'x',dependencies:[]}]),/duplicate/);
});
test('mission states distinguish prepared work from authority and reject illegal transitions',()=>{
  assertTransition('running','review_ready');assertTransition('review_ready','completed');
  assert.throws(()=>assertTransition('ready','completed'),/invalid_transition/);
  assert.throws(()=>assertTransition('superseded','running'),/invalid_transition/);
});
test('workflow source and version must be explicitly supported; missing information is identified',()=>{
  const base=missionInputSchema.parse({schemaVersion:'1.0',tenantId:'test',source:{application:'openg7-social',subjectType:'topic',subjectId:'s1',version:1},workflow:{type:'editorial-brief-preparation-v1',version:'1.0'},constraints:{},input:{}});
  const workflow=resolveWorkflow(base);assert.ok(workflow);
  assert.deepEqual(missingInput(workflow,{}),['topic']);assert.deepEqual(missingInput(workflow,{topic:'Energy'}),[]);
  assert.equal(resolveWorkflow({...base,source:{...base.source,application:'funding-platform'}}),undefined);
});
test('idempotency hashes are stable across object key ordering',()=>{
  assert.equal(hashInput({a:1,b:{c:2}}),hashInput({b:{c:2},a:1}));
  assert.notEqual(hashInput({a:1}),hashInput({a:2}));
});

const editorialContext = {
  schemaVersion: '1.0', sourceCommitmentId: 'commitment-synthetic', sourceSnapshotDigest: 'b'.repeat(64), commitmentVersion: 2,
  publicIdentity: { consent: false } as { consent: boolean; displayName?: string },
  sourceFacts: [{ key: 'organization', value: 'Organisation synthétique' }], missingInformation: ['organization_name', 'contact_email'],
  destinations: [
    { destination: 'website', obligationId: 'web-synthetic', obligationVersion: 3, format: 'individual' },
    { destination: 'facebook', obligationId: 'social-synthetic', obligationVersion: 4, format: 'collective' },
  ], mediaReferences: [] as { id: string; publicUseAllowed: boolean; destinations?: string[] }[],
};
const editorialDraft = { title: 'Organisation synthétique', body: 'Présentation longue proposée.', summary: 'Reconnaissance proposée.', warnings: [] };

test('partial preparation omits unconsented identity and arbitrary private metadata from provider input and previews', () => {
  const input = { title: 'Nom privé synthétique', description: 'Coordonnées privées', benefits: ['Présentation Web'], privateEmail: 'synthetic@example.invalid', editorialContext };
  const providerData = editorialProviderData(input);
  assert.ok(!JSON.stringify(providerData).includes('Nom privé'));
  assert.ok(!JSON.stringify(providerData).includes('Organisation synthétique'));
  assert.ok(!JSON.stringify(providerData).includes('@'));
  assert.ok(!JSON.stringify(providerData).includes(editorialContext.sourceSnapshotDigest));
  assert.deepEqual(missingEditorialInformation(input), ['organization_name', 'contact_email', 'public_name_consent', 'public_name']);
  const proposal = prepareEditorialProposal(input, editorialDraft, 7)!;
  assert.equal(proposal.state, 'partial');
  assert.equal(proposal.publicationAuthorized, false);
  assert.equal(proposal.common.presentation, '');
  assert.ok(!JSON.stringify(proposal).includes('Organisation synthétique'));
  assert.ok(proposal.variants.every(variant => variant.body === '' && !variant.publicationAuthorized));
});

test('consented public facts yield independent web and facebook adaptations without granting authorization', () => {
  const input = { editorialContext: { ...editorialContext, publicIdentity: { consent: true, displayName: 'Organisation synthétique' }, missingInformation: [] } };
  const proposal = prepareEditorialProposal(input, editorialDraft, 7)!;
  assert.equal(proposal.state, 'ready_for_review');
  assert.equal(proposal.sourceVersion, 7);
  assert.equal(proposal.commitmentVersion, 2);
  assert.equal(proposal.common.version, 1);
  assert.equal(proposal.variants[0]?.body, editorialDraft.body);
  assert.equal(proposal.variants[1]?.body, editorialDraft.summary);
  assert.deepEqual(proposal.variants.map(variant => [variant.obligationId, variant.obligationVersion]), [['web-synthetic', 3], ['social-synthetic', 4]]);
  assert.ok(proposal.variants.every(variant => !variant.publicationAuthorized));
  assert.deepEqual(editorialProviderData(input)['publicFacts'], editorialContext.sourceFacts);
});

test('media references require destination scope and never inherit a web authorization for facebook', () => {
  const proposal = prepareEditorialProposal({ editorialContext: {
    ...editorialContext, publicIdentity: { consent: true, displayName: 'Organisation synthétique' }, missingInformation: [],
    mediaReferences: [{ id: 'web-media', publicUseAllowed: true, destinations: ['website'] }, { id: 'unscoped-media', publicUseAllowed: true }],
  } }, editorialDraft, 7)!;
  assert.deepEqual(proposal.variants[0]?.mediaReferences.map(media => media.id), ['web-media']);
  assert.deepEqual(proposal.variants[1]?.mediaReferences, []);
  assert.equal(proposal.state, 'partial');
  assert.deepEqual(proposal.common.missingInformation, ['media_destination_authorization']);
});

test('destination adaptations obey Funding field limits while retaining the complete common draft', () => {
  const draft = { title: 'T'.repeat(200), body: 'B'.repeat(20000), summary: 'S'.repeat(4000), warnings: [] };
  const proposal = prepareEditorialProposal({ editorialContext: {
    ...editorialContext, publicIdentity: { consent: true, displayName: 'Organisation synthétique' }, missingInformation: [],
  } }, draft, 7)!;
  assert.equal(proposal.common.title.length, 160);
  assert.equal(proposal.common.presentation.length, 20000);
  assert.equal(proposal.common.recognition.length, 4000);
  assert.equal(proposal.variants[0]?.body.length, 20000);
  assert.equal(proposal.variants[1]?.body.length, 2500);
  assert.ok(proposal.variants.every(variant => variant.summary.length === 500));
});

test('legacy preparation is unchanged and malformed editorial context is rejected at admission', () => {
  const legacy = { title: 'Synthétique', description: 'Projet', benefits: ['Présentation Web'] };
  assert.equal(editorialProviderData(legacy), legacy);
  assert.equal(prepareEditorialProposal(legacy, editorialDraft, 1), undefined);
  assert.deepEqual(invalidInput(workflows[0]!, { ...legacy, editorialContext }), []);
  assert.deepEqual(missingInput(workflows[0]!, { editorialContext }), []);
  assert.deepEqual(missingInput(workflows[0]!, {}), ['title', 'description', 'benefits']);
  assert.deepEqual(invalidInput(workflows[0]!, { ...legacy, editorialContext: { ...editorialContext, commitmentVersion: 0 } }), ['editorialContext']);
});
