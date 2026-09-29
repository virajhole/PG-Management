import { readJSON, writeJSON, KEYS, SCHEMA_VERSION } from './localStore.js';
import { normalizeCustomer } from './customerService.js';
import { createCycle } from './cycleService.js';
import { createId, nowISO, todayISO, advanceDueDate, dayjs } from '../utils/dateLogic.js';
import { statusFor, getRemaining, toAmount, monthKey, TX_RENT } from '../utils/ledger.js';

/**
 * One-time upgrade from the pre-ledger data model to the cycle/transaction model.
 *
 * The old model stored a flat `payments` array per tenant and advanced
 * `nextDueDate` on *every* payment, so a second payment in the same month was
 * silently attributed to the following cycle and partial payment could not be
 * expressed at all. This converts what is there into real cycles.
 *
 * Guarantees:
 *   - the untouched original records are copied to KEYS.backup first
 *   - it is idempotent: guarded by KEYS.schemaVersion, so it runs at most once
 *   - a tenant's payment history, dates, modes and notes are preserved one to one
 *   - photos and ID proofs (IndexedDB) are never read or written
 *   - the legacy `payments` array is left in place as a safety net; nothing
 *     reads it any more
 */

function readVersion() {
  const raw = readJSON(KEYS.schemaVersion, 0);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function readCustomers() {
  const stored = readJSON(KEYS.customers, []);
  return Array.isArray(stored) ? stored.map(normalizeCustomer) : [];
}

/**
 * Fold a tenant's legacy payments into one entry per due date they were made for.
 * A tenant who paid twice for the same due date produced two rows with the same
 * `paidForDueDate`; those belong to the same cycle and are summed.
 */
function groupLegacyPayments(payments = []) {
  const groups = new Map();
  for (const payment of payments) {
    const dueDate = payment.paidForDueDate || payment.date;
    if (!dueDate) continue;
    const group = groups.get(dueDate) ?? { dueDate, amount: 0, payments: [] };
    group.amount += toAmount(payment.amount);
    group.payments.push(payment);
    groups.set(dueDate, group);
  }
  return [...groups.values()].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
}

export function needsMigration() {
  return readVersion() < SCHEMA_VERSION;
}

/** Convert one tenant, returning the cycles/transactions to persist. */
function migrateCustomer(customer) {
  const cycles = [];
  const transactions = [];
  const groups = groupLegacyPayments(customer.payments);

  for (const group of groups) {
    const rentAmount = toAmount(customer.rentAmount);
    const paidAmount = toAmount(group.amount);
    const cycle = {
      id: createId('cyc'),
      customerId: customer.id,
      dueDate: group.dueDate,
      rentAmount,
      paidAmount,
      remainingAmount: getRemaining({ rentAmount, paidAmount }),
      status: statusFor({ rentAmount, paidAmount }),
      settledAt: paidAmount >= rentAmount ? group.payments[group.payments.length - 1]?.createdAt || nowISO() : null,
      // Marks these as converted rather than entered in the app.
      migratedFrom: 'legacy',
      createdAt: group.payments[0]?.createdAt || nowISO(),
      updatedAt: nowISO(),
    };
    cycles.push(cycle);

    for (const payment of group.payments) {
      transactions.push({
        id: payment.id || createId('txn'),
        customerId: customer.id,
        customerName: customer.name,
        type: TX_RENT,
        cycleId: cycle.id,
        billId: null,
        amount: toAmount(payment.amount),
        date: payment.date || todayISO(),
        mode: payment.mode || 'cash',
        note: payment.note || '',
        createdAt: payment.createdAt || nowISO(),
        migratedFrom: 'legacy',
        // No `openedCycleId`: these cycles predate the ledger and are already
        // settled, so deleting one must not remove an existing next cycle.
        creditBefore: null,
        creditAfter: null,
        dueDateBefore: group.dueDate,
        dueDateAfter: group.dueDate,
      });
    }
  }

  // Work out the cycle that should be open now. When the newest converted cycle
  // is the one `nextDueDate` points at (the legacy double-payment case), the open
  // cycle is the one *after* it.
  const newestCycleDue = cycles.length ? cycles[cycles.length - 1].dueDate : null;
  let openDueDate = customer.nextDueDate;
  if (newestCycleDue && newestCycleDue >= openDueDate) {
    openDueDate = advanceDueDate(newestCycleDue, 1, customer.dueDay);
  }

  // Any surplus on the last converted cycle cannot be claimed by a cycle we
  // know about, so it is held as advance credit and applied to the open cycle.
  const lastCycle = cycles[cycles.length - 1];
  const credit = lastCycle ? Math.max(0, lastCycle.paidAmount - lastCycle.rentAmount) : 0;
  const rentAmount = toAmount(customer.rentAmount);
  const appliedCredit = Math.min(credit, rentAmount);
  const openCycle = {
    id: createId('cyc'),
    customerId: customer.id,
    dueDate: openDueDate,
    rentAmount,
    paidAmount: appliedCredit,
    remainingAmount: getRemaining({ rentAmount, paidAmount: appliedCredit }),
    status: statusFor({ rentAmount, paidAmount: appliedCredit }),
    settledAt: null,
    migratedFrom: 'legacy',
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  cycles.push(openCycle);

  return {
    cycles,
    transactions,
    customerPatch: {
      nextDueDate: openDueDate,
      advanceCredit: Math.max(0, credit - appliedCredit),
    },
  };
}

/**
 * Run the upgrade if it has not run yet.
 * Returns a small report so the UI can tell the user what happened.
 */
export async function runMigration() {
  if (!needsMigration()) {
    return { migrated: false, reason: 'already-current', customers: 0, cycles: 0, transactions: 0 };
  }

  const customers = readCustomers();
  const fromVersion = readVersion();

  // Snapshot before touching anything, so a bad conversion is always reversible
  // by hand from `pgm.backup.v1`.
  if (readJSON(KEYS.backup, null) === null) {
    writeJSON(KEYS.backup, {
      savedAt: nowISO(),
      fromVersion,
      toVersion: SCHEMA_VERSION,
      customers: readJSON(KEYS.customers, []),
    });
  }

  const allCycles = readJSON(KEYS.cycles, []);
  const allTransactions = readJSON(KEYS.transactions, []);
  const existingCycleIds = new Set((Array.isArray(allCycles) ? allCycles : []).map((c) => c.id));

  for (const customer of customers) {
    const result = migrateCustomer(customer);

    // Persist via the service so normalization stays in one place.
    for (const cycle of result.cycles) {
      if (existingCycleIds.has(cycle.id)) continue;
      const created = await createCycle(cycle);
      existingCycleIds.add(created.id);
    }

    allTransactions.push(...result.transactions);
    customer.nextDueDate = result.customerPatch.nextDueDate;
    customer.advanceCredit = result.customerPatch.advanceCredit;
    customer.updatedAt = nowISO();
  }

  if (customers.length) {
    writeJSON(KEYS.customers, customers);
  }
  writeJSON(KEYS.cycles, existingCycleIds.size ? readJSON(KEYS.cycles, []) : []);
  writeJSON(KEYS.transactions, allTransactions);
  writeJSON(KEYS.schemaVersion, SCHEMA_VERSION);

  return {
    migrated: true,
    fromVersion,
    toVersion: SCHEMA_VERSION,
    customers: customers.length,
    cycles: existingCycleIds.size,
    transactions: allTransactions.length,
    backedUp: true,
  };
}

/** Test/debug helper: the untouched pre-ledger snapshot, if one exists. */
export function readBackup() {
  return readJSON(KEYS.backup, null);
}

export { monthKey, dayjs };
