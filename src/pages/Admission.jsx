import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { TextField, Textarea, SelectField } from '../components/FormFields.jsx';
import { AmountField } from '../components/AmountField.jsx';
import ImagePicker from '../components/ImagePicker.jsx';
import { UserPlusIcon, LockIcon } from '../components/icons.jsx';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { customerSchema, PROOF_TYPES, sanitiseAadhaar, sanitisePan, sanitiseMobile, getProofHint } from '../utils/validation.js';
import { getRentForSharing, SHARING_TYPES, roomService } from '../services/index.js';
import { formatCurrency, formatDate } from '../utils/format.js';
import { getNextDueDate, todayISO, dayjs } from '../utils/dateLogic.js';

function Section({ title, description, children }) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {description && <p className="mt-0.5 mb-4 text-xs text-ink-subtle">{description}</p>}
      <div className={description ? '' : 'mt-4'}>{children}</div>
    </section>
  );
}

/**
 * Room picker. Only rooms that match the chosen sharing type *and* still have a
 * free bed are offered - picking a bed here is a convenience, and the RPC
 * re-checks under a lock when the admission is saved.
 */
function RoomPicker({ rooms, selectedRoomId, bedNo, onSelect, onBedChange, prefillRent }) {
  if (rooms.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong p-4 text-center">
        <p className="text-sm font-medium text-ink">No matching rooms with a free bed</p>
        <p className="mt-1 text-xs text-ink-subtle">
          Add rooms on the Rooms page, or pick a different sharing type.
        </p>
      </div>
    );
  }

  const room = rooms.find((r) => r.id === selectedRoomId);

  return (
    <div className="space-y-3">
      <div className="scroll-slim -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {rooms.map((option) => {
          const selected = option.id === selectedRoomId;
          const beds = roomService.freeBeds(option);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelect(option)}
              aria-pressed={selected}
              className={`min-w-36 shrink-0 rounded-xl border p-3 text-left transition ${
                selected
                  ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20 dark:bg-brand-950'
                  : 'border-line-strong bg-raised hover:border-brand-300'
              }`}
            >
              <p className="text-sm font-semibold text-ink">Room {option.roomNo}</p>
              <p className="mt-0.5 text-[11px] text-ink-subtle">
                Floor {option.floor} &middot; {option.vacant} bed{option.vacant === 1 ? '' : 's'} free
              </p>
              <p className="mt-0.5 text-[11px] font-medium text-brand-700 dark:text-brand-300">
                {prefillRent(option)}
              </p>
              {/* Keep the bed numbers out of the button label so the accessible
                  name stays the room, not a run of digits. */}
              <span className="sr-only">Free beds: {beds.join(', ')}</span>
            </button>
          );
        })}
      </div>

      {room && (
        <div>
          <span className="field-label">Bed</span>
          <div className="flex flex-wrap gap-2">
            {roomService.freeBeds(room).map((bed) => (
              <button
                key={bed}
                type="button"
                onClick={() => onBedChange(String(bed))}
                aria-pressed={String(bed) === String(bedNo)}
                className={`flex size-11 items-center justify-center rounded-xl border text-sm font-semibold transition ${
                  String(bed) === String(bedNo)
                    ? 'border-brand-500 bg-brand-600 text-white'
                    : 'border-line-strong bg-raised text-ink hover:border-brand-300'
                }`}
              >
                {bed}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Admission() {
  const { settings, rooms, roomsStatus, refreshRooms, createCustomer, setCustomerImage } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const termsBoxRef = useRef(null);

  // Once the admin types their own rent we stop overwriting it on sharing change.
  const rentOverridden = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const preselected = useRef(false);

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
      roomId: '',
    },
  });

  const sharingType = Number(watch('sharingType'));
  const joiningDate = watch('joiningDate');
  const proofType = watch('proofType');
  const rentAmount = watch('rentAmount');
  const roomId = watch('roomId');
  const bedNo = watch('bedNo');
  const terms = settings.terms || '';

  useEffect(() => {
    refreshRooms();
  }, [refreshRooms]);

  const pickRoom = useCallback(
    (room) => {
      const [firstFree] = roomService.freeBeds(room);
      setValue('roomId', room.id, { shouldValidate: true, shouldDirty: true });
      setValue('roomNo', room.roomNo, { shouldValidate: true, shouldDirty: true });
      setValue('bedNo', firstFree ? String(firstFree) : '', { shouldValidate: true, shouldDirty: true });
      setValue('sharingType', String(room.sharingType), { shouldValidate: true, shouldDirty: true });
      rentOverridden.current = false;
    },
    [setValue],
  );

  // Rooms page links here as /admission?room=<id>&sharing=<n>. Once the list
  // arrives, preselect that room so the first free bed is already filled in.
  useEffect(() => {
    if (roomsStatus !== 'ready' || preselected.current) return;
    preselected.current = true;
    const wanted = searchParams.get('room');
    if (!wanted) return;
    const target = rooms.find((room) => room.id === wanted);
    if (target && roomService.hasVacancy(target)) pickRoom(target);
  }, [roomsStatus, rooms, searchParams, pickRoom]);

  /** Rooms that match the sharing type and still have a free bed. */
  const matchingRooms = useMemo(
    () => roomService.availableRooms(rooms, sharingType),
    [rooms, sharingType],
  );

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === roomId) ?? null,
    [rooms, roomId],
  );

  /**
   * A room's own rent override wins; otherwise the Settings price. Keeping this
   * in one place means the picker preview and the saved value cannot disagree.
   */
  const rentForRoom = useCallback(
    (room) => formatCurrency(roomService.effectiveRent(room, settings)),
    [settings],
  );

  // Auto-fill rent: the selected room's override if there is one, else the
  // Settings price for the sharing type.
  useEffect(() => {
    if (rentOverridden.current) return;
    const price = selectedRoom
      ? roomService.effectiveRent(selectedRoom, settings)
      : getRentForSharing(settings, sharingType);
    if (price) setValue('rentAmount', price, { shouldValidate: true, shouldDirty: true });
  }, [sharingType, selectedRoom, settings, setValue]);

  // 'idle' only happens before the first rooms read resolves, so the form
  // treats it exactly like 'loading' instead of flashing "no rooms".
  const roomsRequired = roomsStatus === 'ready' && rooms.length > 0;
  const roomsLoading = roomsStatus === 'loading' || roomsStatus === 'idle';

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
      // When rooms exist, the tenant must be placed in one. The RPC re-checks
      // capacity under a row lock, so a room that filled up in another tab
      // fails cleanly here instead of double-booking a bed.
      if (roomsRequired && !values.roomId) {
        throw new Error('Choose a room with a free bed.');
      }

      const dueDay = Number(dayjs(values.joiningDate).date()) || 1;
      const payload = {
        ...values,
        sharingType: Number(values.sharingType),
        rentAmount: Number(values.rentAmount) || 0,
        depositAmount: Number(values.depositAmount) || 0,
        dueDay,
        nextDueDate: getNextDueDate(values.joiningDate, 1, dueDay),
        proofImage: undefined,
        photo: undefined,
      };

      // One admission path for both cases: createCustomer routes through the
      // same create_customer RPC that reserves the bed and writes the first
      // rent cycle, and the context call refreshes the ledger afterwards.
      const customer = await createCustomer(payload);

      // Images are written once the customer (and its id) exists.
      if (values.proofImage) await setCustomerImage(customer.id, 'proof', values.proofImage);
      if (values.photo) await setCustomerImage(customer.id, 'photo', values.photo);

      reset();
      preselected.current = true;
      rentOverridden.current = false;
      // Hold the success toast for a beat when navigating away: happy-dom (and
      // the occasional slow real device) unmounts the page before AnimatePresence
      // can fire the toast, so the confirmation could silently never appear.
      toast.success(
        roomsRequired
          ? `${values.name} admitted to room ${values.roomNo} bed ${values.bedNo}. First rent due ${formatDate(customer.nextDueDate ?? values.joiningDate)}.`
          : `${values.name} admitted. First rent due ${formatDate(customer.nextDueDate)} (${formatCurrency(customer.rentAmount)}).`,
      );
      setTimeout(() => navigate('/', { replace: true }), 0);
    } catch (error) {
      toast.error(error.message || 'Could not save this admission. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-4">
      <header>
        <h1 className="text-xl font-bold text-ink sm:text-2xl">New admission</h1>
        <p className="mt-0.5 text-sm text-ink-subtle">
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
        <Section
          title="Room & rent"
          description={
            roomsLoading
              ? 'Loading rooms...'
              : roomsRequired
                ? 'Pick a room with a free bed. Only rooms matching the sharing type are listed.'
                : 'No rooms are set up yet, so room and bed are optional for now.'
          }
        >
          {roomsRequired && (
            <div className="mb-4">
              <RoomPicker
                rooms={matchingRooms}
                selectedRoomId={roomId}
                bedNo={bedNo}
                onSelect={pickRoom}
                onBedChange={(value) =>
                  setValue('bedNo', value, { shouldValidate: true, shouldDirty: true })
                }
                prefillRent={rentForRoom}
              />
            </div>
          )}

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
            className="scroll-slim max-h-64 overflow-y-auto rounded-xl border border-line bg-sunken p-4
                       text-sm leading-relaxed whitespace-pre-line text-ink"
            tabIndex={0}
            role="region"
            aria-label="Terms and conditions"
          >
            {terms}
          </div>

          <p className="mt-2 text-xs text-ink-subtle">
            These terms are editable from <span className="font-medium">Settings</span>.
          </p>

          <label
            className={`mt-3 flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
              errors.termsAccepted
                ? 'border-red-300 bg-red-50'
                : touchedFields.termsAccepted && !errors.termsAccepted
                  ? 'border-brand-300 bg-brand-50'
                  : 'border-line bg-raised hover:border-line-strong'
            }`}
          >
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-brand-600"
              {...register('termsAccepted')}
            />
            <span className="text-sm leading-relaxed font-medium text-ink">
              I have read and agree to the Terms &amp; Conditions above.
              <span className="ml-0.5 text-red-500">*</span>
            </span>
          </label>
          {errors.termsAccepted && <p className="field-error">{errors.termsAccepted.message}</p>}
        </Section>

        {/* -------------------------------------------------------- submit */}
        <div className="sticky bottom-20 z-10 -mx-4 border-t border-line bg-raised/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:rounded-2xl lg:border">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-xs text-ink-subtle">
              {previewDueDate ? (
                <>
                  First rent due <span className="font-semibold text-ink">{formatDate(previewDueDate)}</span>
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
            <p className="mt-2 text-[11px] text-ink-subtle">
              Complete the required fields and accept the Terms &amp; Conditions to continue.
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
