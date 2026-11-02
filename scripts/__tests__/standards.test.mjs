import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { checkProject, commonRange, START, END } from '../check-project-standards.mjs';
import { planSync } from '../sync-openg7-standards.mjs';

const template = fileURLToPath(new URL('../../', import.meta.url));
const common = fs
  .readFileSync(path.join(template, 'docs/standards/agent-common.md'), 'utf8')
  .trim();
const sync = path.join(template, 'scripts/sync-openg7-standards.mjs');
const managed = JSON.parse(
  fs.readFileSync(path.join(template, 'scripts/sync-manifest.json')),
).files;
function put(root, file, content) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openg7-standards-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('openg7-standards-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  put(root, 'README.md', '# Fixture\n');
  put(root, 'docs/ARCHITECTURE.md', '# Architecture\n\n<a id="boundary"></a>\n');
  put(
    root,
    'AGENTS.md',
    `# Projet spécifique\n\n## Mission\n\nMission locale unique.\n\n${START}\n${common}\n${END}\n\n## Périmètre local\n\nPolitique locale conservée.\n\n## Lectures selon la tâche\n\n[Frontière](docs/ARCHITECTURE.md#boundary)\n\n## Validation\n\nValidation locale.\n\n## Maintenance\n\nPropriétaire local.\n`,
  );
  for (const file of managed) put(root, file, fs.readFileSync(path.join(template, file)));
  return root;
}
const cli = (root, ...args) =>
  spawnSync(process.execPath, [sync, '--target', root, ...args], { encoding: 'utf8' });
const bytes = (root, file) => fs.readFileSync(path.join(root, file));
const text = (root, file) => bytes(root, file).toString('utf8');
function stale(root, crlf = false) {
  const original = text(root, 'AGENTS.md');
  const range = commonRange(original);
  let result =
    original.slice(0, range.start) + `${START}\nAncien socle.\n${END}` + original.slice(range.end);
  if (crlf) result = result.replace(/\n/g, '\r\n');
  put(root, 'AGENTS.md', result);
  return result;
}

test('valid project, UTF-8 sizes and local anchors', (t) => {
  const root = fixture(t);
  const report = checkProject(root);
  assert.deepEqual(report.errors, []);
  assert.equal(report.files['AGENTS.md'].bytes, bytes(root, 'AGENTS.md').length);
  assert.ok(report.checkedLinks > 0);
});

test('sync preserves mission, architecture, local instructions and CRLF outside block', (t) => {
  const root = fixture(t);
  const before = stale(root, true);
  put(root, 'apps/api/AGENTS.md', '# Domaine propre\n');
  const architecture = bytes(root, 'docs/ARCHITECTURE.md');
  const local = bytes(root, 'apps/api/AGENTS.md');
  const result = cli(root);
  assert.equal(result.status, 0, result.stderr);
  const after = text(root, 'AGENTS.md');
  const a = commonRange(before),
    b = commonRange(after);
  assert.equal(before.slice(0, a.start), after.slice(0, b.start));
  assert.equal(before.slice(a.end), after.slice(b.end));
  assert.equal(b.content.replace(/\r\n/g, '\n'), common);
  assert.deepEqual(bytes(root, 'docs/ARCHITECTURE.md'), architecture);
  assert.deepEqual(bytes(root, 'apps/api/AGENTS.md'), local);
  assert.deepEqual(planSync(root), []);
  assert.equal(cli(root, '--check').status, 0);
});

test('check and dry-run report drift without writing or creating managed files', (t) => {
  const root = fixture(t);
  stale(root);
  const before = bytes(root, 'AGENTS.md');
  fs.unlinkSync(path.join(root, '.github/workflows/agent-standards.yml'));
  assert.equal(cli(root, '--check').status, 1);
  assert.equal(cli(root, '--dry-run').status, 0);
  assert.deepEqual(bytes(root, 'AGENTS.md'), before);
  assert.equal(fs.existsSync(path.join(root, '.github/workflows/agent-standards.yml')), false);
});

test('missing or duplicate markers fail before mutations', (t) => {
  const root = fixture(t);
  for (const bad of [
    '# Existing project without migration\n',
    `${START}\nx\n${END}\n${START}\ny\n${END}`,
  ]) {
    put(root, 'AGENTS.md', bad);
    put(root, 'docs/standards/README.md', 'local before failure');
    assert.equal(cli(root).status, 2);
    assert.equal(text(root, 'AGENTS.md'), bad);
    assert.equal(text(root, 'docs/standards/README.md'), 'local before failure');
  }
});

test('late missing source and foreign manifest entry cannot produce a partial plan/write', (t) => {
  const root = fixture(t);
  stale(root);
  const source = path.join(root, 'source');
  for (const file of ['scripts/sync-manifest.json', ...managed])
    put(source, file, fs.readFileSync(path.join(template, file)));
  fs.unlinkSync(path.join(source, managed.at(-1)));
  const before = bytes(root, 'AGENTS.md');
  assert.throws(() => planSync(root, source), /ENOENT/);
  assert.deepEqual(bytes(root, 'AGENTS.md'), before);
  put(
    source,
    'scripts/sync-manifest.json',
    JSON.stringify({ version: 1, files: ['../outside.md'] }),
  );
  assert.throws(() => planSync(root, source), /manifest/);
  assert.deepEqual(bytes(root, 'AGENTS.md'), before);
});

test('directory links cannot redirect a synchronized write', (t) => {
  const root = fixture(t);
  stale(root);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.renameSync(path.join(root, 'docs/standards'), path.join(root, 'docs/standards-original'));
  fs.symlinkSync(
    outside,
    path.join(root, 'docs/standards'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const before = bytes(root, 'AGENTS.md');
  assert.throws(() => planSync(root), /symbolique/);
  assert.deepEqual(bytes(root, 'AGENTS.md'), before);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('unknown/conflicting CLI arguments fail without writing', (t) => {
  const root = fixture(t);
  stale(root);
  const before = bytes(root, 'AGENTS.md');
  for (const args of [['--force'], ['--check', '--dry-run'], ['--target', root]])
    assert.equal(cli(root, ...args).status, 2);
  assert.deepEqual(bytes(root, 'AGENTS.md'), before);
});

test('validator catches common drift, missing anchors and nested chain overflow', (t) => {
  const root = fixture(t);
  stale(root);
  put(root, 'docs/ARCHITECTURE.md', '# Changed without preserving anchor\n');
  put(root, 'apps/AGENTS.md', '# Local\n' + 'a'.repeat(5900));
  put(root, 'apps/api/AGENTS.md', '# Nested\n' + 'b'.repeat(5900));
  put(root, 'apps/api/domain/AGENTS.md', '# Deep\n' + 'c'.repeat(5900));
  const errors = checkProject(root).errors.join('\n');
  assert.match(errors, /dérive du socle/);
  assert.match(errors, /ancre absente/);
  assert.match(errors, /chaîne .* > 16384/);
});

test('validator rejects oversized entries, broken links, bad frontmatter and line references', (t) => {
  const root = fixture(t);
  put(
    root,
    '.github/instructions/code.instructions.md',
    'ligne 42\n[absent](../../absent.md)\n' + 'é'.repeat(2100),
  );
  put(root, '.agents/skills/bad/SKILL.md', '---\nname: Invalid_Name\n---\n');
  const errors = checkProject(root).errors.join('\n');
  for (const pattern of [
    /octets > 4096/,
    /applyTo manquant/,
    /numéros de ligne/,
    /cible absente/,
    /frontmatter/,
  ])
    assert.match(errors, pattern);
});

test('code-fenced example links do not create false validation failures', (t) => {
  const root = fixture(t);
  put(
    root,
    'docs/ARCHITECTURE.md',
    '# Architecture\n<a id="boundary"></a>\n\n```md\n[example](missing.md)\n```\n',
  );
  assert.deepEqual(checkProject(root).errors, []);
});
