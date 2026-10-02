import { createCustomer, normalizeCustomer, getCustomer } from './customerService.js';
import { ensureOpenCycle } from './cycleService.js';
import { recordRentPayment, saveLightBill, recordLightBillPayment } from './transactionService.js';
import * as roomService from './roomService.js';
import { dayjs } from '../utils/dateLogic.js';
import { DEFAULT_SETTINGS } from './settingsService.js';

/**
 * Demo data so the whole ledger can be checked the moment you press the button:
 * one overdue tenant with a *partial* rent payment and a pending light bill, a
 * few settled cycles, and transactions dated today and earlier this month. Dates
 * are generated relative to *today*, so the sample always shows the red /
 * yellow / green coding whenever it is seeded.
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
      bedNo: 1,
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
      bedNo: 3,
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
      bedNo: 4,
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
      bedNo: 2,
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
      bedNo: 2,
      depositAmount: 5000,
    }),
  ];

  return samples;
}

/**
 * Rooms the samples above live in, across three floors, with enough spare beds
 * that the admission picker, the move dialog and the vacancy counters all have
 * something to show. `monthlyRent: null` on most rooms means "use the Settings
 * price", which is the common case; one room carries an override to prove the
 * two can coexist.
 */
export function buildSampleRooms() {
  return [
    // Ground floor
    { floor: 0, roomNo: '101', sharingType: 1, hasAc: true, hasAttachedBathroom: true, notes: 'Single room, corner.' },
    { floor: 0, roomNo: '102', sharingType: 2, hasAc: false, hasAttachedBathroom: true },
    { floor: 0, roomNo: '103', sharingType: 3, hasAc: false, hasAttachedBathroom: true, notes: 'Spare triple, north side.' },
    // First floor
    { floor: 1, roomNo: '204', sharingType: 2, hasAc: true, hasAttachedBathroom: true },
    { floor: 1, roomNo: '205', sharingType: 3, hasAc: true, hasAttachedBathroom: false, notes: 'Common bathroom on the floor.' },
    // Rent override: this room is cheaper than the 3-sharing default.
    { floor: 1, roomNo: '207', sharingType: 2, monthlyRent: 9000, hasAc: true, hasAttachedBathroom: true, notes: 'Discounted - near the lift.' },
    // Second floor
    { floor: 2, roomNo: '310', sharingType: 3, hasAc: true, hasAttachedBathroom: true },
    { floor: 2, roomNo: '405', sharingType: 4, hasAc: true, hasAttachedBathroom: true },
    { floor: 2, roomNo: '502', sharingType: 5, hasAc: true, hasAttachedBathroom: true, notes: 'Full occupancy room.' },
    { floor: 2, roomNo: '503', sharingType: 5, hasAc: false, hasAttachedBathroom: true, notes: 'Under maintenance - do not allocate.' },
  ].map((room) => ({ hasAc: false, hasAttachedBathroom: false, monthlyRent: null, isActive: true, ...room }));
}

/**
 * Insert the samples through the ledger itself (never the legacy `addPayment`),
 * so the seeded state demonstrates real partial payments, bill entries and a
 * non-empty transaction log.
 *
 *   Rahul   overdue, partial 5,000 of 11,500 today, plus a pending light bill
 *   Priya   due tomorrow, settled this month in full via bank
 *   Aman    due in 3 days, partial 8,000 of ~rent today
 *   Sneha   due in 20 days, untouched
 *   Imran   due today, just admitted, partial 5,000 via UPI
 *   Deepak  paid ahead - last month settled 5 days ago
 */
export async function seedSampleData() {
  const samples = buildSampleCustomers();
  const created = [];

  // Rooms first: admission assigns a bed through the same locked RPC the real
  // form uses, so the seeded occupancy is genuinely consistent with the ledger
  // rather than just room numbers typed into a text field.
  const rooms = [];
  for (const room of buildSampleRooms()) {
    rooms.push(await roomService.createRoom(room));
  }
  const roomByNo = new Map(rooms.map((room) => [room.roomNo, room]));

  for (const sample of samples) {
    const { id, code, createdAt, updatedAt, payments, ...rest } = sample;
    void id;
    void code;
    void createdAt;
    void updatedAt;
    void payments;

    const room = roomByNo.get(rest.roomNo);
    let customer;
    if (room) {
      // The RPC returns the new id, so read the record back to get the stored
      // row (generated code, server-side rent, status).
      const { customerId } = await roomService.admitCustomer(rest, room.id, rest.bedNo);
      customer = await getCustomer(customerId);
    } else {
      customer = await createCustomer(rest);
    }
    await ensureOpenCycle(customer);
    created.push(customer);
  }

  const [rahul, priya, aman, sneha, imran, deepak] = created;
  const today = dayjs().startOf('day');
  const startOfMonth = today.startOf('month');

  // A date earlier this month, never pushed past today when the month is young.
  const earlierThisMonth = (dayOffset) => {
    const candidate = startOfMonth.add(dayOffset, 'day');
    return candidate.isAfter(today) ? today : candidate;
  };

  // Rahul: the classic partial-payment case - paid 5,000 today of an 11,500 rent,
  // still overdue, with this month's light bill left pending and clearly broken up.
  await recordRentPayment({
    customerId: rahul.id,
    amount: 5000,
    date: today.format('YYYY-MM-DD'),
    mode: 'cash',
    note: 'Partial rent payment',
  });
  await saveLightBill({
    customerId: rahul.id,
    units: 80,
    ratePerUnit: 4.25,
    billAmount: 700, // 80 x 4.25 = 340 + 360 fixed charges
    note: '80 units x Rs 4.25 = Rs 340 + Rs 360 fixed charges',
  });

  // Imran: joining today, first rent due today, a partial UPI payment since morning.
  await recordRentPayment({
    customerId: imran.id,
    amount: 5000,
    date: today.format('YYYY-MM-DD'),
    mode: 'upi',
    note: 'First month - partial payment',
  });

  // Aman: partial payment today, due in 3 days.
  await recordRentPayment({
    customerId: aman.id,
    amount: 8000,
    date: today.format('YYYY-MM-DD'),
    mode: 'upi',
    note: 'Partial rent payment',
  });

  // Priya: settled last month in full, via bank, earlier this month.
  await recordRentPayment({
    customerId: priya.id,
    amount: priya.rentAmount,
    date: earlierThisMonth(5).format('YYYY-MM-DD'),
    mode: 'bank',
    note: 'Rent for last month through bank transfer',
  });

  // Deepak: healthy tenant, settled his previous cycle in full, 5 days ago.
  await recordRentPayment({
    customerId: deepak.id,
    amount: deepak.rentAmount,
    date: earlierThisMonth(5).format('YYYY-MM-DD'),
    mode: 'cash',
    note: 'Rent for last month',
  });

  // Give Deepak's settled cycle a paid light bill for context.
  const deepakBill = await saveLightBill({
    customerId: deepak.id,
    units: 95,
    ratePerUnit: 4.25,
    billAmount: 764, // 403.75 + 360 fixed
    note: '95 units x Rs 4.25 = Rs 403.75 + Rs 360 fixed charges',
  });
  await recordLightBillPayment({
    customerId: deepak.id,
    billId: deepakBill.id,
    amount: deepakBill.billAmount,
    date: earlierThisMonth(3).format('YYYY-MM-DD'),
    mode: 'bank',
    note: 'Paid in full',
  });

  // Sneha has given notice, leaving in two weeks. She still holds bed 4 in room
  // 405, so the occupancy counters must keep counting her until she checks out.
  // Without this the seeded "leaving soon" panel on the dashboard is empty.
  await roomService.giveNotice(
    sneha.id,
    today.add(14, 'day').format('YYYY-MM-DD'),
    'Moving to a hostel nearer college.',
  );

  return created;
}