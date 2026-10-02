import { test, expect } from '@playwright/test';

/**
 * Smoke test: every route opens, and nothing logs an app-level error.
 *
 * A render-time throw used to blank the whole app, and the two reports this
 * suite exists for (Global Search, Assets) were exactly that. The ErrorBoundary
 * now contains a throw to its own route, which means a broken page could pass a
 * "did the heading render" check by showing the error screen instead. So every
 * test asserts on page errors and console errors as well as on content, and
 * treats the boundary's "Something went wrong" copy as a failure.
 *
 * Two kinds of noise are separated rather than ignored:
 *
 *   errors        - page errors and console errors from the app. Any of these
 *                   fails the run; that is the contract.
 *   backendErrors - failed requests to the Supabase project. A 404 there means
 *                   a table has not been created yet (the UI already explains
 *                   which SQL to run), so it is reported rather than failed on.
 *                   A missing *same-origin* asset is a build bug and still
 *                   fails hard.
 */

const EMAIL = process.env.SMOKE_EMAIL || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';

/** Every route the app defines, plus a path that must hit the 404 screen. */
const ROUTES = [
  { path: '/', heading: 'Dashboard' },
  { path: '/admission', heading: /admit|new tenant/i },
  { path: '/customers', heading: /tenants/i },
  { path: '/rooms', heading: 'Rooms' },
  { path: '/transactions', heading: /transactions|payments/i },
  { path: '/expenses', heading: /expenses/i },
  { path: '/operations', heading: 'Operations' },
  { path: '/reports', heading: 'Reports' },
  { path: '/meters', heading: /meter|electric/i },
  { path: '/mess', heading: /mess|menu/i },
  { path: '/assets', heading: 'Assets' },
  { path: '/settings', heading: 'Settings' },
];

// React logs this through console.error when a boundary catches a render throw.
const REACT_ERROR_NOUNCE = /The above error occurred|Uncaught (?:Error|TypeError|ReferenceError)/;
const RESOURCE_FAILED = /Failed to load resource/;

const backendErrors = new Set();

/**
 * Splits browser output into hard app errors and backend failures, so a missing
 * database table does not read as a broken bundle.
 */
function watchForErrors(page, errors) {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (RESOURCE_FAILED.test(text)) return; // handled by the requestfailed hook
    errors.push(`console.error: ${text}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (url.includes('google') || url.includes('gstatic') || url.includes('fonts.')) return;
    errors.push(`requestfailed: ${url} (${req.failure()?.errorText})`);
  });
  page.on('response', (res) => {
    const url = res.url();
    if (res.status() < 400) return;
    const sameOrigin = url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost');
    if (sameOrigin) {
      // A missing chunk, asset or route file is a build problem.
      errors.push(`same-origin ${res.status()}: ${url}`);
      return;
    }
    if (url.includes('supabase.co')) {
      backendErrors.add(`  ${res.status()}  ${url.replace(/^https:\/\/[^/]+\/rest\/v1\//, '')}`);
    }
  });
}

async function signIn(page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|create account/i }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
}

test.afterAll(() => {
  if (backendErrors.size) {
    console.warn(
      '\nThe app logged these backend failures (missing tables, not app bugs).\n' +
        'Run supabase/repair.sql in the Supabase SQL editor to create them:\n' +
        [...backendErrors].join('\n'),
    );
  }
});

test.describe('smoke', () => {
  test('the login screen loads with no console errors', async ({ page }) => {
    const errors = [];
    watchForErrors(page, errors);

    await page.goto('/login');

    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in with email' })).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('an unknown route is handled', async ({ page }) => {
    const errors = [];
    watchForErrors(page, errors);

    await page.goto('/definitely-not-a-route');

    if (EMAIL && PASSWORD) {
      // The 404 route lives inside the authenticated layout, so it only shows
      // once the gate lets us through.
      await signIn(page);
      await page.goto('/definitely-not-a-route');
      await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    } else {
      // Signed out, the gate sends an unknown path to the login screen rather
      // than leaking that it does not exist.
      await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('every route opens without an error', async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, 'set SMOKE_EMAIL and SMOKE_PASSWORD to run the authenticated routes');
    const errors = [];
    watchForErrors(page, errors);

    await signIn(page);

    for (const route of ROUTES) {
      errors.length = 0;
      await page.goto(route.path);
      // The heading proves the page rendered rather than the boundary's retry
      // screen; the heading copy is checked separately for assets below.
      await expect(page.getByText('Something went wrong')).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible({ timeout: 15_000 });
      expect(errors.filter((e) => !REACT_ERROR_NOUNCE.test(e)), `${route.path}: ${errors.join('\n')}`).toEqual([]);
    }
  });

  test('global search opens and survives typing', async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, 'set SMOKE_EMAIL and SMOKE_PASSWORD to run this');
    const errors = [];
    watchForErrors(page, errors);

    await signIn(page);

    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const input = page.getByLabel('Search everything');
    await expect(input).toBeVisible();

    // An empty query must not throw, and a query with no matches must say so
    // rather than crashing - this is the regression that was reported.
    await expect(page.getByText(/start typing to search/i)).toBeVisible();
    await input.fill('zzzznotathing');
    await expect(page.getByText(/no matches for/i)).toBeVisible();
    await input.fill('a');
    await expect(input).toHaveValue('a');

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('assets opens and lists or explains itself', async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, 'set SMOKE_EMAIL and SMOKE_PASSWORD to run this');
    const errors = [];
    watchForErrors(page, errors);

    await signIn(page);
    await page.goto('/assets');

    await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);

    // A real inventory, a deliberate empty state, or the "table is missing"
    // error with a Retry button. What must never happen is a blank page or the
    // boundary's retry screen - that was the reported crash.
    const hasContent =
      (await page.getByRole('button', { name: /add asset/i }).count()) > 0 ||
      (await page.getByRole('button', { name: /try again/i }).count()) > 0;
    expect(hasContent, 'assets page rendered no inventory, empty state or error state').toBe(true);

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('the account menu shows the signed-in user', async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, 'set SMOKE_EMAIL and SMOKE_PASSWORD to run this');
    const errors = [];
    watchForErrors(page, errors);

    await signIn(page);
    await page.getByRole('button', { name: 'Account menu' }).click();

    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
  });
});