import { describe, it, expect } from 'vitest';
import {
  customerSchema,
  customerEditSchema,
  sanitiseAadhaar,
  sanitisePan,
  sanitiseMobile,
  AADHAAR_RE,
  PAN_RE,
  MOBILE_RE,
  getProofHint,
} from './validation.js';

const validCustomer = (overrides = {}) => ({
  name: 'Rahul Sharma',
  mobile: '9876543210',
  proofType: 'AADHAAR',
  proofId: '432198765432',
  joiningDate: '2024-01-10',
  sharingType: 3,
  rentAmount: 13000,
  depositAmount: 5000,
  termsAccepted: true,
  ...overrides,
});

const messagesFor = (result, field) =>
  result.error?.issues?.filter((i) => i.path[0] === field).map((i) => i.message) ?? [];

describe('customerSchema', () => {
  it('accepts a complete customer', () => {
    const result = customerSchema.safeParse(validCustomer());
    expect(result.success).toBe(true);
  });

  it('accepts every optional field being blank', () => {
    const result = customerSchema.safeParse(
      validCustomer({
        email: '',
        guardianName: '',
        guardianPhone: '',
        address: '',
        occupation: '',
        roomNo: '',
        bedNo: '',
        notes: '',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts optional fields being absent entirely', () => {
    const { email, address, notes, ...rest } = validCustomer();
    void email;
    void address;
    void notes;
    expect(customerSchema.safeParse(rest).success).toBe(true);
  });

  it('requires a name and a 10-digit mobile', () => {
    const noName = customerSchema.safeParse(validCustomer({ name: '' }));
    expect(messagesFor(noName, 'name')).toEqual(['Full name is required']);

    const badMobile = customerSchema.safeParse(validCustomer({ mobile: '12345' }));
    expect(messagesFor(badMobile, 'mobile')).toEqual(['Enter a valid 10-digit mobile number']);

    // Indian mobiles start 6-9.
    expect(customerSchema.safeParse(validCustomer({ mobile: '1234567890' })).success).toBe(false);
    expect(customerSchema.safeParse(validCustomer({ mobile: '6123456789' })).success).toBe(true);
  });

  it('validates the Aadhaar number as exactly 12 digits', () => {
    expect(messagesFor(customerSchema.safeParse(validCustomer({ proofId: '12345' })), 'proofId')).toEqual([
      'Aadhaar number must be exactly 12 digits',
    ]);
    expect(messagesFor(customerSchema.safeParse(validCustomer({ proofId: '1234567890123' })), 'proofId')).toEqual([
      'Aadhaar number must be exactly 12 digits',
    ]);
    expect(customerSchema.safeParse(validCustomer({ proofId: '432198765432' })).success).toBe(true);
  });

  it('validates the PAN number as ABCDE1234F', () => {
    const bad = customerSchema.safeParse(
      validCustomer({ proofType: 'PAN', proofId: '1234567890' }),
    );
    expect(messagesFor(bad, 'proofId')).toEqual(['PAN must match the format ABCDE1234F']);

    const short = customerSchema.safeParse(validCustomer({ proofType: 'PAN', proofId: 'ABC123' }));
    expect(messagesFor(short, 'proofId').length).toBe(1);

    expect(customerSchema.safeParse(validCustomer({ proofType: 'PAN', proofId: 'ABCDE1234F' })).success).toBe(true);
  });

  it('still reports proof errors when another field is also invalid', () => {
    // Regression: Zod skips an object-level superRefine when the object it
    // wraps fails to parse, so the proof pair needs validating on its own.
    const result = customerSchema.safeParse(validCustomer({ proofId: '12345', name: '' }));
    expect(messagesFor(result, 'name')).toEqual(['Full name is required']);
    expect(messagesFor(result, 'proofId')).toEqual(['Aadhaar number must be exactly 12 digits']);
  });

  it('still reports proof errors when every optional field is absent', () => {
    const result = customerSchema.safeParse({
      proofType: 'AADHAAR',
      proofId: '12345',
      mobile: '9876543210',
      joiningDate: '2024-01-01',
      sharingType: '3',
      rentAmount: '13000',
      depositAmount: '5000',
      termsAccepted: true,
    });
    expect(messagesFor(result, 'proofId')).toEqual(['Aadhaar number must be exactly 12 digits']);
  });

  it('reports only "required" for a blank proof number', () => {
    for (const blank of ['', '   ']) {
      const result = customerSchema.safeParse(validCustomer({ proofId: blank }));
      expect(messagesFor(result, 'proofId')).toEqual(['Proof ID number is required']);
    }
  });

  it('accepts sharing type and amounts arriving as strings from inputs', () => {
    const result = customerSchema.safeParse(
      validCustomer({ sharingType: '2', rentAmount: '9999', depositAmount: '0' }),
    );
    expect(result.success).toBe(true);
    expect(result.data.sharingType).toBe(2);
    expect(result.data.rentAmount).toBe(9999);
  });

  it('requires the terms checkbox', () => {
    expect(messagesFor(customerSchema.safeParse(validCustomer({ termsAccepted: false })), 'termsAccepted')).toEqual([
      'You must agree to the Terms & Conditions',
    ]);
    expect(customerSchema.safeParse(validCustomer({ termsAccepted: undefined })).success).toBe(false);
  });

  it('rejects a zero rent and a future joining date', () => {
    expect(
      messagesFor(customerSchema.safeParse(validCustomer({ rentAmount: 0 })), 'rentAmount').length,
    ).toBe(1);
    const future = new Date(Date.now() + 86_400_000 * 10).toISOString().slice(0, 10);
    expect(
      messagesFor(customerSchema.safeParse(validCustomer({ joiningDate: future })), 'joiningDate'),
    ).toEqual(['Joining date cannot be in the future']);
  });

  it('accepts a zero deposit but rejects a negative one', () => {
    expect(customerSchema.safeParse(validCustomer({ depositAmount: 0 })).success).toBe(true);
    expect(customerSchema.safeParse(validCustomer({ depositAmount: -1 })).success).toBe(false);
  });

  it('constrains the sharing type to 1-5', () => {
    for (const value of [1, 2, 3, 4, 5]) {
      expect(customerSchema.safeParse(validCustomer({ sharingType: value })).success).toBe(true);
    }
    expect(customerSchema.safeParse(validCustomer({ sharingType: 6 })).success).toBe(false);
    expect(customerSchema.safeParse(validCustomer({ sharingType: 0 })).success).toBe(false);
  });

  it('rejects a malformed email but allows a blank one', () => {
    expect(messagesFor(customerSchema.safeParse(validCustomer({ email: 'nope' })), 'email')).toEqual([
      'Enter a valid email address',
    ]);
    expect(customerSchema.safeParse(validCustomer({ email: 'rahul@example.com' })).success).toBe(true);
  });
});

describe('customerEditSchema', () => {
  it('does not require the terms checkbox', () => {
    const { termsAccepted, ...withoutTerms } = validCustomer();
    void termsAccepted;
    expect(customerEditSchema.safeParse(withoutTerms).success).toBe(true);
  });

  it('still enforces the proof format', () => {
    expect(messagesFor(customerEditSchema.safeParse(validCustomer({ proofId: '99' })), 'proofId').length).toBe(1);
  });
});

describe('input sanitisers', () => {
  it('keeps only digits and caps at 12 for Aadhaar', () => {
    expect(sanitiseAadhaar('4321 9876-5432')).toBe('432198765432');
    expect(sanitiseAadhaar('1234567890123456')).toBe('123456789012');
    expect(sanitiseAadhaar('abc')).toBe('');
  });

  it('upper-cases PAN and caps at 10', () => {
    expect(sanitisePan('abcde1234f')).toBe('ABCDE1234F');
    expect(sanitisePan('abc de-1234 f')).toBe('ABCDE1234F');
    expect(sanitisePan('abcde1234fghij')).toBe('ABCDE1234F');
  });

  it('keeps only digits and caps at 10 for mobile', () => {
    expect(sanitiseMobile('98765 43210')).toBe('9876543210');
    expect(sanitiseMobile('98765432109999')).toBe('9876543210');
  });

  it('strips a pasted +91 country code from mobiles', () => {
    expect(sanitiseMobile('+91 9876543210')).toBe('9876543210');
    expect(sanitiseMobile('919876543210')).toBe('9876543210');
    // A number that merely starts with 91 is left alone.
    expect(sanitiseMobile('9198765432')).toBe('9198765432');
  });
});

describe('helpers', () => {
  it('exposes the patterns it enforces', () => {
    expect(AADHAAR_RE.test('432198765432')).toBe(true);
    expect(PAN_RE.test('ABCDE1234F')).toBe(true);
    expect(MOBILE_RE.test('9876543210')).toBe(true);
  });

  it('returns a format hint per proof type', () => {
    expect(getProofHint('PAN')).toMatch(/ABCDE1234F/);
    expect(getProofHint('AADHAAR')).toMatch(/12 digits/);
  });
});
