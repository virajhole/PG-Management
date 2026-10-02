import { describe, it, expect } from 'vitest';
import { lateFeePerDay, computeLateFee, suggestLateFees } from './lateFee.js';
import { dayjs } from './dateLogic.js';

/**
 * Pure maths for the optional late fee. The admin confirms every fee before it
 * is recorded, so these functions only *suggest* - the tests pin down the
 * grace period, both fee modes, the cap and the "nothing to charge" edges.
 */

const TODAY = '2026-10-02';

describe('lateFeePerDay', () => {
  it('is zero for the "none" mode regardless of value', () => {
    expect(lateFeePerDay({ mode: 'none', value: 50, balance: 1000 })).toBe(0);
  });

  it('returns the fixed rupee amount per day', () => {
    expect(lateFeePerDay({ mode: 'fixed', value: 20, balance: 0 })).toBe(20);
  });

  it('computes a percent of the open balance per day', () => {
    expect(lateFeePerDay({ mode: 'percent', value: 2, balance: 500 })).toBe(10);
  });

  it('never goes negative', () => {
    expect(lateFeePerDay({ mode: 'fixed', value: -5, balance: 100 })).toBe(0);
    expect(lateFeePerDay({ mode: 'percent', value: 10, balance: -500 })).toBe(0);
  });
});

describe('computeLateFee', () => {
  const base = { mode: 'fixed', value: 10, graceDays: 2, dueDate: '2026-09-20', balance: 5000, today: TODAY };

  it('charges nothing when the mode is none', () => {
    expect(computeLateFee({ ...base, mode: 'none' })).toEqual({ daysLate: 0, perDay: 0, amount: 0, capped: false });
  });

  it('charges nothing without a balance or a due date', () => {
    expect(computeLateFee({ ...base, balance: 0 }).amount).toBe(0);
    expect(computeLateFee({ ...base, dueDate: null }).amount).toBe(0);
  });

  it('respects the grace period - inside it there is no fee', () => {
    // Due 20 Sep + 2 grace days = 22 Sep; today is 2 Oct -> 10 days late.
    const fee = computeLateFee(base);
    expect(fee.daysLate).toBe(10);
    expect(fee.amount).toBe(100);
    expect(fee.capped).toBe(false);

    const insideGrace = computeLateFee({ ...base, today: '2026-09-21' });
    expect(insideGrace.daysLate).toBe(0);
    expect(insideGrace.amount).toBe(0);
  });

  it('starts counting the day after grace ends', () => {
    expect(computeLateFee({ ...base, today: '2026-09-22' }).daysLate).toBe(0);
    expect(computeLateFee({ ...base, today: '2026-09-23' }).daysLate).toBe(1);
  });

  it('uses the percent of balance per day', () => {
    const fee = computeLateFee({ ...base, mode: 'percent', value: 1 });
    expect(fee.perDay).toBe(50);
    expect(fee.amount).toBe(500); // 10 days x 50
  });

  it('caps the total when a maximum is configured', () => {
    const fee = computeLateFee({ ...base, max: 60 });
    expect(fee.amount).toBe(60);
    expect(fee.capped).toBe(true);
  });

  it('does not cap when the raw fee stays under the max', () => {
    const fee = computeLateFee({ ...base, max: 500 });
    expect(fee.amount).toBe(100);
    expect(fee.capped).toBe(false);
  });

  it('ignores a zero or null max', () => {
    expect(computeLateFee({ ...base, max: 0 }).capped).toBe(false);
    expect(computeLateFee({ ...base, max: null }).capped).toBe(false);
  });

  it('defaults today to now', () => {
    // Due date far in the past relative to the real clock.
    const fee = computeLateFee({ mode: 'fixed', value: 1, graceDays: 0, dueDate: '2000-01-01', balance: 100 });
    expect(fee.daysLate).toBeGreaterThan(0);
    expect(fee.amount).toBe(fee.daysLate);
  });
});

describe('suggestLateFees', () => {
  const settings = { lateFeeMode: 'fixed', lateFeeValue: 10, lateFeeGraceDays: 2, lateFeeMax: 100 };
  const pending = [
    { customerId: 'c1', name: 'Overdue Partial', daysOverdue: 6, rentRemaining: 2000, dueDate: '2026-09-26' },
    { customerId: 'c2', name: 'Settled', daysOverdue: 6, rentRemaining: 0, dueDate: '2026-09-26' },
    { customerId: 'c3', name: 'Just Late', daysOverdue: 1, rentRemaining: 3000, dueDate: '2026-10-01' },
  ];

  it('returns nothing when late fees are disabled', () => {
    expect(suggestLateFees(pending, { ...settings, lateFeeMode: 'none' }, TODAY)).toEqual([]);
    expect(suggestLateFees(pending, {}, TODAY)).toEqual([]);
  });

  it('suggests fees only for overdue tenants with a balance past grace', () => {
    const suggestions = suggestLateFees(pending, settings, TODAY);
    expect(suggestions.map((s) => s.customerId)).toEqual(['c1']);
    expect(suggestions[0].daysLate).toBe(4); // 26 Sep + 2 grace -> late from 29 Sep
    expect(suggestions[0].amount).toBe(40);
  });

  it('carries the cap through per tenant', () => {
    const suggestions = suggestLateFees(
      [{ customerId: 'c1', name: 'Very Late', daysOverdue: 90, rentRemaining: 9000, dueDate: '2026-07-04' }],
      settings,
      TODAY,
    );
    expect(suggestions[0].capped).toBe(true);
    expect(suggestions[0].amount).toBe(100);
  });

  it('accepts a dayjs today', () => {
    const suggestions = suggestLateFees(pending, settings, dayjs(TODAY));
    expect(suggestions).toHaveLength(1);
  });
});
