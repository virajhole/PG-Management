import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { formatCurrency, formatDate, toNumber } from '../utils/format.js';
import { todayISO } from '../utils/dateLogic.js';

const MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank', label: 'Bank transfer' },
];

/**
 * "Mark as Paid" - records the amount, date and mode, then the service rolls
 * the next due date forward one month.
 */
export default function PaymentDialog({ open, customer, onClose, onConfirm, busy }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [mode, setMode] = useState('cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !customer) return;
    setAmount(String(customer.rentAmount ?? ''));
    setDate(todayISO());
    setMode('cash');
    setNote('');
    setError('');
  }, [open, customer]);

  if (!open || !customer) return null;

  const numericAmount = toNumber(amount, 0);

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
    onConfirm?.({ amount: numericAmount, date, mode, note: note.trim() });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mark rent as paid"
      description={`${customer.name} · ${formatCurrency(customer.rentAmount)} due on ${formatDate(customer.nextDueDate)}`}
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
        <div>
          <label className="field-label" htmlFor="payment-amount">
            Amount received (Rs)
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm font-medium text-slate-400">
              Rs
            </span>
            <input
              id="payment-amount"
              data-autofocus
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              className={`field-input pl-10 ${error ? 'field-input-error' : ''}`}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError('');
              }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="chip border-slate-200 text-slate-600" onClick={() => setAmount(String(customer.rentAmount))}>
              Full rent
            </button>
            <button
              type="button"
              className="chip border-slate-200 text-slate-600"
              onClick={() => setAmount(String(customer.depositAmount || 0))}
            >
              Deposit
            </button>
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
            Note <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="payment-note"
            type="text"
            className="field-input"
            placeholder="e.g. Paid via Google Pay"
            value={note}
            maxLength={120}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && <p className="field-error">{error}</p>}

        <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-xs leading-relaxed text-slate-500">
          Recording this payment moves the next rent due date forward by one month. The row colour on the
          dashboard updates immediately.
        </p>
      </form>
    </Modal>
  );
}
