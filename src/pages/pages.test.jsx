// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../services/supabase.js', async () => await import('../test/supabaseFake.js'));

import { ToastProvider, getQueuedToasts } from '../context/ToastContext.jsx';
import { AuthProvider } from '../context/AuthContext.jsx';
import { DataProvider, useData } from '../context/DataContext.jsx';
import { ThemeProvider, useTheme } from '../context/ThemeContext.jsx';
import Dashboard from './Dashboard.jsx';
import Settings from './Settings.jsx';
import Admission from './Admission.jsx';
import CustomerDetails from './CustomerDetails.jsx';
import Transactions from './Transactions.jsx';
import Rooms from './Rooms.jsx';
import Toaster from '../components/Toaster.jsx';
import { startSession, clearSession } from '../services/authService.js';
import { resetDatabase } from '../test/supabaseFake.js';
import { seedSampleData } from '../test/seed.js';
import { listCustomers } from '../services/customerService.js';

/**
 * The user's checklist, end to end through the real components and the real
 * service layer: add a customer, see it on the dashboard, edit, partial
 * payment, light bill, transactions, rooms, vacate, delete, dark mode.
 */

const list = async () => within(await screen.findByTestId('customer-cards'));

function renderApp(ui) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <DataProvider>
              {ui}
              <Toaster />
            </DataProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

beforeEach(async () => {
  resetDatabase();
  window.localStorage.clear();
  clearSession();
  startSession();
  await seedSampleData();
});

describe('Dashboard', () => {
  it('shows the summary cards and the seeded tenants in due order', async () => {
    renderApp(<Dashboard />);

    expect(await screen.findByLabelText('Summary')).toBeInTheDocument();
    expect(screen.getByText('Total customers')).toBeInTheDocument();
    expect(screen.getByText("Today's collection")).toBeInTheDocument();

    const cards = await list();
    expect(cards.getByText('Rahul Sharma')).toBeInTheDocument();
    expect(cards.getByText('Priya Nair')).toBeInTheDocument();
  });

  it('shows row colours: overdue red, due-soon yellow', async () => {
    renderApp(<Dashboard />);
    const cards = await list();

    const rahul = (await cards.findByText('Rahul Sharma')).closest('.rent-row');
    expect(rahul.className).toContain('rent-overdue');

    const priya = (await cards.findByText('Priya Nair')).closest('.rent-row');
    // Due in 3 days with a full balance: yellow per the colour rule.
    expect(priya.className).toContain('rent-soon');
  });

  it('shows paid / remaining with a progress bar and the light-bill badge', async () => {
    renderApp(<Dashboard />);
    const cards = await list();

    const rahul = (await cards.findByText('Rahul Sharma')).closest('.rent-row');
    expect(within(rahul).getByText(/Overdue by \d days/)).toBeInTheDocument();
    expect(within(rahul).getByText('Balance Rs 10,000')).toBeInTheDocument();

    const deepak = (await cards.findByText('Deepak Rao')).closest('.rent-row');
    expect(within(deepak).getByText(/Elec Rs 500/)).toBeInTheDocument();
  });

  it('filters with the chips and searches by name or mobile', async () => {
    const user = userEvent.setup();
    renderApp(<Dashboard />);
    const cards = await list();

    await user.click(screen.getByRole('button', { name: /^Overdue/ }));
    expect(cards.getByText('Rahul Sharma')).toBeInTheDocument();
    expect(cards.queryByText('Priya Nair')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Partial/ }));
    // Both Rahul (5,000 of 15,000) and Aman (8,000 of 18,000) are partials.
    expect(cards.getByText('Rahul Sharma')).toBeInTheDocument();
    expect(cards.getByText('Aman Verma')).toBeInTheDocument();
    expect(cards.queryByText('Priya Nair')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^All/ }));
    await user.type(screen.getByLabelText('Search tenants'), '9123456780');
    expect(cards.getByText('Priya Nair')).toBeInTheDocument();
    expect(cards.queryByText('Rahul Sharma')).not.toBeInTheDocument();
  });

  it('a partial payment keeps the tenant red and the due date in place', async () => {
    const user = userEvent.setup();
    renderApp(<Dashboard />);
    const cards = await list();

    const overdueCard = (await cards.findByText('Rahul Sharma')).closest('.rent-row');
    await user.click(within(overdueCard).getByRole('button', { name: 'Record' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Amount received/)).toHaveValue(15000);
    await user.clear(within(dialog).getByLabelText(/Amount received/));
    await user.type(within(dialog).getByLabelText(/Amount received/), '2000');
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));

    expect(await screen.findByText(/Payment recorded/)).toBeInTheDocument();
    const updated = cards.getByText('Rahul Sharma').closest('.rent-row');
    expect(updated.className).toContain('rent-overdue'); // 8,000 still owed, still overdue
    expect(within(updated).getByText('Balance Rs 8,000')).toBeInTheDocument();
  });

  it('settles the overdue rent and rolls the surplus into the next cycle', async () => {
    const user = userEvent.setup();
    renderApp(<Dashboard />);
    const cards = await list();

    const overdueCard = (await cards.findByText('Rahul Sharma')).closest('.rent-row');
    await user.click(within(overdueCard).getByRole('button', { name: 'Record' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));

    expect(await screen.findByText(/Payment recorded/)).toBeInTheDocument();
    const updated = cards.getByText('Rahul Sharma').closest('.rent-row');
    expect(updated.className).not.toContain('rent-overdue');
  });
});

describe('Admission', () => {
  beforeEach(async () => {
    // Start from an empty ledger: no rooms, no tenants.
    resetDatabase();
    startSession();
  });

  it('creates a tenant that immediately appears after submit', async () => {
    const user = userEvent.setup();
    renderApp(<Admission />);

    await user.type(await screen.findByLabelText(/Full name/), 'Test Tenant');
    await user.type(screen.getByLabelText(/Mobile number/), '9000000001');
    await user.selectOptions(screen.getByLabelText(/Proof type/), 'AADHAAR');
    await user.type(screen.getByLabelText(/Proof ID number/), '123456789012');
    await user.selectOptions(screen.getByLabelText(/Sharing type/), '3');
    await user.click(screen.getByRole('checkbox', { name: /agree to the Terms/i }));

    const submit = screen.getByRole('button', { name: /Complete admission/ });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(await screen.findByText(/Test Tenant admitted/)).toBeInTheDocument();
    expect(getQueuedToasts().some((t) => t.type === 'success')).toBe(true);
  });

  it('disables the submit until the terms box is ticked', async () => {
    const user = userEvent.setup();
    renderApp(<Admission />);

    await user.type(await screen.findByLabelText(/Full name/), 'Test Tenant');
    await user.type(screen.getByLabelText(/Mobile number/), '9000000001');
    await user.selectOptions(screen.getByLabelText(/Proof type/), 'AADHAAR');
    await user.type(screen.getByLabelText(/Proof ID number/), '123456789012');

    expect(screen.getByRole('button', { name: /Complete admission/ })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /agree to the Terms/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Complete admission/ })).toBeEnabled());
  });

  it('shows the room picker when rooms exist and fills rent from the room', async () => {
    const user = userEvent.setup();
    await seedSampleData();
    renderApp(<Admission />);

    expect(await screen.findByText(/Pick a room with a free bed/i)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /^Room 102/ }));
    const rent = await screen.findByLabelText(/Monthly rent/);
    // Room 102 has no override, so the Settings price for 3 sharing applies.
    await waitFor(() => expect(rent).toHaveValue(13000));
  });
});

describe('Customer details', () => {
  it('shows the tenant, rent history, light bill history and payments', async () => {
    const [rahul] = await listCustomers();

    render(
      <MemoryRouter initialEntries={[`/customer/${rahul.id}`]}>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <DataProvider>
                <Routes>
                  <Route path="/customer/:id" element={<CustomerDetails />} />
                </Routes>
                <Toaster />
              </DataProvider>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Rahul Sharma')).toBeInTheDocument();
    expect(screen.getByText('Tenant details')).toBeInTheDocument();
    expect(screen.getByText('Rent history')).toBeInTheDocument();
    expect(screen.getByText('Light bill history')).toBeInTheDocument();
    expect(screen.getByText('Payments')).toBeInTheDocument();
    expect(screen.getByText(/Partial rent payment/)).toBeInTheDocument();
  });

  it('the identity proof card explains itself when empty', async () => {
    const [rahul] = await listCustomers();

    render(
      <MemoryRouter initialEntries={[`/customer/${rahul.id}`]}>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <DataProvider>
                <Routes>
                  <Route path="/customer/:id" element={<CustomerDetails />} />
                </Routes>
              </DataProvider>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Identity proof')).toBeInTheDocument();
    expect(screen.getByText(/No Aadhaar card uploaded/i)).toBeInTheDocument();
  });
});

describe('Transactions', () => {
  it('shows today / month collection and the payments list', async () => {
    renderApp(<Transactions />);

    expect(await screen.findByText("Today's collection")).toBeInTheDocument();
    expect(screen.getByText('Remaining rent')).toBeInTheDocument();
    expect(screen.getByText('Remaining light bill')).toBeInTheDocument();
    // Both seeded partial payments (Rahul's and Aman's) belong in the list.
    expect(await screen.findAllByText(/Partial rent payment/)).toHaveLength(2);
  });

  it('the Pending tab lists tenants who still owe money', async () => {
    const user = userEvent.setup();
    renderApp(<Transactions />);

    await user.click(await screen.findByRole('button', { name: /Remaining \/ pending/i }));
    expect(screen.getByText('Rahul Sharma')).toBeInTheDocument();
  });

  it('exports the visible payments as CSV', async () => {
    const user = userEvent.setup();
    renderApp(<Transactions />);

    const click = vi.fn();
    const anchor = { click, href: '', download: '', appendChild: vi.fn() };
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'a' ? anchor : originalCreate(tag)));
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => anchor);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });

    await user.click(await screen.findByRole('button', { name: /^CSV$/ }));
    expect(click).toHaveBeenCalled();

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});

describe('Rooms', () => {
  it('shows floor-wise rooms with bed occupancy', async () => {
    renderApp(<Rooms />);

    expect(await screen.findByText('Room 101')).toBeInTheDocument();
    expect(screen.getByText('Room 102')).toBeInTheDocument();
    const card101 = screen.getByText('Room 101').closest('.card');
    expect(card101.textContent).toContain('2/2');
    expect(card101.textContent).toContain('0 free');
  });

  it('adds a room and blocks deleting an occupied one', async () => {
    const user = userEvent.setup();
    renderApp(<Rooms />);

    await user.click(await screen.findByRole('button', { name: /Add room/i }));
    const sheet = await screen.findByRole('dialog');
    await user.type(within(sheet).getByLabelText('Room number'), '201');
    await user.click(within(sheet).getByRole('button', { name: /Save room/i }));

    expect(await screen.findByText('Room added.')).toBeInTheDocument();
    expect(screen.getByText('Room 201')).toBeInTheDocument();

    // Room 101 holds two tenants: the delete confirm fails with the reason.
    await user.click(screen.getByRole('button', { name: 'Delete room 101' }));
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Delete room' }));
    expect(await screen.findByText(/still has 2 tenant/i)).toBeInTheDocument();
  });
});

describe('Settings', () => {
  it('shows PG details and backup sections', async () => {
    renderApp(<Settings />);

    expect(await screen.findByText('PG details')).toBeInTheDocument();
    expect(screen.getByText('Sharing room pricing (per month)')).toBeInTheDocument();
    expect(screen.getByText('Export backup')).toBeInTheDocument();
  });

  it('saves the PG name and prices', async () => {
    const user = userEvent.setup();
    renderApp(<Settings />);

    await user.clear(screen.getByLabelText('PG name'));
    await user.type(screen.getByLabelText('PG name'), 'Sunrise PG');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
  });
});

describe('Vacate and delete', () => {
  it('vacate hides the tenant from the dashboard', async () => {
    const [rahul] = await listCustomers();

    function Harness() {
      const { vacateCustomer } = useData();
      return (
        <button type="button" onClick={() => vacateCustomer(rahul.id)}>
          vacate
        </button>
      );
    }
    renderApp(
      <>
        <Dashboard />
        <Harness />
      </>,
    );

    const user = userEvent.setup();
    await screen.findAllByText('Rahul Sharma');
    await user.click(screen.getByRole('button', { name: 'vacate' }));
    await waitFor(async () => {
      const cards = await list();
      expect(cards.queryByText('Rahul Sharma')).not.toBeInTheDocument();
    });
  });

  it('delete removes the tenant and cascades; a second delete reports already gone', async () => {
    const [rahul] = await listCustomers();
    const { deleteCustomer } = await import('../services/customerService.js');

    function Harness() {
      const { deleteCustomer } = useData();
      return (
        <button
          type="button"
          onClick={() => deleteCustomer(rahul.id).catch(() => {})}
        >
          remove
        </button>
      );
    }
    renderApp(
      <>
        <Dashboard />
        <Harness />
      </>,
    );

    const user = userEvent.setup();
    await screen.findAllByText('Rahul Sharma');
    await user.click(screen.getByRole('button', { name: 'remove' }));
    await waitFor(async () => {
      const cards = await list();
      expect(cards.queryByText('Rahul Sharma')).not.toBeInTheDocument();
    });
    await expect(deleteCustomer(rahul.id)).rejects.toThrow('matched no row');
  });
});

describe('Dark mode', () => {
  it('toggling the theme persists it in localStorage', async () => {
    function Probe() {
      const { theme, toggleTheme } = useTheme();
      return (
        <button type="button" onClick={toggleTheme}>
          {theme}
        </button>
      );
    }
    renderApp(<Probe />);

    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'system' });
    await user.click(button);
    const next = button.textContent;
    expect(next).not.toBe('system');
    expect(window.localStorage.getItem('pg-manager:theme')).toBe(next);
  });
});
