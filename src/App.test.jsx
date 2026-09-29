// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import App from './App.jsx';
import { startSession, clearSession } from './services/authService.js';
import { resetStorageCache, KEYS } from './services/localStore.js';
import { resetSettings } from './services/settingsService.js';
import { clearAllCustomers } from './services/customerService.js';

/**
 * Smoke tests for the whole app: router, auth gate, layout and the lazily loaded
 * routes, all mounted through the real `App` rather than individual pages.
 */

const goto = (path) => window.history.pushState({}, '', path);

beforeEach(async () => {
  resetStorageCache();
  window.localStorage.clear();
  clearSession();
  await clearAllCustomers();
  resetSettings();
  window.localStorage.setItem(KEYS.seeded, 'false');
  goto('/');
});

afterEach(() => {
  cleanup();
});

describe('App', () => {
  it('sends an unauthenticated visitor to the login screen', async () => {
    render(<App />);

    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Enter your PIN' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
  });

  it('lets the first-time user create a PIN and get in', async () => {
    const user = userEvent.setup();
    render(<App />);

    const pin = await screen.findByLabelText('PIN');
    await user.type(pin, '2468');
    await user.click(screen.getByRole('button', { name: /create|set|continue|unlock/i }));

    // The gate lets us through onto the dashboard.
    expect(await screen.findByRole('heading', { name: 'Dashboard' }, { timeout: 3000 })).toBeInTheDocument();
  });

  it('renders the dashboard shell for a signed-in user', async () => {
    startSession();
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    // Desktop sidebar and mobile bottom bar are both landmarks, CSS picks one.
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Summary')).toBeInTheDocument();
    // The seeded tenants show up, so the layout and data layer are wired together.
    // Both the mobile cards and the desktop table are in the DOM.
    expect((await screen.findAllByText('Rahul Sharma')).length).toBeGreaterThan(0);
  });

  it('lazily loads the admission form on its own route', async () => {
    startSession();
    goto('/admission');
    render(<App />);

    expect(await screen.findByLabelText(/Full name/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Complete admission/ })).toBeInTheDocument();
  });

  it('lazily loads the settings screen on its own route', async () => {
    startSession();
    goto('/settings');
    render(<App />);

    expect(await screen.findByText('Sharing room pricing', {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it('shows the 404 screen for an unknown route', async () => {
    startSession();
    goto('/nope');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('keeps the session alive across a remount', async () => {
    startSession();
    const first = render(<App />);
    await screen.findByRole('heading', { name: 'Dashboard' });
    cleanup();

    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument());
    first.unmount();
  });
});
