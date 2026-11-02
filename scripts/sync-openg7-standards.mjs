#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { START, END, commonRange } from './check-project-standards.mjs';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage =
  'Usage: node scripts/sync-openg7-standards.mjs --target <depot> [--check | --dry-run]';

function localFile(root, relative) {
  if (
    !/^[\w./-]+$/.test(relative) ||
    relative.startsWith('/') ||
    relative.split('/').includes('..')
  )
    throw Error(`Chemin interdit: ${relative}`);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw Error(`Lien symbolique interdit: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return current;
}

export function planSync(targetRoot, templateRoot = sourceRoot) {
  const target = path.resolve(targetRoot);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory())
    throw Error('Le dépôt cible doit exister.');
  const comparable = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  if (comparable(fs.realpathSync(target)) !== comparable(target))
    throw Error('La cible doit être un chemin réel, sans lien symbolique.');
  if (target === path.resolve(templateRoot))
    throw Error('Le template ne peut pas être sa propre cible.');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(templateRoot, 'scripts/sync-manifest.json'), 'utf8'),
  );
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    new Set(manifest.files).size !== manifest.files.length
  )
    throw Error('Manifest invalide.');
  if (
    manifest.files.some(
      (f) =>
        ![
          'docs/standards/agent-common.md',
          'docs/standards/README.md',
          'scripts/check-project-standards.mjs',
          '.github/workflows/agent-standards.yml',
        ].includes(f),
    )
  )
    throw Error('Le manifest doit rester limité aux fichiers communs.');
  const agentsPath = localFile(target, 'AGENTS.md');
  const original = fs.readFileSync(agentsPath, 'utf8');
  const range = commonRange(original);
  const common = fs
    .readFileSync(localFile(templateRoot, 'docs/standards/agent-common.md'), 'utf8')
    .replace(/\r\n/g, '\n')
    .trim();
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const replacement = [START, '', common, '', END].join('\n').replace(/\n/g, newline);
  const next = original.slice(0, range.start) + replacement + original.slice(range.end);
  const changes = [{ file: 'AGENTS.md', dest: agentsPath, content: Buffer.from(next) }];
  for (const file of manifest.files) {
    const source = localFile(templateRoot, file);
    const dest = localFile(target, file);
    const content = fs.readFileSync(source);
    if (fs.existsSync(dest) && !fs.statSync(dest).isFile())
      throw Error(`Destination non fichier: ${file}`);
    let parent = path.dirname(dest);
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    if (!fs.statSync(parent).isDirectory()) throw Error(`Parent non répertoire: ${file}`);
    changes.push({ file, dest, content });
  }
  return changes.filter(
    (c) => !fs.existsSync(c.dest) || !fs.readFileSync(c.dest).equals(c.content),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) console.log(usage);
    else {
      let target;
      let mode = 'write';
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--target' && !target && args[i + 1] && !args[i + 1].startsWith('--'))
          target = args[++i];
        else if (['--check', '--dry-run'].includes(arg) && mode === 'write') mode = arg;
        else throw Error(usage);
      }
      if (!target) throw Error(usage);
      const changes = planSync(target);
      if (mode === 'write')
        for (const change of changes) {
          fs.mkdirSync(path.dirname(change.dest), { recursive: true });
          fs.writeFileSync(change.dest, change.content);
        }
      console.log(
        `${changes.length} fichier(s) ${mode === 'write' ? 'synchronisé(s)' : 'en dérive'}; mission et règles locales conservées.`,
      );
      for (const change of changes) console.log(change.file);
      if (mode === '--check' && changes.length) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
