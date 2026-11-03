import { readFileSync, statSync } from 'node:fs';
import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const secretKeys = ['PREFLIGHT_DATABASE_URL_FILE', 'PREFLIGHT_POSTGRES_ADMIN_PASSWORD_FILE', 'PREFLIGHT_POSTGRES_APP_PASSWORD_FILE', 'PREFLIGHT_POSTGRES_CA_FILE', 'PREFLIGHT_POSTGRES_CERT_FILE', 'PREFLIGHT_POSTGRES_KEY_FILE', 'PREFLIGHT_OPENAI_API_KEY_FILE'];
const placeholder = value => !value || /replace-with|example\.invalid|change[_-]?me/i.test(value);
const forbiddenPasswords = new Set(['preflight_local','password','postgres']);
const certificates = pem => [...String(pem).matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)].map(match => new X509Certificate(match[0]));

function trustedChain(leaf, supplied, anchors, valid) {
  const seen = new Set();
  let current = leaf;
  for (let depth = 0; depth < 8; depth++) {
    if (!valid(current) || seen.has(current.fingerprint256)) return false;
    seen.add(current.fingerprint256);
    if (anchors.some(anchor => anchor.fingerprint256 === current.fingerprint256)) return current.ca;
    const issuer = [...supplied, ...anchors].find(candidate => candidate.ca && valid(candidate) && !seen.has(candidate.fingerprint256) && current.checkIssued(candidate) && current.verify(candidate.publicKey));
    if (!issuer) return false;
    current = issuer;
  }
  return false;
}

/** Read-only preparation check. Errors are stable codes and never include values. */
export function checkProductionEnvironment(env, { requireFiles = true, now = Date.now() } = {}) {
  const errors = [];
  for (const name of ['PREFLIGHT_SERVER_IMAGE','PREFLIGHT_WEB_IMAGE']) {
    if (placeholder(env[name]) || !env[name].includes(':') || env[name].endsWith(':latest')) errors.push(`${name.toLowerCase()}_invalid`);
  }
  if (env.DATABASE_URL || env.OPENAI_API_KEY) errors.push('inline_secrets_forbidden');
  const urls = {};
  for (const name of ['OIDC_ISSUER','OIDC_JWKS_URL','OIDC_BROWSER_REDIRECT_URI']) {
    try {
      const url = new URL(env[name]);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || placeholder(url.hostname)) throw new Error();
      urls[name] = url;
    } catch { errors.push(`${name.toLowerCase()}_invalid`); }
  }
  for (const name of ['OIDC_AUDIENCE','OIDC_BROWSER_CLIENT_ID','OPENAI_MODEL']) if (placeholder(env[name])) errors.push(`${name.toLowerCase()}_invalid`);
  for (const name of ['AI_INPUT_PRICE_PER_MILLION','AI_OUTPUT_PRICE_PER_MILLION']) if (!Number.isFinite(Number(env[name])) || Number(env[name]) <= 0) errors.push(`${name.toLowerCase()}_invalid`);
  const concurrency = Number(env.WORKER_CONCURRENCY ?? '4');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) errors.push('worker_concurrency_invalid');
  const secret = {};
  for (const key of secretKeys) {
    if (!env[key] || !path.isAbsolute(env[key])) { errors.push(`${key.toLowerCase()}_invalid`); continue; }
    if (!requireFiles) continue;
    try {
      const file = statSync(env[key]);
      if (!file.isFile() || file.size > 65536) throw new Error();
      const content = readFileSync(env[key], 'utf8').trim();
      if (!content || content.includes('\0')) throw new Error();
      secret[key] = content;
    } catch { errors.push(`${key.toLowerCase()}_unreadable`); }
  }
  if (!requireFiles) return errors;
  let database;
  try {
    database = new URL(secret.PREFLIGHT_DATABASE_URL_FILE);
    if (!['postgres:','postgresql:'].includes(database.protocol) || database.username !== 'preflight_app' || database.pathname !== '/preflight' || database.searchParams.get('sslmode') !== 'verify-full' || database.searchParams.get('sslrootcert') !== '/run/secrets/postgres_ca') throw new Error();
    const password = decodeURIComponent(database.password);
    if (!password || forbiddenPasswords.has(password) || password !== secret.PREFLIGHT_POSTGRES_APP_PASSWORD_FILE) throw new Error();
  } catch { errors.push('database_url_or_application_password_invalid'); }
  if (secret.PREFLIGHT_POSTGRES_ADMIN_PASSWORD_FILE && (forbiddenPasswords.has(secret.PREFLIGHT_POSTGRES_ADMIN_PASSWORD_FILE) || secret.PREFLIGHT_POSTGRES_ADMIN_PASSWORD_FILE === secret.PREFLIGHT_POSTGRES_APP_PASSWORD_FILE)) errors.push('postgres_admin_password_invalid');
  try {
    const anchors = certificates(secret.PREFLIGHT_POSTGRES_CA_FILE);
    const chain = certificates(secret.PREFLIGHT_POSTGRES_CERT_FILE);
    const cert = chain[0];
    const key = createPrivateKey(secret.PREFLIGHT_POSTGRES_KEY_FILE);
    const valid = value => Date.parse(value.validFrom) <= now && Date.parse(value.validTo) > now;
    if (!cert || !anchors.length || !trustedChain(cert, chain.slice(1), anchors, valid) || !database || !cert.checkHost(database.hostname)) throw new Error();
    const expected = cert.publicKey.export({ type: 'spki', format: 'der' });
    const actual = createPublicKey(key).export({ type: 'spki', format: 'der' });
    if (!expected.equals(actual)) throw new Error();
  } catch { errors.push('postgres_certificate_chain_key_or_hostname_invalid'); }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--env-file') throw new Error();
    const env = parseEnv(readFileSync(args[1], 'utf8'));
    const errors = checkProductionEnvironment(env);
    console.log(JSON.stringify({ event: 'production.configuration', valid: errors.length === 0, errors }));
    process.exitCode = errors.length ? 1 : 0;
  } catch { console.error('{"event":"production.configuration","valid":false,"errors":["configuration_file_invalid"]}'); process.exitCode = 1; }
}
