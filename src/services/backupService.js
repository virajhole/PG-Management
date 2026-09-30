import { TABLES, rpc, emptyStorage, getImageUrl, uploadImage } from './supabase.js';
import { listCustomers } from './customerService.js';
import { listCycles } from './cycleService.js';
import { listLightBills } from './lightBillService.js';
import { listTransactions } from './transactionService.js';
import { loadSettings, saveSettings } from './settingsService.js';

/**
 * Portable copies of everything in this account.
 *
 * Export exists so a landlord is never locked in: a single JSON file (or CSV for
 * the spreadsheet) holds the whole ledger and can be re-imported into any
 * account. Import is one atomic RPC, so a partial import cannot happen.
 */

const CUSTOMER_COLUMNS = [
  'id', 'code', 'name', 'mobile', 'email', 'guardianName', 'guardianPhone', 'address',
  'occupation', 'proofType', 'proofId', 'joiningDate', 'sharingType', 'rentAmount',
  'depositAmount', 'depositPaid', 'roomNo', 'bedNo', 'notes', 'dueDay', 'nextDueDate',
  'advanceCredit', 'termsAccepted', 'termsAcceptedAt', 'status', 'photoId', 'proofImageId',
  'payments', 'createdAt', 'updatedAt',
];

const CYCLE_COLUMNS = ['id', 'customerId', 'dueDate', 'rentAmount', 'paidAmount', 'settledAt', 'createdAt', 'updatedAt'];
const BILL_COLUMNS = ['id', 'customerId', 'month', 'units', 'ratePerUnit', 'billAmount', 'paidAmount', 'note', 'createdAt', 'updatedAt'];
const TX_COLUMNS = [
  'id', 'customerId', 'customerName', 'type', 'cycleId', 'billId', 'amount', 'date', 'mode',
  'note', 'createdAt', 'openedCycleId', 'creditBefore', 'creditAfter', 'settledAt',
  'dueDateBefore', 'dueDateAfter', 'billMonth',
];

const pick = (row, columns) => Object.fromEntries(columns.filter((c) => c in row).map((c) => [c, row[c]]));

/**
 * ID documents live in private storage, so a snapshot of table rows alone would
 * restore every `photoId` as a path that resolves to nothing in the new account
 * (storage keys are namespaced by the owner's user id). Pull the actual bytes
 * through a short-lived signed URL and carry them in the file.
 */
async function collectImages(customers) {
  const images = {};
  const ids = [
    ...new Set(customers.flatMap((c) => [c.photoId, c.proofImageId]).filter(Boolean)),
  ];

  for (const id of ids) {
    try {
      const url = await getImageUrl(id);
      if (!url) continue;
      const response = await fetch(url);
      if (!response.ok) continue;
      const blob = await response.blob();
      images[id] = await blobToDataUrl(blob);
    } catch {
      // A missing or unreadable document must not fail the whole export.
    }
  }
  return images;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

/** The full account snapshot, as plain camelCase JSON. */
export async function buildSnapshot() {
  const [customers, cycles, lightBills, transactions, settings] = await Promise.all([
    listCustomers(),
    listCycles(),
    listLightBills(),
    listTransactions(),
    loadSettings(),
  ]);

  return {
    app: 'pg-manager',
    format: 'pg-manager.snapshot.v2',
    exportedAt: new Date().toISOString(),
    settings,
    customers: customers.map((c) => pick(c, CUSTOMER_COLUMNS)),
    cycles: cycles.map((c) => pick(c, CYCLE_COLUMNS)),
    lightBills: lightBills.map((b) => pick(b, BILL_COLUMNS)),
    transactions: transactions.map((t) => pick(t, TX_COLUMNS)),
    images: await collectImages(customers),
  };
}

export function snapshotToJSON(snapshot) {
  return JSON.stringify(snapshot, null, 2);
}

const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function toCSV(columns, rows) {
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((c) => csvCell(pick(row, [c])[c])).join(',')).join('\n');
  return `${header}\n${body}`;
}

/** Spreadsheet-friendly tenant sheet: one row per tenant with cycle balance. */
export function customersToCSV(customers) {
  return toCSV(
    ['code', 'name', 'mobile', 'email', 'sharingType', 'rentAmount', 'depositAmount', 'depositPaid',
      'roomNo', 'bedNo', 'joiningDate', 'nextDueDate', 'advanceCredit', 'status', 'notes'],
    customers,
  );
}

/** Spreadsheet-friendly payment history: one row per transaction. */
export function transactionsToCSV(transactions) {
  return toCSV(
    ['date', 'customerName', 'type', 'amount', 'mode', 'note', 'billMonth', 'id'],
    transactions,
  );
}

/**
 * Import a snapshot into the signed-in account. Ids are preserved, so importing
 * the same file twice is a no-op rather than a duplicate.
 */
export async function importSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('That file does not look like a PG Manager backup.');
  }
  const result = await rpc('import_backup', {
    customers: Array.isArray(snapshot.customers) ? snapshot.customers : [],
    cycles: Array.isArray(snapshot.cycles) ? snapshot.cycles : [],
    bills: Array.isArray(snapshot.lightBills) ? snapshot.lightBills : [],
    transactions: Array.isArray(snapshot.transactions) ? snapshot.transactions : [],
  });
  if (snapshot.settings) await saveSettings(snapshot.settings);

  // Rows land first so the tenant records exist, then the documents are written
  // into this account's own storage folder under the same ids the rows point at.
  const images = snapshot.images && typeof snapshot.images === 'object' ? snapshot.images : {};
  let imageCount = 0;
  for (const [id, dataUrl] of Object.entries(images)) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) continue;
    try {
      await uploadImage(id, dataUrl);
      imageCount += 1;
    } catch {
      // Keep going: a rejected document should not undo an otherwise good import.
    }
  }

  return { ...result, images: imageCount };
}

/** Settings -> Erase all tenant data: rows, then every stored document. */
export async function wipeEverything() {
  const counts = await rpc('wipe_all');
  await emptyStorage();
  return counts;
}

/** Best-effort "save this file" helper; returns false if the browser blocked it. */
export function downloadText(filename, text, mime = 'application/json') {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

/** Wipe localStorage remnants of the old on-device store. */
export function clearLegacyLocalData() {
  try {
    // Both the original v1 keys and the v2 ledger keys that shipped after them,
    // plus the schema marker the migration reads to decide whether to re-run.
    const keys = [
      'pgm.customers.v1', 'pgm.customers.v2', 'pgm.cycles.v2', 'pgm.transactions.v2', 'pgm.lightBills.v2',
      'pgm.settings.v1', 'pgm.session.v1', 'pgm.seeded.v1', 'pgm.pin.v1', 'pgm.schemaVersion', 'pgm.backup.v1',
    ];
    for (const key of keys) localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export { TABLES };