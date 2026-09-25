import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end journeys against the real stack (#92): the images `docker
 * compose` builds, Postgres included. Nothing here starts the stack --
 * CI's e2e job does, and locally:
 *
 *   docker compose -p softtrack-e2e up -d --build   # its own volumes
 *   cd e2e && npm ci && npx playwright install chromium && npm test
 *
 * One browser to start with; breadth of journeys before breadth of browsers.
 */
export default defineConfig({
  testDir: './tests',
  // Journeys run one at a time: they share one backend and its sign-up rate
  // limit, and a board is easier to reason about when nothing else is typing.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    // A trace is what makes a CI failure debuggable: every action, the DOM
    // before and after, the network. Kept only when a test fails.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
