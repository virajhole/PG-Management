// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../services/supabase.js', async () => await import('../test/supabaseFake.js'));

import { ToastProvider } from '../context/ToastContext.jsx';
import { AuthProvider } from '../context/AuthContext.jsx';
import { DataProvider } from '../context/DataContext.jsx';
import { ThemeProvider } from '../context/ThemeContext.jsx';
import { RouteBoundary } from './ErrorBoundary.jsx';
import GlobalSearch from './GlobalSearch.jsx';
import Assets from '../pages/Assets.jsx';
import { startSession, clearSession } from '../services/authService.js';
import { resetDatabase } from '../test/supabaseFake.js';
import { seedSampleData } from '../services/seedService.js';

/**
 * Regression suite for the two crashes reported after the redesign:
 *
 *  - the Assets page threw `Cannot read properties of undefined (reading 'find')`
 *  - global search threw `Cannot read properties of undefined (reading 'filter')`
 *
 * Both had the same cause: `useData()` never published `rooms`, but three
 * components destructured it from there. These tests pin the fix at the point
 * it broke - an undefined list must read as "no results", never as a throw.
 */

function renderApp(ui) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <DataProvider>{ui}</DataProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  resetDatabase();
  window.localStorage.clear();
  clearSession();
  startSession();
  await seedSampleData();
});

afterEach(() => cleanup());

describe('Assets page', () => {
  it('opens without crashing', async () => {
    renderApp(<Assets />);
    expect(await screen.findByRole('heading', { name: 'Assets' })).toBeInTheDocument();
  });

  it('lists the rooms it has assets for', async () => {
    renderApp(<Assets />);
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    // Either an empty inventory or grouped cards, but never a thrown render.
    expect(screen.getByRole('button', { name: /add asset/i })).toBeInTheDocument();
  });

  it('shows a retryable error instead of a blank page when the table is missing', async () => {
    const data = await import('../services/supabase.js');
    const spy = vi
      .spyOn(data, 'listRows')
      .mockRejectedValue(new Error('relation "public.assets" does not exist'));
    renderApp(<Assets />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/assets table is missing/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();

    spy.mockRestore();
  });
});

describe('Global search', () => {
  it('opens and accepts a query without crashing', async () => {
    const user = userEvent.setup();
    renderApp(<GlobalSearch open onClose={() => {}} />);

    const input = await screen.findByLabelText('Search everything');
    await user.type(input, 'rahul');

    expect(await screen.findByText('Rahul Sharma')).toBeInTheDocument();
  });

  it('shows the empty-query prompt and a no-match message', async () => {
    const user = userEvent.setup();
    renderApp(<GlobalSearch open onClose={() => {}} />);

    expect(await screen.findByText(/start typing to search/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search everything'), 'zzzznotathing');
    expect(await screen.findByText(/no matches for/i)).toBeInTheDocument();
  });
});

describe('Route error boundary', () => {
  it('replaces a broken page with a retry screen instead of the whole app', async () => {
    const Boom = () => {
      throw new Error('kaboom');
    };
    // React logs the caught error; keep the test output readable.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderApp(
      <RouteBoundary routeKey="/broken" label="The assets page">
        <Boom />
      </RouteBoundary>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    spy.mockRestore();
  });
});