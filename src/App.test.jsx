// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

vi.mock('./services/supabase.js', async () => await import('./test/supabaseFake.js'));

import App from './App.jsx';
import { startSession, clearSession } from './services/authService.js';
import { resetDatabase } from './test/supabaseFake.js';
import { seedSampleData } from './services/seedService.js';

/**
 * Smoke tests for the whole app: router, auth gate, layout and the lazily loaded
 * routes, all mounted through the real `App` rather than individual pages.
 *
 * The Supabase data layer is swapped for the in-memory fake, and each test seeds
 * whatever records it needs - the app itself no longer seeds demo data.
 */

const goto = (path) => window.history.pushState({}, '', path);

beforeEach(async () => {
  resetDatabase();
  window.localStorage.clear();
  clearSession();
  goto('/');
});

afterEach(() => {
  cleanup();
});

describe('App', () => {
  it('sends an unauthenticated visitor to the sign-in screen', async () => {
    render(<App />);

    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
  });

  it('lets a new user create an account and get in', async () => {
    const user = userEvent.setup();
    render(<App />);

    const email = await screen.findByLabelText('Email');
    await user.type(email, 'owner@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter2pass');
    await user.click(screen.getByRole('button', { name: /sign in|create account/i }));

    expect(await screen.findByRole('heading', { name: 'Dashboard' }, { timeout: 3000 })).toBeInTheDocument();
  });

  it('renders the dashboard shell for a signed-in user', async () => {
    startSession();
    await seedSampleData();
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    // Desktop sidebar and mobile bottom bar are both landmarks, CSS picks one.
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Summary')).toBeInTheDocument();
    // The seeded tenants show up, so the layout and data layer are wired together.
    // Both the mobile cards and the desktop table are in the DOM.
    expect((await screen.findAllByText('Rahul Sharma')).length).toBeGreaterThan(0);
  });

  it('shows an empty state for an account with no tenants', async () => {
    startSession();
    render(<App />);

    expect(await screen.findByText('No tenants yet')).toBeInTheDocument();
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
    expect(screen.getByText('Backup & restore')).toBeInTheDocument();
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