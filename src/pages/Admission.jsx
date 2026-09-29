import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { TextField, Textarea, SelectField } from '../components/FormFields.jsx';
import { AmountField } from '../components/AmountField.jsx';
import ImagePicker from '../components/ImagePicker.jsx';
import { UserPlusIcon, LockIcon } from '../components/icons.jsx';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { customerSchema, PROOF_TYPES, sanitiseAadhaar, sanitisePan, sanitiseMobile, getProofHint } from '../utils/validation.js';
import { getRentForSharing, SHARING_TYPES } from '../services/index.js';
import { formatCurrency, formatDate } from '../utils/format.js';
import { getNextDueDate, todayISO, dayjs } from '../utils/dateLogic.js';

function Section({ title, description, children }) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {description && <p className="mt-0.5 mb-4 text-xs text-slate-500">{description}</p>}
      <div className={description ? '' : 'mt-4'}>{children}</div>
    </section>
  );
}

export default function Admission() {
  const { settings, createCustomer, setCustomerImage } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const termsBoxRef = useRef(null);

  // Once the admin types their own rent we stop overwriting it on sharing change.
  const rentOverridden = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors, isValid, touchedFields },
  } = useForm({
    resolver: zodResolver(customerSchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
      mobile: '',
      email: '',
      guardianName: '',
      guardianPhone: '',
      address: '',
      occupation: '',
      proofType: 'AADHAAR',
      proofId: '',
      proofImage: null,
      photo: null,
      joiningDate: todayISO(),
      sharingType: 3,
      rentAmount: getRentForSharing(settings, 3) || 13000,
      roomNo: '',
      bedNo: '',
      depositAmount: settings.defaultDeposit ?? 5000,
      notes: '',
      termsAccepted: false,
    },
  });

  const sharingType = watch('sharingType');
  const joiningDate = watch('joiningDate');
  const proofType = watch('proofType');
  const rentAmount = watch('rentAmount');
  const terms = settings.terms || '';

  // Auto-fill rent from the Settings price for the chosen sharing type.
  useEffect(() => {
    if (rentOverridden.current) return;
    const price = getRentForSharing(settings, sharingType);
    if (price) setValue('rentAmount', price, { shouldValidate: true, shouldDirty: true });
  }, [sharingType, settings, setValue]);

  const previewDueDate = useMemo(() => {
    if (!joiningDate) return null;
    return getNextDueDate(joiningDate, 1, dayjs(joiningDate).date());
  }, [joiningDate]);

  function scrollToTerms() {
    termsBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function onSubmit(values) {
    setSubmitting(true);
    try {
      const created = await createCustomer({
        ...values,
        proofImage: undefined,
        photo: undefined,
      });

      // Images live in IndexedDB, the record only keeps the resulting keys -
      // so they are written once the customer (and its id) exists.
      if (values.proofImage) await setCustomerImage(created.id, 'proof', values.proofImage);
      if (values.photo) await setCustomerImage(created.id, 'photo', values.photo);

      reset();
      rentOverridden.current = false;
      toast.success(
        `${values.name} admitted. First rent due ${formatDate(created.nextDueDate)} (${formatCurrency(created.rentAmount)}).`,
      );
      navigate('/', { replace: true });
    } catch (error) {
      toast.error(error.message || 'Could not save this admission. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-4">
      <header>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">New admission</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Register a new paying guest. Required fields are marked with <span className="text-red-500">*</span>.
        </p>
      </header>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {/* --------------------------------------------------- personal */}
        <Section title="Personal details">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="name"
              label="Full name"
              required
              autoComplete="name"
              placeholder="e.g. Rahul Sharma"
              error={errors.name?.message}
              wrapperClassName="sm:col-span-2"
              {...register('name')}
            />
            <Controller
              control={control}
              name="mobile"
              render={({ field }) => (
                <TextField
                  {...field}
                  id="mobile"
                  label="Mobile number"
                  required
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="10-digit number"
                  maxLength={10}
                  error={errors.mobile?.message}
                  onChange={(e) => field.onChange(sanitiseMobile(e.target.value))}
                />
              )}
            />
            <TextField
              id="email"
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="optional"
              error={errors.email?.message}
              {...register('email')}
            />
            <TextField
              id="guardianName"
              label="Guardian / Parent name"
              placeholder="optional"
              error={errors.guardianName?.message}
              {...register('guardianName')}
            />
            <Controller
              control={control}
              name="guardianPhone"
              render={({ field }) => (
                <TextField
                  {...field}
                  id="guardianPhone"
                  label="Guardian phone"
                  type="tel"
                  inputMode="numeric"
                  placeholder="optional"
                  maxLength={10}
                  error={errors.guardianPhone?.message}
                  onChange={(e) => field.onChange(sanitiseMobile(e.target.value))}
                />
              )}
            />
            <TextField
              id="occupation"
              label="Occupation / College / Company"
              placeholder="e.g. B.Tech 2nd year, ABC College"
              wrapperClassName="sm:col-span-2"
              error={errors.occupation?.message}
              {...register('occupation')}
            />
            <Textarea
              id="address"
              label="Permanent address"
              placeholder="House / street / city / state"
              wrapperClassName="sm:col-span-2"
              error={errors.address?.message}
              {...register('address')}
            />
          </div>
        </Section>

        {/* ------------------------------------------------------ proof */}
        <Section title="Identity proof" description="Aadhaar or PAN is mandatory before a tenant is admitted.">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="proofType"
              label="Proof type"
              required
              options={PROOF_TYPES.map((p) => ({ value: p.value, label: p.label }))}
              error={errors.proofType?.message}
              {...register('proofType')}
            />
            <Controller
              control={control}
              name="proofId"
              render={({ field }) => (
                <TextField
                  {...field}
                  id="proofId"
                  label="Proof ID number"
                  required
                  placeholder={proofType === 'PAN' ? 'ABCDE1234F' : '12-digit Aadhaar'}
                  maxLength={12}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  hint={getProofHint(proofType)}
                  error={errors.proofId?.message}
                  onChange={(e) =>
                    field.onChange(
                      proofType === 'PAN' ? sanitisePan(e.target.value) : sanitiseAadhaar(e.target.value),
                    )
                  }
                />
              )}
            />
          </div>

          <div className="mt-5 space-y-5">
            <Controller
              control={control}
              name="proofImage"
              render={({ field }) => (
                <ImagePicker
                  value={field.value}
                  onChange={field.onChange}
                  label="Proof image"
                  hint="Photograph of the Aadhaar / PAN. Stored compressed on this device only."
                  icon={LockIcon}
                />
              )}
            />
            <Controller
              control={control}
              name="photo"
              render={({ field }) => (
                <ImagePicker
                  value={field.value}
                  onChange={field.onChange}
                  label="Customer photo"
                  hint="Optional. Used as the avatar on the dashboard."
                />
              )}
            />
          </div>
        </Section>

        {/* ------------------------------------------------- allocation */}
        <Section title="Room & rent">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="joiningDate"
              label="Joining date"
              required
              type="date"
              max={todayISO()}
              hint={previewDueDate ? `First rent due ${formatDate(previewDueDate)}` : undefined}
              error={errors.joiningDate?.message}
              {...register('joiningDate')}
            />
            <SelectField
              id="sharingType"
              label="Sharing type"
              required
              options={SHARING_TYPES.map((n) => ({
                value: String(n),
                label: `${n} sharing${n === 1 ? ' (single)' : ''} · ${formatCurrency(settings.sharingPrices[n])}`,
              }))}
              error={errors.sharingType?.message}
              hint="Rent is filled in automatically from Settings — override it if needed."
              {...register('sharingType')}
            />
            <AmountField
              id="rentAmount"
              label="Monthly rent"
              required
              min="0"
              step="1"
              hint="Auto-filled from Settings. Editable per tenant."
              error={errors.rentAmount?.message}
              {...register('rentAmount', {
                onChange: () => {
                  // Typing here wins over the Settings price from now on.
                  rentOverridden.current = true;
                },
              })}
            />
            <AmountField
              id="depositAmount"
              label="Security deposit"
              min="0"
              step="1"
              hint="Defaults to the Settings value."
              error={errors.depositAmount?.message}
              {...register('depositAmount')}
            />
            <TextField
              id="roomNo"
              label="Room number"
              placeholder="e.g. 204"
              error={errors.roomNo?.message}
              {...register('roomNo')}
            />
            <TextField
              id="bedNo"
              label="Bed number"
              placeholder="e.g. A"
              error={errors.bedNo?.message}
              {...register('bedNo')}
            />
            <Textarea
              id="notes"
              label="Notes"
              placeholder="Diet preference, vehicle, special requests…"
              wrapperClassName="sm:col-span-2"
              error={errors.notes?.message}
              {...register('notes')}
            />
          </div>
        </Section>

        {/* ------------------------------------------------------- terms */}
        <Section
          title="Terms & Conditions"
          description="Please read the PG rules before you agree."
        >
          <div
            ref={termsBoxRef}
            className="scroll-slim max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4
                       text-sm leading-relaxed whitespace-pre-line text-slate-700"
            tabIndex={0}
            role="region"
            aria-label="Terms and conditions"
          >
            {terms}
          </div>

          <p className="mt-2 text-xs text-slate-500">
            These terms are editable from <span className="font-medium">Settings</span>.
          </p>

          <label
            className={`mt-3 flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
              errors.termsAccepted
                ? 'border-red-300 bg-red-50'
                : touchedFields.termsAccepted && !errors.termsAccepted
                  ? 'border-brand-300 bg-brand-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-brand-600"
              {...register('termsAccepted')}
            />
            <span className="text-sm leading-relaxed font-medium text-slate-800">
              I have read and agree to the Terms &amp; Conditions above.
              <span className="ml-0.5 text-red-500">*</span>
            </span>
          </label>
          {errors.termsAccepted && <p className="field-error">{errors.termsAccepted.message}</p>}
        </Section>

        {/* -------------------------------------------------------- submit */}
        <div className="sticky bottom-20 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:rounded-2xl lg:border">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-xs text-slate-500">
              {previewDueDate ? (
                <>
                  First rent due <span className="font-semibold text-slate-700">{formatDate(previewDueDate)}</span>
                  {' · '}
                  {formatCurrency(rentAmount || 0)} per month
                </>
              ) : (
                'Choose a joining date to preview the first rent due date.'
              )}
            </div>
            <button
              type="submit"
              className="btn-primary shrink-0 sm:min-w-44"
              disabled={!isValid || submitting}
              onClick={!isValid ? scrollToTerms : undefined}
            >
              <UserPlusIcon className="size-4" />
              {submitting ? 'Saving…' : 'Complete admission'}
            </button>
          </div>
          {!isValid && (
            <p className="mt-2 text-[11px] text-slate-400">
              Complete the required fields and accept the Terms &amp; Conditions to continue.
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
