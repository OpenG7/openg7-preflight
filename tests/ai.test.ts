import test from 'node:test';
import assert from 'node:assert/strict';
import { MockAiProvider, OpenAiProvider, createAiProvider, aiTaskResultSchema, type AiTaskInput } from '../packages/ai/src/index.js';

const input: AiTaskInput = { kind: 'editorial-brief', data: { topic: 'Sujet synthétique', facts: ['Exemple public'] }, maxCostUsd: 0.5, timeoutMs: 1000 };
const config = { apiKey: 'synthetic-test-key', model: 'fixture-model', inputPricePerMillion: 1, outputPricePerMillion: 2 };
const output = { title: 'Brouillon', summary: 'Résumé', body: 'Contenu proposé', warnings: ['À vérifier'] };
const payload = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }], usage: { input_tokens: 100, output_tokens: 50 } };
const respond = (value: unknown, status = 200): typeof fetch => async () => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('mock is deterministic, schema-valid and visibly simulated', async () => {
  const provider = new MockAiProvider();
  const a = await provider.generate(input); const b = await provider.generate(input);
  assert.deepEqual(a.output, b.output); assert.equal(a.provenance.inputHash, b.provenance.inputHash);
  assert.equal(a.provenance.simulated, true); assert.equal(a.provenance.provider, 'mock');
  assert.equal(a.provenance.estimatedCostUsd, 0); assert.match(a.output.warnings[0]!, /Simulation/);
  assert.ok(aiTaskResultSchema.safeParse(a).success);
});
test('no provider, external opt-in and production mock fail closed', () => {
  assert.throws(() => createAiProvider({}), /provider_not_configured/);
  assert.throws(() => createAiProvider({ AI_PROVIDER: 'openai' }), /external_provider_not_enabled/);
  assert.throws(() => createAiProvider({ AI_PROVIDER: 'openai', AI_EXTERNAL_ENABLED: 'true' }), /provider_configuration_invalid/);
  assert.throws(() => createAiProvider({ AI_PROVIDER: 'mock', NODE_ENV: 'production' }), /mock_provider_forbidden/);
});
test('Responses adapter sends strict structured contract without tools and validates provenance', async () => {
  let body: Record<string, unknown> | undefined;
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const result = await new OpenAiProvider(config, fetcher).generate(input);
  assert.deepEqual(result.output, output); assert.equal(result.provenance.simulated, false);
  assert.equal(result.provenance.usage?.inputTokens, 100);
  assert.equal(result.provenance.estimatedCostUsd, 0.0002);
  assert.equal(body?.['store'], false); assert.equal(body?.['tools'], undefined);
  assert.equal((body?.['text'] as { format: { strict: boolean } }).format.strict, true);
});
test('budget reservation prevents external invocation', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return new Response('{}'); };
  await assert.rejects(new OpenAiProvider(config, fetcher).generate({ ...input, maxCostUsd: 0 }), /budget_exceeded/);
  assert.equal(calls, 0);
});
test('invalid model output, incomplete response, refusal and supplier failure are visible', async () => {
  await assert.rejects(new OpenAiProvider(config, respond({ ...payload, output: [{ type: 'message', content: [{ type: 'output_text', text: '{"body":"missing required fields"}' }] }] })).generate(input), /provider_output_invalid/);
  await assert.rejects(new OpenAiProvider(config, respond({ ...payload, status: 'incomplete' })).generate(input), /provider_response_incomplete/);
  await assert.rejects(new OpenAiProvider(config, respond({ ...payload, output: [{ type: 'message', content: [{ type: 'refusal' }] }] })).generate(input), /provider_refused/);
  await assert.rejects(new OpenAiProvider(config, respond({}, 503)).generate(input), error => error instanceof Error && error.message === 'provider_http_error' && 'retryable' in error && error.retryable === true);
  await assert.rejects(new OpenAiProvider(config, respond('not a response')).generate(input), /provider_response_invalid/);
});
test('timeout and caller cancellation terminate the provider wait', async () => {
  const blocked: typeof fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    if (init?.signal?.aborted) reject(new Error('already_aborted'));
  });
  // Keep the event loop active: AbortSignal.timeout deliberately uses an unref timer.
  const keepAlive = setTimeout(() => undefined, 1000);
  try { await assert.rejects(new OpenAiProvider(config, blocked).generate({ ...input, timeoutMs: 5 }), /provider_timeout/); }
  finally { clearTimeout(keepAlive); }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(new OpenAiProvider(config, blocked).generate(input, { signal: controller.signal }), /provider_timeout/);
});
