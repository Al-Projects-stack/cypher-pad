import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 240000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173'
  },
  webServer: [
    {
      command: 'node e2e/api.mjs',
      port: 3001,
      reuseExistingServer: false,
      env: {
        E2E_API_PORT: '3001',
        PORT: '3001'
      },
      stdout: 'pipe',
      stderr: 'pipe'
    },
    {
      command: 'pnpm exec vite preview --port 5173 --strictPort',
      port: 5173,
      reuseExistingServer: false
    }
  ]
});
