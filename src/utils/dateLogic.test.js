import { describe, it, expect } from 'vitest';
import {
  getNextDueDate,
  advanceDueDate,
  daysDiff,
  getRentStatus,
  getRentStatusLabel,
  getCycleStart,
  dateForAnchor,
  daysInMonth,
  formatDate,
  toDateInput,
  todayISO,
} from './dateLogic.js';

describe('getNextDueDate', () => {
  it('returns the same day-of-month one month after joining', () => {
    expect(getNextDueDate('2024-03-10')).toBe('2024-04-10');
    expect(getNextDueDate('2024-01-05')).toBe('2024-02-05');
    expect(getNextDueDate('2024-11-20')).toBe('2024-12-20');
  });

  it('clamps 31st joins to the last day of shorter months', () => {
    expect(getNextDueDate('2024-01-31')).toBe('2024-02-29'); // leap year
    expect(getNextDueDate('2023-01-31')).toBe('2023-02-28'); // non-leap
    expect(getNextDueDate('2024-03-31')).toBe('2024-04-30'); // 30-day month
    expect(getNextDueDate('2024-05-31')).toBe('2024-06-30');
    expect(getNextDueDate('2024-08-31')).toBe('2024-09-30');
  });

  it('handles 30th joins into February', () => {
    expect(getNextDueDate('2024-01-30')).toBe('2024-02-29');
    expect(getNextDueDate('2023-01-30')).toBe('2023-02-28');
  });

  it('handles a leap-day join', () => {
    expect(getNextDueDate('2024-02-29')).toBe('2024-03-29');
    expect(getNextDueDate('2024-02-29', 12)).toBe('2025-02-28');
  });

  it('crosses the year boundary', () => {
    expect(getNextDueDate('2024-12-15')).toBe('2025-01-15');
    expect(getNextDueDate('2024-12-31')).toBe('2025-01-31');
  });

  it('supports looking further ahead', () => {
    expect(getNextDueDate('2024-01-31', 12)).toBe('2025-01-31');
    expect(getNextDueDate('2024-01-31', 2)).toBe('2024-03-31');
  });

  it('respects an explicit anchor day', () => {
    // anchor 5 even though the join date is the 10th
    expect(getNextDueDate('2024-01-10', 1, 5)).toBe('2024-02-05');
  });
});

describe('advanceDueDate', () => {
  it('moves one month forward while keeping the anchor day', () => {
    // joined 31 Jan: first due 29 Feb, then back to 31 Mar (not 29 Mar)
    const first = getNextDueDate('2024-01-31');
    expect(first).toBe('2024-02-29');
    expect(advanceDueDate(first, 1, 31)).toBe('2024-03-31');
    expect(advanceDueDate('2024-03-31', 1, 31)).toBe('2024-04-30');
  });

  it('walks a long chain without drifting', () => {
    let due = getNextDueDate('2023-11-30');
    const seen = [due];
    for (let i = 0; i < 4; i += 1) {
      due = advanceDueDate(due, 1, 30);
      seen.push(due);
    }
    expect(seen).toEqual(['2023-12-30', '2024-01-30', '2024-02-29', '2024-03-30', '2024-04-30']);
  });

  it('defaults the anchor to the due date day when omitted', () => {
    expect(advanceDueDate('2024-01-15')).toBe('2024-02-15');
  });
});

describe('dateForAnchor', () => {
  it('clamps to the target month length', () => {
    expect(dateForAnchor('2024-01-31', 31, 0)).toBe('2024-01-31');
    expect(dateForAnchor('2024-01-31', 31, -1)).toBe('2023-12-31');
  });

  it('falls back to the source day when the anchor is missing', () => {
    expect(dateForAnchor('2024-01-09', undefined, 1)).toBe('2024-02-09');
  });
});

describe('daysInMonth', () => {
  it('reports month lengths', () => {
    expect(daysInMonth('2024-02-10')).toBe(29);
    expect(daysInMonth('2023-02-10')).toBe(28);
    expect(daysInMonth('2024-04-10')).toBe(30);
    expect(daysInMonth('2024-12-10')).toBe(31);
  });
});

describe('daysDiff', () => {
  it('is 0 for the same calendar day regardless of time', () => {
    expect(daysDiff('2024-05-10', '2024-05-10T23:59:00')).toBe(0);
    expect(daysDiff('2024-05-10T23:00:00', '2024-05-10T01:00:00')).toBe(0);
  });

  it('counts forward days', () => {
    expect(daysDiff('2024-05-10', '2024-05-13')).toBe(3);
    expect(daysDiff('2024-05-10', '2024-06-10')).toBe(31);
  });

  it('is negative for past dates', () => {
    expect(daysDiff('2024-05-10', '2024-05-06')).toBe(-4);
  });

  it('handles month and year boundaries', () => {
    expect(daysDiff('2024-01-31', '2024-02-01')).toBe(1);
    expect(daysDiff('2023-12-31', '2024-01-01')).toBe(1);
  });
});

describe('getRentStatus', () => {
  const today = '2024-05-10';

  it('flags past due dates as overdue', () => {
    expect(getRentStatus('2024-05-09', today)).toBe('overdue');
    expect(getRentStatus('2024-04-10', today)).toBe('overdue');
    expect(getRentStatus('2023-05-10', today)).toBe('overdue');
  });

  it('treats today and the next 5 days as soon', () => {
    expect(getRentStatus('2024-05-10', today)).toBe('soon');
    expect(getRentStatus('2024-05-11', today)).toBe('soon');
    expect(getRentStatus('2024-05-15', today)).toBe('soon'); // exactly 5
  });

  it('treats more than 5 days away as ok', () => {
    expect(getRentStatus('2024-05-16', today)).toBe('ok');
    expect(getRentStatus('2024-06-10', today)).toBe('ok');
  });

  it('honours a custom window', () => {
    expect(getRentStatus('2024-05-12', today, 1)).toBe('ok');
    expect(getRentStatus('2024-05-12', today, 2)).toBe('soon');
  });

  it('accepts a dayjs object for today', () => {
    expect(getRentStatus('2024-05-11', new Date(2024, 4, 10))).toBe('soon');
  });
});

describe('getRentStatusLabel', () => {
  const today = '2024-05-10';

  it('formats overdue labels with singular/plural handling', () => {
    expect(getRentStatusLabel('2024-05-09', today)).toBe('Overdue by 1 day');
    expect(getRentStatusLabel('2024-05-06', today)).toBe('Overdue by 4 days');
  });

  it('formats due-soon labels', () => {
    expect(getRentStatusLabel('2024-05-10', today)).toBe('Due today');
    expect(getRentStatusLabel('2024-05-11', today)).toBe('Due in 1 day');
    expect(getRentStatusLabel('2024-05-13', today)).toBe('Due in 3 days');
    expect(getRentStatusLabel('2024-05-20', today)).toBe('Due in 10 days');
  });
});

describe('getCycleStart', () => {
  it('returns the day before the previous due date', () => {
    // cycle 10 Apr -> 10 May starts on 10 Apr
    expect(getCycleStart('2024-05-10', 10)).toBe('2024-04-10');
    expect(getCycleStart('2024-04-30', 31)).toBe('2024-03-31');
  });
});

describe('formatting helpers', () => {
  it('formats dates for display', () => {
    expect(formatDate('2024-05-09')).toBe('09 May 2024');
    expect(formatDate('')).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });

  it('produces date-input compatible values', () => {
    expect(toDateInput('2024-05-09')).toBe('2024-05-09');
    expect(toDateInput('')).toBe('');
  });

  it('returns today as an ISO date', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
