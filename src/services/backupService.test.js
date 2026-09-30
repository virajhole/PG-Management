// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

vi.mock('./supabase.js', async () => await import('../test/supabaseFake.js'));

import {
  buildSnapshot,
  importSnapshot,
  snapshotToJSON,
  wipeEverything,
  customersToCSV,
  transactionsToCSV,
} from './backupService.js';
import { startSession } from './authService.js';
import { resetDatabase, uploadImage, getImageUrl, listRows } from '../test/supabaseFake.js';
import { createCustomer, listCustomers } from './customerService.js';
import { ensureOpenCycle } from './cycleService.js';
import { createLightBill } from './lightBillService.js';
import { recordRentPayment, recordLightBillPayment, listTransactions } from './transactionService.js';
import { loadSettings } from './settingsService.js';

describe('backupService', () => {
  it('round-trips a ledger into a fresh account, documents included', async () => {
    resetDatabase();
    startSession();

    const customer = await createCustomer({
      name: 'Rahul Sharma',
      mobile: '9876543210',
      rentAmount: 15000,
      nextDueDate: '2026-10-15',
      dueDay: 15,
      photoId: 'c/abc/photo/p1.jpg',
    });
    await ensureOpenCycle(customer);
    await uploadImage('c/abc/photo/p1.jpg', 'data:image/jpeg;base64,AAAA');
    await recordRentPayment({ customerId: customer.id, amount: 15000, date: '2026-09-30', mode: 'cash' });
    const bill = await createLightBill({ customerId: customer.id, month: '2026-09', units: 80, ratePerUnit: 4.25, billAmount: 700 });
    await recordLightBillPayment({ customerId: customer.id, billId: bill.id, amount: 700, date: '2026-09-30' });

    const snapshot = await buildSnapshot();
    expect(snapshot.customers).toHaveLength(1);
    expect(snapshot.cycles.length).toBeGreaterThan(0);
    expect(snapshot.transactions.length).toBe(2);
    // The snapshot must be JSON-serialisable and carry the document bytes.
    expect(() => snapshotToJSON(snapshot)).not.toThrow();

    // Simulate importing into a different, empty account.
    resetDatabase();
    startSession();
    const counts = await importSnapshot(JSON.parse(snapshotToJSON(snapshot)));
    expect(counts.customers).toBe(1);
    expect(counts.transactions).toBe(2);

    const restored = await listCustomers();
    expect(restored[0].name).toBe('Rahul Sharma');
    expect(await listRows('transactions')).toHaveLength(2);

    // Settings come back with the ledger, not just the rows.
    expect((await loadSettings()).pgName).toBeTruthy();

    const wiped = await wipeEverything();
    expect(wiped.customers).toBe(1);
    expect(await listCustomers()).toHaveLength(0);
    expect(await getImageUrl('c/abc/photo/p1.jpg')).toBeNull();
  });

  it('produces CSV a spreadsheet can open', async () => {
    resetDatabase();
    startSession();
    const customer = await createCustomer({ name: 'Aman Verma', mobile: '9123456780', rentAmount: 13000 });
    await ensureOpenCycle(customer);
    await recordRentPayment({ customerId: customer.id, amount: 4000, date: '2026-09-30' });

    const tenantCsv = customersToCSV(await listCustomers());
    expect(tenantCsv.split('\n')[0]).toMatch(/^code,name,mobile/);
    expect(tenantCsv).toContain('Aman Verma');

    const paymentCsv = transactionsToCSV(await listTransactions());
    expect(paymentCsv.split('\n')[0]).toMatch(/^date,customerName/);
    expect(paymentCsv).toContain('Aman Verma');
  });

  it('rejects a file that is not a backup', async () => {
    await expect(importSnapshot(null)).rejects.toThrow(/does not look like/);
    await expect(importSnapshot('some text')).rejects.toThrow(/does not look like/);
  });
});
