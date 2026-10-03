import { listCustomers } from './customerService.js';
import { listCycles } from './cycleService.js';
import { listLightBills } from './lightBillService.js';
import { listTransactions } from './transactionService.js';
import { loadSettings } from './settingsService.js';
import { downloadBlob } from '../utils/download.js';

/**
 * Export backup: one JSON file with everything, plus a spreadsheet-friendly
 * CSV of the tenants. Import is deliberately not offered - restoring a backup
 * is a Supabase-support task, not a button.
 */

export async function snapshot() {
  const [customers, cycles, lightBills, transactions, settings] = await Promise.all([
    listCustomers(),
    listCycles(),
    listLightBills(),
    listTransactions(),
    loadSettings(),
  ]);
  return { exportedAt: new Date().toISOString(), settings, customers, cycles, lightBills, transactions };
}

export function snapshotToJSON(snapshotData) {
  return JSON.stringify(snapshotData, null, 2);
}

/** One row per tenant with their open-cycle balance, for spreadsheets. */
export function customersToCSV(customers, openCycleByCustomer = new Map()) {
  const header = ['Name', 'Mobile', 'Room', 'Bed', 'Sharing', 'Rent', 'Paid', 'Remaining', 'Next due', 'Status'];
  const cell = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = customers.map((customer) => {
    const cycle = openCycleByCustomer.get(customer.id);
    const remaining = cycle ? Math.max(0, (Number(cycle.rentAmount) || 0) - (Number(cycle.paidAmount) || 0)) : 0;
    return [
      customer.name,
      customer.mobile,
      customer.roomNo,
      customer.bedNo,
      customer.sharingType,
      customer.rentAmount,
      (Number(customer.rentAmount) || 0) - remaining,
      remaining,
      customer.nextDueDate,
      customer.status,
    ];
  });
  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
}

export async function downloadBackup(openCycleByCustomer = new Map()) {
  const data = await snapshot();
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(new Blob([snapshotToJSON(data)], { type: 'application/json' }), `pg-backup-${stamp}.json`);
  downloadBlob(
    new Blob([customersToCSV(data.customers, openCycleByCustomer)], { type: 'text/csv;charset=utf-8' }),
    `pg-tenants-${stamp}.csv`,
  );
  return data;
}
