import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTransition, hashInput, missingInput, planWorkflow, resolveWorkflow, validatePlan, workflows } from '../packages/engine/src/index.js';
import { missionInputSchema } from '../packages/contracts/src/index.js';

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
