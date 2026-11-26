import { defineConfig, devices } from '@playwright/test'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import 'dotenv/config'

// Keep browser fixtures and the Next server on the same explicit test database.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const port = Number(process.env.PLAYWRIGHT_PORT || 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Playwright port')
const baseURL = `http://localhost:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium' },
    },
  ],
  webServer: {
    command: `npm run ${process.env.PLAYWRIGHT_PRODUCTION ? 'start' : 'dev'} -- --port ${port}`,
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL || '' },
    timeout: 180000,
    reuseExistingServer: false,
    url: baseURL,
  },
})
