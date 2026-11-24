import { defineConfig, devices } from '@playwright/test';

const includeWebkit = process.env.PLAYWRIGHT_INCLUDE_WEBKIT === 'true';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Run sequentially for localStorage state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'on', // Take screenshots for every test
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    ...(includeWebkit
      ? [
          {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
          },
        ]
      : []),
  ],

  webServer: [
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Same app, but with credentials inherited from a backend that no longer
      // exists (.invalid never resolves) — the shape of the deployed instance.
      // Used by tests/dead-backend.spec.js.
      command: 'npm run dev -- --port 5174',
      url: 'http://127.0.0.1:5174',
      env: {
        VITE_SUPABASE_URL: 'https://deleted-project.invalid',
        VITE_SUPABASE_ANON_KEY: 'deleted-anon-key',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
