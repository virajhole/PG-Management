import { describe, it, expect } from 'vitest';
import {
  money,
  toAmount,
  getRemaining,
  statusFor,
  getPaidPercent,
  applyPayment,
  planRentPayment,
  describeRentPlan,
  monthKey,
  monthRange,
  formatMonthLabel,
  getTodayTotal,
  getMonthTotal,
  sumTransactions,
  filterTransactions,
  toCsv,
  getPendingList,
  getOutstandingTotals,
  TX_RENT,
  TX_LIGHT_BILL,
} from './ledger.js';
import { dayjs } from './dateLogic.js';

const cycle = (overrides = {}) => ({
  id: 'cyc_1',
  customerId: 'cus_1',
  dueDate: '2024-05-10',
  rentAmount: 11500,
  paidAmount: 0,
  remainingAmount: 11500,
  status: 'pending',
  ...overrides,
});

const bill = (overrides = {}) => ({
  id: 'bil_1',
  customerId: 'cus_1',
  month: '2024-05',
  billAmount: 900,
  paidAmount: 0,
  remainingAmount: 900,
  status: 'pending',
  ...overrides,
});

const tx = (overrides = {}) => ({
  id: 'txn_1',
  customerId: 'cus_1',
  customerName: 'Rahul Sharma',
  type: TX_RENT,
  cycleId: 'cyc_1',
  amount: 1000,
  date: '2024-05-10',
  mode: 'cash',
  note: '',
  createdAt: '2024-05-10T10:00:00.000Z',
  ...overrides,
});

describe('money helpers', () => {
  it('rounds to paise and never returns NaN', () => {
    expect(money(11500.005)).toBe(11500.01);
    expect(money('11500.50')).toBe(11500.5);
    expect(money('abc')).toBe(0);
    expect(money(undefined)).toBe(0);
  });

  it('clamps toAmount at zero', () => {
    expect(toAmount(-50)).toBe(0);
    expect(toAmount('2500')).toBe(2500);
  });
});

describe('getRemaining / statusFor / getPaidPercent', () => {
  it('computes the remaining amount for a cycle', () => {
    expect(getRemaining(cycle())).toBe(11500);
    expect(getRemaining(cycle({ paidAmount: 5000 }))).toBe(6500);
    expect(getRemaining(cycle({ paidAmount: 11500 }))).toBe(0);
  });

  it('computes the remaining amount for a light bill', () => {
    expect(getRemaining(bill())).toBe(900);
    expect(getRemaining(bill({ paidAmount: 350 }))).toBe(550);
  });

  it('ignores a stale stored remainingAmount and recomputes it', () => {
    expect(getRemaining(cycle({ paidAmount: 5000, remainingAmount: 99999 }))).toBe(6500);
  });

  it('treats an overpaid cycle as fully settled, never negative', () => {
    expect(getRemaining(cycle({ paidAmount: 12000 }))).toBe(0);
  });

  it('classifies pending / partial / paid', () => {
    expect(statusFor(cycle())).toBe('pending');
    expect(statusFor(cycle({ paidAmount: 1 }))).toBe('partial');
    expect(statusFor(cycle({ paidAmount: 11500 }))).toBe('paid');
    expect(statusFor(null)).toBe('pending');
  });

  it('converts paid amount into a 0-100 percentage', () => {
    expect(getPaidPercent(cycle())).toBe(0);
    expect(getPaidPercent(cycle({ paidAmount: 5750 }))).toBe(50);
    expect(getPaidPercent(cycle({ paidAmount: 11500 }))).toBe(100);
    expect(getPaidPercent(cycle({ rentAmount: 0, paidAmount: 0 }))).toBe(100);
  });
});

describe('applyPayment - partial, exact and overpayment', () => {
  it('marks a part payment as partial and leaves the rest pending', () => {
    const r = applyPayment(cycle(), 5000);
    expect(r.kind).toBe('partial');
    expect(r.applied).toBe(5000);
    expect(r.surplus).toBe(0);
    expect(r.remainingBefore).toBe(11500);
    expect(r.remainingAfter).toBe(6500);
    expect(r.paidAfter).toBe(5000);
    expect(r.settled).toBe(false);
    expect(r.status).toBe('partial');
  });

  it('accumulates successive part payments onto the same cycle', () => {
    const first = applyPayment(cycle(), 5000);
    const second = applyPayment(cycle({ paidAmount: first.paidAfter }), 3000);
    expect(second.paidBefore).toBe(5000);
    expect(second.paidAfter).toBe(8000);
    expect(second.remainingAfter).toBe(3500);
    expect(second.status).toBe('partial');
    expect(second.settled).toBe(false);
  });

  it('settles the cycle on an exact payment', () => {
    const r = applyPayment(cycle(), 11500);
    expect(r.kind).toBe('exact');
    expect(r.remainingAfter).toBe(0);
    expect(r.settled).toBe(true);
    expect(r.status).toBe('paid');
  });

  it('settles the cycle on the exact remainder after a part payment', () => {
    const r = applyPayment(cycle({ paidAmount: 5000 }), 6500);
    expect(r.kind).toBe('exact');
    expect(r.applied).toBe(6500);
    expect(r.surplus).toBe(0);
    expect(r.settled).toBe(true);
  });

  it('caps an overpayment at the remaining and reports the surplus', () => {
    const r = applyPayment(cycle(), 13500);
    expect(r.kind).toBe('over');
    expect(r.applied).toBe(11500);
    expect(r.surplus).toBe(2000);
    expect(r.remainingAfter).toBe(0);
    expect(r.settled).toBe(true);
  });

  it('reports a further payment against a settled cycle as pure excess', () => {
    const r = applyPayment(cycle({ paidAmount: 11500 }), 500);
    expect(r.kind).toBe('excess');
    expect(r.applied).toBe(0);
    expect(r.surplus).toBe(500);
    expect(r.remainingAfter).toBe(0);
  });

  it('rejects a zero or negative amount without touching the balance', () => {
    const r = applyPayment(cycle({ paidAmount: 5000 }), 0);
    expect(r.kind).toBe('none');
    expect(r.paidAfter).toBe(5000);
    expect(r.remainingAfter).toBe(6500);
  });

  it('works identically for a light bill', () => {
    const r = applyPayment(bill(), 350);
    expect(r.kind).toBe('partial');
    expect(r.remainingAfter).toBe(550);
    expect(r.status).toBe('partial');

    const full = applyPayment(bill({ paidAmount: 350 }), 550);
    expect(full.kind).toBe('exact');
    expect(full.remainingAfter).toBe(0);

    const over = applyPayment(bill(), 1000);
    expect(over.kind).toBe('over');
    expect(over.surplus).toBe(100);
  });
});

describe('planRentPayment', () => {
  it('keeps the due date and creates no next cycle for a partial payment', () => {
    const plan = planRentPayment({ cycle: cycle(), amount: 5000, dueDay: 10 });
    expect(plan.kind).toBe('partial');
    expect(plan.settled).toBe(false);
    expect(plan.nextCycle).toBeNull();
    expect(plan.remainingAfter).toBe(6500);
    expect(describeRentPlan(plan)).toMatch(/Partial payment/);
  });

  it('opens the next cycle one month later on an exact payment', () => {
    const plan = planRentPayment({ cycle: cycle(), amount: 11500, dueDay: 10 });
    expect(plan.settled).toBe(true);
    expect(plan.nextCycle.dueDate).toBe('2024-06-10');
    expect(plan.nextCycle.rentAmount).toBe(11500);
    expect(plan.nextCycle.paidAmount).toBe(0);
    expect(plan.nextCycle.status).toBe('pending');
    expect(plan.creditAfter).toBe(0);
  });

  it('carries an overpayment into the next cycle as advance', () => {
    const plan = planRentPayment({ cycle: cycle(), amount: 13500, dueDay: 10 });
    expect(plan.surplus).toBe(2000);
    expect(plan.carriedToNextCycle).toBe(2000);
    expect(plan.nextCycle.paidAmount).toBe(2000);
    expect(plan.nextCycle.remainingAmount).toBe(9500);
    expect(plan.nextCycle.status).toBe('partial');
    expect(plan.creditAfter).toBe(0);
    expect(describeRentPlan(plan)).toMatch(/Rs 2,000 is applied to next month/);
  });

  it('spends existing advance credit on the next cycle first', () => {
    const plan = planRentPayment({ cycle: cycle(), amount: 11500, dueDay: 10, advanceCredit: 3000 });
    expect(plan.nextCycle.paidAmount).toBe(3000);
    expect(plan.nextCycle.remainingAmount).toBe(8500);
    expect(plan.creditAfter).toBe(0);
    expect(describeRentPlan(plan)).toMatch(/existing advance credit/);
  });

  it('combines an overpayment with existing credit', () => {
    const plan = planRentPayment({ cycle: cycle(), amount: 12000, dueDay: 10, advanceCredit: 1000 });
    expect(plan.surplus).toBe(500);
    expect(plan.carriedToNextCycle).toBe(1500);
    expect(plan.creditAfter).toBe(0);
  });

  it('holds a surplus larger than next month rent as credit', () => {
    const plan = planRentPayment({ cycle: cycle(), amount: 30000, dueDay: 10 });
    expect(plan.surplus).toBe(18500);
    expect(plan.carriedToNextCycle).toBe(11500);
    expect(plan.nextCycle.remainingAmount).toBe(0);
    expect(plan.nextCycle.status).toBe('paid');
    expect(plan.creditAfter).toBe(7000);
    expect(describeRentPlan(plan)).toMatch(/advance credit/);
  });

  it('uses the updated rent for the next cycle', () => {
    const plan = planRentPayment({ cycle: cycle(), amount: 11500, dueDay: 10, nextRentAmount: 13000 });
    expect(plan.nextCycle.rentAmount).toBe(13000);
    expect(plan.nextCycle.remainingAmount).toBe(13000);
  });

  it('preserves a 31st anchor when opening the next cycle', () => {
    const plan = planRentPayment({
      cycle: cycle({ dueDate: '2024-01-31', rentAmount: 10500 }),
      amount: 10500,
      dueDay: 31,
    });
    expect(plan.nextCycle.dueDate).toBe('2024-02-29'); // leap year clamp
  });
});

describe('month helpers', () => {
  it('derives a YYYY-MM key', () => {
    expect(monthKey('2024-05-17')).toBe('2024-05');
    expect(monthKey(dayjs('2024-12-01'))).toBe('2024-12');
  });

  it('builds an inclusive range for a month', () => {
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthRange('2023-02')).toEqual({ from: '2023-02-01', to: '2023-02-28' });
  });

  it('labels a month for humans', () => {
    expect(formatMonthLabel('2024-05')).toBe('May 2024');
  });
});

describe('collection totals', () => {
  const list = [
    tx({ id: 'a', amount: 11500, date: '2024-05-10', type: TX_RENT }),
    tx({ id: 'b', amount: 350, date: '2024-05-10', type: TX_LIGHT_BILL }),
    tx({ id: 'c', amount: 5000, date: '2024-05-02', type: TX_RENT }),
    tx({ id: 'd', amount: 900, date: '2024-04-28', type: TX_LIGHT_BILL }),
  ];

  it('sums a mixed list with a rent / light bill split', () => {
    const t = sumTransactions(list);
    expect(t.total).toBe(17750);
    expect(t.rent).toBe(16500);
    expect(t.lightBill).toBe(1250);
    expect(t.count).toBe(4);
  });

  it('totals a single day', () => {
    const t = getTodayTotal(list, '2024-05-10');
    expect(t.total).toBe(11850);
    expect(t.rent).toBe(11500);
    expect(t.lightBill).toBe(350);
    expect(t.count).toBe(2);
  });

  it('returns zero for a day with no payments', () => {
    expect(getTodayTotal(list, '2024-05-11')).toMatchObject({ total: 0, rent: 0, lightBill: 0, count: 0 });
  });

  it('totals a calendar month', () => {
    const t = getMonthTotal(list, '2024-05');
    expect(t.total).toBe(16850);
    expect(t.rent).toBe(16500);
    expect(t.lightBill).toBe(350);
    expect(getMonthTotal(list, '2024-04').total).toBe(900);
  });
});

describe('filterTransactions', () => {
  const list = [
    tx({ id: 'a', customerName: 'Rahul Sharma', amount: 11500, date: '2024-05-10', type: TX_RENT, mode: 'upi' }),
    tx({ id: 'b', customerName: 'Aman Verma', amount: 350, date: '2024-05-09', type: TX_LIGHT_BILL, mode: 'cash', note: 'May units' }),
    tx({ id: 'c', customerName: 'Priya Nair', amount: 5000, date: '2024-04-02', type: TX_RENT, mode: 'bank' }),
  ];

  it('returns everything sorted newest first when unfiltered', () => {
    expect(filterTransactions(list).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('filters by type', () => {
    expect(filterTransactions(list, { type: TX_LIGHT_BILL }).map((t) => t.id)).toEqual(['b']);
    expect(filterTransactions(list, { type: TX_RENT }).map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('filters by mode', () => {
    expect(filterTransactions(list, { mode: 'bank' }).map((t) => t.id)).toEqual(['c']);
  });

  it('filters by a custom date range', () => {
    const result = filterTransactions(list, { range: 'custom', from: '2024-05-01', to: '2024-05-31' });
    expect(result.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('filters by a custom range with only one bound set', () => {
    expect(filterTransactions(list, { range: 'custom', from: '2024-05-10' }).map((t) => t.id)).toEqual(['a']);
  });

  it('searches the customer name and the note', () => {
    expect(filterTransactions(list, { query: 'rahul' }).map((t) => t.id)).toEqual(['a']);
    expect(filterTransactions(list, { query: 'units' }).map((t) => t.id)).toEqual(['b']);
  });

  it('combines filters', () => {
    const result = filterTransactions(list, { type: TX_RENT, range: 'custom', from: '2024-05-01', to: '2024-05-31' });
    expect(result.map((t) => t.id)).toEqual(['a']);
  });
});

describe('toCsv', () => {
  it('writes a header and one row per transaction', () => {
    const csv = toCsv([tx({ amount: 11500, date: '2024-05-10' })]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Date,Tenant,Type,Amount (Rs),Mode,Reference,Note');
    expect(lines[1]).toBe('2024-05-10,Rahul Sharma,Rent,11500.00,cash,cyc_1,');
  });

  it('labels light bills and escapes notes containing commas or quotes', () => {
    const csv = toCsv([tx({ type: TX_LIGHT_BILL, billId: 'bil_9', cycleId: undefined, note: 'units "peak", June' })]);
    const line = csv.split('\r\n')[1];
    expect(line).toContain('Light bill');
    expect(line).toContain('"units ""peak"", June"');
  });
});

describe('getPendingList', () => {
  const customers = [
    { id: 'cus_1', name: 'Rahul Sharma', mobile: '9876543210', code: 'PG-0001', rentAmount: 11500, nextDueDate: '2024-05-10' },
    { id: 'cus_2', name: 'Aman Verma', mobile: '9123456780', code: 'PG-0002', rentAmount: 13000, nextDueDate: '2024-06-12' },
    { id: 'cus_3', name: 'Sneha Patil', mobile: '9988776655', code: 'PG-0003', rentAmount: 11500, nextDueDate: '2024-05-12', status: 'inactive' },
    { id: 'cus_4', name: 'Imran Sheikh', mobile: '9555444332', code: 'PG-0004', rentAmount: 10500, nextDueDate: '2024-06-30', advanceCredit: 500 },
  ];

  const cycles = [
    cycle({ id: 'cyc_1', customerId: 'cus_1', dueDate: '2024-05-10', paidAmount: 5000 }),
    cycle({ id: 'cyc_2', customerId: 'cus_2', dueDate: '2024-06-12', rentAmount: 13000 }),
    cycle({ id: 'cyc_3', customerId: 'cus_3', dueDate: '2024-05-12' }),
    cycle({ id: 'cyc_4', customerId: 'cus_4', dueDate: '2024-06-30', rentAmount: 10500, paidAmount: 10500 }),
  ];

  const lightBills = [
    bill({ id: 'bil_1', customerId: 'cus_1', month: '2024-05', billAmount: 900, paidAmount: 350 }),
    bill({ id: 'bil_2', customerId: 'cus_2', month: '2024-05', billAmount: 1200 }),
  ];

  it('lists only customers with a balance', () => {
    const rows = getPendingList({ customers, cycles, lightBills, today: dayjs('2024-05-10') });
    expect(rows.map((r) => r.name)).toEqual(['Rahul Sharma', 'Aman Verma']);
  });

  it('keeps rent and light bill remaining separate', () => {
    const [rahul] = getPendingList({ customers, cycles, lightBills, today: dayjs('2024-05-10') });
    expect(rahul.rentRemaining).toBe(6500);
    expect(rahul.lightRemaining).toBe(550);
    expect(rahul.totalRemaining).toBe(7050);
    expect(rahul.rentPaid).toBe(5000);
    expect(rahul.rentStatus).toBe('partial');
  });

  it('reports days overdue, negative when not yet due', () => {
    const [rahul, aman] = getPendingList({ customers, cycles, lightBills, today: dayjs('2024-05-10') });
    expect(rahul.daysOverdue).toBe(0);
    expect(aman.dueDate).toBe('2024-06-12');
    expect(aman.daysOverdue).toBe(-33);
  });

  it('sorts the most overdue tenant first', () => {
    const rows = getPendingList({
      customers,
      cycles: [cycles[1], { ...cycles[0], dueDate: '2024-04-10' }, cycles[3]],
      lightBills: [],
      today: dayjs('2024-05-10'),
    });
    expect(rows[0].name).toBe('Rahul Sharma'); // due 10 Apr, 30 days late
  });

  it('excludes a tenant whose only balance is advance credit', () => {
    const rows = getPendingList({ customers, cycles, lightBills: [], today: dayjs('2024-05-10') });
    expect(rows.map((r) => r.name)).not.toContain('Imran Sheikh');
  });

  it('surfaces advance credit on the row', () => {
    const rows = getPendingList({
      customers,
      cycles: [{ ...cycles[3], paidAmount: 10000 }],
      lightBills: [],
      today: dayjs('2024-05-10'),
    });
    expect(rows[0].advanceCredit).toBe(500);
    expect(rows[0].rentRemaining).toBe(500);
  });

  it('handles an empty install', () => {
    expect(getPendingList()).toEqual([]);
    expect(getOutstandingTotals()).toEqual({ rent: 0, lightBill: 0 });
  });

  it('totals outstanding rent and light bills separately', () => {
    const totals = getOutstandingTotals({ cycles, lightBills });
    expect(totals.rent).toBe(6500 + 13000 + 11500);
    expect(totals.lightBill).toBe(550 + 1200);
  });
});
