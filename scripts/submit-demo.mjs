const base = process.env.PREFLIGHT_API_URL ?? 'http://127.0.0.1:3000';
const run = process.argv.find(arg => arg.startsWith('--run='))?.slice(6) ?? 'welcome-v1';
const tenantId = process.env.DEV_TENANT_ID ?? 'openg7-demo';
const headers = { 'content-type': 'application/json', ...(process.env.PREFLIGHT_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.PREFLIGHT_ACCESS_TOKEN}` } : {}) };
const common = { schemaVersion: '1.0', tenantId, priority: 'normal', constraints: { humanApprovalRequired: true, maxCostUsd: 0.5 } };
const missions = [
  { ...common, eventId: `demo-funding-${run}`, source: { application: 'funding-platform', subjectType: 'sponsorship', subjectId: `synthetic-funding-${run}`, version: 1 }, workflow: { type: 'sponsorship-preparation-v1', version: '1.0' },
    input: { title: 'Atelier des Bâtisseurs — exemple synthétique', description: 'Engagement activé simulé : préparer un brouillon de présentation Web.', benefits: ['Présentation Web proposée à la revue humaine'], demonstration: true } },
  { ...common, eventId: `demo-social-${run}`, source: { application: 'openg7-social', subjectType: 'editorial-topic', subjectId: `synthetic-social-${run}`, version: 1 }, workflow: { type: 'editorial-brief-preparation-v1', version: '1.0' },
    input: { topic: 'Coopération locale et partage de capacités — exemple synthétique', demonstration: true } },
];
for (const mission of missions) {
  const response = await fetch(`${base}/api/missions`, { method: 'POST', headers, body: JSON.stringify(mission) });
  const result = await response.json();
  if (!response.ok) throw new Error(`Soumission refusée : HTTP ${response.status} ${result.error ?? ''}`);
  const id = result.mission.id;
  console.log(JSON.stringify({ event: 'demo.submitted', missionId: id, application: mission.source.application, duplicate: result.duplicate, simulatedSource: true }));
  const deadline = Date.now() + 60000;
  let status;
  do {
    const detailResponse = await fetch(`${base}/api/missions/${encodeURIComponent(id)}`, { headers });
    if (!detailResponse.ok) throw new Error(`Lecture refusée : HTTP ${detailResponse.status}`);
    const detail = await detailResponse.json();
    status = detail.mission.status;
    if (['review_ready', 'failed', 'waiting_input', 'cancelled', 'superseded'].includes(status)) {
      console.log(JSON.stringify({ event: 'demo.processed', missionId: id, status, results: detail.results.length, proposals: detail.proposals.length, simulatedInference: detail.results.some(item => item.provenance?.simulated === true) }));
      if (status !== 'review_ready') process.exitCode = 1;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  if (status !== 'review_ready') { console.error(`Mission ${id} : ${status}; inspecter le worker et le détail de mission.`); process.exitCode = 1; }
}
