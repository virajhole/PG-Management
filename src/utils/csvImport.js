import Papa from 'papaparse';
import { normalizeCustomer } from '../services/customerService.js';
import { AADHAAR_RE, PAN_RE, MOBILE_RE } from './validation.js';
import { dayjs, todayISO } from './dateLogic.js';

/**
 * Bulk tenant import from CSV (Excel exports CSV fine).
 *
 * parseImport(text) -> { rows, errors } where each row is either validated and
 * normalized (ready for createCustomer) or carries a human-readable error for
 * its 1-based line. Nothing is written until the admin confirms the preview.
 */

export const IMPORT_COLUMNS = [
  { key: 'name', label: 'name', required: true, example: 'Ravi Kumar', hint: 'Full name (required)' },
  { key: 'mobile', label: 'mobile', required: true, example: '9876543210', hint: '10-digit mobile (required)' },
  { key: 'sharingType', label: 'sharingType', required: false, example: '2', hint: '1-5, default 1' },
  { key: 'rentAmount', label: 'rentAmount', required: false, example: '15000', hint: 'Monthly rent' },
  { key: 'depositAmount', label: 'depositAmount', required: false, example: '5000', hint: 'Security deposit' },
  { key: 'roomNo', label: 'roomNo', required: false, example: '204', hint: 'Room number (display only)' },
  { key: 'bedNo', label: 'bedNo', required: false, example: '1', hint: 'Bed number' },
  { key: 'joiningDate', label: 'joiningDate', required: false, example: '2026-10-01', hint: 'YYYY-MM-DD' },
  { key: 'proofType', label: 'proofType', required: false, example: 'AADHAAR', hint: 'AADHAAR or PAN' },
  { key: 'proofId', label: 'proofId', required: false, example: '432198765432', hint: 'ID number' },
  { key: 'email', label: 'email', required: false, example: 'ravi@gmail.com', hint: 'Optional' },
  { key: 'occupation', label: 'occupation', required: false, example: 'Student', hint: 'Optional' },
  { key: 'guardianName', label: 'guardianName', required: false, example: 'Suresh Kumar', hint: 'Optional' },
  { key: 'guardianPhone', label: 'guardianPhone', required: false, example: '9811122233', hint: 'Optional' },
  { key: 'address', label: 'address', required: false, example: '12 MG Road, Pune', hint: 'Optional' },
];

/** Downloadable sample CSV. */
export function sampleCsv() {
  const header = IMPORT_COLUMNS.map((c) => c.label).join(',');
  const rows = IMPORT_COLUMNS.map((c) => c.example).join(',');
  return `# PG Manager tenant import template\n${header}\n${rows}\n`;
}

function isValidMobile(value) {
  return MOBILE_RE.test(String(value ?? '').replace(/\D/g, ''));
}

function isValidProofId(type, value) {
  const v = String(value ?? '').toUpperCase();
  return type === 'PAN' ? PAN_RE.test(v) : AADHAAR_RE.test(v.replace(/\D/g, ''));
}

function coerce(row) {
  const out = {};
  for (const col of IMPORT_COLUMNS) {
    const raw = row[col.label];
    out[col.key] = typeof raw === 'string' ? raw.trim() : raw;
  }
  return out;
}

function validate(entry, lineNumber) {
  const errors = [];
  if (!entry.name) errors.push('name is required');
  if (!entry.mobile) errors.push('mobile is required');
  else if (!isValidMobile(entry.mobile)) errors.push(`mobile "${entry.mobile}" is not a valid 10-digit number`);

  const sharing = Number(entry.sharingType) || 1;
  if (entry.sharingType && (sharing < 1 || sharing > 5)) errors.push('sharingType must be 1-5');

  if (entry.proofId) {
    const type = (entry.proofType || 'AADHAAR').toUpperCase();
    if (!isValidProofId(type, entry.proofId)) errors.push(`${type.toLowerCase()} id "${entry.proofId}" is not valid`);
  }

  if (entry.joiningDate && !dayjs(entry.joiningDate).isValid()) errors.push(`joiningDate "${entry.joiningDate}" is not a real date`);

  if (errors.length) {
    return { ok: false, lineNumber, errors };
  }

  const normalized = normalizeCustomer({
    name: entry.name,
    mobile: entry.mobile,
    sharingType: sharing,
    rentAmount: Number(entry.rentAmount) || 0,
    depositAmount: Number(entry.depositAmount) || 0,
    roomNo: entry.roomNo || '',
    bedNo: entry.bedNo || '',
    joiningDate: entry.joiningDate || todayISO(),
    proofType: (entry.proofType || 'AADHAAR').toUpperCase(),
    proofId: entry.proofId || '',
    email: entry.email || '',
    occupation: entry.occupation || '',
    guardianName: entry.guardianName || '',
    guardianPhone: entry.guardianPhone || '',
    address: entry.address || '',
    status: 'active',
  });
  return { ok: true, lineNumber, customer: normalized };
}

/** Parse CSV text into validated rows + errors (nothing is written). */
export function parseImport(text) {
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase(),
    comments: '#',
  });

  const rows = [];
  const errors = [];

  (parsed.data ?? []).forEach((raw, i) => {
    const lineNumber = i + 2; // +1 header, +1 for 1-based lines
    const entry = coerce(raw);
    const result = validate(entry, lineNumber);
    if (result.ok) rows.push(result.customer);
    else errors.push({ lineNumber, errors: result.errors });
  });

  return { rows, errors };
}

/** Run a validated import through createCustomer one by one. */
export async function runImport(customers, createCustomer) {
  let imported = 0;
  const failed = [];
  for (const customer of customers) {
    try {
      await createCustomer(customer);
      imported += 1;
    } catch (err) {
      failed.push({ name: customer.name, error: err.message });
    }
  }
  return { imported, failed };
}
