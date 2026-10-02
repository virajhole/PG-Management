import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke-test config.
 *
 * Runs against a production build served by `vite preview`, not the dev server,
 * because lazy-route chunking and the service worker only behave the way they
 * ship. Set PW_BASE_URL to point the same suite at a deployed URL.
 *
 *   npm run build && npm run test:e2e
 *
 * The suite needs a signed-in account. Set SMOKE_EMAIL / SMOKE_PASSWORD, or
 * leave both empty and the tests only cover the public /login route (which is
 * still enough to catch a broken bundle or a missing chunk).
 */
// 4173 is the default `npm run preview` port and is often already taken by a
// dev server, so the smoke suite defaults to 4188.
const PORT = Number(process.env.PW_PORT || 4188);
const baseURL = process.env.PW_BASE_URL || `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // A phone viewport: the app is mobile-first and the bottom nav, bottom
    // sheets and swipe list only render there.
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: false,
  },

  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'] } }],

  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: `npm run build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});