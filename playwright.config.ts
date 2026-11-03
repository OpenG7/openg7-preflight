import { defineConfig } from '@playwright/test';

function localWebUrl(raw: string): URL {
  let result: URL;
  try { result = new URL(raw); }
  catch { throw new Error('Browser test origin configuration is invalid.'); }
  if (result.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(result.hostname) ||
      result.username || result.password || result.search || result.hash || result.pathname !== '/')
    throw new Error('Browser tests require a dedicated loopback HTTP origin.');
  return result;
}
// PREFLIGHT_WEB_URL may describe an already running developer console. Never take over that port.
const configured = process.env['PREFLIGHT_TEST_WEB_URL'] ?? process.env['PREFLIGHT_WEB_URL'];
const candidate = configured ? localWebUrl(configured) : undefined;
if (process.env['PREFLIGHT_TEST_WEB_URL'] && candidate?.port === '4300') throw new Error('Browser tests cannot use the developer console port.');
const web = candidate && candidate.port !== '4300' ? candidate : localWebUrl('http://127.0.0.1:4400');
const webPort = Number(web.port || 80);
const apiPort = Number(process.env['PREFLIGHT_TEST_API_PORT'] ?? '3400');
if (![apiPort, webPort].every(value => Number.isInteger(value) && value > 0 && value <= 65535) ||
    [3000, 4300].includes(apiPort) || [3000, 4300].includes(webPort) || apiPort === webPort)
  throw new Error('Browser test ports must be dedicated and distinct from development ports.');

const databaseUrl = process.env['TEST_DATABASE_URL'];
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for isolated browser tests.');
let database: URL;
try { database = new URL(databaseUrl); }
catch { throw new Error('Browser test database configuration is invalid.'); }
const databaseName = decodeURIComponent(database.pathname.slice(1));
if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) ||
    !/^[a-z0-9_]*test[a-z0-9_]*$/i.test(databaseName) ||
    ['host', 'hostaddr', 'port', 'database', 'dbname', 'service', 'options'].some(key => database.searchParams.has(key)))
  throw new Error('Browser tests require an explicit loopback PostgreSQL test database.');

const baseURL = web.origin;
export default defineConfig({
  testDir: './tests/browser', timeout: 60000, workers: 1,
  use: { baseURL, browserName: 'chromium', viewport: { width: 1920, height: 1080 }, trace: 'retain-on-failure' },
  reporter: 'list', outputDir: 'test-results',
  webServer: {
    command: 'npm run db:migrate && npm run dev',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NODE_ENV: 'development', AUTH_MODE: 'development', HOST: '127.0.0.1',
      PORT: String(apiPort), PREFLIGHT_DEV_API_PORT: String(apiPort),
      PREFLIGHT_DEV_WEB_PORT: String(webPort), PREFLIGHT_DEV_WEB_HOST: web.hostname === '[::1]' ? '::1' : web.hostname,
      PREFLIGHT_WEB_URL: baseURL, DEV_WEB_ORIGIN: baseURL,
      DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl,
      AI_PROVIDER: 'mock', AI_EXTERNAL_ENABLED: 'false',
      DEV_TENANT_ID: 'openg7-browser-test', DEV_SUBJECT: 'browser-test-administrator',
      DEV_APPLICATIONS: 'funding-platform,openg7-social', DEV_ROLES: 'administrator',
      OIDC_BROWSER_CLIENT_ID: '', OIDC_BROWSER_REDIRECT_URI: '',
      OIDC_ISSUER: '', OIDC_AUDIENCE: '', OIDC_JWKS_URL: '',
    },
  },
});
