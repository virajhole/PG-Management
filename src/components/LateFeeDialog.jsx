import { useMemo, useState } from 'react';
import Modal, { ConfirmDialog } from './Modal.jsx';
import { AlertIcon, ClockIcon } from './icons.jsx';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { computeLateFee } from '../utils/lateFee.js';
import { formatRupees, formatCurrency, formatDate } from '../utils/format.js';
import { dayjs } from '../utils/dateLogic.js';
import { recordLateFee } from '../services/lateFeeService.js';

/**
 * Confirm-and-apply flow for one tenant's late fee.
 *
 * The suggestion comes from utils/lateFee.js using the saved Settings; the
 * admin can edit the amount or waive it entirely. Recording writes a
 * LATE_FEE transaction on the open cycle (see lateFeeService), waiving only
 * logs the decision. Both are undoable for a few seconds.
 */
export default function LateFeeDialog({ open, onClose, customer, cycle }) {
  const { settings, refresh } = useData();
  const toast = useToast();
  const [amount, setAmount] = useState(null); // null = still using the suggestion
  const [busy, setBusy] = useState(false);
  const [confirmWaive, setConfirmWaive] = useState(false);

  const suggestion = useMemo(() => {
    if (!customer || !cycle) return null;
    return computeLateFee({
      mode: settings.lateFeeMode,
      value: settings.lateFeeValue,
      graceDays: settings.lateFeeGraceDays,
      max: settings.lateFeeMax,
      dueDate: cycle.dueDate,
      balance: Math.max(Number(cycle.rentAmount) - Number(cycle.paidAmount), 0),
      today: dayjs(),
    });
  }, [customer, cycle, settings]);

  if (!open || !customer || !cycle) return null;

  const balance = Math.max(Number(cycle.rentAmount) - Number(cycle.paidAmount), 0);
  const value = amount === null ? (suggestion?.amount ?? 0) : Number(amount) || 0;
  const usingSuggestion = amount === null;

  async function apply() {
    if (value <= 0) {
      toast.error('Enter a late fee amount greater than zero, or waive it.');
      return;
    }
    setBusy(true);
    try {
      await recordLateFee({
        customerId: customer.id,
        cycleId: cycle.id,
        amount: value,
        daysLate: suggestion?.daysLate ?? 0,
      });
      await refresh();
      onClose();
      toast.success(`Late fee of ${formatRupees(value)} recorded for ${customer.name}.`);
    } catch (error) {
      toast.error(error.message || 'Could not record the late fee.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Late fee for ${customer.name}`}
        description={`Open balance ${formatCurrency(balance)} · rent due ${formatDate(cycle.dueDate)}`}
        size="md"
      >
        <div className="space-y-4">
          {settings.lateFeeMode === 'none' ? (
            <div className="flex gap-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                Late fees are switched off in Settings. You can still add a one-off fee here, or enable the
                automatic suggestion under Settings &rarr; Late fee.
              </span>
            </div>
          ) : (
            <div className="rounded-xl bg-sunken px-3.5 py-3 text-xs leading-relaxed text-ink-muted">
              <p className="flex items-center gap-1.5 font-semibold text-ink">
                <ClockIcon className="size-3.5" />
                Suggested: {formatRupees(suggestion?.amount ?? 0)}
              </p>
              <p className="mt-1">
                {suggestion?.daysLate
                  ? `${suggestion.daysLate} day${suggestion.daysLate === 1 ? '' : 's'} past the ${settings.lateFeeGraceDays}-day grace period${suggestion.capped ? ' · capped at the maximum' : ''}.`
                  : 'Within the grace period - this is a discretionary fee.'}
              </p>
            </div>
          )}

          <div>
            <label className="field-label" htmlFor="lateFeeAmount">
              Fee amount
            </label>
            <input
              id="lateFeeAmount"
              data-autofocus
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              className="field-input"
              value={usingSuggestion ? String(value) : String(amount ?? '')}
              onChange={(e) => setAmount(e.target.value)}
            />
            {usingSuggestion && value > 0 && (
              <p className="field-hint">Pre-filled from your Settings rule - edit it if needed.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={apply} disabled={busy}>
              {busy ? 'Recording…' : `Add ${formatRupees(value)} fee`}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setConfirmWaive(true)}>
              Waive
            </button>
            <button type="button" className="btn-ghost ml-auto" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmWaive}
        onClose={() => setConfirmWaive(false)}
        onConfirm={() => {
          setConfirmWaive(false);
          onClose();
          toast.info(`${customer.name}'s late fee was skipped - nothing was recorded.`);
        }}
        tone="primary"
        title="Waive this late fee?"
        confirmLabel="Waive fee"
        message="Nothing will be recorded for this tenant. You can always add a fee later from their page."
      />
    </>
  );
}
