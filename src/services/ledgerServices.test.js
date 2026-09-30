import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./supabase.js', async () => await import('../test/supabaseFake.js'));

import { resetDatabase } from '../test/supabaseFake.js';
import { createCustomer, getCustomer, clearAllCustomers } from './customerService.js';
import { ensureOpenCycle, getOpenCycle, listCycles, listCyclesForCustomer, clearAllCycles } from './cycleService.js';
import { getLightBillForMonth, listLightBills, clearAllLightBills } from './lightBillService.js';
import {
  recordRentPayment,
  recordLightBillPayment,
  saveLightBill,
  previewRentPayment,
  deleteTransaction,
  listTransactions,
  clearAllTransactions,
} from './transactionService.js';
import { runMigration, needsMigration, readBackup } from './migrationService.js';
import { getRemaining, TX_RENT, TX_LIGHT_BILL } from '../utils/ledger.js';
import { dayjs } from '../utils/dateLogic.js';

/**
 * Service-level tests: these drive the real storage layer, so they cover the
 * parts the pure `ledger.test.js` maths cannot - that a partial payment really
 * leaves the due date alone, that settling really opens the next cycle, and that
 * deleting a payment really puts all of it back.
 */

let customer;

async function setupCustomer(overrides = {}) {
  const created = await createCustomer({
    name: 'Rahul Sharma',
    mobile: '9876543210',
    joiningDate: '2024-04-10',
    rentAmount: 11500,
    sharingType: 3,
    ...overrides,
  });
  await ensureOpenCycle(created);
  return created;
}

beforeEach(async () => {
  resetDatabase();
  window.localStorage.clear();
  await clearAllCustomers();
  clearAllCycles();
  clearAllLightBills();
  clearAllTransactions();
  customer = await setupCustomer();
});

describe('open cycle', () => {
  it('is created once and reused', async () => {
    const first = await getOpenCycle(customer.id);
    const again = await ensureOpenCycle(customer);
    expect(again.id).toBe(first.id);
    expect(await listCycles()).toHaveLength(1);
  });

  it('uses the joining-date anchor and the next month', async () => {
    const cycle = await getOpenCycle(customer.id);
    expect(cycle.dueDate).toBe('2024-05-10');
    expect(cycle.rentAmount).toBe(11500);
    expect(cycle.status).toBe('pending');
  });
});

describe('partial rent payment', () => {
  it('records the payment and keeps the due date and cycle', async () => {
    const before = await getOpenCycle(customer.id);
    const { transaction, cycle } = await recordRentPayment({ customerId: customer.id, amount: 5000, date: '2024-05-05' });

    expect(transaction.type).toBe(TX_RENT);
    expect(transaction.cycleId).toBe(before.id);
    expect(transaction.amount).toBe(5000);
    expect(transaction.customerName).toBe('Rahul Sharma');
    expect(cycle.status).toBe('partial');
    expect(cycle.paidAmount).toBe(5000);
    expect(cycle.dueDate).toBe('2024-05-10');
    expect(cycle.remainingAmount).toBe(6500);

    // still the same single open cycle, not advanced
    expect(await listCycles()).toHaveLength(1);
    expect((await getCustomer(customer.id)).nextDueDate).toBe('2024-05-10');
  });

  it('accumulates several part payments on one cycle', async () => {
    await recordRentPayment({ customerId: customer.id, amount: 5000 });
    await recordRentPayment({ customerId: customer.id, amount: 3000 });
    await recordRentPayment({ customerId: customer.id, amount: 1000 });

    const cycle = await getOpenCycle(customer.id);
    expect(cycle.paidAmount).toBe(9000);
    expect(getRemaining(cycle)).toBe(2500);
    expect(cycle.status).toBe('partial');
    expect(await listTransactions()).toHaveLength(3);
  });

  it('rejects a zero amount', async () => {
    await expect(recordRentPayment({ customerId: customer.id, amount: 0 })).rejects.toThrow(/greater than zero/i);
  });

  it('previews without writing anything', async () => {
    const plan = await previewRentPayment({ customerId: customer.id, amount: 5000 });
    expect(plan.kind).toBe('partial');
    expect(plan.remainingAfter).toBe(6500);
    expect(plan.nextCycle).toBeNull();
    expect(await listTransactions()).toHaveLength(0);
    expect((await getOpenCycle(customer.id)).paidAmount).toBe(0);
  });
});

describe('settling a cycle', () => {
  it('opens the next month when the exact amount is paid', async () => {
    const { cycle, nextCycle, transaction } = await recordRentPayment({ customerId: customer.id, amount: 11500 });

    expect(cycle.status).toBe('paid');
    expect(nextCycle.dueDate).toBe('2024-06-10');
    expect(nextCycle.paidAmount).toBe(0);
    expect(nextCycle.status).toBe('pending');
    expect(transaction.openedCycleId).toBe(nextCycle.id);

    expect((await getCustomer(customer.id)).nextDueDate).toBe('2024-06-10');
    const open = await getOpenCycle(customer.id);
    expect(open.id).toBe(nextCycle.id);
  });

  it('settles when the exact remainder arrives after a part payment', async () => {
    await recordRentPayment({ customerId: customer.id, amount: 5000 });
    const { cycle, nextCycle } = await recordRentPayment({ customerId: customer.id, amount: 6500 });

    expect(cycle.status).toBe('paid');
    expect(cycle.paidAmount).toBe(11500);
    expect(nextCycle.dueDate).toBe('2024-06-10');
  });

  it('keeps history: the settled cycle stays queryable', async () => {
    await recordRentPayment({ customerId: customer.id, amount: 11500 });
    const history = await listCyclesForCustomer(customer.id);
    expect(history).toHaveLength(2);
    expect(history[0].dueDate).toBe('2024-06-10'); // newest first
    expect(history[1].dueDate).toBe('2024-05-10');
  });
});

describe('overpayment', () => {
  it('rolls the surplus into the next cycle', async () => {
    const { nextCycle, transaction } = await recordRentPayment({ customerId: customer.id, amount: 13500 });

    expect(transaction.amount).toBe(13500);
    expect(nextCycle.paidAmount).toBe(2000);
    expect(nextCycle.remainingAmount).toBe(9500);
    expect(nextCycle.status).toBe('partial');
    expect((await getCustomer(customer.id)).advanceCredit).toBe(0);
  });

  it('holds the unclaimable part of a large payment as advance credit', async () => {
    const { nextCycle } = await recordRentPayment({ customerId: customer.id, amount: 30000 });
    expect(nextCycle.paidAmount).toBe(11500);
    expect(nextCycle.status).toBe('paid');
    expect((await getCustomer(customer.id)).advanceCredit).toBe(7000);
  });

  it('uses existing credit on the following cycle', async () => {
    // A tenant with Rs 2,000 advance credit and an unpaid open cycle: paying
    // exactly this month's rent lets the credit cover part of next month.
    const withCredit = await createCustomer({
      name: 'Aman Verma',
      mobile: '9123456780',
      joiningDate: '2024-04-12',
      rentAmount: 11500,
      advanceCredit: 2000,
    });
    await ensureOpenCycle(withCredit);

    const { nextCycle } = await recordRentPayment({ customerId: withCredit.id, amount: 11500 });
    expect(nextCycle.paidAmount).toBe(2000);
    expect(nextCycle.remainingAmount).toBe(9500);
    expect((await getCustomer(withCredit.id)).advanceCredit).toBe(0);
  });

  it('keeps credit across an excess settlement of a credit-paid cycle', async () => {
    const { nextCycle } = await recordRentPayment({ customerId: customer.id, amount: 25000 });
    // June is fully covered by the surplus (2000 beyond one rent) is held.
    expect(nextCycle.status).toBe('paid');
    expect((await getCustomer(customer.id)).advanceCredit).toBe(2000);

    const settled = await recordRentPayment({ customerId: customer.id, amount: 11500 });
    expect(settled.nextCycle.dueDate).toBe('2024-07-10');
    expect(settled.nextCycle.paidAmount).toBe(11500);
    expect((await getCustomer(customer.id)).advanceCredit).toBe(2000);
  });
});

describe('deleting a rent transaction', () => {
  it('restores a part payment', async () => {
    const { transaction } = await recordRentPayment({ customerId: customer.id, amount: 5000 });
    await recordRentPayment({ customerId: customer.id, amount: 2000 });

    await deleteTransaction(transaction.id);

    const cycle = await getOpenCycle(customer.id);
    expect(cycle.paidAmount).toBe(2000);
    expect(cycle.status).toBe('partial');
    expect((await getCustomer(customer.id)).nextDueDate).toBe('2024-05-10');
    expect(await listTransactions()).toHaveLength(1);
  });

  it('removes the cycle the payment opened and rolls the due date back', async () => {
    const { transaction } = await recordRentPayment({ customerId: customer.id, amount: 11500 });
    expect(await listCycles()).toHaveLength(2);

    await deleteTransaction(transaction.id);

    expect(await listCycles()).toHaveLength(1);
    const cycle = await getOpenCycle(customer.id);
    expect(cycle.dueDate).toBe('2024-05-10');
    expect(cycle.status).toBe('pending');
    expect((await getCustomer(customer.id)).nextDueDate).toBe('2024-05-10');
  });

  it('reverses an overpayment, including the advance credit', async () => {
    const { transaction } = await recordRentPayment({ customerId: customer.id, amount: 30000 });
    expect((await getCustomer(customer.id)).advanceCredit).toBe(7000);

    await deleteTransaction(transaction.id);

    expect((await getCustomer(customer.id)).advanceCredit).toBe(0);
    expect(await listCycles()).toHaveLength(1);
    const cycle = await getOpenCycle(customer.id);
    expect(cycle.paidAmount).toBe(0);
    expect(cycle.status).toBe('pending');
  });

  it('keeps the cycle when a paid-into advance cycle existed', async () => {
    const { transaction: first } = await recordRentPayment({ customerId: customer.id, amount: 11500 });
    const { transaction: second } = await recordRentPayment({ customerId: customer.id, amount: 5000 });

    await deleteTransaction(first.id);

    // Deleting "May in full" did not destroy June: the 5000 the tenant already
    // put into it has nowhere else to live, so June stays as the open cycle.
    expect(await listCycles()).toHaveLength(2);
    const open = await getOpenCycle(customer.id);
    expect(open.dueDate).toBe('2024-06-10');
    expect(open.paidAmount).toBe(5000);
    expect((await getCustomer(customer.id)).nextDueDate).toBe('2024-06-10');
    expect(await listTransactions()).toHaveLength(1);
    expect(second.amount).toBe(5000);
  });

  it('throws for an unknown id', async () => {
    await expect(deleteTransaction('nope')).rejects.toThrow(/not found/i);
  });
});

describe('light bills are independent of rent', () => {
  beforeEach(async () => {
    await recordRentPayment({ customerId: customer.id, amount: 11500 });
  });

  it('saves one bill per tenant per month', async () => {
    const bill = await saveLightBill({ customerId: customer.id, month: '2024-05', billAmount: 900 });
    expect(bill.remainingAmount).toBe(900);
    expect(bill.status).toBe('pending');

    const again = await saveLightBill({ customerId: customer.id, month: '2024-05', billAmount: 1000 });
    expect(again.id).toBe(bill.id);
    expect(await listLightBills()).toHaveLength(1);
    expect((await getLightBillForMonth(customer.id, '2024-05')).billAmount).toBe(1000);
  });

  it('derives the amount from units x rate', async () => {
    const bill = await saveLightBill({ customerId: customer.id, month: '2024-05', units: 150, ratePerUnit: 7.5 });
    expect(bill.billAmount).toBe(1125);
  });

  it('rejects a bill smaller than what is already paid', async () => {
    const bill = await saveLightBill({ customerId: customer.id, month: '2024-05', billAmount: 900 });
    await recordLightBillPayment({ customerId: customer.id, billId: bill.id, amount: 900 });
    await expect(
      saveLightBill({ customerId: customer.id, month: '2024-05', billAmount: 500 })
    ).rejects.toThrow(/cannot be less than/i);
  });

  it('records a part bill payment and leaves rent untouched', async () => {
    const bill = await saveLightBill({ customerId: customer.id, month: '2024-05', billAmount: 900 });
    const { transaction, bill: updated } = await recordLightBillPayment({
      customerId: customer.id,
      billId: bill.id,
      amount: 350,
    });

    expect(transaction.type).toBe(TX_LIGHT_BILL);
    expect(transaction.billId).toBe(bill.id);
    expect(updated.paidAmount).toBe(350);
    expect(updated.status).toBe('partial');

    // the rent cycle and due date are exactly as they were
    const open = await getOpenCycle(customer.id);
    expect(open.dueDate).toBe('2024-06-10');
    expect(open.rentAmount).toBe(11500);
  });

  it('settles a bill without touching the rent cycle', async () => {
    const bill = await saveLightBill({ customerId: customer.id, month: '2024-05', billAmount: 900 });
    const { bill: updated } = await recordLightBillPayment({ customerId: customer.id, billId: bill.id, amount: 900 });
    expect(updated.status).toBe('paid');
    expect(await listCycles()).toHaveLength(2);
  });

  it('rebuilds the bill when a bill transaction is deleted', async () => {
    const bill = await saveLightBill({ customerId: customer.id, month: '2024-05', billAmount: 900 });
    const { transaction } = await recordLightBillPayment({ customerId: customer.id, billId: bill.id, amount: 900 });

    await deleteTransaction(transaction.id);

    const after = await getLightBillForMonth(customer.id, '2024-05');
    expect(after.paidAmount).toBe(0);
    expect(after.status).toBe('pending');
    // rent history survives a bill deletion
    expect(await listCycles()).toHaveLength(2);
  });

  it('rejects a zero bill payment', async () => {
    const bill = await saveLightBill({ customerId: customer.id, month: '2024-05', billAmount: 900 });
    await expect(recordLightBillPayment({ customerId: customer.id, billId: bill.id, amount: 0 })).rejects.toThrow();
  });
});

describe('migration from the legacy payment model', () => {
  /** The shape the old `addPayment` produced: every payment rolled the due date. */
  function legacyCustomer(overrides = {}) {
    return {
      id: 'cus_legacy',
      code: 'PG-0001',
      name: 'Old Tenant',
      mobile: '9876543210',
      joiningDate: '2024-01-10',
      dueDay: 10,
      rentAmount: 11500,
      nextDueDate: '2024-05-10',
      photoId: 'img_1',
      proofImageId: 'img_2',
      payments: [
        { id: 'pay_1', amount: 11500, date: '2024-04-05', mode: 'upi', note: 'April', paidForDueDate: '2024-04-10', createdAt: '2024-04-05T09:00:00.000Z' },
        { id: 'pay_2', amount: 11500, date: '2024-05-06', mode: 'cash', note: '', paidForDueDate: '2024-05-10', createdAt: '2024-05-06T09:00:00.000Z' },
      ],
      ...overrides,
    };
  }

  beforeEach(() => {
    resetDatabase();
    window.localStorage.clear();
  });

  /** The migration still reads the old on-device store, so seed it directly. */
  const writeLegacyCustomers = (customers) =>
    window.localStorage.setItem('pgm.customers.v1', JSON.stringify(customers));

  it('reports a fresh install as needing migration', () => {
    expect(needsMigration()).toBe(true);
  });

  it('converts each due date into its own settled cycle', async () => {
    writeLegacyCustomers([legacyCustomer()]);
    const report = await runMigration();

    expect(report.migrated).toBe(true);
    expect(report.customers).toBe(1);

    const cycles = await listCycles();
    // two settled cycles + the new open one
    expect(cycles).toHaveLength(3);
    expect(cycles.map((c) => c.dueDate).sort()).toEqual(['2024-04-10', '2024-05-10', '2024-06-10']);
    expect(cycles.every((c) => c.rentAmount === 11500)).toBe(true);

    const open = await getOpenCycle('cus_legacy');
    expect(open.dueDate).toBe('2024-06-10');
    expect(open.status).toBe('pending');
    expect(open.paidAmount).toBe(0);
  });

  it('preserves every payment as a transaction, with date, mode and note', async () => {
    writeLegacyCustomers([legacyCustomer()]);
    await runMigration();

    const txs = await listTransactions();
    expect(txs).toHaveLength(2);
    const april = txs.find((t) => t.note === 'April');
    expect(april.amount).toBe(11500);
    expect(april.date).toBe('2024-04-05');
    expect(april.mode).toBe('upi');
    expect(april.type).toBe(TX_RENT);
  });

  it('keeps the original records in a backup', async () => {
    writeLegacyCustomers([legacyCustomer()]);
    await runMigration();

    const backup = readBackup();
    expect(backup).not.toBeNull();
    expect(backup.customers[0].payments).toHaveLength(2);
    expect(backup.toVersion).toBe(3);
  });

  it('points the customer at the new open cycle', async () => {
    writeLegacyCustomers([legacyCustomer()]);
    await runMigration();
    expect((await getCustomer('cus_legacy')).nextDueDate).toBe('2024-06-10');
  });

  it('leaves photos and ID proofs alone', async () => {
    writeLegacyCustomers([legacyCustomer()]);
    await runMigration();
    const after = await getCustomer('cus_legacy');
    expect(after.photoId).toBe('img_1');
    expect(after.proofImageId).toBe('img_2');
  });

  it('groups two payments for the same due date into one cycle', async () => {
    writeLegacyCustomers([
      legacyCustomer({
        nextDueDate: '2024-05-10',
        payments: [
          { id: 'p1', amount: 5000, date: '2024-04-20', mode: 'cash', paidForDueDate: '2024-04-10' },
          { id: 'p2', amount: 6500, date: '2024-04-25', mode: 'cash', paidForDueDate: '2024-04-10' },
        ],
      }),
    ]);
    await runMigration();

    const cycles = await listCycles();
    expect(cycles).toHaveLength(2);
    const april = cycles.find((c) => c.dueDate === '2024-04-10');
    expect(april.paidAmount).toBe(11500);
    expect(april.status).toBe('paid');
    expect((await getOpenCycle('cus_legacy')).dueDate).toBe('2024-05-10');
  });

  it('applies a legacy surplus to the open cycle', async () => {
    writeLegacyCustomers([
      legacyCustomer({
        nextDueDate: '2024-06-10',
        payments: [{ id: 'p1', amount: 13500, date: '2024-05-06', mode: 'cash', paidForDueDate: '2024-05-10' }],
      }),
    ]);
    await runMigration();

    const may = (await listCycles()).find((c) => c.dueDate === '2024-05-10');
    expect(may.paidAmount).toBe(13500);
    expect(may.status).toBe('paid');
    // 2000 above one rent: applied to the open June cycle, nothing left over.
    expect((await getCustomer('cus_legacy')).advanceCredit).toBe(0);
    expect((await getOpenCycle('cus_legacy')).paidAmount).toBe(2000);
  });

  it('holds a legacy surplus bigger than one rent as credit', async () => {
    writeLegacyCustomers([
      legacyCustomer({
        nextDueDate: '2024-06-10',
        payments: [{ id: 'p1', amount: 30000, date: '2024-05-06', mode: 'cash', paidForDueDate: '2024-05-10' }],
      }),
    ]);
    await runMigration();

    const stored = await getCustomer('cus_legacy');
    expect(stored.advanceCredit).toBe(7000);
    // the surplus's first 11500 covered June in full; 7000 is held for later
    expect((await getOpenCycle('cus_legacy')).status).toBe('paid');
  });

  it('handles a tenant who has never paid', async () => {
    writeLegacyCustomers([legacyCustomer({ payments: [] })]);
    await runMigration();
    const cycles = await listCycles();
    expect(cycles).toHaveLength(1);
    expect(cycles[0].status).toBe('pending');
    expect((await getCustomer('cus_legacy')).nextDueDate).toBe('2024-05-10');
  });

  it('runs only once', async () => {
    writeLegacyCustomers([legacyCustomer()]);
    const first = await runMigration();
    expect(first.migrated).toBe(true);

    const second = await runMigration();
    expect(second.migrated).toBe(false);
    expect(second.reason).toBe('already-current');
    expect(needsMigration()).toBe(false);

    // no duplicated cycles or transactions
    expect(await listCycles()).toHaveLength(3);
    expect(await listTransactions()).toHaveLength(2);
  });

  it('accepts new payments normally after migrating', async () => {
    writeLegacyCustomers([legacyCustomer()]);
    await runMigration();

    const { cycle } = await recordRentPayment({ customerId: 'cus_legacy', amount: 4000 });
    expect(cycle.status).toBe('partial');
    expect((await getCustomer('cus_legacy')).nextDueDate).toBe('2024-06-10');
  });
});

describe('monthly aggregation across tenants', () => {
  it('keeps rent and electricity in separate buckets', async () => {
    const other = await setupCustomer({ name: 'Aman Verma', joiningDate: '2024-04-12', rentAmount: 13000 });

    await recordRentPayment({ customerId: customer.id, amount: 11500, date: '2024-05-06' });
    await recordRentPayment({ customerId: other.id, amount: 5000, date: '2024-05-07' });

    const bill = await saveLightBill({ customerId: other.id, month: '2024-05', billAmount: 1200 });
    await recordLightBillPayment({ customerId: other.id, billId: bill.id, amount: 1200, date: '2024-05-08' });

    const txs = await listTransactions();
    const rent = txs.filter((t) => t.type === TX_RENT).reduce((s, t) => s + t.amount, 0);
    const light = txs.filter((t) => t.type === TX_LIGHT_BILL).reduce((s, t) => s + t.amount, 0);

    expect(rent).toBe(16500);
    expect(light).toBe(1200);
    expect(dayjs('2024-05-08').isValid()).toBe(true);
  });
});
