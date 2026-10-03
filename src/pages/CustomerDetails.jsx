import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Avatar from '../components/Avatar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import PaymentDialog from '../components/PaymentDialog.jsx';
import LightBillDialog from '../components/LightBillDialog.jsx';
import ImageViewer from '../components/ImageViewer.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { TextField, Textarea, SelectField } from '../components/FormFields.jsx';
import { AmountField } from '../components/AmountField.jsx';
import ImagePicker from '../components/ImagePicker.jsx';
import { EmptyState, Spinner } from '../components/States.jsx';
import {
  ArrowLeftIcon,
  EditIcon,
  TrashIcon,
  CheckIcon,
  BoltIcon,
  PhoneIcon,
  IdCardIcon,
  CheckoutIcon,
} from '../components/icons.jsx';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useImageUrl } from '../hooks/useImageUrl.js';
import { customerEditSchema, PROOF_TYPES, sanitiseAadhaar, sanitisePan, sanitiseMobile, getProofHint } from '../utils/validation.js';
import { formatCurrency, formatRupees, formatDate, getAge, formatBillMonth } from '../utils/format.js';
import { todayISO, toDateInput, dayjs } from '../utils/dateLogic.js';
import { getRemaining, getPaidPercent, monthKey, toAmount, TX_LIGHT_BILL } from '../utils/ledger.js';
import { SHARING_TYPES } from '../services/index.js';

const MODE_LABEL = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer' };

function DetailRow({ label, value, mono = false }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <dt className="shrink-0 text-sm text-ink-subtle">{label}</dt>
      <dd className={`text-right text-sm font-medium break-words text-ink ${mono ? 'tabular-nums' : ''}`}>
        {value || <span className="text-ink-subtle">—</span>}
      </dd>
    </div>
  );
}

function ProofThumbnail({ customer, onOpen }) {
  const { url, loading } = useImageUrl(customer.proofPath);
  const label = customer.proofType === 'PAN' ? 'PAN card' : 'Aadhaar card';

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!customer.proofPath}
      className={`group relative flex aspect-4/3 w-full items-center justify-center overflow-hidden rounded-xl border
                  border-line bg-sunken transition ${
                    customer.proofPath ? 'hover:border-brand-300' : 'cursor-not-allowed'
                  }`}
    >
      {loading ? (
        <Spinner />
      ) : url ? (
        <img src={url} alt={label} className="size-full object-cover" />
      ) : (
        <span className="flex flex-col items-center gap-1.5 p-4 text-center">
          <IdCardIcon className="size-6 text-ink-subtle" />
          <span className="text-xs text-ink-subtle">No {label} uploaded</span>
        </span>
      )}
    </button>
  );
}

function HistoryRow({ left, sub, right, rightSub, progress, tone = '' }) {
  return (
    <li className="px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{left}</p>
          {sub && <p className="truncate text-xs text-ink-subtle">{sub}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-sm font-bold ${tone}`}>{right}</p>
          {rightSub && <p className="text-[11px] text-ink-subtle">{rightSub}</p>}
        </div>
      </div>
      {progress !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
          <div
            className={`h-full rounded-full ${
              getPaidPercent({ rentAmount: 100, paidAmount: progress }) >= 100 ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
            style={{ width: `${Math.min(100, getPaidPercent({ rentAmount: 100, paidAmount: progress }))}%` }}
          />
        </div>
      )}
    </li>
  );
}

function EditForm({ customer, onCancel, onSaved }) {
  const { updateCustomer, setCustomerImage } = useData();
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isValid },
  } = useForm({
    resolver: zodResolver(customerEditSchema),
    mode: 'onChange',
    defaultValues: {
      name: customer.name,
      mobile: customer.mobile,
      email: customer.email ?? '',
      guardianName: customer.guardianName ?? '',
      guardianPhone: customer.guardianPhone ?? '',
      address: customer.address ?? '',
      occupation: customer.occupation ?? '',
      proofType: customer.proofType,
      proofId: customer.proofId,
      joiningDate: toDateInput(customer.joiningDate),
      sharingType: String(customer.sharingType),
      rentAmount: customer.rentAmount,
      depositAmount: customer.depositAmount,
      roomNo: customer.roomNo ?? '',
      bedNo: customer.bedNo ?? '',
      notes: customer.notes ?? '',
    },
  });

  const proofType = watch('proofType');

  async function onSubmit(values) {
    setSaving(true);
    try {
      await updateCustomer(customer.id, values);
      toast.success(`${values.name || 'Tenant'} updated.`);
      onSaved();
    } catch (error) {
      toast.error(error.message || 'Could not save the changes.');
    } finally {
      setSaving(false);
    }
  }

  async function saveImage(kind, dataUrl) {
    try {
      await setCustomerImage(customer.id, kind, dataUrl);
      toast.success(kind === 'proof' ? 'Proof image updated.' : 'Photo updated.');
    } catch (error) {
      toast.error(error.message || 'Could not save that image.');
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="e-name" label="Full name" required error={errors.name?.message} {...register('name')} />
        <Controller
          control={control}
          name="mobile"
          render={({ field }) => (
            <TextField
              {...field}
              id="e-mobile"
              label="Mobile number"
              required
              type="tel"
              inputMode="numeric"
              maxLength={10}
              error={errors.mobile?.message}
              onChange={(e) => field.onChange(sanitiseMobile(e.target.value))}
            />
          )}
        />
        <TextField id="e-email" label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <TextField id="e-guardian" label="Guardian / Parent name" error={errors.guardianName?.message} {...register('guardianName')} />
        <Controller
          control={control}
          name="guardianPhone"
          render={({ field }) => (
            <TextField
              {...field}
              id="e-gphone"
              label="Guardian phone"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              error={errors.guardianPhone?.message}
              onChange={(e) => field.onChange(sanitiseMobile(e.target.value))}
            />
          )}
        />
        <TextField id="e-occupation" label="Occupation / College / Company" error={errors.occupation?.message} {...register('occupation')} />
        <SelectField
          id="e-proofType"
          label="Proof type"
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
              id="e-proofId"
              label="Proof ID number"
              maxLength={12}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              hint={getProofHint(proofType)}
              error={errors.proofId?.message}
              onChange={(e) =>
                field.onChange(proofType === 'PAN' ? sanitisePan(e.target.value) : sanitiseAadhaar(e.target.value))
              }
            />
          )}
        />
        <TextField
          id="e-joining"
          label="Joining date"
          type="date"
          max={todayISO()}
          error={errors.joiningDate?.message}
          {...register('joiningDate')}
        />
        <SelectField
          id="e-sharing"
          label="Sharing type"
          options={SHARING_TYPES.map((n) => ({ value: String(n), label: `${n} sharing` }))}
          error={errors.sharingType?.message}
          {...register('sharingType')}
        />
        <AmountField id="e-rent" label="Monthly rent" required min="0" step="1" error={errors.rentAmount?.message} {...register('rentAmount')} />
        <AmountField id="e-deposit" label="Security deposit" min="0" step="1" error={errors.depositAmount?.message} {...register('depositAmount')} />
        <TextField id="e-room" label="Room number" error={errors.roomNo?.message} {...register('roomNo')} />
        <TextField id="e-bed" label="Bed number" error={errors.bedNo?.message} {...register('bedNo')} />
        <Textarea id="e-address" label="Permanent address" wrapperClassName="sm:col-span-2" error={errors.address?.message} {...register('address')} />
        <Textarea id="e-notes" label="Notes" wrapperClassName="sm:col-span-2" error={errors.notes?.message} {...register('notes')} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Controller
          control={control}
          name="proofImage"
          render={({ field }) => (
            <ImagePicker
              value={field.value}
              onChange={(dataUrl) => {
                field.onChange(dataUrl);
                if (dataUrl) saveImage('proof', dataUrl);
              }}
              label="Replace proof image"
              icon={IdCardIcon}
            />
          )}
        />
        <Controller
          control={control}
          name="photo"
          render={({ field }) => (
            <ImagePicker
              value={field.value}
              onChange={(dataUrl) => {
                field.onChange(dataUrl);
                if (dataUrl) saveImage('photo', dataUrl);
              }}
              label="Replace customer photo"
            />
          )}
        />
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={!isValid || saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

export default function CustomerDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const {
    customers,
    cycles,
    lightBills,
    transactions,
    openCycleByCustomer,
    status,
    today,
    updateCustomer,
    vacateCustomer,
    deleteCustomer,
    recordRentPayment,
    recordLightBillPayment,
    saveLightBill,
    deleteTransaction,
    refresh,
  } = useData();

  const [editing, setEditing] = useState(false);
  const [viewingImage, setViewingImage] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [vacateOpen, setVacateOpen] = useState(false);
  const [vacateDate, setVacateDate] = useState(todayISO());
  const [payOpen, setPayOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [existingBill, setExistingBill] = useState(null);
  const [deletingTx, setDeletingTx] = useState(null);
  const [saving, setSaving] = useState(false);

  const customer = useMemo(() => customers.find((c) => c.id === id) ?? null, [customers, id]);
  const cycle = openCycleByCustomer.get(id) ?? null;
  const rentRemaining = getRemaining(cycle);

  const customerCycles = useMemo(
    () => cycles.filter((c) => c.customerId === id).sort((a, b) => String(b.dueDate).localeCompare(String(a.dueDate))),
    [cycles, id],
  );
  const customerBills = useMemo(
    () => lightBills.filter((b) => b.customerId === id).sort((a, b) => String(b.month).localeCompare(String(a.month))),
    [lightBills, id],
  );
  const customerTx = useMemo(
    () =>
      transactions
        .filter((t) => t.customerId === id)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt))),
    [transactions, id],
  );
  const totalReceived = useMemo(() => customerTx.reduce((sum, t) => sum + toAmount(t.amount), 0), [customerTx]);
  const lightRemaining = useMemo(() => customerBills.reduce((sum, b) => sum + getRemaining(b), 0), [customerBills]);
  const overdue = rentRemaining > 0 && today.diff(dayjs(customer?.nextDueDate), 'day') > 0;

  async function handleDelete() {
    setSaving(true);
    try {
      const name = customer.name;
      await deleteCustomer(customer.id);
      toast.success(`${name || 'Tenant'} was removed.`);
      navigate('/', { replace: true });
    } catch (error) {
      // The real error from Supabase is shown verbatim - the list has been
      // refreshed either way, so it always reflects the database.
      toast.error(error.message || 'Could not delete this tenant.');
    } finally {
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  async function handleVacate() {
    setSaving(true);
    try {
      await vacateCustomer(customer.id, vacateDate);
      toast.success(`${customer.name || 'Tenant'} marked as vacated. The bed is free now.`);
      setVacateOpen(false);
    } catch (error) {
      toast.error(error.message || 'Could not save the checkout.');
    } finally {
      setSaving(false);
    }
  }

  async function handleVacateUpdate() {
    setSaving(true);
    try {
      await updateCustomer(customer.id, { status: 'active', vacatedOn: null });
      toast.success('Tenant marked active again.');
    } catch (error) {
      toast.error(error.message || 'Could not update the tenant.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmPayment(payment) {
    setSaving(true);
    try {
      if (payment.kind === 'bill') {
        await recordLightBillPayment({
          customerId: customer.id,
          billId: payment.billId,
          amount: payment.amount,
          date: payment.date,
          mode: payment.mode,
          note: payment.note,
        });
        toast.success('Light bill payment recorded.');
      } else {
        await recordRentPayment({ customerId: customer.id, amount: payment.amount, date: payment.date, mode: payment.mode, note: payment.note });
        toast.success(`Payment recorded. ${formatRupees(payment.amount)} applied to rent.`);
      }
      setPayOpen(false);
    } catch (error) {
      toast.error(error.message || 'Could not record that payment.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmBill(bill) {
    setSaving(true);
    try {
      const saved = await saveLightBill({ ...bill, customerId: customer.id });
      toast.success(`Light bill for ${saved.month} saved.`);
      setBillOpen(false);
      setExistingBill(null);
    } catch (error) {
      toast.error(error.message || 'Could not save that bill.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTx() {
    if (!deletingTx) return;
    setSaving(true);
    try {
      await deleteTransaction(deletingTx.id);
      setDeletingTx(null);
      await refresh();
      toast.success('Payment deleted. Balances were recalculated.');
    } catch (error) {
      setDeletingTx(null);
      toast.error(error.message || 'Could not delete that payment.');
    } finally {
      setSaving(false);
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (!customer) {
    return (
      <EmptyState
        title="Tenant not found"
        message="This record may have been deleted, or the link is out of date."
        action={
          <button type="button" className="btn-primary" onClick={() => navigate('/')}>
            Back to dashboard
          </button>
        }
      />
    );
  }

  const payTarget = { kind: 'rent', customer, cycle };
  const billForThisMonth = customerBills.find((b) => b.month === monthKey(today)) ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-4">
      <button type="button" onClick={() => navigate(-1)} className="btn-ghost -ml-3">
        <ArrowLeftIcon className="size-4" />
        Back
      </button>

      {/* ---------------------------------------------------------- header */}
      <div className="card p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <Avatar customer={customer} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold text-ink">{customer.name || 'Unnamed tenant'}</h1>
                <p className="mt-0.5 text-sm text-ink-subtle">
                  {customer.sharingType} sharing · {getAge(customer.joiningDate)} at PG
                  {customer.status === 'vacated' ? ' · Vacated' : ''}
                </p>
              </div>
              <StatusBadge customer={customer} today={today} cycle={cycle} />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <a href={`tel:${customer.mobile}`} className="btn-secondary min-h-10 px-3 text-xs">
                <PhoneIcon className="size-4" />
                Call
              </a>
              {customer.status !== 'vacated' && (
                <>
                  <button type="button" onClick={() => setPayOpen(true)} className="btn-primary min-h-10 gap-1.5 px-3 text-xs">
                    <CheckIcon className="size-4" />
                    Record payment
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExistingBill(billForThisMonth);
                      setBillOpen(true);
                    }}
                    className="btn-secondary min-h-10 gap-1.5 px-3 text-xs"
                  >
                    <BoltIcon className="size-4" />
                    {billForThisMonth ? 'Edit this month bill' : 'Add light bill'}
                  </button>
                  <button type="button" onClick={() => setVacateOpen(true)} className="btn-secondary min-h-10 gap-1.5 px-3 text-xs">
                    <CheckoutIcon className="size-4" />
                    Vacate customer
                  </button>
                </>
              )}
              {customer.status === 'vacated' && (
                <button type="button" onClick={handleVacateUpdate} className="btn-secondary min-h-10 px-3 text-xs" disabled={saving}>
                  Mark active again
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="btn-ghost min-h-10 gap-1.5 px-3 text-xs text-red-600 dark:text-red-400"
              >
                <TrashIcon className="size-4" />
                Delete
              </button>
            </div>
          </div>
        </div>

        {/* Damaged row: the text fields never made it in. Say so instead of a
            silent blank card. */}
        {!customer.name && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="font-semibold">This tenant's record is missing its name and contact details.</p>
            <p className="mt-0.5">
              Use <span className="font-semibold">Edit details</span> to fill the name and mobile, or delete this tenant
              and admit them again.
            </p>
          </div>
        )}

        {/* The balance strip the tenant cares about. */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-sunken p-3">
            <p className="text-[11px] text-ink-subtle">Monthly rent</p>
            <p className="mt-0.5 text-sm font-bold text-ink">{formatCurrency(customer.rentAmount)}</p>
          </div>
          <div className="rounded-xl bg-sunken p-3">
            <p className="text-[11px] text-ink-subtle">Next rent due</p>
            <p className="mt-0.5 text-sm font-bold text-ink">{formatDate(customer.nextDueDate)}</p>
          </div>
          <div className={`rounded-xl p-3 ${rentRemaining > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
            <p className="text-[11px] text-ink-subtle">Rent balance</p>
            <p className={`mt-0.5 text-sm font-bold ${rentRemaining > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
              {formatRupees(rentRemaining)}
            </p>
          </div>
          <div className="rounded-xl bg-sunken p-3">
            <p className="text-[11px] text-ink-subtle">Deposit</p>
            <p className="mt-0.5 text-sm font-bold text-ink">{formatCurrency(customer.depositAmount)}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {customer.advanceCredit > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
              Advance credit {formatRupees(customer.advanceCredit)}
            </span>
          )}
          {lightRemaining > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
              <BoltIcon className="size-3.5" />
              Electricity due {formatRupees(lightRemaining)}
            </span>
          )}
          <span className="inline-flex items-center rounded-full bg-sunken px-2.5 py-1 text-xs font-semibold text-ink-muted">
            {formatRupees(totalReceived)} received all-time
          </span>
        </div>

        {overdue && (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800">
            Rent is overdue with a balance of {formatRupees(rentRemaining)}. A partial payment will reduce it.
          </p>
        )}
      </div>

      {editing ? (
        <div className="card p-4 sm:p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink">Edit tenant</h2>
          <EditForm customer={customer} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* ---------------------------------------------------- details */}
          <div className="card p-4 sm:p-5 lg:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">Tenant details</h2>
              <button type="button" className="btn-ghost min-h-9 gap-1.5 px-2.5 text-xs" onClick={() => setEditing(true)}>
                <EditIcon className="size-4" />
                Edit details
              </button>
            </div>
            <dl>
              <DetailRow label="Mobile" value={customer.mobile} mono />
              <DetailRow label="Email" value={customer.email} />
              <DetailRow label="Guardian / Parent" value={customer.guardianName} />
              <DetailRow label="Guardian phone" value={customer.guardianPhone} mono />
              <DetailRow label="Occupation / College" value={customer.occupation} />
              <DetailRow label="Permanent address" value={customer.address} />
              <DetailRow label="Joining date" value={formatDate(customer.joiningDate)} />
              <DetailRow label="Room / Bed" value={[customer.roomNo, customer.bedNo].filter(Boolean).join(' - ')} />
              <DetailRow label="Sharing type" value={`${customer.sharingType} sharing`} />
              {customer.status === 'vacated' && <DetailRow label="Vacated on" value={formatDate(customer.vacatedOn)} />}
              <DetailRow label="Notes" value={customer.notes} />
            </dl>
          </div>

          {/* ------------------------------------------------------ proof */}
          <div className="card p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-ink">Identity proof</h2>
            <div className="mt-3">
              <ProofThumbnail customer={customer} onOpen={() => setViewingImage(true)} />
              <p className="mt-2 text-center text-xs text-ink-subtle">
                {customer.proofType === 'PAN' ? 'PAN' : 'Aadhaar'} · {customer.proofId || 'no number saved'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------- rent history */}
      <div className="card overflow-hidden">
        <h2 className="px-3.5 pt-4 pb-2 text-sm font-semibold text-ink">Rent history</h2>
        {customerCycles.length === 0 ? (
          <p className="px-3.5 pb-4 text-sm text-ink-subtle">No rent cycles yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {customerCycles.map((c) => (
              <HistoryRow
                key={c.id}
                left={`Due ${formatDate(c.dueDate)}`}
                sub={`${formatCurrency(c.rentAmount)} rent · ${formatCurrency(c.paidAmount)} paid`}
                right={getRemaining(c) <= 0 ? 'Paid' : formatRupees(getRemaining(c))}
                rightSub={c.status === 'paid' ? 'settled' : c.status}
                progress={toAmount(c.paidAmount)}
                tone={getRemaining(c) <= 0 ? 'text-emerald-700' : 'text-amber-700'}
              />
            ))}
          </ul>
        )}
      </div>

      {/* --------------------------------------------- light bill history */}
      <div className="card overflow-hidden">
        <h2 className="px-3.5 pt-4 pb-2 text-sm font-semibold text-ink">Light bill history</h2>
        {customerBills.length === 0 ? (
          <p className="px-3.5 pb-4 text-sm text-ink-subtle">No light bills yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {customerBills.map((b) => (
              <HistoryRow
                key={b.id}
                left={formatBillMonth(b.month)}
                sub={`${formatCurrency(b.billAmount)} bill · ${formatCurrency(b.paidAmount)} paid`}
                right={getRemaining(b) <= 0 ? 'Paid' : formatRupees(getRemaining(b))}
                rightSub={getRemaining(b) <= 0 ? 'settled' : 'pending'}
                tone={getRemaining(b) <= 0 ? 'text-emerald-700' : 'text-indigo-700'}
              />
            ))}
          </ul>
        )}
      </div>

      {/* --------------------------------------------------- payments log */}
      <div className="card overflow-hidden">
        <h2 className="px-3.5 pt-4 pb-2 text-sm font-semibold text-ink">Payments</h2>
        {customerTx.length === 0 ? (
          <p className="px-3.5 pb-4 text-sm text-ink-subtle">No payments recorded yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {customerTx.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                    t.type === TX_LIGHT_BILL ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {t.type === TX_LIGHT_BILL ? <BoltIcon className="size-4" /> : <CheckIcon className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {t.type === TX_LIGHT_BILL ? 'Light bill' : 'Rent'} · {formatDate(t.date)} · {MODE_LABEL[t.mode] ?? t.mode}
                  </p>
                  {t.note && <p className="truncate text-xs text-ink-subtle">{t.note}</p>}
                </div>
                <span className="shrink-0 text-sm font-bold text-ink">{formatRupees(t.amount)}</span>
                <button
                  type="button"
                  className="btn-ghost size-8 min-h-8 shrink-0 p-0 text-ink-subtle hover:text-red-600"
                  onClick={() => setDeletingTx(t)}
                  aria-label={`Delete payment of ${formatCurrency(t.amount)} on ${formatDate(t.date)}`}
                >
                  <TrashIcon className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --------------------------------------------------------- modals */}
      {payOpen && (
        <PaymentDialog open target={payTarget} onClose={() => setPayOpen(false)} onConfirm={confirmPayment} busy={saving} />
      )}

      {billOpen && (
        <LightBillDialog
          open
          customer={customer}
          existingBill={existingBill}
          onClose={() => {
            setBillOpen(false);
            setExistingBill(null);
          }}
          onSave={confirmBill}
          busy={saving}
        />
      )}

      <ConfirmDialog
        open={vacateOpen}
        onClose={() => setVacateOpen(false)}
        onConfirm={handleVacate}
        busy={saving}
        title={`Vacate ${customer.name || 'this tenant'}?`}
        confirmLabel="Mark vacated"
        message="They are hidden from the dashboard, their bed is freed, and their history is kept."
      >
        <label className="block">
          <span className="field-label">Vacated on</span>
          <input
            type="date"
            className="field-input"
            value={vacateDate}
            max={todayISO()}
            onChange={(e) => setVacateDate(e.target.value)}
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        busy={saving}
        title={`Delete ${customer.name || 'this tenant'}?`}
        confirmLabel="Delete tenant"
        message={`This permanently removes the tenant record, their ${customerTx.length} payment ${
          customerTx.length === 1 ? 'entry' : 'entries'
        }, all rent cycles and light bills, and any uploaded photos or ID documents. This cannot be undone.`}
      />

      <ConfirmDialog
        open={Boolean(deletingTx)}
        onClose={() => setDeletingTx(null)}
        onConfirm={handleDeleteTx}
        busy={saving}
        title="Delete this payment?"
        confirmLabel="Delete payment"
        message={
          deletingTx
            ? `${formatRupees(deletingTx.amount)} received on ${formatDate(deletingTx.date)} will be removed, and the balance it paid will be recalculated.`
            : ''
        }
      />

      <ImageViewer
        open={viewingImage}
        onClose={() => setViewingImage(false)}
        imageId={customer.proofPath}
        title={customer.proofType === 'PAN' ? 'PAN card' : 'Aadhaar card'}
      />
    </div>
  );
}
