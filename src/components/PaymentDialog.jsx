import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { AmountField } from './AmountField.jsx';
import { formatDate, formatRupees, toNumber } from '../utils/format.js';
import { todayISO } from '../utils/dateLogic.js';
import { getRemaining, describeRentPlan, planRentPayment } from '../utils/ledger.js';

const MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank', label: 'Bank transfer' },
];

/**
 * The single "Record Payment" sheet.
 *
 * Two targets:
 *   kind 'rent' -> pays the tenant's open rent cycle (live preview of what the
 *                  payment will do: partial, settle + next cycle, or advance)
 *   kind 'bill' -> pays a light bill (presented as "settle in full or leave")
 *
 * The parent decides which service to call from the exact same form values.
 */
export default function PaymentDialog({ open, target, onClose, onConfirm, busy }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [mode, setMode] = useState('cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  const isRent = open && target?.kind === 'rent';
  const isBill = open && target?.kind === 'bill';

  const cycle = isRent ? target.cycle : null;
  const bill = isBill ? target.bill : null;
  const customer = open ? target?.customer : null;

  const remaining = isBill ? getRemaining(bill) : cycle ? getRemaining(cycle) : 0;
  const rentAmount = cycle ? cycle.rentAmount : isBill ? bill.billAmount : 0;

  // Reset each time the sheet opens.
  useEffect(() => {
    if (!open || !target) return;
    setDate(todayISO());
    setMode('cash');
    setNote('');
    setError('');
    setPreview(null);
    if (target.kind === 'bill') {
      setAmount(String(remaining || ''));
    } else {
      setAmount(String(customer?.rentAmount ?? ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.id]);

  // Live preview of a rent payment, debounced. Writes nothing.
  useEffect(() => {
    if (!isRent || !customer || !cycle) {
      setPreview(null);
      return;
    }
    const numeric = toNumber(amount, 0);
    if (numeric <= 0) {
      setPreview(null);
      return;
    }
    const handle = setTimeout(() => {
      setPreview(
        planRentPayment({
          cycle,
          amount: numeric,
          dueDay: customer.dueDay,
          nextRentAmount: customer.rentAmount,
          advanceCredit: customer.advanceCredit,
        }),
      );
    }, 250);
    return () => clearTimeout(handle);
  }, [isRent, customer, cycle, amount]);

  if (!open || !customer) return null;

  const numericAmount = toNumber(amount, 0);

  const chips = isBill
    ? [
        { label: 'Full amount', amount: bill.billAmount },
        ...(remaining > 0 ? [{ label: 'Balance', amount: remaining }] : []),
      ]
    : [
        { label: 'Full rent', amount: cycle.rentAmount },
        ...(remaining > 0 ? [{ label: 'Balance', amount: remaining }] : []),
        { label: 'Half rent', amount: Math.round(cycle.rentAmount / 2) },
        ...(customer.depositAmount > 0 ? [{ label: 'Deposit', amount: customer.depositAmount }] : []),
      ];

  function submit(event) {
    event.preventDefault();
    if (numericAmount <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (!date) {
      setError('Choose a payment date.');
      return;
    }
    onConfirm?.({
      kind: isRent ? 'rent' : 'bill',
      amount: numericAmount,
      date,
      mode,
      note: note.trim(),
    });
  }

  const statusTone = remaining <= 0 ? 'emerald' : cycle ? 'slate' : 'red';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isBill ? 'Record light bill payment' : 'Record rent payment'}
      description={
        isBill
          ? `${customer.name} · ${formatRupees(bill.billAmount)} bill for ${formatBillMonth(bill.month)}`
          : `${customer.name} · ${formatRupees(customer.rentAmount)} rent due ${formatDate(cycle.dueDate)}`
      }
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="payment-form" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Record payment'}
          </button>
        </div>
      }
    >
      <form id="payment-form" onSubmit={submit} className="space-y-4">
        {/* ----------------------------------------------------- target card */}
        <div
          className={`rounded-xl border bg-sunken p-3.5 text-sm ${
            statusTone === 'emerald' ? 'border-emerald-200' : statusTone === 'red' ? 'border-red-200' : 'border-line'
          }`}
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-medium text-ink-subtle">Total due</p>
            <p className="text-lg font-bold text-ink tabular-nums">{formatRupees(rentAmount)}</p>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-3">
            <p className="text-xs font-medium text-ink-subtle">Paid so far</p>
            <p className="font-semibold text-ink tabular-nums">
              {formatRupees(rentAmount - remaining)}
              {remaining > 0 && <span className="ml-3 text-xs font-medium text-red-600">{formatRupees(remaining)} left</span>}
            </p>
          </div>
          {cycle && customer.advanceCredit > 0 && (
            <p className={`mt-1.5 text-xs font-medium ${statusTone === 'emerald' ? 'text-emerald-700' : 'text-amber-700'}`}>
              Advance credit: {formatRupees(customer.advanceCredit)} already in hand
            </p>
          )}
        </div>

        {/* ---------------------------------------------------- live preview */}
        {isRent && preview && (
          <div className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-3 text-xs leading-relaxed">
            <p className="font-semibold text-brand-800">
              {preview.kind === 'none' ? 'Nothing to apply' : capitalize(preview.kind)} payment
            </p>
            <p className="mt-1 text-brand-900">{describeRentPlan(preview)}</p>
          </div>
        )}

        {isBill && numericAmount > 0 && (
          <div
            className={`rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed ${
              remaining <= 0
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : numericAmount >= remaining
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-line bg-sunken text-ink-muted'
            }`}
          >
            {remaining <= 0
              ? 'This bill is already settled - the amount is an overpayment.'
              : numericAmount >= remaining
                ? 'Will settle this bill in full.'
                : `${formatRupees(remaining - numericAmount)} will still be pending on this bill.`}
          </div>
        )}

        {/* --------------------------------------------------------- amount */}
        <div>
          <AmountField
            id="payment-amount"
            label="Amount received"
            required
            autoFocus
            min="1"
            step="1"
            value={amount}
            error={error}
            onChange={(e) => {
              setAmount(e.target.value);
              setError('');
            }}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <button
                key={chip.label}
                type="button"
                className="chip border-line text-ink-muted"
                onClick={() => setAmount(String(chip.amount))}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="payment-date">
              Payment date
            </label>
            <input
              id="payment-date"
              type="date"
              className="field-input"
              value={date}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="payment-mode">
              Payment mode
            </label>
            <select
              id="payment-mode"
              className="field-input"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="payment-note">
            Note <span className="font-normal text-ink-subtle">(optional)</span>
          </label>
          <input
            id="payment-note"
            type="text"
            className="field-input"
            placeholder={isBill ? 'e.g. Paid in full for May units' : 'e.g. Paid via Google Pay'}
            value={note}
            maxLength={120}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && <p className="field-error">{error}</p>}

        <p className="rounded-xl bg-sunken px-3.5 py-3 text-xs leading-relaxed text-ink-subtle">
          {isBill
            ? 'Recording a bill payment updates the bill balance. Rent is never affected by a light bill payment.'
            : 'A partial payment leaves the due date unchanged. Settling in full opens the next month cycle; any surplus rolls into it automatically.'}
        </p>
      </form>
    </Modal>
  );
}

function formatBillMonth(key) {
  const [year, month] = String(key || '').split('-');
  if (!year || !month) return String(key || '');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(month) - 1]} ${year}`;
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}