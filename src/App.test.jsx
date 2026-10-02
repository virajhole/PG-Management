// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

vi.mock('./services/supabase.js', async () => await import('./test/supabaseFake.js'));

import App from './App.jsx';
import { startSession, clearSession } from './services/authService.js';
import { resetDatabase, listAdmins, addAdmin, getSession as getSessionRaw, listRows as listRowsFake, setAdminsTableMissing, TABLES } from './test/supabaseFake.js';
import { seedSampleData } from './services/seedService.js';
import { listCustomers } from './services/customerService.js';

/**
 * Smoke tests for the whole app: router, auth gate, layout and the lazily loaded
 * routes, all mounted through the real `App` rather than individual pages.
 *
 * The Supabase data layer is swapped for the in-memory fake, and each test seeds
 * whatever records it needs - the app itself no longer seeds demo data.
 */

const goto = (path) => window.history.pushState({}, '', path);

const getSessionUser = async () => (await getSessionRaw()).user;
const listTransactions = () => listRowsFake(TABLES.transactions);

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
    // First account on an empty project claims ownership of the allowlist.
    expect(await listAdmins()).toEqual([
      expect.objectContaining({ email: 'owner@example.com', role: 'admin' }),
    ]);
  });

  it('blocks a signed-in Google user who is not on the allowlist', async () => {
    // Someone is already on the team, so this account cannot claim ownership.
    await addAdmin({ email: 'owner@example.com', role: 'admin' });

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /continue with google/i }));
    // Simulate the OAuth redirect: Supabase hands us a session for someone else.
    startSession({
      id: 'fake-stranger',
      email: 'stranger@gmail.com',
      name: 'Stranger',
      avatarUrl: '',
      provider: 'google',
    });

    expect(await screen.findByRole('heading', { name: 'Access denied' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('stranger@gmail.com')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
    // The rejected session is dropped, not left hanging around.
    await waitFor(async () => expect(await getSessionUser()).toBeNull());
  });

  it('explains a missing database instead of blaming the allowlist', async () => {
    // The exact shape of a project that only has migrations 001-002 applied:
    // the admins table does not exist, so *every* sign-in is rejected - owner
    // included. Pointing at Settings -> Team there would be a dead end.
    setAdminsTableMissing(true);

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /continue with google/i }));
    startSession({
      id: 'fake-owner',
      email: 'virajhole7774@gmail.com',
      name: 'Owner',
      avatarUrl: '',
      provider: 'google',
    });

    expect(
      await screen.findByRole('heading', { name: 'Database not set up' }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/repair\.sql/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Access denied' })).not.toBeInTheDocument();

    setAdminsTableMissing(false);
    // With the schema in place the very next sign-in claims ownership.
    await addAdmin({ email: 'virajhole7774@gmail.com', role: 'owner' });
    startSession({
      id: 'fake-owner',
      email: 'virajhole7774@gmail.com',
      name: 'Owner',
      avatarUrl: '',
      provider: 'google',
    });
    expect(await screen.findByRole('heading', { name: 'Dashboard' }, { timeout: 3000 })).toBeInTheDocument();
  });

  it('records a payment from the tenant page', async () => {
    const user = userEvent.setup();
    startSession();
    await seedSampleData();
    const [rahul] = await listCustomers();
    goto(`/customer/${rahul.id}`);
    render(<App />);

    const before = (await listTransactions()).length;
    await user.click(await screen.findByRole('button', { name: /record payment/i }, { timeout: 3000 }));
    await user.click((await screen.findAllByRole('button', { name: /^record payment$/i })).pop());

    await waitFor(async () => expect((await listTransactions()).length).toBe(before + 1));
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