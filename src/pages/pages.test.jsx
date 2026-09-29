// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../context/ToastContext.jsx';
import { AuthProvider } from '../context/AuthContext.jsx';
import { DataProvider } from '../context/DataContext.jsx';
import Dashboard from './Dashboard.jsx';
import Settings from './Settings.jsx';
import Admission from './Admission.jsx';
import Toaster from '../components/Toaster.jsx';
import { startSession, clearSession } from '../services/authService.js';
import { resetStorageCache } from '../services/localStore.js';
import { resetSettings, DEFAULT_SETTINGS } from '../services/settingsService.js';
import { clearAllCustomers } from '../services/customerService.js';
import { KEYS } from '../services/localStore.js';
import { dayjs } from '../utils/dateLogic.js';

/**
 * End-to-end-ish tests through the real components and the real service layer.
 * The point is to prove the wiring works: seeding, colour coding, the payment
 * roll-forward and the admission form's disabled-submit rule.
 *
 * Note: the list renders both the mobile cards and the desktop table (CSS
 * decides which is visible), so name queries are scoped to one of them.
 */

const list = async () => within(await screen.findByTestId('customer-cards'));
const table = async () => within(await screen.findByTestId('customer-table'));

function renderApp(ui) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <DataProvider>
            {ui}
            <Toaster />
          </DataProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

beforeEach(async () => {
  resetStorageCache();
  window.localStorage.clear();
  clearSession();
  await clearAllCustomers();
  resetSettings();
  window.localStorage.setItem(KEYS.seeded, 'false');
  startSession(); // skip the PIN gate for these tests
});

describe('Dashboard', () => {
  it('seeds demo tenants and shows all three colour states', async () => {
    renderApp(<Dashboard />);
    const cards = await list();

    expect(cards.getByText('Rahul Sharma')).toBeInTheDocument();
    expect(cards.getByText('Aman Verma')).toBeInTheDocument();
    expect(cards.getByText('Sneha Patil')).toBeInTheDocument();

    // Overdue / due-soon / healthy labels are all present from the seed.
    // Two seeded tenants are already overdue, so match them as a list.
    expect(cards.getAllByText(/Overdue by/).length).toBeGreaterThan(0);
    expect(cards.getByText('Due in 3 days')).toBeInTheDocument();
    expect(cards.getByText('Due in 20 days')).toBeInTheDocument();
    expect(cards.getByText('Due today')).toBeInTheDocument();
  });

  it('applies red, amber and green row tints', async () => {
    const { container } = renderApp(<Dashboard />);
    const cards = await list();

    // Overdue tenant (seeded 6 days ago).
    expect(cards.getByText('Rahul Sharma').closest('.rent-row').className).toContain('rent-overdue');
    // Due in 3 days.
    expect(cards.getByText('Aman Verma').closest('.rent-row').className).toContain('rent-soon');
    // Due in 20 days.
    expect(cards.getByText('Sneha Patil').closest('.rent-row').className).toContain('rent-ok');

    expect(container.querySelectorAll('.rent-row').length).toBeGreaterThanOrEqual(6);
  });

  it('renders a desktop table with the same rows', async () => {
    renderApp(<Dashboard />);
    const rows = await table();
    expect(rows.getByRole('table')).toBeInTheDocument();
    expect(rows.getByText('Rahul Sharma')).toBeInTheDocument();
    expect(rows.getByText('9876543210')).toBeInTheDocument();
  });

  it('shows the summary counts and collected money this month', async () => {
    renderApp(<Dashboard />);
    await list();

    expect(screen.getByText('Total tenants')).toBeInTheDocument();
    expect(screen.getByText('Rent overdue')).toBeInTheDocument();
    expect(screen.getByText('Collected this month')).toBeInTheDocument();
    expect(screen.getByText('Outstanding')).toBeInTheDocument();

    // Seed deposits: Rahul 5,000 + Imran 5,000 + Aman 8,000 + Priya 18,000
    // + Deepak 15,000 rent, plus Deepak's 764 light bill payment.
    expect(screen.getByText('Rs 51,764')).toBeInTheDocument();
  });

  it('filters with the chip row', async () => {
    const user = userEvent.setup();
    renderApp(<Dashboard />);
    const cards = await list();

    await user.click(screen.getByRole('button', { name: /^Overdue/ }));
    expect(cards.getByText('Rahul Sharma')).toBeInTheDocument();
    expect(cards.queryByText('Sneha Patil')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^All/ }));
    expect(cards.getByText('Sneha Patil')).toBeInTheDocument();
  });

  it('searches by name and by mobile', async () => {
    const user = userEvent.setup();
    renderApp(<Dashboard />);
    const cards = await list();

    const search = screen.getByLabelText('Search tenants');
    await user.type(search, 'sneha');
    expect(cards.getByText('Sneha Patil')).toBeInTheDocument();
    expect(cards.queryByText('Rahul Sharma')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, '98765');
    expect(cards.getByText('Rahul Sharma')).toBeInTheDocument();
  });

  it('marks rent as paid and rolls the due date forward a month', async () => {
    const user = userEvent.setup();
    renderApp(<Dashboard />);
    const cards = await list();

    const overdueCard = cards.getByText('Rahul Sharma').closest('.rent-row');
    expect(overdueCard.className).toContain('rent-overdue');
    expect(within(overdueCard).getByText(/Overdue by 6 days/)).toBeInTheDocument();

    await user.click(within(overdueCard).getByRole('button', { name: 'Record' }));

    // Dialog opens pre-filled with the full rent.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Amount received/)).toHaveValue(15000);
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));

    // Toast confirms, and the row is no longer overdue.
    expect(await screen.findByText(/Payment recorded/)).toBeInTheDocument();
    const updatedCard = cards.getByText('Rahul Sharma').closest('.rent-row');
    expect(updatedCard.className).not.toContain('rent-overdue');
    expect(within(updatedCard).getByText('Paid')).toBeInTheDocument();
  });

  it('links the WhatsApp reminder with a prefilled message', async () => {
    renderApp(<Dashboard />);
    const cards = await list();

    const link = cards.getByTitle(/Send rent reminder to Rahul Sharma/);
    expect(link).toHaveAttribute('href', expect.stringContaining('https://wa.me/919876543210?text='));
    // Rahul is overdue with 10,000 still on the open cycle, so the reminder
    // quotes that balance instead of the flat monthly rent.
    expect(decodeURIComponent(link.getAttribute('href'))).toContain('balance of ₹10,000');
  });
});

describe('Settings', () => {
  it('shows the five default sharing prices', async () => {
    renderApp(<Settings />);
    await waitFor(() => {
      expect(screen.getByLabelText('1 sharing')).toHaveValue(18000);
    });
    expect(screen.getByLabelText('2 sharing')).toHaveValue(15000);
    expect(screen.getByLabelText('3 sharing')).toHaveValue(13000);
    expect(screen.getByLabelText('4 sharing')).toHaveValue(11500);
    expect(screen.getByLabelText('5 sharing')).toHaveValue(10500);
  });

  it('persists a changed price', async () => {
    const user = userEvent.setup();
    renderApp(<Settings />);
    const input = await screen.findByLabelText('2 sharing');

    await user.clear(input);
    await user.type(input, '16000');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));

    expect(await screen.findByText(/Sharing prices saved/)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(KEYS.settings)).sharingPrices['2']).toBe(16000);
  });

  it('saves an edited default deposit and terms text', async () => {
    const user = userEvent.setup();
    renderApp(<Settings />);

    const deposit = await screen.findByLabelText(/Default deposit/);
    await user.clear(deposit);
    await user.type(deposit, '7500');

    const terms = screen.getByLabelText(/Terms & Conditions text/);
    await user.clear(terms);
    await user.type(terms, 'Be nice.');

    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();

    const stored = JSON.parse(window.localStorage.getItem(KEYS.settings));
    expect(stored.defaultDeposit).toBe(7500);
    expect(stored.terms).toBe('Be nice.');
  });

  it('restores the default terms text', async () => {
    const user = userEvent.setup();
    renderApp(<Settings />);
    const terms = await screen.findByLabelText(/Terms & Conditions text/);

    await user.clear(terms);
    await user.type(terms, 'short');
    await user.click(screen.getByRole('button', { name: 'Reset to default text' }));

    expect(screen.getByLabelText(/Terms & Conditions text/)).toHaveValue(DEFAULT_SETTINGS.terms);
  });
});

describe('Admission form', () => {
  async function fillRequiredFields(user, overrides = {}) {
    const values = {
      name: 'Test Person',
      mobile: '9876543210',
      proofId: '432198765432',
      ...overrides,
    };

    await user.type(screen.getByLabelText(/Full name/), values.name);
    await user.type(screen.getByLabelText(/Mobile number/), values.mobile);
    await user.type(screen.getByLabelText(/Proof ID number/), values.proofId);
    return values;
  }

  it('keeps submit disabled until every required field is filled', async () => {
    const user = userEvent.setup();
    renderApp(<Admission />);

    const submit = await screen.findByRole('button', { name: /Complete admission/ });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/Full name/), 'Test Person');
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/Mobile number/), '9876543210');
    expect(submit).toBeDisabled(); // proof + terms still missing

    await user.type(screen.getByLabelText(/Proof ID number/), '432198765432');
    expect(submit).toBeDisabled(); // terms not accepted yet

    await user.click(screen.getByLabelText(/I have read and agree/));
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it('rejects an invalid mobile number', async () => {
    const user = userEvent.setup();
    renderApp(<Admission />);

    await user.type(await screen.findByLabelText(/Mobile number/), '12345');
    expect(await screen.findByText('Enter a valid 10-digit mobile number')).toBeInTheDocument();
  });

  it('rejects a bad Aadhaar and accepts a valid one', async () => {
    const user = userEvent.setup();
    renderApp(<Admission />);

    const proof = await screen.findByLabelText(/Proof ID number/);
    await user.type(proof, '12345');
    expect(await screen.findByText('Aadhaar number must be exactly 12 digits')).toBeInTheDocument();

    await user.clear(proof);
    await user.type(proof, '432198765432');
    await waitFor(() => expect(screen.queryByText(/Aadhaar number must/)).not.toBeInTheDocument());
  });

  it('switches proof validation to the PAN format', async () => {
    const user = userEvent.setup();
    renderApp(<Admission />);

    await user.selectOptions(await screen.findByLabelText(/Proof type/), 'PAN');
    const proof = screen.getByLabelText(/Proof ID number/);
    await user.type(proof, '1234567890');
    expect(await screen.findByText('PAN must match the format ABCDE1234F')).toBeInTheDocument();

    await user.clear(proof);
    await user.type(proof, 'abcde1234f'); // sanitised to upper case
    await waitFor(() => expect(screen.queryByText(/PAN must match/)).not.toBeInTheDocument());
  });

  it('auto-fills rent from the sharing type and previews the first due date', async () => {
    const user = userEvent.setup();
    renderApp(<Admission />);

    await waitFor(() => expect(screen.getByLabelText(/Monthly rent/)).toHaveValue(13000));

    await user.selectOptions(screen.getByLabelText(/Sharing type/), '1');
    await waitFor(() => expect(screen.getByLabelText(/Monthly rent/)).toHaveValue(18000));

    await user.selectOptions(screen.getByLabelText(/Sharing type/), '5');
    await waitFor(() => expect(screen.getByLabelText(/Monthly rent/)).toHaveValue(10500));

    // Joining date defaults to today, so the first due date is one month out.
    // The preview appears both under the field and in the sticky submit bar.
    expect(screen.getByLabelText(/Joining date/)).toHaveValue(dayjs().format('YYYY-MM-DD'));
    const expected = dayjs().add(1, 'month').format('DD MMM YYYY');
    const previews = screen.getAllByText(/First rent due/);
    expect(previews.some((node) => node.textContent.includes(expected))).toBe(true);
  });

  it('keeps a manually overridden rent when the sharing type changes', async () => {
    const user = userEvent.setup();
    renderApp(<Admission />);

    const rent = await screen.findByLabelText(/Monthly rent/);
    await user.clear(rent);
    await user.type(rent, '9999');

    await user.selectOptions(screen.getByLabelText(/Sharing type/), '2');
    await waitFor(() => expect(screen.getByLabelText(/Monthly rent/)).toHaveValue(9999));
  });

  it('submits and computes the due date one month after joining', async () => {
    const user = userEvent.setup();
    renderApp(<Admission />);

    await fillRequiredFields(user);
    await user.click(screen.getByLabelText(/I have read and agree/));

    const joinDate = dayjs().subtract(2, 'month').date(15).format('YYYY-MM-DD');
    await user.clear(screen.getByLabelText(/Joining date/));
    await user.type(screen.getByLabelText(/Joining date/), joinDate);

    await user.click(screen.getByRole('button', { name: /Complete admission/ }));

    expect(await screen.findByText(/Test Person admitted/)).toBeInTheDocument();

    const stored = JSON.parse(window.localStorage.getItem(KEYS.customers));
    const created = stored.find((c) => c.name === 'Test Person');
    expect(created.nextDueDate).toBe(dayjs().subtract(1, 'month').date(15).format('YYYY-MM-DD'));
    expect(created.dueDay).toBe(15);
    expect(created.termsAccepted).toBe(true);
    expect(created.code).toMatch(/^PG-\d{4}$/);
  });

  it('clamps a 31st joining date to the shorter month', async () => {
    const user = userEvent.setup();
    renderApp(<Admission />);

    await fillRequiredFields(user);
    await user.click(screen.getByLabelText(/I have read and agree/));

    const joinDate = dayjs().subtract(1, 'month').date(31).format('YYYY-MM-DD');
    const joinInput = screen.getByLabelText(/Joining date/);
    await user.clear(joinInput);
    await user.type(joinInput, joinDate);

    await user.click(screen.getByRole('button', { name: /Complete admission/ }));
    await screen.findByText(/Test Person admitted/);

    const stored = JSON.parse(window.localStorage.getItem(KEYS.customers));
    const created = stored.find((c) => c.name === 'Test Person');
    // The 31st must clamp to the last day of whatever month we land in,
    // never spill over into the next month.
    const due = dayjs(created.nextDueDate);
    const anchor = dayjs(created.joiningDate).date();
    expect(anchor).toBe(31);
    expect(due.date()).toBe(Math.min(anchor, due.daysInMonth()));
    expect(due.format('YYYY-MM')).toBe(dayjs(created.joiningDate).add(1, 'month').format('YYYY-MM'));
  });
});
