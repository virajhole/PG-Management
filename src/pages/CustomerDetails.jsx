import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Avatar from '../components/Avatar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import ReminderButton from '../components/ReminderButton.jsx';
import ImagePicker from '../components/ImagePicker.jsx';
import ImageViewer from '../components/ImageViewer.jsx';
import PaymentDialog from '../components/PaymentDialog.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { TextField, Textarea, SelectField } from '../components/FormFields.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { EmptyState, Spinner } from '../components/States.jsx';
import {
  ArrowLeftIcon,
  EditIcon,
  TrashIcon,
  CheckIcon,
  PhoneIcon,
  IdCardIcon,
  UserPlusIcon,
  MessageIcon,
} from '../components/icons.jsx';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { customerService } from '../services/index.js';
import { useImageUrl } from '../hooks/useImageUrl.js';
import { customerEditSchema, PROOF_TYPES, sanitiseAadhaar, sanitisePan, sanitiseMobile, getProofHint } from '../utils/validation.js';
import { formatCurrency, formatDate, getAge } from '../utils/format.js';
import { getCycleStart, todayISO, toDateInput } from '../utils/dateLogic.js';
import { SHARING_TYPES } from '../services/index.js';

function DetailRow({ label, value, mono = false }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0">
      <dt className="shrink-0 text-sm text-slate-500">{label}</dt>
      <dd className={`text-right text-sm font-medium break-words text-slate-800 ${mono ? 'tabular-nums' : ''}`}>
        {value || <span className="text-slate-400">—</span>}
      </dd>
    </div>
  );
}

function ProofThumbnail({ customer, onOpen }) {
  const { url, loading } = useImageUrl(customer.proofImageId);
  const label = customer.proofType === 'PAN' ? 'PAN card' : 'Aadhaar card';

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!customer.proofImageId}
      className={`group relative flex aspect-4/3 w-full items-center justify-center overflow-hidden rounded-xl border
                  border-slate-200 bg-slate-50 transition ${
                    customer.proofImageId ? 'cursor-zoom-in hover:border-brand-400' : 'cursor-default'
                  }`}
    >
      {loading ? (
        <Spinner className="size-5 text-slate-400" />
      ) : url ? (
        <>
          <img src={url} alt={`${label} for ${customer.name}`} className="size-full object-cover" />
          <span className="absolute inset-x-0 bottom-0 bg-slate-900/70 px-2 py-1.5 text-[11px] font-medium text-white">
            Tap to view full screen
          </span>
        </>
      ) : (
        <div className="flex flex-col items-center gap-1.5 p-4 text-center">
          <IdCardIcon className="size-6 text-slate-300" />
          <span className="text-xs text-slate-400">No {label} uploaded</span>
        </div>
      )}
    </button>
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
      toast.success(`${values.name} updated.`);
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
        <TextField
          id="e-guardian"
          label="Guardian / Parent name"
          error={errors.guardianName?.message}
          {...register('guardianName')}
        />
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
        <TextField
          id="e-occupation"
          label="Occupation / College / Company"
          error={errors.occupation?.message}
          {...register('occupation')}
        />
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
                field.onChange(
                  proofType === 'PAN' ? sanitisePan(e.target.value) : sanitiseAadhaar(e.target.value),
                )
              }
            />
          )}
        />
        <TextField
          id="e-joining"
          label="Joining date"
          type="date"
          max={todayISO()}
          hint="Changing this recalculates the rent due anchor."
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
        <AmountField
          id="e-rent"
          label="Monthly rent"
          required
          min="0"
          step="1"
          error={errors.rentAmount?.message}
          {...register('rentAmount')}
        />
        <AmountField
          id="e-deposit"
          label="Security deposit"
          min="0"
          step="1"
          error={errors.depositAmount?.message}
          {...register('depositAmount')}
        />
        <TextField id="e-room" label="Room number" error={errors.roomNo?.message} {...register('roomNo')} />
        <TextField id="e-bed" label="Bed number" error={errors.bedNo?.message} {...register('bedNo')} />
        <Textarea
          id="e-address"
          label="Permanent address"
          wrapperClassName="sm:col-span-2"
          error={errors.address?.message}
          {...register('address')}
        />
        <Textarea
          id="e-notes"
          label="Notes"
          wrapperClassName="sm:col-span-2"
          error={errors.notes?.message}
          {...register('notes')}
        />
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

      <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
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
  const { customers, status, today, deleteCustomer, addPayment, removePayment } = useData();

  const [editing, setEditing] = useState(false);
  const [viewingImage, setViewingImage] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingPayment, setDeletingPayment] = useState(null);

  const customer = useMemo(() => customers.find((c) => c.id === id) ?? null, [customers, id]);

  useEffect(() => {
    setEditing(false);
  }, [id]);

  async function handlePay(payment) {
    setSaving(true);
    try {
      const { customer: updated } = await addPayment(customer.id, payment);
      toast.success(`Payment recorded. Next rent due ${formatDate(updated.nextDueDate)}.`);
      setPayOpen(false);
    } catch (error) {
      toast.error(error.message || 'Could not record that payment.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      const name = customer.name;
      await deleteCustomer(customer.id);
      toast.success(`${name} was removed.`);
      navigate('/', { replace: true });
    } catch (error) {
      toast.error(error.message || 'Could not delete this tenant.');
    } finally {
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  async function handleDeletePayment() {
    try {
      await removePayment(customer.id, deletingPayment.id);
      toast.success('Payment entry deleted.');
      setDeletingPayment(null);
    } catch (error) {
      toast.error(error.message || 'Could not delete that payment.');
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="size-7 text-brand-600" />
      </div>
    );
  }

  if (!customer) {
    return (
      <EmptyState
        icon={UserPlusIcon}
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

  const rentStatus = customerService.getCustomerStatus(customer, today);
  const cycleStart = getCycleStart(customer.nextDueDate, customer.dueDay);
  const payments = [...customer.payments].sort((a, b) => (a.date < b.date ? 1 : -1));
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

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
                <h1 className="truncate text-xl font-bold text-slate-900">{customer.name}</h1>
                <p className="mt-0.5 text-sm text-slate-500">
                  {customer.code} · {customer.sharingType} sharing · {getAge(customer.joiningDate)} at PG
                </p>
              </div>
              <StatusBadge customer={customer} today={today} />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <a href={`tel:${customer.mobile}`} className="btn-secondary min-h-10 px-3 text-xs">
                <PhoneIcon className="size-4" />
                Call
              </a>
              <ReminderButton customer={customer} className="btn-secondary min-h-10 px-3 text-xs" label="Send reminder" />
              <button
                type="button"
                onClick={() => setPayOpen(true)}
                className="btn-primary min-h-10 px-3 text-xs"
              >
                <CheckIcon className="size-4" />
                Mark as Paid
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] text-slate-500">Monthly rent</p>
            <p className="mt-0.5 text-sm font-bold text-slate-900">{formatCurrency(customer.rentAmount)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] text-slate-500">Next rent due</p>
            <p className="mt-0.5 text-sm font-bold text-slate-900">{formatDate(customer.nextDueDate)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] text-slate-500">Deposit</p>
            <p className="mt-0.5 text-sm font-bold text-slate-900">
              {formatCurrency(customer.depositAmount)}
              {customer.depositPaid ? ' ✓' : ''}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] text-slate-500">Total received</p>
            <p className="mt-0.5 text-sm font-bold text-slate-900">{formatCurrency(totalPaid)}</p>
          </div>
        </div>

        {rentStatus === 'overdue' && (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800">
            Rent is overdue. Recording a payment will move the due date forward one month.
          </p>
        )}
      </div>

      {editing ? (
        <div className="card p-4 sm:p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Edit tenant</h2>
          <EditForm customer={customer} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* ---------------------------------------------------- details */}
          <div className="card p-4 sm:p-5 lg:col-span-2">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Tenant details</h2>
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
              <DetailRow label="Status" value={customer.status === 'active' ? 'Active' : 'Inactive'} />
              <DetailRow label="Notes" value={customer.notes} />
            </dl>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button type="button" className="btn-secondary flex-1" onClick={() => setEditing(true)}>
                <EditIcon className="size-4" />
                Edit details
              </button>
              <button type="button" className="btn-ghost text-red-600 hover:bg-red-50 sm:flex-none" onClick={() => setConfirmDelete(true)}>
                <TrashIcon className="size-4" />
                Delete
              </button>
            </div>
          </div>

          {/* ------------------------------------------------------ proof */}
          <div className="card p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Identity proof</h2>
            <ProofThumbnail customer={customer} onOpen={() => setViewingImage(true)} />
            <dl className="mt-3">
              <DetailRow label="Type" value={customer.proofType === 'PAN' ? 'PAN card' : 'Aadhaar card'} />
              <DetailRow label="Proof number" value={customer.proofId} mono />
            </dl>
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
              Stored on this device only. Do not share screenshots of this screen.
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------- payment history */}
      <div className="card p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Payment history
            {payments.length > 0 && (
              <span className="ml-1.5 font-normal text-slate-400">({payments.length})</span>
            )}
          </h2>
          <p className="text-xs text-slate-500">
            Billing cycle from {formatDate(cycleStart)}
          </p>
        </div>

        {payments.length === 0 ? (
          <EmptyState
            icon={MessageIcon}
            title="No payments recorded yet"
            message="Once rent is collected, every entry will appear here with its amount, date and mode."
            action={
              <button type="button" className="btn-primary" onClick={() => setPayOpen(true)}>
                <CheckIcon className="size-4" />
                Record first payment
              </button>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-center gap-3 py-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <CheckIcon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{formatCurrency(payment.amount)}</p>
                  <p className="truncate text-xs text-slate-500">
                    {formatDate(payment.date)} · {payment.mode === 'upi' ? 'UPI' : payment.mode === 'bank' ? 'Bank transfer' : 'Cash'}
                    {payment.note ? ` · ${payment.note}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeletingPayment(payment)}
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                  aria-label={`Delete payment of ${formatCurrency(payment.amount)} on ${formatDate(payment.date)}`}
                >
                  <TrashIcon className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------------------------------------------------------- modals */}
      <ImageViewer
        open={viewingImage}
        imageId={customer.proofImageId}
        onClose={() => setViewingImage(false)}
        title={`${customer.proofType === 'PAN' ? 'PAN' : 'Aadhaar'} · ${customer.name}`}
      />

      <PaymentDialog
        open={payOpen}
        customer={customer}
        onClose={() => setPayOpen(false)}
        onConfirm={handlePay}
        busy={saving}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        busy={saving}
        title={`Delete ${customer.name}?`}
        confirmLabel="Delete tenant"
        message={`This permanently removes the tenant record, their ${payments.length} payment ${
          payments.length === 1 ? 'entry' : 'entries'
        } and any uploaded photos or ID documents. This cannot be undone.`}
      />

      <ConfirmDialog
        open={Boolean(deletingPayment)}
        onClose={() => setDeletingPayment(null)}
        onConfirm={handleDeletePayment}
        title="Delete this payment entry?"
        confirmLabel="Delete entry"
        message={
          deletingPayment
            ? `${formatCurrency(deletingPayment.amount)} received on ${formatDate(deletingPayment.date)} will be removed. The next rent due date will not change.`
            : ''
        }
      />
    </div>
  );
}
