import { readJSON, writeJSON, KEYS } from './localStore.js';
import { createId, nowISO, todayISO, dayjs } from '../utils/dateLogic.js';
import { normalizeCustomer } from './customerService.js';
import {
  getOpenCycle,
  createCycle,
  updateCycle,
  recomputeCycleFromPayments,
  deleteCycle,
} from './cycleService.js';
import {
  getLightBill,
  getLightBillForMonth,
  createLightBill,
  updateLightBill,
  recomputeLightBillFromPayments,
} from './lightBillService.js';
import { planRentPayment, applyPayment, toAmount, money, TX_RENT, TX_LIGHT_BILL } from '../utils/ledger.js';

/**
 * The payment ledger.
 *
 * A transaction is the only thing that ever changes money, and every transaction
 * is reversible: deleting one puts the balances back exactly as they were. That
 * is why the side effects a rent payment has beyond the balance are *stored on
 * the transaction* (`openedCycleId`, `creditBefore`, `settledAt`) - the delete
 * path can then undo them precisely instead of guessing.
 *
 * Rent and light bill payments share this module only for the append/delete
 * mechanics. Each links to its own target and never touches the other's.
 */

// ------------------------------------------------------------------- helpers

function readCustomers() {
  const stored = readJSON(KEYS.customers, []);
  return Array.isArray(stored) ? stored.map(normalizeCustomer) : [];
}

function patchCustomer(id, patch) {
  const all = readCustomers();
  const index = all.findIndex((c) => c.id === id);
  if (index === -1) throw new Error('Customer not found.');

  const merged = normalizeCustomer({ ...all[index], ...patch, id, updatedAt: nowISO() });
  all[index] = merged;
  writeJSON(KEYS.customers, all);
  return merged;
}

function readTransactions() {
  const stored = readJSON(KEYS.transactions, []);
  return Array.isArray(stored) ? stored : [];
}

function writeTransactions(transactions) {
  writeJSON(KEYS.transactions, transactions);
  return transactions;
}

function findTransaction(id) {
  return readTransactions().find((tx) => tx.id === id) ?? null;
}

function buildTransaction({ customerId, customerName, type, cycleId = null, billId = null, amount, date, mode, note, extra = {} }) {
  return {
    id: createId('txn'),
    customerId,
    // The name is denormalised so history still reads correctly after a tenant
    // is renamed, and stays printable/exportable without a lookup.
    customerName,
    type,
    cycleId,
    billId,
    amount: toAmount(amount),
    date: date || todayISO(),
    mode: mode || 'cash',
    note: note || '',
    createdAt: nowISO(),
    ...extra,
  };
}

// -------------------------------------------------------------- rent payment

/**
 * Record rent against the tenant's open cycle.
 *
 *   partial  -> balance drops, due date and cycle stay exactly as they were
 *   exact    -> cycle settles and the next cycle opens one anchored month later
 *   over     -> cycle settles, the surplus rolls into the next cycle, and any
 *               amount still unclaimed is held on the customer as advance credit
 *
 * `previewRentPayment` runs the same plan without writing, so a dialog can show
 * the consequences of the typed amount first.
 */
export async function recordRentPayment({ customerId, amount, date, mode = 'cash', note = '' }) {
  const customers = readCustomers();
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) throw new Error('Customer not found.');

  const cycle = await getOpenCycle(customerId);
  if (!cycle) throw new Error('No open rent cycle for this tenant.');

  const plan = await previewRentPayment({ customerId, amount });
  if (plan.applied <= 0 && plan.surplus <= 0) {
    throw new Error('Enter an amount greater than zero.');
  }

  const settled = await updateCycle(cycle.id, {
    paidAmount: plan.paidAfter,
    settledAt: plan.settled ? nowISO() : null,
  });

  let openedCycleId = null;
  let nextCycle = null;
  if (plan.settled) {
    nextCycle = await createCycle({
      customerId,
      dueDate: plan.nextCycle.dueDate,
      rentAmount: plan.nextCycle.rentAmount,
      paidAmount: plan.nextCycle.paidAmount,
    });
    openedCycleId = nextCycle.id;
  }

  const transaction = buildTransaction({
    customerId,
    customerName: customer.name,
    type: TX_RENT,
    cycleId: cycle.id,
    amount: plan.requested,
    date,
    mode,
    note,
    extra: {
      // Reversal data: everything a delete needs to put things back.
      openedCycleId,
      creditBefore: plan.previousCredit,
      creditAfter: plan.creditAfter,
      settledAt: settled.settledAt,
      dueDateBefore: cycle.dueDate,
      dueDateAfter: plan.settled ? nextCycle.dueDate : cycle.dueDate,
    },
  });
  writeTransactions([...readTransactions(), transaction]);

  patchCustomer(customerId, {
    advanceCredit: plan.creditAfter,
    nextDueDate: plan.settled ? nextCycle.dueDate : cycle.dueDate,
  });

  return { transaction, cycle: settled, nextCycle, plan };
}

/** Run the rent plan for a prospective amount. Writes nothing. */
export async function previewRentPayment({ customerId, amount, nextRentAmount }) {
  const customer = readCustomers().find((c) => c.id === customerId);
  if (!customer) throw new Error('Customer not found.');

  const cycle = await getOpenCycle(customerId);
  if (!cycle) throw new Error('No open rent cycle for this tenant.');

  return planRentPayment({
    cycle,
    amount,
    dueDay: customer.dueDay,
    nextRentAmount: nextRentAmount ?? cycle.rentAmount,
    advanceCredit: customer.advanceCredit,
  });
}

// ---------------------------------------------------------- light bill entry

/** Create or update this month's bill for a tenant. */
export async function saveLightBill({ customerId, billId, month, units, ratePerUnit, billAmount, note = '' }) {
  const customer = readCustomers().find((c) => c.id === customerId);
  if (!customer) throw new Error('Customer not found.');

  const targetMonth = month || dayjs().format('YYYY-MM');
  const computedAmount = billAmount != null ? toAmount(billAmount) : toAmount(units) * toAmount(ratePerUnit);
  if (computedAmount <= 0) throw new Error('Enter a bill amount greater than zero.');

  const existing = billId ? await getLightBill(billId) : await getLightBillForMonth(customerId, targetMonth);

  if (existing) {
    if (existing.paidAmount > computedAmount) {
      throw new Error('The bill amount cannot be less than the amount already paid.');
    }
    return updateLightBill(existing.id, { month: targetMonth, units, ratePerUnit, billAmount: computedAmount, note });
  }
  return createLightBill({ customerId, month: targetMonth, units, ratePerUnit, billAmount: computedAmount, note });
}

/** Record a payment against a light bill. */
export async function recordLightBillPayment({ customerId, billId, amount, date, mode = 'cash', note = '' }) {
  const customers = readCustomers();
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) throw new Error('Customer not found.');

  const bill = await getLightBill(billId);
  if (!bill) throw new Error('Light bill not found.');

  const result = applyPayment(bill, amount);
  if (result.applied <= 0 && result.surplus <= 0) {
    throw new Error('Enter an amount greater than zero.');
  }

  const updated = await updateLightBill(bill.id, { paidAmount: result.paidAfter });

  const transaction = buildTransaction({
    customerId,
    customerName: customer.name,
    type: TX_LIGHT_BILL,
    billId: bill.id,
    amount: result.requested,
    date,
    mode,
    note,
    extra: { billMonth: bill.month },
  });
  writeTransactions([...readTransactions(), transaction]);

  return { transaction, bill: updated, result };
}

// ------------------------------------------------------------------ queries

export async function listTransactions() {
  return readTransactions();
}

export async function getTransaction(id) {
  return findTransaction(id);
}

// ------------------------------------------------------------------ deletion

/**
 * Delete a transaction and restore the balances it changed.
 *
 * Rent: the linked cycle's paid amount is rebuilt from whatever transactions
 * remain, the cycle this payment opened is removed, and any advance credit is
 * returned to the value it held before the payment.
 */
export async function deleteTransaction(id) {
  const all = readTransactions();
  const index = all.findIndex((tx) => tx.id === id);
  if (index === -1) throw new Error('Transaction not found.');

  const transaction = all[index];
  const remaining = all.filter((tx) => tx.id !== id);
  writeTransactions(remaining);

  if (transaction.type === TX_LIGHT_BILL) {
    const payments = remaining.filter((tx) => tx.billId === transaction.billId);
    await recomputeLightBillFromPayments(transaction.billId, payments);
    return { transaction };
  }

  const payments = remaining.filter((tx) => tx.cycleId === transaction.cycleId);
  await recomputeCycleFromPayments(transaction.cycleId, payments);

  if (transaction.openedCycleId) {
    const openedCyclePaid = remaining.some((tx) => tx.cycleId === transaction.openedCycleId);
    // Only remove the cycle this payment opened when nothing was ever recorded
    // against it. If the tenant already paid into it, that money has nowhere
    // else to live - so it stays, as the tenant's advance-covered cycle.
    if (!openedCyclePaid) {
      await deleteCycle(transaction.openedCycleId);
    }
  }

  // Whatever the shape left behind, the tenant's next due date is now whatever
  // the newest open cycle says, and the credit is back to its pre-payment value.
  const openCycle = await getOpenCycle(transaction.customerId);
  patchCustomer(transaction.customerId, {
    advanceCredit: transaction.creditBefore ?? 0,
    nextDueDate: openCycle ? openCycle.dueDate : transaction.dueDateBefore,
  });

  return { transaction, cycle: openCycle };
}

export async function clearAllTransactions() {
  writeTransactions([]);
  return [];
}

/** Remove every transaction a deleted customer leaves behind. */
export async function deleteTransactionsForCustomer(customerId) {
  writeTransactions(readTransactions().filter((tx) => tx.customerId !== customerId));
  return true;
}

export { money };
