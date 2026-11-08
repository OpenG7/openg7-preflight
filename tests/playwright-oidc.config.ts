import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const baseURL='http://127.0.0.1:4500';

// This suite intercepts the API and issuer and needs neither a database nor credentials.
export default defineConfig({
  testDir:'./browser',testMatch:'oidc.spec.ts',timeout:30000,workers:1,
  use:{baseURL,browserName:'chromium',trace:'retain-on-failure'},
  reporter:'list',outputDir:'../test-results/oidc',
  webServer:{
    command:'node ../../node_modules/@angular/cli/bin/ng.js serve --host 127.0.0.1 --port 4500',
    cwd:fileURLToPath(new URL('../apps/admin-web/',import.meta.url)),
    url:baseURL,reuseExistingServer:false,timeout:120000,
  },
});
