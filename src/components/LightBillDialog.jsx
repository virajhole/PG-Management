import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { AmountField } from './AmountField.jsx';
import { formatRupees, toNumber } from '../utils/format.js';
import { formatMonthKey, toMonthInput, todayISO } from '../utils/dateLogic.js';

/**
 * Create or edit a light bill for a tenant.
 *
 * Units x rate is offered as the convenient shortcut (the derived amount is
 * shown live), but the total is fully editable because most real bills carry
 * fixed charges too - e.g. 80 units x 4.25 = 340, plus a 360 fixed charge, is a
 * Rs 700 bill.
 */
export default function LightBillDialog({ open, customer, existingBill, onClose, onSave, busy }) {
  const [month, setMonth] = useState(toMonthInput(todayISO()));
  const [units, setUnits] = useState('');
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !customer) return;
    setMonth(existingBill?.month || toMonthInput(todayISO()));
    setUnits(existingBill?.units == null ? '' : String(existingBill.units));
    setRate(existingBill?.ratePerUnit == null ? '' : String(existingBill.ratePerUnit));
    setAmount(String(existingBill?.billAmount ?? ''));
    setNote(existingBill?.note ?? '');
    setAmountTouched(Boolean(existingBill));
    setError('');
  }, [open, customer, existingBill]);

  if (!open || !customer) return null;

  const unitsValue = toNumber(units, 0);
  const rateValue = toNumber(rate, 0);
  const derived = unitsValue * rateValue;
  const numericAmount = toNumber(amount, 0);
  const effectiveAmount = amountTouched ? numericAmount : derived;

  const unitSummary =
    units && rate && !amountTouched
      ? `${unitsValue} units x Rs ${rateValue} = ${formatRupees(derived)}`
      : amountTouched && units && rate
        ? `Note: units x rate here would be ${formatRupees(derived)}`
        : '';

  function submit(event) {
    event.preventDefault();
    if (effectiveAmount <= 0) {
      setError(amountTouched ? 'Enter a bill amount greater than zero.' : 'Enter units and rate, or a manual amount.');
      return;
    }
    onSave?.({
      billId: existingBill?.id ?? null,
      customerId: customer.id,
      month: month || formatMonthKey(todayISO()),
      units: units === '' ? null : unitsValue,
      ratePerUnit: rate === '' ? null : rateValue,
      billAmount: effectiveAmount,
      note: note.trim(),
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existingBill ? 'Edit light bill' : 'Add light bill'}
      description={`${customer.name} · bill for a calendar month, tracked separately from rent`}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="bill-form" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : existingBill ? 'Save bill' : 'Add bill'}
          </button>
        </div>
      }
    >
      <form id="bill-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="bill-month">
              Month
            </label>
            <input
              id="bill-month"
              type="month"
              className="field-input"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <div />
          <AmountField
            id="bill-units"
            label="Units consumed"
            prefix=""
            min="0"
            step="1"
            placeholder="e.g. 80"
            value={units}
            onChange={(e) => {
              setUnits(e.target.value);
              if (e.target.value === '') {
                setAmountTouched(true);
              } else if (!amountTouched) {
                setAmount(e.target.value && rate ? String(toNumber(e.target.value * toNumber(rate, 0), 0)) : amount);
                setAmountTouched(false);
              }
            }}
          />
          <AmountField
            id="bill-rate"
            label="Rate per unit (Rs)"
            prefix=""
            min="0"
            step="0.01"
            placeholder="e.g. 4.25"
            value={rate}
            onChange={(e) => {
              setRate(e.target.value);
              if (e.target.value === '') {
                setAmountTouched(true);
              } else if (!amountTouched) {
                setAmount(units ? String(toNumber(toNumber(units, 0) * e.target.value, 0)) : amount);
                setAmountTouched(false);
              }
            }}
          />
        </div>

        {unitSummary && <p className="field-hint -mt-1">{unitSummary}</p>}

        <div>
          <AmountField
            id="bill-amount"
            label="Total bill amount"
            required
            min="1"
            step="1"
            value={String(effectiveAmount || '')}
            error={error}
            onChange={(e) => {
              setAmount(e.target.value);
              setAmountTouched(true);
              setError('');
            }}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="bill-note">
            Note <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="bill-note"
            type="text"
            className="field-input"
            placeholder="e.g. 80 units x Rs 4.25 = Rs 340 + Rs 360 fixed charges"
            value={note}
            maxLength={160}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && <p className="field-error">{error}</p>}
      </form>
    </Modal>
  );
}