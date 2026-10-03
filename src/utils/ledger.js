import { dayjs, daysDiff, advanceDueDate } from './dateLogic.js';

/**
 * Pure ledger maths for rent cycles, light bills and transactions.
 *
 * Nothing in this file reads or writes storage - it takes plain objects and
 * returns plain objects, which is what makes the partial / exact / overpayment
 * rules straightforward to unit test and safe to reuse from a service, a dialog
 * preview or a report.
 *
 * Vocabulary used throughout the app:
 *   cycle  - one month of rent for one tenant (due date, rent, paid, remaining)
 *   bill   - one month of electricity for one tenant, tracked completely
 *            separately from rent
 *   credit - money handed over early that is not yet owed (advance credit)
 */

export const TX_RENT = 'RENT';
export const TX_LIGHT_BILL = 'LIGHT_BILL';
// Written by the checkout RPC. It is money going *out* (a deposit refund), not
// a payment against a cycle, so it never reduces what a tenant owes.
export const TX_REFUND = 'REFUND';

export const TX_TYPES = [
  { value: 'all', label: 'All' },
  { value: TX_RENT, label: 'Rent' },
  { value: TX_LIGHT_BILL, label: 'Light bill' },
  { value: TX_REFUND, label: 'Deposit refund' },
];

/** True when a transaction adds to cash in rather than taking it out. */
export function isIncoming(tx) {
  return tx?.type !== TX_REFUND;
}

export const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank', label: 'Bank transfer' },
];

export const STATUS_PENDING = 'pending';
export const STATUS_PARTIAL = 'partial';
export const STATUS_PAID = 'paid';

/** Round to paise, kill NaN/Infinity, and never return a negative amount. */
export function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Coerce to a non-negative amount. */
export function toAmount(value) {
  return Math.max(0, money(value));
}

/**
 * What is still owed on a cycle or a bill.
 *
 * `remainingAmount` is stored for readable exports, but it is always recomputed
 * from the two source-of-truth numbers so a stale copy can never be trusted.
 */
export function getRemaining(item) {
  if (!item) return 0;
  const total = toAmount(item.billAmount ?? item.rentAmount);
  const paid = toAmount(item.paidAmount);
  return money(Math.max(0, total - paid));
}

/** pending -> nothing paid, partial -> some paid, paid -> settled. */
export function statusFor(item) {
  if (!item) return STATUS_PENDING;
  const remaining = getRemaining(item);
  if (remaining <= 0) return STATUS_PAID;
  if (toAmount(item.paidAmount) > 0) return STATUS_PARTIAL;
  return STATUS_PENDING;
}

/** 0-100, for the progress bar. A zero-amount cycle reads as complete. */
export function getPaidPercent(item) {
  if (!item) return 0;
  const total = toAmount(item.billAmount ?? item.rentAmount);
  if (total <= 0) return 100;
  const paid = toAmount(item.paidAmount);
  return Math.max(0, Math.min(100, Math.round((paid / total) * 100)));
}

/**
 * Apply one payment to a cycle or bill and report what happened.
 *
 * This is the single place the partial / exact / overpayment split is decided:
 *   amount <  remaining -> partial, nothing else changes
 *   amount =  remaining -> settled
 *   amount >  remaining -> settled, and the excess is reported as `surplus`
 *                          (the caller turns that into advance credit)
 */
export function applyPayment(item, amount) {
  const total = toAmount(item?.billAmount ?? item?.rentAmount);
  const paidBefore = toAmount(item?.paidAmount);
  const remainingBefore = money(Math.max(0, total - paidBefore));
  const requested = toAmount(amount);

  if (requested <= 0) {
    return {
      kind: 'none',
      requested: 0,
      applied: 0,
      surplus: 0,
      paidBefore,
      paidAfter: paidBefore,
      remainingBefore,
      remainingAfter: remainingBefore,
      settled: remainingBefore <= 0,
      status: statusFor({ rentAmount: total, paidAmount: paidBefore }),
    };
  }

  const applied = money(Math.min(requested, remainingBefore));
  const surplus = money(Math.max(0, requested - applied));
  const paidAfter = money(paidBefore + applied);
  const remainingAfter = money(Math.max(0, remainingBefore - applied));

  let kind = 'partial';
  if (remainingBefore <= 0) kind = 'excess';
  else if (surplus > 0) kind = 'over';
  else if (remainingAfter <= 0) kind = 'exact';

  return {
    kind,
    requested,
    applied,
    surplus,
    paidBefore,
    paidAfter,
    remainingBefore,
    remainingAfter,
    settled: remainingAfter <= 0,
    status: remainingAfter <= 0 ? STATUS_PAID : applied > 0 ? STATUS_PARTIAL : STATUS_PENDING,
  };
}

/**
 * Work out everything a rent payment will do *before* anything is written.
 *
 * Used twice: by the Record Payment dialog to show the tenant what is about to
 * happen ("this will leave Rs 6,500 pending" / "Rs 2,000 moves to next month"),
 * and by the service to perform it. Keeping it pure is what guarantees the
 * preview and the stored result can never disagree.
 *
 *   amount < remaining -> partial, due date stays put
 *   amount = remaining -> settled, next cycle opens one month later, unpaid
 *   amount > remaining -> settled, surplus is applied to the next cycle as
 *                         advance, and anything left over is held as credit
 */
export function planRentPayment({ cycle, amount, dueDay, nextRentAmount, advanceCredit = 0 }) {
  const result = applyPayment(cycle, amount);

  const plan = {
    ...result,
    dueDay: Number(dueDay) || dayjs(cycle?.dueDate).date(),
    nextRentAmount: toAmount(nextRentAmount ?? cycle?.rentAmount),
    previousCredit: toAmount(advanceCredit),
    nextCycle: null,
    creditAfter: toAmount(advanceCredit),
    carriedToNextCycle: 0,
  };

  if (!plan.settled) {
    // Partial payment: the due date must not move, and the credit is untouched.
    plan.creditAfter = toAmount(advanceCredit);
    return plan;
  }

  const dueDate = advanceDueDate(cycle.dueDate, 1, plan.dueDay);
  const rentAmount = toAmount(nextRentAmount ?? cycle?.rentAmount);
  const pool = money(plan.surplus + toAmount(advanceCredit));
  const appliedToNext = money(Math.min(pool, rentAmount));
  const remainingNext = money(Math.max(0, rentAmount - appliedToNext));

  plan.carriedToNextCycle = appliedToNext;
  plan.creditAfter = money(Math.max(0, pool - appliedToNext));
  plan.nextCycle = {
    dueDate,
    rentAmount,
    paidAmount: appliedToNext,
    remainingAmount: remainingNext,
    status: remainingNext <= 0 ? STATUS_PAID : appliedToNext > 0 ? STATUS_PARTIAL : STATUS_PENDING,
  };

  return plan;
}

/** Human preview of a plan, used by the payment sheet. */
export function describeRentPlan(plan) {
  if (!plan || plan.kind === 'none') return '';
  if (!plan.settled) {
    return `Partial payment. ${formatShort(plan.remainingAfter)} will still be pending, and the due date does not move.`;
  }

  const fromSurplus = plan.surplus > 0;
  if (fromSurplus && plan.carriedToNextCycle > 0 && plan.creditAfter > 0) {
    return (
      `Settles this cycle. ${formatShort(plan.surplus)} is applied to next month, ` +
      `and ${formatShort(plan.creditAfter)} is held as advance credit.`
    );
  }
  if (fromSurplus && plan.carriedToNextCycle > 0) {
    return `Settles this cycle. ${formatShort(plan.surplus)} is applied to next month as advance.`;
  }
  if (fromSurplus) {
    return `Settles this cycle. ${formatShort(plan.surplus)} is held as advance credit.`;
  }
  if (plan.carriedToNextCycle > 0) {
    return `Settles this cycle. ${formatShort(plan.carriedToNextCycle)} of existing advance credit covers next month.`;
  }
  return 'Settles this cycle. The next cycle opens one month later.';
}

/** Tiny local formatter so the ledger stays free of React/Intl view concerns. */
function formatShort(amount) {
  return `Rs ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(toAmount(amount))}`;
}

/** "YYYY-MM" for a date-ish value, used by light bills and month filters. */
export function monthKey(value = dayjs()) {
  const d = dayjs(value);
  return d.isValid() ? d.format('YYYY-MM') : dayjs().format('YYYY-MM');
}

export function formatMonthLabel(key) {
  const d = dayjs(`${key}-01`);
  return d.isValid() ? d.format('MMMM YYYY') : String(key ?? '');
}

/** Start/end day of a "YYYY-MM" key, inclusive. */
export function monthRange(key) {
  const start = dayjs(`${key}-01`);
  return { from: start.format('YYYY-MM-DD'), to: start.endOf('month').format('YYYY-MM-DD') };
}

// -------------------------------------------------------------- collections

/** Sum a list of transactions, split by type. */
export function sumTransactions(transactions = []) {
  const totals = { total: 0, rent: 0, lightBill: 0, refund: 0, count: transactions.length };
  for (const tx of transactions) {
    const amount = toAmount(tx?.amount);
    // A deposit refund is cash leaving the business. Folding it into `rent`
    // would inflate collections, so it gets its own bucket and is subtracted
    // from the net.
    if (tx?.type === TX_REFUND) {
      totals.refund = money(totals.refund + amount);
      totals.total = money(totals.total - amount);
      continue;
    }
    totals.total = money(totals.total + amount);
    if (tx?.type === TX_LIGHT_BILL) totals.lightBill = money(totals.lightBill + amount);
    else totals.rent = money(totals.rent + amount);
  }
  return totals;
}

/** Everything collected on one calendar day. */
export function getTodayTotal(transactions = [], date = dayjs()) {
  const day = dayjs(date).format('YYYY-MM-DD');
  return sumTransactions(transactions.filter((tx) => dayjs(tx.date).format('YYYY-MM-DD') === day));
}

/** Everything collected in one calendar month, by "YYYY-MM" key. */
export function getMonthTotal(transactions = [], key = monthKey()) {
  const month = monthKey(key);
  return sumTransactions(transactions.filter((tx) => dayjs(tx.date).format('YYYY-MM') === month));
}

/** Newest first; ties broken by creation time so inserts stay stable. */
export function sortTransactions(transactions = []) {
  return [...transactions].sort((a, b) => {
    const byDate = dayjs(b.date).valueOf() - dayjs(a.date).valueOf();
    if (byDate !== 0) return byDate;
    return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
  });
}

/**
 * Filter the transaction log. `range` is 'today' | 'month' | 'all' | 'custom'.
 * An empty filter object returns everything, which keeps the UI dumb.
 */
export function filterTransactions(transactions = [], filters = {}) {
  const { range = 'all', from, to, type = 'all', mode = 'all', query = '' } = filters;
  const today = dayjs();

  let start = null;
  let end = null;
  if (range === 'today') {
    start = today.startOf('day');
    end = today.endOf('day');
  } else if (range === 'month') {
    start = today.startOf('month');
    end = today.endOf('month');
  } else if (range === 'custom') {
    start = from ? dayjs(from).startOf('day') : null;
    end = to ? dayjs(to).endOf('day') : null;
  }

  const q = String(query || '').trim().toLowerCase();

  return sortTransactions(transactions).filter((tx) => {
    if (type !== 'all' && tx.type !== type) return false;
    if (mode !== 'all' && tx.mode !== mode) return false;

    if (start || end) {
      const date = dayjs(tx.date);
      if (start && date.isBefore(start)) return false;
      if (end && date.isAfter(end)) return false;
    }

    if (q) {
      const haystack = [tx.customerName, tx.note, tx.type].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/** Spreadsheet-ready CSV, one row per transaction. */
export function toCsv(transactions = []) {
  const header = ['Date', 'Tenant', 'Type', 'Amount (Rs)', 'Mode', 'Reference', 'Note'];
  const rows = transactions.map((tx) => [
    dayjs(tx.date).format('YYYY-MM-DD'),
    tx.customerName ?? '',
    tx.type === TX_LIGHT_BILL ? 'Light bill' : tx.type === TX_REFUND ? 'Deposit refund' : 'Rent',
    money(tx.amount).toFixed(2),
    tx.mode ?? '',
    tx.cycleId || tx.billId || '',
    (tx.note ?? '').replace(/[\r\n]+/g, ' '),
  ]);

  const escape = (value) => {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  return [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
}

/**
 * Everyone who still owes something, most overdue first.
 *
 * Rent and light bill are reported side by side but kept apart, because a
 * pending light bill must never colour a rent row or move a rent due date.
 */
export function getPendingList({ customers = [], cycles = [], lightBills = [], today = dayjs() } = {}) {
  const cycleByCustomer = new Map();
  for (const cycle of cycles) {
    // The open cycle is the one the customer is currently being billed for.
    if (cycleByCustomer.has(cycle.customerId)) continue;
    cycleByCustomer.set(cycle.customerId, cycle);
  }

  const billsByCustomer = new Map();
  for (const bill of lightBills) {
    const list = billsByCustomer.get(bill.customerId) ?? [];
    list.push(bill);
    billsByCustomer.set(bill.customerId, list);
  }

  const rows = [];
  for (const customer of customers) {
    // A checked-out tenant is not "pending" anything. `notice` tenants still
    // hold a bed and still owe rent, so they stay in the list.
    if (customer.status === 'vacated') continue;

    const cycle = cycleByCustomer.get(customer.id) ?? null;
    const rentRemaining = getRemaining(cycle);
    const bills = billsByCustomer.get(customer.id) ?? [];
    const lightRemaining = money(bills.reduce((sum, bill) => sum + getRemaining(bill), 0));
    const totalRemaining = money(rentRemaining + lightRemaining);
    if (totalRemaining <= 0) continue;

    const dueDate = cycle?.dueDate ?? customer.nextDueDate ?? null;
    // `-0` (due exactly today) is normalised to `0` so it compares equal to zero
    // and survives a JSON round trip as 0 rather than 0 with the sign bit set.
    const overdue = dueDate ? -daysDiff(today, dueDate) : 0;
    rows.push({
      customerId: customer.id,
      code: customer.code,
      name: customer.name,
      mobile: customer.mobile,
      roomNo: customer.roomNo,
      rentAmount: toAmount(cycle?.rentAmount ?? customer.rentAmount),
      rentPaid: toAmount(cycle?.paidAmount),
      rentRemaining,
      rentStatus: statusFor(cycle),
      lightRemaining,
      lightPending: bills.filter((bill) => getRemaining(bill) > 0).length,
      totalRemaining,
      advanceCredit: toAmount(customer.advanceCredit),
      dueDate,
      daysOverdue: Object.is(overdue, -0) ? 0 : overdue,
    });
  }

  return rows.sort((a, b) => {
    if (b.daysOverdue !== a.daysOverdue) return b.daysOverdue - a.daysOverdue;
    if (b.totalRemaining !== a.totalRemaining) return b.totalRemaining - a.totalRemaining;
    return String(a.name).localeCompare(String(b.name));
  });
}

/** Outstanding rent and light bill across every tenant. */
export function getOutstandingTotals({ cycles = [], lightBills = [] } = {}) {
  return {
    rent: money(cycles.reduce((sum, cycle) => sum + getRemaining(cycle), 0)),
    lightBill: money(lightBills.reduce((sum, bill) => sum + getRemaining(bill), 0)),
  };
}


// ---------------------------------------------------------- derived helpers

/**
 * The cycle each tenant is currently being billed for: the newest one that is
 * not yet settled, falling back to the newest overall (a tenant who overpaid
 * last month can legitimately have every cycle settled).
 *
 * The input is sorted explicitly because lists arrive oldest-first, and any
 * "first entry wins" shortcut over an unsorted list ends up pinning a tenant's
 * balance to their oldest, months-stale cycle.
 */
export function openCycleByCustomer(cycles = []) {
  // Newest first, so the first entry seen per tenant in a pass is the newest.
  const byNewest = (a, b) =>
    String(b.dueDate ?? '').localeCompare(String(a.dueDate ?? '')) ||
    String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));

  const sorted = [...cycles].sort(byNewest);
  const map = new Map();
  // Pass 1: the newest unsettled cycle per tenant.
  for (const cycle of sorted) {
    if (cycle.status !== STATUS_PAID && !map.has(cycle.customerId)) {
      map.set(cycle.customerId, cycle);
    }
  }
  // Pass 2: tenants with nothing outstanding keep their newest cycle.
  for (const cycle of sorted) {
    if (!map.has(cycle.customerId)) map.set(cycle.customerId, cycle);
  }
  return map;
}

/** Unpaid electricity per tenant, summed across their bills. */
export function billsRemainingByCustomer(lightBills = []) {
  const map = new Map();
  for (const bill of lightBills) {
    const remaining = getRemaining(bill);
    if (remaining <= 0) continue;
    map.set(bill.customerId, (map.get(bill.customerId) ?? 0) + remaining);
  }
  return map;
}
