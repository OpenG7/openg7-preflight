import { defineConfig } from '@playwright/test';
const baseURL = process.env['PREFLIGHT_WEB_URL'] ?? 'http://127.0.0.1:4300';
if (!['127.0.0.1','localhost','[::1]'].includes(new URL(baseURL).hostname)) throw new Error('Browser tests require a local development server.');
export default defineConfig({
  testDir: './tests/browser', timeout: 60000, workers: 1,
  use: { baseURL, browserName: 'chromium', viewport: { width: 1920, height: 1080 }, trace: 'retain-on-failure' },
  reporter: 'list', outputDir: 'test-results',
  webServer: { command: 'npm run dev', url: baseURL, reuseExistingServer: !process.env['CI'], timeout: 120000 },
});
