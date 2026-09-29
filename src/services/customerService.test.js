import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeCustomer,
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
  deleteCustomer,
  addPayment,
  removePayment,
  sortByDueDate,
  summarise,
  getCustomerStatus,
  getCustomerStatusLabel,
  isPaidForCurrentCycle,
  getPaidAmountForCurrentCycle,
  getLastPaidThrough,
  clearAllCustomers,
} from './customerService.js';
import { dayjs } from '../utils/dateLogic.js';
import { resetStorageCache } from './localStore.js';

const TODAY = dayjs('2024-05-10');

function makeCustomer(overrides = {}) {
  return normalizeCustomer({
    name: 'Test Tenant',
    mobile: '9876543210',
    joiningDate: '2024-01-10',
    sharingType: 3,
    rentAmount: 13000,
    ...overrides,
  });
}

beforeEach(() => {
  resetStorageCache();
  window.localStorage.clear();
});

describe('normalizeCustomer', () => {
  it('derives the due date and anchor from the joining date', () => {
    const c = makeCustomer({ joiningDate: '2024-01-31' });
    expect(c.dueDay).toBe(31);
    expect(c.nextDueDate).toBe('2024-02-29');
  });

  it('fills in safe defaults for missing fields', () => {
    const c = normalizeCustomer({ name: 'X' });
    expect(c.payments).toEqual([]);
    expect(c.status).toBe('active');
    expect(c.nextDueDate).toBeTruthy();
    expect(c.sharingType).toBe(1);
  });

  it('coerces sharing type and amounts to numbers', () => {
    const c = normalizeCustomer({ sharingType: '4', rentAmount: '11500' });
    expect(c.sharingType).toBe(4);
    expect(c.rentAmount).toBe(11500);
  });
});

describe('create / read / update / delete', () => {
  it('persists a new customer with a generated code', async () => {
    const created = await createCustomer({
      name: 'Rahul Kumar',
      mobile: '9876543210',
      joiningDate: '2024-03-15',
      sharingType: 2,
      rentAmount: 15000,
    });
    expect(created.code).toBe('PG-0001');
    expect(created.nextDueDate).toBe('2024-04-15');

    const all = await listCustomers();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Rahul Kumar');
  });

  it('keeps codes unique across multiple creates', async () => {
    await createCustomer({ name: 'A', joiningDate: '2024-01-05' });
    await createCustomer({ name: 'B', joiningDate: '2024-01-05' });
    const all = await listCustomers();
    expect(all.map((c) => c.code)).toEqual(['PG-0001', 'PG-0002']);
  });

  it('reads a single customer by id', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2024-01-05' });
    const found = await getCustomer(created.id);
    expect(found.name).toBe('A');
    expect(await getCustomer('missing')).toBeNull();
  });

  it('patches a customer without losing payments', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2024-01-10', rentAmount: 13000 });
    await addPayment(created.id, { amount: 13000, date: '2024-02-08', mode: 'cash' });
    const updated = await updateCustomer(created.id, { roomNo: '204' });
    expect(updated.roomNo).toBe('204');
    expect(updated.payments).toHaveLength(1);
    expect(updated.nextDueDate).toBe('2024-03-10'); // payment already rolled it
  });

  it('recomputes the due date when the joining date changes', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2024-01-10' });
    const updated = await updateCustomer(created.id, { joiningDate: '2024-01-31' });
    expect(updated.dueDay).toBe(31);
    expect(updated.nextDueDate).toBe('2024-02-29');
  });

  it('throws when updating or deleting a missing record', async () => {
    await expect(updateCustomer('nope', { name: 'x' })).rejects.toThrow('Customer not found.');
    await expect(deleteCustomer('nope')).rejects.toThrow('Customer not found.');
  });

  it('deletes a customer', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2024-01-05' });
    await deleteCustomer(created.id);
    expect(await listCustomers()).toHaveLength(0);
  });

  it('clears every customer', async () => {
    await createCustomer({ name: 'A', joiningDate: '2024-01-05' });
    await clearAllCustomers();
    expect(await listCustomers()).toEqual([]);
  });
});

describe('addPayment', () => {
  it('records the payment and rolls the due date forward one month', async () => {
    const created = await createCustomer({
      name: 'A',
      joiningDate: '2024-01-10',
      rentAmount: 13000,
    });
    expect(created.nextDueDate).toBe('2024-02-10');

    const { customer, payment } = await addPayment(created.id, {
      amount: 13000,
      date: '2024-02-05',
      mode: 'upi',
    });

    expect(payment.amount).toBe(13000);
    expect(payment.mode).toBe('upi');
    expect(customer.payments).toHaveLength(1);
    expect(customer.nextDueDate).toBe('2024-03-10');
  });

  it('preserves the 31st anchor across a February payment', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2024-01-31' });
    expect(created.nextDueDate).toBe('2024-02-29');
    const { customer } = await addPayment(created.id, { amount: 10500, date: '2024-02-20' });
    expect(customer.nextDueDate).toBe('2024-03-31');
  });

  it('catches up month by month when the tenant is overdue', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2024-01-10' });
    await updateCustomer(created.id, { nextDueDate: '2024-04-10' });
    const { customer } = await addPayment(created.id, { amount: 13000, date: '2024-05-20' });
    expect(customer.nextDueDate).toBe('2024-05-10');
  });

  it('defaults the payment date to today', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2024-01-10' });
    const { payment } = await addPayment(created.id, { amount: 100 });
    expect(payment.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('removes a payment', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2024-01-10' });
    const { payment } = await addPayment(created.id, { amount: 100, date: '2024-02-01' });
    const updated = await removePayment(created.id, payment.id);
    expect(updated.payments).toHaveLength(0);
  });
});

describe('status helpers', () => {
  it('classifies due dates against today', () => {
    expect(getCustomerStatus({ nextDueDate: '2024-05-09' }, TODAY)).toBe('overdue');
    expect(getCustomerStatus({ nextDueDate: '2024-05-13' }, TODAY)).toBe('soon');
    expect(getCustomerStatus({ nextDueDate: '2024-05-20' }, TODAY)).toBe('ok');
  });

  it('formats a human label', () => {
    expect(getCustomerStatusLabel({ nextDueDate: '2024-05-08' }, TODAY)).toBe('Overdue by 2 days');
    expect(getCustomerStatusLabel({ nextDueDate: '2024-05-10' }, TODAY)).toBe('Due today');
  });
});

describe('payment cycle attribution', () => {
  it('marks a tenant paid after paying up to the current due date', async () => {
    const created = await createCustomer({
      name: 'A',
      joiningDate: '2024-03-10',
      rentAmount: 13000,
    });
    // due 10 Apr, paid on 10 Apr -> settles 10 Apr, next due 10 May
    const { payment } = await addPayment(created.id, { amount: 13000, date: '2024-04-10' });
    expect(payment.paidForDueDate).toBe('2024-04-10');

    const updated = await getCustomer(created.id);
    expect(isPaidForCurrentCycle(updated, TODAY)).toBe(true);
  });

  it('counts an early payment as settling the upcoming due date', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2024-03-10', rentAmount: 13000 });
    // tenant pays on 5 Apr for the 10 Apr due date
    await addPayment(created.id, { amount: 13000, date: '2024-04-05' });
    const updated = await getCustomer(created.id);
    expect(updated.nextDueDate).toBe('2024-05-10');
    expect(isPaidForCurrentCycle(updated, dayjs('2024-04-20'))).toBe(true);
  });

  it('is not paid once the next due date lapses again', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2024-01-10', rentAmount: 13000 });
    await addPayment(created.id, { amount: 13000, date: '2024-02-02' });
    const updated = await getCustomer(created.id);
    // settled 10 Feb, next due 10 Mar -> up to date on 5 Mar, chasing rent on 20 Mar
    expect(updated.nextDueDate).toBe('2024-03-10');
    expect(isPaidForCurrentCycle(updated, dayjs('2024-03-05'))).toBe(true);
    expect(isPaidForCurrentCycle(updated, dayjs('2024-03-20'))).toBe(false);
  });

  it('reports not-paid when there are no payments at all', () => {
    const c = makeCustomer({ nextDueDate: '2024-06-10', dueDay: 10 });
    expect(isPaidForCurrentCycle(c, TODAY)).toBe(false);
    expect(getLastPaidThrough(c)).toBeNull();
    expect(getPaidAmountForCurrentCycle(c)).toBe(0);
  });

  it('sums payments against the most recently settled due date', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2024-01-10', rentAmount: 13000 });
    await addPayment(created.id, { amount: 13000, date: '2024-02-05' });
    let updated = await getCustomer(created.id);
    expect(updated.nextDueDate).toBe('2024-03-10');
    expect(getPaidAmountForCurrentCycle(updated)).toBe(13000);

    await addPayment(created.id, { amount: 13500, date: '2024-03-02' });
    updated = await getCustomer(created.id);
    expect(updated.nextDueDate).toBe('2024-04-10');
    expect(getLastPaidThrough(updated)).toBe('2024-03-10');
    // only the payment that settled 10 Mar counts, not the older Feb one
    expect(getPaidAmountForCurrentCycle(updated)).toBe(13500);
  });

  it('exposes the last settled due date', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2024-01-10' });
    await addPayment(created.id, { amount: 100, date: '2024-02-02' });
    await addPayment(created.id, { amount: 100, date: '2024-03-02' });
    const updated = await getCustomer(created.id);
    expect(getLastPaidThrough(updated)).toBe('2024-03-10');
  });
});

describe('sortByDueDate', () => {
  it('orders most-overdue first, then due soon, then healthy - each nearest first', () => {
    const list = [
      { id: 'ok-far', name: 'Z', nextDueDate: '2024-07-20' },
      { id: 'soon-2', name: 'B', nextDueDate: '2024-05-12' },
      { id: 'overdue-5', name: 'C', nextDueDate: '2024-05-05' },
      { id: 'overdue-1', name: 'D', nextDueDate: '2024-05-09' },
      { id: 'soon-5', name: 'A', nextDueDate: '2024-05-15' },
    ];
    expect(sortByDueDate(list, TODAY).map((c) => c.id)).toEqual([
      'overdue-5',
      'overdue-1',
      'soon-2',
      'soon-5',
      'ok-far',
    ]);
  });

  it('breaks ties by name', () => {
    const list = [
      { id: '1', name: 'Zara', nextDueDate: '2024-05-12' },
      { id: '2', name: 'Aman', nextDueDate: '2024-05-12' },
    ];
    expect(sortByDueDate(list, TODAY).map((c) => c.name)).toEqual(['Aman', 'Zara']);
  });

  it('does not mutate the input', () => {
    const list = [
      { id: '1', name: 'A', nextDueDate: '2024-06-01' },
      { id: '2', name: 'B', nextDueDate: '2024-05-01' },
    ];
    const copy = [...list];
    sortByDueDate(list, TODAY);
    expect(list).toEqual(copy);
  });
});

describe('summarise', () => {
  it('totals customers, buckets and expected rent', () => {
    const list = [
      { name: 'A', nextDueDate: '2024-05-05', rentAmount: 13000, status: 'active', payments: [], dueDay: 10 },
      { name: 'B', nextDueDate: '2024-05-13', rentAmount: 15000, status: 'active', payments: [], dueDay: 10 },
      { name: 'C', nextDueDate: '2024-06-10', rentAmount: 10500, status: 'active', payments: [], dueDay: 10 },
      { name: 'D', nextDueDate: '2024-05-01', rentAmount: 18000, status: 'inactive', payments: [], dueDay: 10 },
    ];
    const s = summarise(list, TODAY);
    expect(s.total).toBe(3); // inactive excluded
    expect(s.overdue).toBe(1);
    expect(s.dueSoon).toBe(1);
    expect(s.ok).toBe(1);
    expect(s.expected).toBe(13000 + 15000 + 10500);
  });

  it('handles an empty list', () => {
    const s = summarise([], TODAY);
    expect(s).toMatchObject({ total: 0, overdue: 0, dueSoon: 0, expected: 0, outstanding: 0 });
  });
});
