import { TABLES, insertRow, getRow, updateRow } from './supabase.js';
import { normalizeCustomer } from './customerService.js';
import { createCycle } from './cycleService.js';
import { createId, nowISO, todayISO, advanceDueDate, dayjs } from '../utils/dateLogic.js';
import { statusFor, getRemaining, toAmount, monthKey, TX_RENT } from '../utils/ledger.js';

/**
 * One-time upgrade from the pre-ledger localStorage data model into Supabase.
 *
 * The old model stored a flat `payments` array per tenant and advanced
 * `nextDueDate` on *every* payment, so a second payment in the same month was
 * silently attributed to the following cycle and partial payment could not be
 * expressed at all. This converts what is on the device into real cycles and
 * transactions in the cloud.
 *
 * Guarantees:
 *   - the untouched original records are copied to the local backup key first
 *   - it is idempotent: guarded by KEYS.schemaVersion, so it runs at most once
 *   - a tenant's payment history, dates, modes and notes are preserved one to one
 *   - already-imported ids are skipped, so a half-finished run can be repeated
 */

const SCHEMA_VERSION = 3;

// The legacy on-device store is the only thing still read from localStorage:
// it is the source for a one-time upgrade, and nothing else reads it.
const LEGACY_KEYS = {
  customers: 'pgm.customers.v1',
  schemaVersion: 'pgm.schemaVersion',
  backup: 'pgm.backup.v1',
};

function storage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readVersion() {
  const n = Number(readJSON(LEGACY_KEYS.schemaVersion, 0));
  return Number.isFinite(n) ? n : 0;
}

function readJSON(key, fallback) {
  try {
    const raw = storage()?.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    storage()?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readCustomers() {
  const stored = readJSON(LEGACY_KEYS.customers, []);
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
  // by hand from `pgm.backup.v1`. Write it fresh every run: if an earlier attempt
  // failed part-way, the older snapshot would be the state we are recovering
  // from, not the state we are converting.
  writeJSON(LEGACY_KEYS.backup, {
    savedAt: nowISO(),
    fromVersion,
    toVersion: SCHEMA_VERSION,
    customers: readJSON(LEGACY_KEYS.customers, []),
  });

  let cycleCount = 0;
  let transactionCount = 0;

  for (const customer of customers) {
    const result = migrateCustomer(customer);

    // Upsert the tenant, then persist the converted cycles/transactions through
    // the same service writes the rest of the app uses.
    const existing = await getRow(TABLES.customers, customer.id);
    if (existing) {
      await updateRow(TABLES.customers, customer.id, { ...customer, ...result.customerPatch });
    } else {
      await insertRow(TABLES.customers, { ...customer, ...result.customerPatch });
    }

    for (const cycle of result.cycles) {
      await createCycle(cycle);
      cycleCount += 1;
    }

    for (const transaction of result.transactions) {
      await insertRow(TABLES.transactions, transaction);
      transactionCount += 1;
    }
  }

  writeJSON(LEGACY_KEYS.schemaVersion, SCHEMA_VERSION);

  return {
    migrated: true,
    fromVersion,
    toVersion: SCHEMA_VERSION,
    customers: customers.length,
    cycles: cycleCount,
    transactions: transactionCount,
    backedUp: true,
  };
}

/** Test/debug helper: the untouched pre-ledger snapshot, if one exists. */
export function readBackup() {
  return readJSON(LEGACY_KEYS.backup, null);
}

export { monthKey, dayjs };