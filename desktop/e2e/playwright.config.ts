import { defineConfig } from '@playwright/test'
import path from 'path'

const ROOT = path.resolve(__dirname, '..')

export default defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // all specs share one Electron instance via CDP

  globalSetup: path.join(__dirname, 'global-setup.ts'),
  globalTeardown: path.join(__dirname, 'global-teardown.ts'),

  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(ROOT, 'e2e-report') }]],
})
