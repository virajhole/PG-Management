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
import LightBillDialog from '../components/LightBillDialog.jsx';
import AgreementDialog from '../components/AgreementDialog.jsx';
import UpiQr from '../components/UpiQr.jsx';
import ReminderTemplatesDialog from '../components/ReminderTemplatesDialog.jsx';
import LateFeeDialog from '../components/LateFeeDialog.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { NoticeDialog, MoveDialog, VacateDialog, RoomHistoryDialog } from '../components/TenantDialogs.jsx';
import { TextField, Textarea, SelectField } from '../components/FormFields.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { EmptyState, Spinner } from '../components/States.jsx';
import {
  ArrowLeftIcon,
  EditIcon,
  TrashIcon,
  CheckIcon,
  BoltIcon,
  PhoneIcon,
  IdCardIcon,
  UserPlusIcon,
  MoveIcon,
  CheckoutIcon,
  BuildingIcon,
  FileTextIcon,
  ClockIcon,
  MessageIcon,
} from '../components/icons.jsx';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useImageUrl } from '../hooks/useImageUrl.js';
import { customerEditSchema, PROOF_TYPES, sanitiseAadhaar, sanitisePan, sanitiseMobile, getProofHint } from '../utils/validation.js';
import { formatCurrency, formatRupees, formatDate, getAge } from '../utils/format.js';
import { todayISO, toDateInput, dayjs } from '../utils/dateLogic.js';
import { getRemaining, getPaidPercent, TX_LIGHT_BILL } from '../utils/ledger.js';
import { SHARING_TYPES, roomService } from '../services/index.js';

const MODE_LABEL = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer' };

const TENANT_STATUS_LABELS = {
  active: 'Active',
  notice: 'Leaving soon',
  vacated: 'Vacated',
};

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
  const { url, loading } = useImageUrl(customer.proofImageId);
  const label = customer.proofType === 'PAN' ? 'PAN card' : 'Aadhaar card';

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!customer.proofImageId}
      className={`group relative flex aspect-4/3 w-full items-center justify-center overflow-hidden rounded-xl border
                  border-line bg-sunken transition ${
                    customer.proofImageId ? 'cursor-zoom-in hover:border-brand-400' : 'cursor-default'
                  }`}
    >
      {loading ? (
        <Spinner className="size-5 text-ink-subtle" />
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
          <span className="text-xs text-ink-subtle">No {label} uploaded</span>
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
  const [payTarget, setPayTarget] = useState(null);
  const [billOpen, setBillOpen] = useState(false);
  const [existingBill, setExistingBill] = useState(null);
  const [deletingTx, setDeletingTx] = useState(null);
  const [saving, setSaving] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [vacateOpen, setVacateOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [lateFeeOpen, setLateFeeOpen] = useState(false);
  const [rooms, setRooms] = useState([]);
  const customer = useMemo(() => customers.find((c) => c.id === id) ?? null, [customers, id]);

  useEffect(() => {
    setEditing(false);
  }, [id]);

  // Room numbers for labels; the move/history dialogs need the list, not just ids.
  useEffect(() => {
    let cancelled = false;
    roomService
      .listRooms()
      .then((list) => {
        if (!cancelled) setRooms(list);
      })
      .catch(() => {
        if (!cancelled) setRooms([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cycle = openCycleByCustomer.get(id) ?? null;
  const rentRemaining = getRemaining(cycle);

  const cycleHistory = useMemo(
    () =>
      cycles
        .filter((c) => c.customerId === id)
        .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1)),
    [cycles, id],
  );

  const bills = useMemo(
    () =>
      lightBills
        .filter((b) => b.customerId === id)
        .sort((a, b) => (a.month < b.month ? 1 : -1)),
    [lightBills, id],
  );

  const customerTx = useMemo(
    () =>
      transactions
        .filter((tx) => tx.customerId === id)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [transactions, id],
  );

  const totalReceived = customerTx.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const lightRemaining = bills.reduce((sum, b) => sum + getRemaining(b), 0);

  async function handlePay(payment) {
    setSaving(true);
    try {
      if (payment.kind === 'bill') {
        const { bill } = await recordLightBillPayment({
          customerId: customer.id,
          billId: payTarget.bill.id,
          amount: payment.amount,
          date: payment.date,
          mode: payment.mode,
          note: payment.note,
        });
        toast.success(`Light bill updated. ${formatRupees(getRemaining(bill))} left.`);
      } else {
        const { transaction, nextCycle } = await recordRentPayment({
          customerId: customer.id,
          amount: payment.amount,
          date: payment.date,
          mode: payment.mode,
          note: payment.note,
        });
        const opened = nextCycle ? ` Next cycle due ${formatDate(nextCycle.dueDate)}.` : ' The due date is unchanged.';
        toast.success(`${formatRupees(transaction.amount)} recorded.${opened}`);
      }
      setPayTarget(null);
    } catch (error) {
      toast.error(error.message || 'Could not record that payment.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveBill(bill) {
    setSaving(true);
    try {
      const saved = await saveLightBill(bill);
      toast.success(`Light bill ${formatRupees(saved.billAmount)} saved for ${saved.month}.`);
      setBillOpen(false);
      setExistingBill(null);
    } catch (error) {
      toast.error(error.message || 'Could not save that bill.');
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

  async function handleDeleteTx() {
    if (!deletingTx) return;
    const tx = deletingTx;
    setSaving(true);
    try {
      await deleteTransaction(tx.id);
      setDeletingTx(null);
      await refresh();
      // Genuine undo: a deleted payment is restored by re-recording it with
      // the same amount, date and mode - the ledger maths put the balances
      // back exactly where they were.
      await toast.withUndo(
        async () => {},
        async () => {
          if (tx.type === TX_LIGHT_BILL && tx.billId) {
            await recordLightBillPayment({ customerId: tx.customerId, billId: tx.billId, amount: tx.amount, date: tx.date, mode: tx.mode, note: tx.note });
          } else {
            await recordRentPayment({ customerId: tx.customerId, amount: tx.amount, date: tx.date, mode: tx.mode, note: tx.note });
          }
          await refresh();
        },
        { pendingMessage: 'Transaction deleted. Undo?', undoneMessage: 'Payment restored.' },
      );
    } catch (error) {
      toast.error(error.message || 'Could not delete that transaction.');
    } finally {
      setSaving(false);
    }
  }

  function openPayBill(bill) {
    setPayTarget({ kind: 'bill', customer, bill });
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

  const overdue = getRemaining(cycle) > 0 && today.diff(dayjs(customer.nextDueDate), 'day') > 0;

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
                <h1 className="truncate text-xl font-bold text-ink">{customer.name}</h1>
                <p className="mt-0.5 text-sm text-ink-subtle">
                  {customer.code} · {customer.sharingType} sharing · {getAge(customer.joiningDate)} at PG
                </p>
              </div>
              <StatusBadge customer={customer} today={today} cycle={cycle} />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <a href={`tel:${customer.mobile}`} className="btn-secondary min-h-10 px-3 text-xs">
                <PhoneIcon className="size-4" />
                Call
              </a>
              <ReminderButton customer={customer} remaining={rentRemaining} className="btn-secondary min-h-10 px-3 text-xs" label="Send reminder" />
              <button
                type="button"
                onClick={() => setTemplatesOpen(true)}
                className="btn-secondary min-h-10 px-3 text-xs"
              >
                <MessageIcon className="size-4" />
                Templates
              </button>
              <button
                type="button"
                onClick={() => setPayTarget({ kind: 'rent', customer, cycle })}
                className="btn-primary min-h-10 px-3 text-xs"
              >
                <CheckIcon className="size-4" />
                Record payment
              </button>
              <button
                type="button"
                onClick={() => {
                  setExistingBill(bills.find((b) => b.month === currentMonthKey(today)) ?? null);
                  setBillOpen(true);
                }}
                className="btn-secondary min-h-10 px-3 text-xs"
              >
                <BoltIcon className="size-4" />
                {bills.some((b) => b.month === currentMonthKey(today)) ? 'Edit this month bill' : 'Add light bill'}
              </button>
              {overdue && cycle && (
                <button
                  type="button"
                  onClick={() => setLateFeeOpen(true)}
                  className="btn-secondary min-h-10 px-3 text-xs"
                >
                  <ClockIcon className="size-4" />
                  Late fee
                </button>
              )}
              <button
                type="button"
                onClick={() => setAgreementOpen(true)}
                className="btn-secondary min-h-10 px-3 text-xs"
              >
                <FileTextIcon className="size-4" />
                Agreement
              </button>
            </div>

            {/* Scannable UPI QR for the exact outstanding balance. */}
            {customer.status !== 'vacated' && <UpiQr customer={customer} remaining={rentRemaining} compact />}
          </div>
        </div>

        {/* The sharing card / balance strip the tenant cares about. */}
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
            <p className="text-[11px] text-ink-subtle">Balance on sharing card</p>
            <p className={`mt-0.5 text-sm font-bold ${rentRemaining > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
              {formatRupees(rentRemaining)}
            </p>
          </div>
          <div className="rounded-xl bg-sunken p-3">
            <p className="text-[11px] text-ink-subtle">Deposit</p>
            <p className="mt-0.5 text-sm font-bold text-ink">
              {formatCurrency(customer.depositAmount)}
              {customer.depositPaid ? ' ✓' : ''}
            </p>
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
            Rent is overdue with a balance of {formatRupees(rentRemaining)}. A partial payment will reduce it
            without moving the due date; settling in full opens the next month.
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
            <h2 className="mb-2 text-sm font-semibold text-ink">Tenant details</h2>
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
              <DetailRow label="Status" value={TENANT_STATUS_LABELS[customer.status] ?? customer.status} />
              {customer.status === 'notice' && (
                <DetailRow label="Expected leaving" value={formatDate(customer.expectedLeavingDate)} />
              )}
              {customer.vacatedAt && (
                <DetailRow label="Checked out" value={formatDate(customer.vacatedAt)} />
              )}
              {Number(customer.damageCharges) > 0 && (
                <DetailRow label="Damage charges" value={formatRupees(customer.damageCharges)} />
              )}
              <DetailRow label="Notes" value={customer.notes} />
            </dl>

            {customer.status !== 'vacated' && (
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
                  <EditIcon className="size-4" />
                  Edit details
                </button>
                <button type="button" className="btn-secondary" onClick={() => setMoveOpen(true)}>
                  <MoveIcon className="size-4" />
                  Move bed
                </button>
                <button
                  type="button"
                  className="btn-secondary sm:col-span-2"
                  onClick={() => setHistoryOpen(true)}
                >
                  <BuildingIcon className="size-4" />
                  Room history
                </button>
                {customer.status === 'notice' ? (
                  <button type="button" className="btn-secondary" onClick={() => setNoticeOpen(true)}>
                    Update notice
                  </button>
                ) : (
                  <button type="button" className="btn-secondary" onClick={() => setNoticeOpen(true)}>
                    Give notice
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary sm:col-span-2"
                  onClick={() => setVacateOpen(true)}
                >
                  <CheckoutIcon className="size-4" />
                  Checkout &amp; settle deposit
                </button>
                <button
                  type="button"
                  className="btn-ghost text-red-600 hover:bg-red-50 sm:col-span-2"
                  onClick={() => setConfirmDelete(true)}
                >
                  <TrashIcon className="size-4" />
                  Delete tenant
                </button>
              </div>
            )}
          </div>

          {/* ------------------------------------------------------ proof */}
          <div className="card p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Identity proof</h2>
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

      {/* --------------------------------------------------- rent cycle history */}
      <div className="card p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">
            Rent cycles
            <span className="ml-1.5 font-normal text-ink-subtle">({cycleHistory.length})</span>
          </h2>
          {cycle && <p className="text-xs text-ink-subtle">Next due {formatDate(customer.nextDueDate)}</p>}
        </div>

        {cycleHistory.length === 0 ? (
          <EmptyState
            icon={CheckIcon}
            title="No rent cycles yet"
            message="The open cycle appears here the moment the first payment is recorded."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {cycleHistory.map((c) => {
              const remaining = getRemaining(c);
              const percent = getPaidPercent(c);
              return (
                <li key={c.id} className="py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-1">
                        <p className="text-sm font-semibold text-ink">
                          {formatCurrency(c.rentAmount)} <span className="font-normal text-ink-subtle">· due {formatDate(c.dueDate)}</span>
                        </p>
                        <span
                          className={`text-xs font-semibold ${
                            remaining <= 0 ? 'text-emerald-600' : c.paidAmount > 0 ? 'text-amber-600' : 'text-red-600'
                          }`}
                        >
                          {remaining <= 0 ? 'Paid' : `${formatRupees(remaining)} left`}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                          <div
                            className={`h-full rounded-full ${percent >= 100 ? 'bg-emerald-500' : percent > 0 ? 'bg-amber-500' : 'bg-line-strong'}`}
                            style={{ width: `${Math.min(100, percent)}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-ink-subtle tabular-nums">{percent}%</span>
                      </div>
                    </div>
                    {getRemaining(c) > 0 && c.id === cycle?.id && (
                      <button
                        type="button"
                        onClick={() => setPayTarget({ kind: 'rent', customer, cycle: c })}
                        className="btn-secondary min-h-9 px-2.5 text-xs"
                      >
                        Pay
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ---------------------------------------------------- light bill history */}
      <div className="card p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">
            Light bills
            <span className="ml-1.5 font-normal text-ink-subtle">({bills.length})</span>
          </h2>
          <button
            type="button"
            className="btn-ghost text-brand-700"
            onClick={() => {
              setExistingBill(bills.find((b) => b.month === currentMonthKey(today)) ?? null);
              setBillOpen(true);
            }}
          >
            <BoltIcon className="size-4" />
            {bills.some((b) => b.month === currentMonthKey(today)) ? 'Edit bill' : 'Add bill'}
          </button>
        </div>

        {bills.length === 0 ? (
          <EmptyState
            icon={BoltIcon}
            title="No electricity bills yet"
            message="Add a light bill to track this tenant's electricity separately from rent."
            action={
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setExistingBill(null);
                  setBillOpen(true);
                }}
              >
                <BoltIcon className="size-4" />
                Add light bill
              </button>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {bills.map((bill) => {
              const remaining = getRemaining(bill);
              return (
                <li key={bill.id} className="flex items-center gap-3 py-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                    <BoltIcon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{formatBillMonth(bill.month)} · {formatRupees(bill.billAmount)}</p>
                    <p className="truncate text-xs text-ink-subtle">
                      {bill.units != null ? `${bill.units} units` : ''}
                      {bill.ratePerUnit != null ? ` x Rs ${bill.ratePerUnit}` : ''}
                      {bill.note ? ` · ${bill.note}` : ''}
                      {remaining > 0 ? ` · ${formatRupees(remaining)} pending` : ' · paid'}
                    </p>
                  </div>
                  {remaining > 0 && (
                    <button
                      type="button"
                      onClick={() => openPayBill(bill)}
                      className="btn-secondary min-h-9 px-2.5 text-xs"
                    >
                      Pay {formatRupees(remaining)}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setExistingBill(bill);
                      setBillOpen(true);
                    }}
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-sunken hover:text-ink-muted"
                    aria-label={`Edit ${formatBillMonth(bill.month)} bill`}
                  >
                    <EditIcon className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ------------------------------------------------- payment history */}
      <div className="card p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">
            Payment history
            <span className="ml-1.5 font-normal text-ink-subtle">({customerTx.length})</span>
          </h2>
          <p className="text-xs text-ink-subtle">{formatRupees(totalReceived)} received in total</p>
        </div>

        {customerTx.length === 0 ? (
          <EmptyState
            icon={CheckIcon}
            title="No payments recorded yet"
            message="Once rent is collected, every entry will appear here with its amount, date, mode and note."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {customerTx.map((payment) => (
              <li key={payment.id} className="flex items-center gap-3 py-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <CheckIcon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{formatCurrency(payment.amount)}</p>
                  <p className="truncate text-xs text-ink-subtle">
                    {formatDate(payment.date)} · {MODE_LABEL[payment.mode] ?? payment.mode} ·{' '}
                    {payment.type === TX_LIGHT_BILL ? 'Light bill' : 'Rent'}
                    {payment.note ? ` · ${payment.note}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeletingTx(payment)}
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-red-50 hover:text-red-600"
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

      <RoomHistoryDialog
        open={historyOpen}
        customer={customer}
        rooms={rooms}
        onClose={() => setHistoryOpen(false)}
      />

      <NoticeDialog
        open={noticeOpen}
        customer={customer}
        onClose={() => setNoticeOpen(false)}
        onDone={refresh}
      />

      <MoveDialog
        open={moveOpen}
        customer={customer}
        onClose={() => setMoveOpen(false)}
        onDone={refresh}
      />

      <VacateDialog
        open={vacateOpen}
        customer={customer}
        pendingRent={rentRemaining}
        pendingBill={lightRemaining}
        onClose={() => setVacateOpen(false)}
        onDone={refresh}
      />

      <PaymentDialog
        open={Boolean(payTarget)}
        target={payTarget}
        onClose={() => setPayTarget(null)}
        onConfirm={handlePay}
        busy={saving}
      />

      <LightBillDialog
        open={billOpen}
        customer={customer}
        existingBill={existingBill}
        onClose={() => setBillOpen(false)}
        onSave={handleSaveBill}
        busy={saving}
      />

      <AgreementDialog open={agreementOpen} customer={customer} onClose={() => setAgreementOpen(false)} />

      <ReminderTemplatesDialog
        open={templatesOpen}
        customer={customer}
        onClose={() => setTemplatesOpen(false)}
      />

      <LateFeeDialog
        open={lateFeeOpen}
        customer={customer}
        cycle={cycle}
        onClose={() => setLateFeeOpen(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        busy={saving}
        title={`Delete ${customer.name}?`}
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
        title="Delete this entry?"
        confirmLabel="Delete entry"
        message={
          deletingTx
            ? `${formatRupees(deletingTx.amount)} received on ${formatDate(deletingTx.date)} will be removed, and the rent cycle or bill it paid will be recalculated.`
            : ''
        }
      />
    </div>
  );
}

function currentMonthKey(date) {
  return dayjs(date).format('YYYY-MM');
}

function formatBillMonth(key) {
  const [year, month] = String(key || '').split('-');
  if (!year || !month) return String(key || '');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(month) - 1]} ${year}`;
}