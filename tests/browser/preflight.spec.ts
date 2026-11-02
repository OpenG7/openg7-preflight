import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test('real API, durable worker, both workflows, briefing, inspection and versioned batch export', async ({ page, request }, info) => {
  const session = await (await request.get('/api/session')).json();
  expect(session.authMode, 'These synthetic missions are allowed only in local development.').toBe('development');
  const run = randomUUID().slice(0, 8);
  const inputs = [
    { application: 'funding-platform', workflow: 'sponsorship-preparation-v1', input: { title: 'Exemple navigateur synthétique', description: 'Présentation de démonstration', benefits: ['Brouillon à examiner'] } },
    { application: 'funding-platform', workflow: 'sponsorship-preparation-v1', input: { title: 'Second exemple navigateur synthétique', description: 'Préparation groupée de démonstration', benefits: ['Brouillon à examiner'] } },
    { application: 'openg7-social', workflow: 'editorial-brief-preparation-v1', input: { topic: 'Coopération — sujet synthétique navigateur' } },
  ];
  const prepared: Array<{ missionId: string; proposalId: string; subject: string }> = [];
  for (const [index, input] of inputs.entries()) {
    const subject = `synthetic-browser-${run}-${index}`;
    const body = { schemaVersion: '1.0', eventId: `browser-${run}-${index}`, tenantId: session.tenantId,
      source: { application: input.application, subjectType: 'demonstration', subjectId: subject, version: 1 },
      workflow: { type: input.workflow, version: '1.0' }, constraints: { humanApprovalRequired: true, maxCostUsd: 0.5 }, input: input.input };
    const response = await request.post('/api/missions', { data: body });
    expect(response.status()).toBe(202);
    const submitted = await response.json();
    const duplicate = await request.post('/api/missions', { data: body });
    expect(duplicate.status()).toBe(200);
    expect((await duplicate.json()).mission.id).toBe(submitted.mission.id);
    await expect.poll(async () => (await (await request.get(`/api/missions/${submitted.mission.id}`)).json()).mission.status, { timeout: 25000 }).toBe('review_ready');
    const detail = await (await request.get(`/api/missions/${submitted.mission.id}`)).json();
    expect(detail.tasks).toHaveLength(5);
    expect(detail.results).toHaveLength(5);
    expect(detail.results.find((item: {kind: string}) => item.kind === 'draft').provenance.simulated).toBe(true);
    prepared.push({ missionId: submitted.mission.id, proposalId: detail.proposals[0].id, subject });
  }
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Votre briefing de relève/ })).toBeVisible();
  await expect(page.getByText('Identité de développement explicite', { exact: false })).toBeVisible();
  await expect(page.locator('.metric-grid')).toContainText('Propositions prêtes');
  await page.screenshot({ path: info.outputPath('briefing-desktop.png'), fullPage: false });
  await page.getByRole('button', { name: 'Missions', exact: true }).click();
  await page.getByLabel('Recherche', { exact: true }).fill(prepared[0]!.subject);
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await page.getByRole('button', { name: prepared[0]!.subject, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Résultats & provenance' })).toBeVisible();
  await expect(page.getByText('Simulation déterministe', { exact: true })).toBeVisible();
  await expect(page.locator('.draft-content')).toContainText('Brouillon de démonstration');
  await page.getByRole('button', { name: 'Propositions & lots', exact: true }).click();
  for (const proposal of prepared.slice(0, 2)) await page.getByRole('checkbox', { name: `Sélectionner la proposition ${proposal.proposalId}`, exact: true }).check();
  await page.getByRole('button', { name: 'Préparer un lot · 2', exact: true }).click();
  await expect(page.getByText('SÉLECTION VERSIONNÉE · V1')).toBeVisible();
  page.once('dialog', dialog => { void dialog.accept(); });
  await page.getByRole('button', { name: 'Exclure ce dossier', exact: true }).first().click();
  await expect(page.getByText('SÉLECTION VERSIONNÉE · V2')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter pour transmission', exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8')) as { authority: string; businessDecisionExecuted: boolean; proposals: unknown[] };
  expect(exported.authority).toBe('source_application');
  expect(exported.businessDecisionExecuted).toBe(false);
  expect(exported.proposals).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('mobile layout supports keyboard navigation and displays connection boundaries', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Votre briefing de relève/ })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused();
  await page.getByRole('button', { name: 'Applications', exact: true }).click();
  await expect(page.getByText('Non raccordée', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('a failed briefing request has a useful error and retry action', async ({ page }) => {
  await page.route('**/api/briefing?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'test_unavailable', correlationId: 'synthetic-browser-failure' }) }));
  await page.route('**/api/briefing', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'test_unavailable', correlationId: 'synthetic-browser-failure' }) }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Réessayer', exact: true })).toBeVisible();
});
