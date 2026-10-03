import { TABLES, insertRow } from './supabaseFake.js';
import { recordRentPayment, recordLightBillPayment } from '../services/transactionService.js';
import { saveLightBill } from '../services/lightBillService.js';
import { dayjs } from '../utils/dateLogic.js';

/**
 * Sample data for tests - the same four tenants supabase/seed.sql creates:
 *   Rahul   overdue 6 days, partial 5,000 of 15,000 (2 sharing, room 101)
 *   Priya   due in 3 days, last month settled in full (2 sharing, room 101)
 *   Aman    due in 20 days, partial 8,000 of 18,000 (no room)
 *   Deepak  paid ahead, with a partially paid light bill (no room)
 *
 * Everything is written through the real service layer, exactly the way the
 * UI does it, so the ledger rules are exercised end to end.
 */

const iso = (d) => d.format('YYYY-MM-DD');

export async function seedSampleData() {
  const [room101] = await Promise.all([
    insertRow(TABLES.rooms, { floor: 1, roomNo: '101', sharingType: 2, monthlyRent: 15000 }),
  ]);
  await insertRow(TABLES.rooms, { floor: 1, roomNo: '102', sharingType: 3 });

  const today = dayjs().startOf('day');

  const [rahul, priya, aman, deepak] = await Promise.all([
    insertRow(TABLES.customers, {
      name: 'Rahul Sharma',
      mobile: '9876543210',
      guardianName: 'Suresh Sharma',
      proofType: 'AADHAAR',
      proofId: '123456789012',
      joiningDate: iso(today.subtract(36, 'day')),
      sharingType: 2,
      rentAmount: 15000,
      depositAmount: 5000,
      roomId: room101.id,
      roomNo: '101',
      bedNo: '1',
    }),
    insertRow(TABLES.customers, {
      name: 'Priya Nair',
      mobile: '9123456780',
      proofType: 'PAN',
      proofId: 'ABCDE1234F',
      joiningDate: iso(today.subtract(63, 'day')),
      sharingType: 2,
      rentAmount: 15000,
      depositAmount: 5000,
      roomId: room101.id,
      roomNo: '101',
      bedNo: '2',
    }),
    insertRow(TABLES.customers, {
      name: 'Aman Verma',
      mobile: '9988776655',
      proofType: 'AADHAAR',
      proofId: '234567890123',
      joiningDate: iso(today.subtract(10, 'day')),
      sharingType: 1,
      rentAmount: 18000,
      depositAmount: 5000,
    }),
    insertRow(TABLES.customers, {
      name: 'Deepak Rao',
      mobile: '9555444332',
      proofType: 'AADHAAR',
      proofId: '345678901234',
      joiningDate: iso(today.subtract(40, 'day')),
      sharingType: 1,
      rentAmount: 18000,
      depositAmount: 5000,
    }),
  ]);

  // Rahul: open cycle due 6 days ago, 5,000 of 15,000 paid -> red, partial.
  const [rahulCycle] = await Promise.all([
    insertRow(TABLES.cycles, { customerId: rahul.id, dueDate: iso(today.subtract(6, 'day')), rentAmount: 15000 }),
  ]);
  await recordRentPayment({ customerId: rahul.id, amount: 5000, date: iso(today.subtract(3, 'day')), mode: 'cash', note: 'Partial rent payment' });

  // Priya: last month settled in full - the payment's roll-forward opens the
  // current cycle due in ~3 days, unpaid -> green.
  await insertRow(TABLES.cycles, { customerId: priya.id, dueDate: iso(today.subtract(27, 'day')), rentAmount: 15000 });
  await recordRentPayment({ customerId: priya.id, amount: 15000, date: iso(today.subtract(30, 'day')), mode: 'upi', note: 'Last month rent' });

  // Aman: due in 20 days, partial 8,000 of 18,000 -> green, partial.
  const [amanCycle] = await Promise.all([
    insertRow(TABLES.cycles, { customerId: aman.id, dueDate: iso(today.add(20, 'day')), rentAmount: 18000 }),
  ]);
  await recordRentPayment({ customerId: aman.id, amount: 8000, date: iso(today.subtract(2, 'day')), mode: 'cash', note: 'Partial rent payment' });

  // Deepak: rent paid in advance - the settle rolls the cycle to next month.
  const [deepakCycle] = await Promise.all([
    insertRow(TABLES.cycles, { customerId: deepak.id, dueDate: iso(today.add(20, 'day')), rentAmount: 18000 }),
  ]);
  await recordRentPayment({ customerId: deepak.id, amount: 18000, date: iso(today.subtract(5, 'day')), mode: 'bank', note: 'Rent paid in advance' });

  // Deepak's light bill, partially paid.
  const bill = await saveLightBill({
    customerId: deepak.id,
    month: iso(today).slice(0, 7),
    billAmount: 700,
    note: '80 units + fixed charges',
  });
  await recordLightBillPayment({ customerId: deepak.id, billId: bill.id, amount: 200, date: iso(today.subtract(1, 'day')), mode: 'cash' });

  return { rahul, priya, aman, deepak, rahulCycle, amanCycle, deepakCycle, bill };
}
