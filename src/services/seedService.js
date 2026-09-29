import { readJSON, writeJSON, KEYS } from './localStore.js';
import { normalizeCustomer, createCustomer, addPayment } from './customerService.js';
import { dayjs, getCycleStart, createId } from '../utils/dateLogic.js';
import { DEFAULT_SETTINGS } from './settingsService.js';

/**
 * Demo data so the red / yellow / green coding can be checked the moment the
 * app opens. Dates are generated relative to *today* rather than hard-coded,
 * so the sample always shows one overdue, one due in 3 days and one due in 20
 * days whenever it is seeded.
 */

/** Build a customer whose next rent due date lands `offsetDays` from today. */
function buildCustomer(offsetDays, overrides = {}) {
  const due = dayjs().startOf('day').add(offsetDays, 'day');
  const dueDay = due.date();
  const joined = due.subtract(1, 'month');

  return normalizeCustomer({
    name: 'Sample Tenant',
    joiningDate: joined.format('YYYY-MM-DD'),
    dueDay,
    nextDueDate: due.format('YYYY-MM-DD'),
    ...overrides,
  });
}

export function buildSampleCustomers() {
  const samples = [
    buildCustomer(-6, {
      name: 'Rahul Sharma',
      mobile: '9876543210',
      email: 'rahul.sharma@gmail.com',
      guardianName: 'Mohan Lal Sharma',
      guardianPhone: '9811122233',
      address: '12, Model Town, Sector 4, Gurugram',
      occupation: 'Software Engineer at Zoho',
      proofType: 'AADHAAR',
      proofId: '432198765432',
      sharingType: 2,
      rentAmount: DEFAULT_SETTINGS.sharingPrices[2],
      roomNo: '204',
      bedNo: 'A',
      depositAmount: 5000,
      notes: 'Requested a top bunk. Vegetarian.',
    }),
    buildCustomer(-1, {
      name: 'Priya Nair',
      mobile: '9765432109',
      email: 'priya.nair@outlook.com',
      guardianName: 'Suresh Nair',
      guardianPhone: '9845566778',
      address: '45, 7th Cross, Indiranagar, Bengaluru',
      occupation: 'CA Final - ICAI',
      proofType: 'PAN',
      proofId: 'ABCDE1234F',
      sharingType: 1,
      rentAmount: DEFAULT_SETTINGS.sharingPrices[1],
      roomNo: '101',
      depositAmount: 8000,
      notes: 'Single room. Keeps an inverter backup at all times.',
    }),
    buildCustomer(3, {
      name: 'Aman Verma',
      mobile: '9123456780',
      email: 'aman.verma@gmail.com',
      guardianName: 'Rakesh Verma',
      guardianPhone: '9898989898',
      address: 'B-12, Sector 62, Noida',
      occupation: 'B.Tech CSE, 2nd year - NIIT',
      proofType: 'AADHAAR',
      proofId: '556677889900',
      sharingType: 3,
      rentAmount: DEFAULT_SETTINGS.sharingPrices[3],
      roomNo: '310',
      bedNo: 'C',
      depositAmount: 5000,
    }),
    buildCustomer(20, {
      name: 'Sneha Patil',
      mobile: '9988776655',
      guardianName: 'Kiran Patil',
      guardianPhone: '9112233445',
      address: '8, Kalyani Nagar, Pune',
      occupation: 'Nurse, Sahyadri Hospital',
      proofType: 'PAN',
      proofId: 'ZXCVB9876K',
      sharingType: 4,
      rentAmount: DEFAULT_SETTINGS.sharingPrices[4],
      roomNo: '405',
      bedNo: 'D',
      depositAmount: 5000,
    }),
    buildCustomer(0, {
      name: 'Imran Sheikh',
      mobile: '9555444332',
      guardianName: 'Farida Sheikh',
      guardianPhone: '9333222111',
      address: '22, Charholi, Nagpur',
      occupation: 'Delivery Partner',
      proofType: 'AADHAAR',
      proofId: '778899001122',
      sharingType: 5,
      rentAmount: DEFAULT_SETTINGS.sharingPrices[5],
      roomNo: '502',
      bedNo: 'B',
      depositAmount: 5000,
      notes: 'Joining today - first rent due today.',
    }),
    buildCustomer(25, {
      name: 'Deepak Joshi',
      mobile: '9009009009',
      guardianName: 'Mahesh Joshi',
      guardianPhone: '9222333444',
      address: '3, Shivaji Nagar, Nashik',
      occupation: 'Branch Manager, HDFC Bank',
      proofType: 'AADHAAR',
      proofId: '223344556677',
      sharingType: 2,
      rentAmount: DEFAULT_SETTINGS.sharingPrices[2],
      roomNo: '207',
      bedNo: 'B',
      depositAmount: 5000,
    }),
  ];

  return samples;
}

/** Insert the samples, including one settled payment so "Paid" has a member. */
export async function seedSampleData() {
  const samples = buildSampleCustomers();
  const created = [];

  for (const sample of samples) {
    const { id, code, createdAt, updatedAt, payments, ...rest } = sample;
    void id;
    void code;
    void createdAt;
    void updatedAt;
    void payments;
    const record = await createCustomer(rest);
    created.push(record);
  }

  // Deepak Joshi is the healthy/paid one: his previous cycle was settled on time.
  const deepak = created[created.length - 1];
  if (deepak) {
    const previousDue = getCycleStart(deepak.nextDueDate, deepak.dueDay);
    await addPayment(deepak.id, {
      amount: deepak.rentAmount,
      date: previousDue,
      mode: 'upi',
      note: 'Rent for last month',
    });
  }

  return created;
}

/** Seed once, on first launch only. */
export async function ensureSeeded() {
  const alreadySeeded = readJSON(KEYS.seeded, false);
  const existing = readJSON(KEYS.customers, null);
  const hasCustomers = Array.isArray(existing) && existing.length > 0;
  if (alreadySeeded || hasCustomers) return false;

  await seedSampleData();
  writeJSON(KEYS.seeded, true);
  return true;
}

export function wasSeeded() {
  return readJSON(KEYS.seeded, false);
}

export { createId };
