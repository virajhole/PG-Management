import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./supabase.js', async () => await import('../test/supabaseFake.js'));

import { resetDatabase, db } from '../test/supabaseFake.js';
import { startSession } from './authService.js';
import { createCustomer, getCustomer } from './customerService.js';
import { listCycles, getOpenCycle } from './cycleService.js';
import { listLightBills, saveLightBill } from './lightBillService.js';
import { recordRentPayment, recordLightBillPayment, deleteTransaction, listTransactions } from './transactionService.js';

beforeEach(async () => {
  resetDatabase();
  startSession();
});

describe('rent payments', () => {
  it('a partial payment reduces the balance and keeps the due date', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2026-01-10', rentAmount: 13000 });
    await recordRentPayment({ customerId: created.id, amount: 5000, date: '2026-01-12', mode: 'cash' });

    const cycle = await getOpenCycle(created.id);
    expect(cycle.paidAmount).toBe(5000);
    expect(cycle.dueDate).toBe('2026-02-10'); // unchanged by a partial payment
    expect((await listTransactions()).length).toBe(1);
  });

  it('a full payment settles the cycle and opens the next month', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2026-01-10', rentAmount: 13000 });
    await recordRentPayment({ customerId: created.id, amount: 13000, date: '2026-02-08', mode: 'upi' });

    const cycles = await listCycles();
    expect(cycles).toHaveLength(2);
    const settled = cycles.find((c) => c.dueDate === '2026-02-10');
    const next = cycles.find((c) => c.dueDate === '2026-03-10');
    expect(settled.paidAmount).toBe(13000);
    expect(next.paidAmount).toBe(0);

    const customer = await getCustomer(created.id);
    expect(customer.nextDueDate).toBe('2026-03-10');
    expect(customer.advanceCredit).toBe(0);
  });

  it('an overpayment settles the cycle, pays into the next one and holds the rest as credit', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2026-01-10', rentAmount: 13000 });
    // 8,000 still owed after a partial; pay 30,000 -> 8,000 settles,
    // 13,000 covers next month in full, 9,000 stays as advance credit.
    await recordRentPayment({ customerId: created.id, amount: 5000, date: '2026-01-12' });
    await recordRentPayment({ customerId: created.id, amount: 30000, date: '2026-02-01' });

    const customer = await getCustomer(created.id);
    expect(customer.nextDueDate).toBe('2026-03-10');
    expect(customer.advanceCredit).toBe(9000);

    const next = await getOpenCycle(created.id);
    expect(next.paidAmount).toBe(13000);
    expect(next.rentAmount).toBe(13000);
  });

  it('refuses zero and negative amounts', async () => {
    const created = await createCustomer({ name: 'A', rentAmount: 13000 });
    await expect(recordRentPayment({ customerId: created.id, amount: 0 })).rejects.toThrow('greater than zero');
    await expect(recordRentPayment({ customerId: created.id, amount: -5 })).rejects.toThrow('greater than zero');
  });

  it('refuses payments for a tenant that does not exist', async () => {
    await expect(recordRentPayment({ customerId: 'nope', amount: 100 })).rejects.toThrow('Customer not found.');
  });
});

describe('deleting a payment recalculates the balances', () => {
  it('a deleted partial payment returns the cycle to its previous state', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2026-01-10', rentAmount: 13000 });
    const { transactionId } = await recordRentPayment({ customerId: created.id, amount: 5000, date: '2026-01-12' });

    await deleteTransaction(transactionId);

    const cycle = await getOpenCycle(created.id);
    expect(cycle.paidAmount).toBe(0);
    expect(cycle.dueDate).toBe('2026-02-10');
    expect((await listTransactions()).length).toBe(0);
  });

  it('deleting the settling payment withdraws the auto-created next cycle', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2026-01-10', rentAmount: 13000 });
    const { transactionId } = await recordRentPayment({ customerId: created.id, amount: 13000, date: '2026-02-08' });
    expect((await listCycles()).length).toBe(2);

    await deleteTransaction(transactionId);

    expect(await listCycles()).toHaveLength(1); // the roll-forward cycle is gone
    const cycle = await getOpenCycle(created.id);
    expect(cycle.paidAmount).toBe(0);
    expect(cycle.dueDate).toBe('2026-02-10');
    expect((await getCustomer(created.id)).nextDueDate).toBe('2026-02-10');
  });

  it('deleting an overpayment restores the surplus, not the carried advance', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2026-01-10', rentAmount: 13000 });
    await recordRentPayment({ customerId: created.id, amount: 5000, date: '2026-01-12' });
    const { transactionId } = await recordRentPayment({ customerId: created.id, amount: 30000, date: '2026-02-01' });

    await deleteTransaction(transactionId);

    // The first 5,000 partial payment stands on its own; the deleted payment's
    // surplus must not survive as credit.
    const cycle = await getOpenCycle(created.id);
    expect(cycle.paidAmount).toBe(5000);
    expect((await getCustomer(created.id)).advanceCredit).toBe(0);
    expect(await listCycles()).toHaveLength(1);
  });

  it('deleting an unknown payment is reported, not thrown', async () => {
    await expect(deleteTransaction('nope')).rejects.toThrow('already deleted or not found');
  });
});

describe('light bills', () => {
  it('a bill payment stays on the bill and never touches rent', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2026-01-10', rentAmount: 13000 });
    const bill = await saveLightBill({ customerId: created.id, month: '2026-02', billAmount: 700 });
    await recordLightBillPayment({ customerId: created.id, billId: bill.id, amount: 300, date: '2026-02-05' });

    const [saved] = await listLightBills();
    expect(saved.paidAmount).toBe(300);
    expect((await getOpenCycle(created.id)).paidAmount).toBe(0); // rent untouched

    const [tx] = await listTransactions();
    expect(tx.type).toBe('LIGHT_BILL');
    expect(tx.refId).toBe(bill.id);
  });

  it('a bill overpayment becomes advance credit, not rent', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2026-01-10', rentAmount: 13000 });
    const bill = await saveLightBill({ customerId: created.id, month: '2026-02', billAmount: 700 });
    await recordLightBillPayment({ customerId: created.id, billId: bill.id, amount: 900 });

    expect((await listLightBills())[0].paidAmount).toBe(700);
    expect((await getCustomer(created.id)).advanceCredit).toBe(200);
  });

  it('deleting a bill payment recalculates the bill', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2026-01-10', rentAmount: 13000 });
    const bill = await saveLightBill({ customerId: created.id, month: '2026-02', billAmount: 700 });
    const { transactionId } = await recordLightBillPayment({ customerId: created.id, billId: bill.id, amount: 300 });

    await deleteTransaction(transactionId);
    expect((await listLightBills())[0].paidAmount).toBe(0);
  });

  it('deleting a customer cascades to bills and transactions', async () => {
    const created = await createCustomer({ name: 'A', joiningDate: '2026-01-10', rentAmount: 13000 });
    const bill = await saveLightBill({ customerId: created.id, month: '2026-02', billAmount: 700 });
    await recordLightBillPayment({ customerId: created.id, billId: bill.id, amount: 300 });
    expect(db.transactions.length).toBe(1);

    const { deleteCustomer } = await import('./customerService.js');
    await deleteCustomer(created.id);

    expect(db.customers.length).toBe(0);
    expect(db.rent_cycles.length).toBe(0);
    expect(db.light_bills.length).toBe(0);
    expect(db.transactions.length).toBe(0);
  });
});
