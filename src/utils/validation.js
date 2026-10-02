import { z } from 'zod';
import { dayjs } from './dateLogic.js';

/**
 * Aadhaar / PAN rules depend on the selected proof type, so those two fields are
 * validated as a pair (see `proofShape`).
 *
 * `.omit()` is unavailable once a `superRefine` has been applied, which is why
 * the admission and edit schemas are built as two intersections instead of one
 * shape with a field removed.
 */

const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

export const AADHAAR_RE = /^\d{12}$/;
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const MOBILE_RE = /^[6-9]\d{9}$/;

/** Strip formatting as the user types, so the field always holds a clean value. */
export function sanitiseAadhaar(value) {
  return digitsOnly(value).slice(0, 12);
}

export function sanitisePan(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);
}

export function sanitiseMobile(value) {
  const digits = digitsOnly(value);
  // Numbers are usually pasted straight out of a phonebook, i.e. with +91.
  const local = digits.length > 10 && digits.startsWith('91') ? digits.slice(2) : digits;
  return local.slice(0, 10);
}

const requiredText = (label, min = 2) =>
  z
    .string()
    .trim()
    .min(min, { message: `${label} is required` })
    .max(120, { message: `${label} is too long` });

/**
 * Optional strings accept `undefined` (field absent) or `''` (field rendered but
 * left blank). They must be genuinely `.optional()` - a bare `z.string()` is
 * required, and a required field failing elsewhere makes Zod skip `superRefine`
 * entirely, which would silently disable the Aadhaar/PAN cross-check.
 */
const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, { message: `Must be under ${max} characters` })
    .optional();

const optionalEmail = z
  .string()
  .trim()
  .max(120, { message: 'Email is too long' })
  .refine((v) => v === '' || z.string().email().safeParse(v).success, {
    message: 'Enter a valid email address',
  })
  .optional();

const optionalPhone = z
  .string()
  .trim()
  .refine((v) => v === '' || MOBILE_RE.test(v), { message: 'Enter a valid 10-digit mobile number' })
  .optional();

export const PROOF_TYPES = [
  { value: 'AADHAAR', label: 'Aadhaar card', hint: '12 digits, e.g. 4321 9876 5432' },
  { value: 'PAN', label: 'PAN card', hint: '10 characters, e.g. ABCDE1234F' },
];

const baseShape = {
  name: requiredText('Full name'),
  mobile: z
    .string()
    .trim()
    .regex(MOBILE_RE, { message: 'Enter a valid 10-digit mobile number' }),
  email: optionalEmail,
  guardianName: optionalText(120),
  guardianPhone: optionalPhone,
  address: optionalText(400),
  occupation: optionalText(120),
  proofImage: z.string().nullable().optional(),
  photo: z.string().nullable().optional(),
  joiningDate: z
    .string()
    .min(1, { message: 'Joining date is required' })
    .refine((v) => dayjs(v).isValid(), { message: 'Enter a valid date' })
    .refine((v) => !dayjs(v).isAfter(dayjs().endOf('day')), {
      message: 'Joining date cannot be in the future',
    }),
  sharingType: z.coerce
    .number({ invalid_type_error: 'Select a sharing type' })
    .int('Sharing type must be a whole number')
    .min(1, 'Select a sharing type')
    .max(5, 'Sharing type must be between 1 and 5'),
  rentAmount: z.coerce
    .number({ invalid_type_error: 'Rent amount is required' })
    .min(1, 'Rent amount must be greater than zero')
    .max(1_000_000, 'That rent amount looks too high'),
  roomNo: optionalText(20),
  bedNo: optionalText(20),
  // Kept in the schema so the resolver's parsed values carry it through: the
  // submit handler needs the picked room id, and zod strips unknown keys.
  roomId: z.string().optional(),
  depositAmount: z.coerce
    .number({ invalid_type_error: 'Deposit amount is required' })
    .min(0, 'Deposit cannot be negative')
    .max(1_000_000, 'That deposit amount looks too high'),
  notes: optionalText(500),
};

/**
 * The expected proof format depends on the selected proof type, so the two are
 * validated together.
 *
 * They deliberately live in their own object rather than on the main shape: Zod
 * skips an object-level `superRefine` whenever the object it wraps fails to
 * parse. Keeping them inline would mean the Aadhaar/PAN check stayed silent
 * until every *other* field was valid, so the field gave no feedback at all
 * while the user was still filling the form in. Intersecting the pair with the
 * rest of the shape keeps the error paths flat (`proofId`) and runs the check as
 * soon as the proof fields themselves are well formed.
 */
const proofShape = z
  .object({
    proofType: z.enum(['AADHAAR', 'PAN'], { required_error: 'Select a proof type' }),
    proofId: z
      .string()
      .trim()
      .min(1, { message: 'Proof ID number is required' })
      .max(20, { message: 'Proof ID number is too long' }),
  })
  .superRefine(({ proofType, proofId }, ctx) => {
    // A blank field is already reported as "required"; adding a format error on
    // top of that just gives the user two messages to read for one problem.
    if (!proofId) return;

    if (proofType === 'AADHAAR' && !AADHAAR_RE.test(proofId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proofId'],
        message: 'Aadhaar number must be exactly 12 digits',
      });
    }
    if (proofType === 'PAN' && !PAN_RE.test(proofId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proofId'],
        message: 'PAN must match the format ABCDE1234F',
      });
    }
  });

/** Full admission form: everything above plus the mandatory terms acceptance. */
export const customerSchema = z.intersection(
  z.object({
    ...baseShape,
    termsAccepted: z.literal(true, {
      errorMap: () => ({ message: 'You must agree to the Terms & Conditions' }),
    }),
  }),
  proofShape,
);

/** Editing an existing tenant: the terms were already accepted on admission. */
export const customerEditSchema = z.intersection(z.object(baseShape), proofShape);

export function getProofHint(proofType) {
  return PROOF_TYPES.find((p) => p.value === proofType)?.hint ?? '';
}

/** Human-readable first error, for the toast on a failed submit. */
export function firstError(errors) {
  if (!errors) return null;
  const key = Object.keys(errors)[0];
  return key ? errors[key]?.message : null;
}
