// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

vi.mock('./services/supabase.js', async () => await import('./test/supabaseFake.js'));

import App from './App.jsx';
import { startSession, clearSession } from './services/authService.js';
import { resetDatabase } from './test/supabaseFake.js';
import { seedSampleData } from './test/seed.js';

/**
 * Smoke tests for the whole app: router, auth gate and the lazily loaded
 * routes, all mounted through the real `App`.
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
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in with email' })).toBeInTheDocument();
  });

  it('lets a user sign in with email and password', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText('Email'), 'owner@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter2pass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect((await screen.findAllByText(/no tenants yet/i, {}, { timeout: 3000 })).length).toBeGreaterThan(0);
  });

  it('rejects a wrong password', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText('Email'), 'owner@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/invalid login credentials/i)).toBeInTheDocument();
  });

  it('admits any signed-in Google user straight to the dashboard', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /continue with google/i }));
    // Simulate the OAuth redirect: Supabase hands us a session.
    startSession({
      id: 'fake-stranger',
      email: 'stranger@gmail.com',
      name: 'Stranger',
      avatarUrl: '',
      provider: 'google',
    });

    expect(
      await screen.findAllByText(/no tenants yet|Dashboard|Hello/i, {}, { timeout: 3000 }),
    ).not.toHaveLength(0);
  });

  it('renders the dashboard shell for a signed-in user with seeded tenants', async () => {
    startSession();
    await seedSampleData();
    render(<App />);

    expect(await screen.findByLabelText('Summary')).toBeInTheDocument();
    expect((await screen.findAllByText('Rahul Sharma', {}, { timeout: 3000 })).length).toBeGreaterThan(0);
  });

  it('shows an empty state for an account with no tenants', async () => {
    startSession();
    render(<App />);

    expect((await screen.findAllByText(/no tenants yet/i)).length).toBeGreaterThan(0);
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

    expect(await screen.findByText('PG details', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('Export backup')).toBeInTheDocument();
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
    await screen.findAllByText(/no tenants yet/i, {}, { timeout: 3000 });
    cleanup();

    render(<App />);
    await waitFor(() => expect(screen.getAllByText(/no tenants yet|Hello/i).length).toBeGreaterThan(0));
    first.unmount();
  });
});
