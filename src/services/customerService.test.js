import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./supabase.js', async () => await import('../test/supabaseFake.js'));

import { resetDatabase } from '../test/supabaseFake.js';
import { startSession } from './authService.js';
import {
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
  deleteCustomer,
  vacateCustomer,
  sortByDueDate,
} from './customerService.js';
import { listCycles, getOpenCycle } from './cycleService.js';
import { dayjs } from '../utils/dateLogic.js';

beforeEach(async () => {
  resetDatabase();
  startSession();
});

describe('customers', () => {
  it('creates a customer with a database-generated uuid id', async () => {
    const created = await createCustomer({ name: 'Rahul Sharma', mobile: '9876543210', joiningDate: '2026-01-10' });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.name).toBe('Rahul Sharma');
    expect(created.status).toBe('active');
    expect(await getCustomer(created.id)).not.toBeNull();
  });

  it('admission also opens the first rent cycle, one month after joining', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2026-01-31', rentAmount: 13000 });
    const cycles = await listCycles();
    expect(cycles).toHaveLength(1);
    expect(cycles[0].customerId).toBe(created.id);
    expect(cycles[0].dueDate).toBe('2026-02-28'); // month-end clamp
    expect(cycles[0].paidAmount).toBe(0);
    expect(created.nextDueDate).toBe('2026-02-28');
  });

  it('refuses a blank name', async () => {
    await expect(createCustomer({ name: '   ' })).rejects.toThrow('name is required');
  });

  it('edits a customer and normalises the numeric fields', async () => {
    const created = await createCustomer({ name: 'A', rentAmount: 10000 });
    const updated = await updateCustomer(created.id, { rentAmount: '12000', name: 'A2' });
    expect(updated.name).toBe('A2');
    expect(updated.rentAmount).toBe(12000);
  });

  it('deleting a customer whose row is gone surfaces the real error', async () => {
    const created = await createCustomer({ name: 'A' });
    expect(await deleteCustomer(created.id)).toBe(true);
    expect(await listCustomers()).toHaveLength(0);
    await expect(deleteCustomer(created.id)).rejects.toThrow('matched no row');
  });

  it('deleting a customer cascades to their cycles', async () => {
    const created = await createCustomer({ name: 'A', rentAmount: 9000 });
    await deleteCustomer(created.id);
    expect(await listCycles()).toHaveLength(0);
  });

  it('vacate marks the tenant and the date, without deleting anything', async () => {
    const created = await createCustomer({ name: 'A' });
    const vacated = await vacateCustomer(created.id, '2026-03-01');
    expect(vacated.status).toBe('vacated');
    expect(vacated.vacatedOn).toBe('2026-03-01');
    expect(await getCustomer(created.id)).not.toBeNull();
  });

  it('vacated tenants are hidden from the dashboard sort', async () => {
    const a = await createCustomer({ name: 'Zed', joiningDate: '2026-01-05' });
    await createCustomer({ name: 'Amy', joiningDate: '2026-01-05' });
    await vacateCustomer(a.id);
    const sorted = sortByDueDate(await listCustomers(), dayjs());
    expect(sorted.map((c) => c.name)).toEqual(['Amy']);
  });

  it('the open cycle is the newest one', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2026-01-10', rentAmount: 10000 });
    // Settling in full rolls the cycle forward one month.
    const { recordRentPayment } = await import('./transactionService.js');
    await recordRentPayment({ customerId: created.id, amount: 10000, date: '2026-02-08' });
    const open = await getOpenCycle(created.id);
    expect(open.dueDate).toBe('2026-03-10');
  });
});
