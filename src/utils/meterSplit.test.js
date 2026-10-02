import { describe, it, expect } from 'vitest';
import { unitsConsumed, billForUnits, splitEqually, planMeterSplit } from './meterSplit.js';

/**
 * Meter reading maths: the bill is split equally among the room's occupants
 * with the rounding remainder absorbed so the parts always sum exactly.
 */

describe('unitsConsumed', () => {
  it('subtracts previous from current', () => {
    expect(unitsConsumed(1200, 1350)).toBe(150);
  });

  it('handles decimal meters', () => {
    expect(unitsConsumed(100.5, 160.25)).toBe(59.75);
  });

  it('returns 0 when the meter rolls backwards', () => {
    expect(unitsConsumed(1500, 1400)).toBe(0);
    expect(unitsConsumed(500, 500)).toBe(0);
  });
});

describe('billForUnits', () => {
  it('multiplies units by the rate', () => {
    expect(billForUnits(150, 4.25)).toBe(637.5);
  });

  it('treats negative inputs as zero', () => {
    expect(billForUnits(-10, 5)).toBe(0);
    expect(billForUnits(10, -5)).toBe(0);
  });
});

describe('splitEqually', () => {
  it('splits cleanly when divisible', () => {
    expect(splitEqually(600, 3)).toEqual([200, 200, 200]);
  });

  it('absorbs the rounding remainder into the last share', () => {
    const parts = splitEqually(100, 3);
    expect(parts).toEqual([33.33, 33.33, 33.34]);
  });

  it('always sums back to the total exactly (paise level)', () => {
    for (const [total, n] of [[764, 3], [1000, 7], [333.33, 4], [0.05, 2]]) {
      const parts = splitEqually(total, n);
      expect(parts).toHaveLength(n);
      expect(Number(parts.reduce((a, b) => a + b, 0).toFixed(2))).toBe(total);
    }
  });

  it('returns the whole amount for one person and [] for nobody', () => {
    expect(splitEqually(500, 1)).toEqual([500]);
    expect(splitEqually(500, 0)).toEqual([]);
  });
});

describe('planMeterSplit', () => {
  const reading = { previousReading: 1000, currentReading: 1164, ratePerUnit: 4.25 };
  const occupants = [
    { id: 'c1', name: 'Active', status: 'active' },
    { id: 'c2', name: 'On notice', status: 'notice' },
    { id: 'c3', name: 'Vacated', status: 'vacated' },
  ];

  it('bills only active and notice occupants, splitting equally', () => {
    const plan = planMeterSplit({ reading, occupants });
    expect(plan.totalUnits).toBe(164);
    expect(plan.totalAmount).toBe(697); // 164 x 4.25
    expect(plan.perPerson).toBe(348.5);
    expect(plan.entries.map((e) => e.customerId)).toEqual(['c1', 'c2']);
    expect(plan.entries.map((e) => e.share)).toEqual([348.5, 348.5]);
  });

  it('handles the uneven remainder without losing paise', () => {
    const plan = planMeterSplit({
      reading: { previousReading: 0, currentReading: 100, ratePerUnit: 1 },
      occupants: [{ id: 'a', name: 'A', status: 'active' }, { id: 'b', name: 'B', status: 'active' }, { id: 'c', name: 'C', status: 'active' }],
    });
    expect(plan.totalAmount).toBe(100);
    expect(plan.entries.map((e) => e.share)).toEqual([33.33, 33.33, 33.34]);
  });

  it('produces an empty plan with no occupants', () => {
    const plan = planMeterSplit({ reading, occupants: [] });
    expect(plan.totalUnits).toBe(164);
    expect(plan.totalAmount).toBe(697);
    expect(plan.entries).toEqual([]);
    expect(plan.perPerson).toBe(0);
  });

  it('handles a backwards meter as a zero bill', () => {
    const plan = planMeterSplit({
      reading: { previousReading: 2000, currentReading: 1900, ratePerUnit: 5 },
      occupants: [{ id: 'a', name: 'A', status: 'active' }],
    });
    expect(plan.totalUnits).toBe(0);
    expect(plan.totalAmount).toBe(0);
    expect(plan.entries[0].share).toBe(0);
  });
});
