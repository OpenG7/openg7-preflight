#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const START = '<!-- openg7:common:start -->';
export const END = '<!-- openg7:common:end -->';
const ignored = new Set([
  '.git',
  '.yarn',
  '.pnp',
  'node_modules',
  '.venv',
  'venv',
  'dist',
  'build',
  'coverage',
  'test-results',
  'playwright-report',
  'backups',
  '.angular',
]);
const slash = (s) => s.split(path.sep).join('/');

export function commonRange(text) {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (
    start < 0 ||
    end < start ||
    text.indexOf(START, start + 1) >= 0 ||
    text.indexOf(END, end + 1) >= 0
  ) {
    throw new Error(
      'AGENTS.md: un seul bloc commun délimité est requis; migration explicite nécessaire.',
    );
  }
  return { start, end: end + END.length, content: text.slice(start + START.length, end).trim() };
}

function prose(text) {
  let fence = null;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
        return '';
      }
      return fence ? '' : line;
    })
    .join('\n');
}

function anchors(text) {
  const clean = prose(text);
  const found = new Set([...clean.matchAll(/<a\s+(?:id|name)=["']([^"']+)["']/g)].map((m) => m[1]));
  const counts = new Map();
  for (const match of clean.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const base = match[1]
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
      .replace(/\s/g, '-');
    const count = counts.get(base) ?? 0;
    found.add(count ? `${base}-${count}` : base);
    counts.set(base, count + 1);
  }
  return found;
}

export function checkProject(repoRoot) {
  const root = path.resolve(repoRoot);
  const errors = [];
  const documents = new Map();
  const instructions = [];
  const sizes = {};
  let checkedLinks = 0;
  const load = (file) => {
    if (!documents.has(file)) documents.set(file, fs.readFileSync(path.join(root, file), 'utf8'));
    return documents.get(file);
  };
  function walk(dir = '') {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/^AGENTS(?:\.override)?\.md$/.test(entry.name)) instructions.push(rel);
    }
  }
  walk();
  const sources = new Set(instructions);
  for (const file of ['AGENTS.md', 'docs/standards/agent-common.md', 'docs/standards/README.md']) {
    if (!fs.existsSync(path.join(root, file))) errors.push(`Fichier requis absent: ${file}`);
    else sources.add(file);
  }
  if (!fs.existsSync(path.join(root, 'README.md'))) errors.push('README.md absent.');
  const architecture = ['docs/ARCHITECTURE.md', 'ARCHITECTURE.md'].find((f) =>
    fs.existsSync(path.join(root, f)),
  );
  if (architecture) sources.add(architecture);
  else errors.push('Architecture locale absente.');
  function collect(dir) {
    if (!fs.existsSync(path.join(root, dir))) return;
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) collect(rel);
      else if (entry.name.endsWith('.md')) sources.add(rel);
    }
  }
  for (const dir of ['.github/instructions', '.agents/skills', 'docs/agents']) collect(dir);
  for (const file of [
    '.github/copilot-instructions.md',
    '.github/pull_request_template.md',
    '.github/workflows/README.md',
  ]) {
    if (fs.existsSync(path.join(root, file))) sources.add(file);
  }
  try {
    const text = load('AGENTS.md');
    const common = load('docs/standards/agent-common.md').replace(/\r\n/g, '\n').trim();
    if (commonRange(text).content.replace(/\r\n/g, '\n') !== common)
      errors.push('AGENTS.md: dérive du socle commun.');
    for (const heading of [
      'Mission',
      'Socle commun OpenG7',
      'Périmètre local',
      'Lectures selon la tâche',
      'Validation',
      'Maintenance',
    ]) {
      if (!prose(text).split('\n').includes(`## ${heading}`))
        errors.push(`AGENTS.md: section absente: ${heading}`);
    }
  } catch (error) {
    errors.push(error.message);
  }

  for (const file of sources) {
    const text = load(file);
    const bytes = Buffer.byteLength(text);
    const isAgent = instructions.includes(file);
    const isTool = file.startsWith('.github/') || file.startsWith('.agents/');
    const maxBytes = isAgent ? (file === 'AGENTS.md' ? 8192 : 6144) : isTool ? 4096 : null;
    sizes[file] = { bytes, ...(maxBytes ? { maxBytes } : {}) };
    if (maxBytes && bytes > maxBytes) errors.push(`${file}: ${bytes} octets > ${maxBytes}`);
    if (file.endsWith('AGENTS.override.md'))
      errors.push(`${file}: utiliser AGENTS.md pour conserver la chaîne du socle commun.`);
    if (isAgent) {
      const parents = file.split('/').slice(0, -1);
      let chain = bytes;
      for (let i = 0; i < parents.length; i++) {
        const parent = [...parents.slice(0, i), 'AGENTS.md'].join('/');
        if (instructions.includes(parent)) chain += Buffer.byteLength(load(parent));
      }
      sizes[file].chainBytes = chain;
      if (chain > 16384) errors.push(`${file}: chaîne ${chain} octets > 16384`);
    }
    if (
      file.endsWith('.instructions.md') &&
      !/^---\r?\n[\s\S]*?\bapplyTo:\s*\S[\s\S]*?\r?\n---/.test(text)
    )
      errors.push(`${file}: applyTo manquant.`);
    if (file.endsWith('/SKILL.md')) {
      const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (
        !front ||
        !/^name:\s*[a-z0-9-]+\s*$/m.test(front[1]) ||
        !/^description:\s*\S/m.test(front[1])
      )
        errors.push(`${file}: frontmatter name/description invalide.`);
    }
    if ((isTool || isAgent) && /\blignes?\s+\d+/i.test(text))
      errors.push(`${file}: remplacer les numéros de ligne par liens/ancres stables.`);
    for (const match of prose(text).matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const href = match[1];
      if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(href)) continue;
      const [raw, anchor] = href.split('#');
      let target;
      try {
        target = raw
          ? path.resolve(root, path.dirname(file), decodeURIComponent(raw))
          : path.join(root, file);
      } catch {
        errors.push(`${file}: lien mal encodé: ${href}`);
        continue;
      }
      const rel = slash(path.relative(root, target));
      if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) {
        errors.push(`${file}: lien hors dépôt: ${href}`);
        continue;
      }
      checkedLinks++;
      if (!fs.existsSync(target)) errors.push(`${file}: cible absente: ${href}`);
      else if (anchor && target.endsWith('.md')) {
        try {
          if (!anchors(load(rel)).has(decodeURIComponent(anchor)))
            errors.push(`${file}: ancre absente: ${href}`);
        } catch {
          errors.push(`${file}: ancre invalide: ${href}`);
        }
      }
    }
  }
  return { unit: 'UTF-8 bytes; not tokens', files: sizes, checkedLinks, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--json')) {
    console.error('Usage: node scripts/check-project-standards.mjs [--json]');
    process.exitCode = 2;
  } else {
    try {
      const report = checkProject(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
      if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(
          `${Object.keys(report.files).length} documents; ${report.checkedLinks} liens/ancres; AGENTS racine ${report.files['AGENTS.md']?.bytes ?? 0} octets.`,
        );
        for (const error of report.errors) console.error(error);
        if (!report.errors.length) console.log('Standard OpenG7 respecté.');
      }
      process.exitCode = report.errors.length ? 1 : 0;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 2;
    }
  }
}
