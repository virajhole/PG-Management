import { describe, it, expect } from 'vitest';
import { buildUpiLink, REMINDER_TEMPLATES, TEMPLATE_PLACEHOLDERS, fillTemplate } from './upi.js';

/**
 * UPI deep links and reminder templates. The QR code is generated from the
 * same string the deep link uses, so these tests pin the wire format that
 * GPay / PhonePe / Paytm all parse.
 */

describe('buildUpiLink', () => {
  it('builds the standard upi://pay deep link', () => {
    const link = buildUpiLink({ payeeVpa: 'pg@ybl', payeeName: 'Sunrise PG', amount: 15000, note: 'Rent - Room 204' });
    expect(link).toBe('upi://pay?pa=pg%40ybl&pn=Sunrise%20PG&am=15000.00&cu=INR&tn=Rent%20-%20Room%20204');
  });

  it('always formats the amount to two decimals', () => {
    const link = buildUpiLink({ payeeVpa: 'a@b', amount: 10 });
    expect(link).toContain('am=10.00');
  });

  it('rounds amounts to the paisa', () => {
    const link = buildUpiLink({ payeeVpa: 'a@b', amount: 33.3333 });
    expect(link).toContain('am=33.33');
  });

  it('omits the optional name and note when empty', () => {
    const link = buildUpiLink({ payeeVpa: 'a@b', amount: 5 });
    expect(link).toBe('upi://pay?pa=a%40b&am=5.00&cu=INR');
  });

  it('returns "" for a missing or malformed VPA', () => {
    expect(buildUpiLink({ payeeVpa: '', amount: 5 })).toBe('');
    expect(buildUpiLink({ payeeVpa: 'noatsign', amount: 5 })).toBe('');
    expect(buildUpiLink({ amount: 5 })).toBe('');
  });

  it('returns "" for a zero or negative amount', () => {
    expect(buildUpiLink({ payeeVpa: 'a@b', amount: 0 })).toBe('');
    expect(buildUpiLink({ payeeVpa: 'a@b', amount: -10 })).toBe('');
  });

  it('escapes special characters so the URL stays parseable', () => {
    const link = buildUpiLink({ payeeVpa: 'name@bank', amount: 500, note: 'Rent & bills + ₹' });
    expect(link).not.toContain(' & ');
    expect(link.startsWith('upi://pay?pa=name%40bank&')).toBe(true);
    expect(new URLSearchParams(link.split('?')[1]).get('tn')).toBe('Rent & bills + ₹');
  });
});

describe('reminder templates', () => {
  it('covers the three reminder stages with every placeholder present in each body', () => {
    expect(Object.keys(REMINDER_TEMPLATES).sort()).toEqual(['dueToday', 'first', 'overdue']);
    for (const template of Object.values(REMINDER_TEMPLATES)) {
      for (const placeholder of TEMPLATE_PLACEHOLDERS) {
        expect(template.body).toContain(placeholder);
      }
    }
  });

  it('fills placeholders with the tenant values', () => {
    const filled = fillTemplate(REMINDER_TEMPLATES.overdue.body, {
      name: 'Rahul',
      amount: '₹10,000',
      dueDate: '26 Sep 2026',
      upiLink: 'upi://pay?pa=pg%40ybl&am=10000.00&cu=INR',
    });
    expect(filled).toContain('Hello Rahul,');
    expect(filled).toContain('rent of ₹10,000 was due on 26 Sep 2026');
    expect(filled).toContain('upi://pay?pa=pg%40ybl&am=10000.00&cu=INR');
    expect(filled).not.toContain('{name}');
  });

  it('leaves placeholders blank when a value is missing', () => {
    expect(fillTemplate('Hi {name}, pay {amount}', {})).toBe('Hi , pay ');
  });

  it('survives a null template', () => {
    expect(fillTemplate(null, { name: 'A' })).toBe('');
  });
});
