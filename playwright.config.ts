// Browser tests for the orcs ui web app. They start their own server over a throwaway ~/.orcs.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/ui',
  testMatch: '*.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: [['list']],
  // ORCS_CHROMIUM can point at a local Chromium binary when the managed download does not match the machine.
  use: { trace: 'off', screenshot: 'only-on-failure', launchOptions: { executablePath: process.env.ORCS_CHROMIUM || undefined } },
});
