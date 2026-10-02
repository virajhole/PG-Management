import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { ConfirmDialog } from './Modal.jsx';
import { roomService } from '../services/index.js';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatRupees, formatDate } from '../utils/format.js';
import { dayjs, todayISO } from '../utils/dateLogic.js';

/**
 * Give notice: a tenant stays counted as occupying their bed, but the expected
 * leaving date is recorded so vacancy can be planned.
 */
export function NoticeDialog({ open, customer, onClose, onDone }) {
  const toast = useToast();
  const defaultDate = customer?.expectedLeavingDate || dayjs().add(30, 'day').format('YYYY-MM-DD');
  const [leaving, setLeaving] = useState(defaultDate);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setLeaving(customer?.expectedLeavingDate || dayjs().add(30, 'day').format('YYYY-MM-DD'));
      setNote('');
    }
  }, [open, customer]);

  const submit = async () => {
    setSaving(true);
    try {
      await roomService.giveNotice(customer.id, leaving, note);
      await onDone();
      toast.success(`${customer.name} marked as leaving on ${leaving}.`);
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Give notice"
      description="The tenant keeps their bed until they actually move out, so the room stays occupied."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={saving} data-autofocus>
            {saving ? 'Saving...' : 'Mark as leaving'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="field-label">Expected leaving date</span>
          <input
            type="date"
            className="field-input"
            value={leaving}
            min={todayISO()}
            onChange={(e) => setLeaving(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="field-label">Note</span>
          <textarea
            className="field-input"
            rows={2}
            value={note}
            placeholder="Reason, agreement, anything to follow up on"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

/** Move to a different bed, optionally in a different room. */
export function MoveDialog({ open, customer, onClose, onDone }) {
  const { settings } = useData();
  const toast = useToast();
  const [rooms, setRooms] = useState([]);
  const [roomId, setRoomId] = useState('');
  const [bedNo, setBedNo] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRoomId(customer?.roomId ?? '');
    setBedNo(customer?.bedNo ?? '');
    roomService.listRooms().then(setRooms).catch(() => setRooms([]));
  }, [open, customer]);

  // A tenant with no room yet can go anywhere with vacancy; one with a room
  // should see that room first, but any room with space is allowed.
  const candidates = useMemo(
    () => rooms.filter((room) => room.isActive && room.vacant > 0),
    [rooms],
  );
  const room = candidates.find((r) => r.id === roomId) ?? null;
  const freeBeds = room ? roomService.freeBeds(room) : [];

  useEffect(() => {
    if (room && !freeBeds.includes(String(bedNo))) setBedNo(freeBeds[0] ? String(freeBeds[0]) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const submit = async () => {
    setSaving(true);
    try {
      await roomService.moveCustomer(customer.id, roomId, bedNo);
      await onDone();
      toast.success(`${customer.name} moved to room ${room.roomNo}, bed ${bedNo}.`);
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Move ${customer?.name ?? ''}`}
      description="Pick a free bed. Availability is re-checked when the move is saved."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={saving || !roomId || !bedNo}
            data-autofocus
          >
            {saving ? 'Moving...' : 'Confirm move'}
          </button>
        </div>
      }
    >
      {candidates.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-subtle">
          No room currently has a free bed.
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <span className="field-label">Room</span>
            <div className="scroll-slim -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {candidates.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setRoomId(option.id)}
                  aria-pressed={option.id === roomId}
                  className={`min-w-32 shrink-0 rounded-xl border p-3 text-left transition ${
                    option.id === roomId
                      ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20 dark:bg-brand-950'
                      : 'border-line-strong bg-raised hover:border-brand-300'
                  }`}
                >
                  <p className="text-sm font-semibold text-ink">Room {option.roomNo}</p>
                  <p className="mt-0.5 text-[11px] text-ink-subtle">
                    Floor {option.floor} &middot; {option.vacant} free
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-brand-700 dark:text-brand-300">
                    {formatRupees(roomService.effectiveRent(option, settings))}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {room && freeBeds.length > 0 && (
            <div>
              <span className="field-label">Bed</span>
              <div className="flex flex-wrap gap-2">
                {freeBeds.map((bed) => (
                  <button
                    key={bed}
                    type="button"
                    onClick={() => setBedNo(String(bed))}
                    aria-pressed={String(bed) === bedNo}
                    className={`flex size-11 items-center justify-center rounded-xl border text-sm font-semibold transition ${
                      String(bed) === bedNo
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
      )}
    </Modal>
  );
}

/**
 * Checkout. Works out the deposit refund, lets the owner adjust it, records the
 * refund as a transaction, and frees the bed.
 */
export function VacateDialog({ open, customer, pendingRent, pendingBill, onClose, onDone }) {
  const toast = useToast();
  const [damage, setDamage] = useState('');
  const [refund, setRefund] = useState('');
  const [mode, setMode] = useState('cash');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const suggested = roomService.calculateRefund({
    depositAmount: customer?.depositAmount ?? 0,
    pendingRent,
    pendingBill,
    damageCharges: Number(damage) || 0,
  });

  // Seed the field with the calculated figure until the owner edits it.
  useEffect(() => {
    if (open) {
      setDamage('');
      setRefund('');
      setTouched(false);
      setNote('');
    }
  }, [open]);

  useEffect(() => {
    if (!touched) setRefund(String(suggested));
  }, [suggested, touched]);

  const shortfall = Math.max(pendingRent + pendingBill + (Number(damage) || 0) - (customer?.depositAmount ?? 0), 0);

  const submit = async () => {
    setSaving(true);
    try {
      const amount = Math.max(Number(refund) || 0, 0);
      await roomService.vacateCustomer({
        customerId: customer.id,
        pendingRent,
        pendingBill,
        damageCharges: Number(damage) || 0,
        refundAmount: amount,
        refundMode: mode,
        note,
      });
      await onDone();
      toast.success(
        amount > 0
          ? `${customer.name} vacated. ${formatRupees(amount)} refund recorded.`
          : `${customer.name} vacated.`,
      );
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Check out ${customer?.name ?? ''}`}
      description="Records the final settlement and frees the bed. Rent cycles are left as they are so any outstanding rent stays visible."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={submit} disabled={saving} data-autofocus>
            {saving ? 'Finishing...' : 'Complete checkout'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <dl className="space-y-1.5 rounded-xl bg-sunken p-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-muted">Deposit paid</dt>
            <dd className="font-medium text-ink">{formatRupees(customer?.depositAmount)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">Outstanding rent</dt>
            <dd className="font-medium text-ink">{formatRupees(pendingRent)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">Outstanding light bill</dt>
            <dd className="font-medium text-ink">{formatRupees(pendingBill)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-1.5">
            <dt className="text-ink-muted">Refund (deposit &minus; dues)</dt>
            <dd className="font-semibold text-emerald-700 dark:text-emerald-400">
              {formatRupees(suggested)}
            </dd>
          </div>
        </dl>

        {shortfall > 0 && (
          <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Dues exceed the deposit by {formatRupees(shortfall)}. No refund is due, and the
            balance stays outstanding on this tenant's record.
          </p>
        )}

        <label className="block">
          <span className="field-label">Damage / other charges</span>
          <input
            type="number"
            className="field-input"
            min="0"
            step="1"
            value={damage}
            placeholder="0"
            onChange={(e) => {
              setDamage(e.target.value);
              setTouched(false);
            }}
          />
        </label>

        <label className="block">
          <span className="field-label">Deposit refund</span>
          <input
            type="number"
            className="field-input"
            min="0"
            step="1"
            value={refund}
            onChange={(e) => {
              setTouched(true);
              setRefund(e.target.value);
            }}
          />
          <span className="field-hint">Adjustable. Recorded as a refund transaction.</span>
        </label>

        <label className="block">
          <span className="field-label">Refund mode</span>
          <select className="field-input" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="bank">Bank transfer</option>
          </select>
        </label>

        <label className="block">
          <span className="field-label">Note</span>
          <textarea
            className="field-input"
            rows={2}
            value={note}
            placeholder="Inspection result, keys returned, anything worth recording"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

/** Where this tenant has lived - one row per bed occupancy period. */
export function RoomHistoryDialog({ open, customer, rooms, onClose }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !customer) return;
    let cancelled = false;
    setLoading(true);
    roomService
      .listRoomHistory(customer.id)
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, customer]);

  const roomLabel = (roomId) => {
    const room = rooms.find((r) => r.id === roomId);
    return room ? `Room ${room.roomNo}` : roomId ? 'Room (removed)' : 'Unassigned';
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Room history"
      description="Every bed this tenant has occupied."
      footer={
        <div className="flex justify-end">
          <button type="button" className="btn-secondary" onClick={onClose} data-autofocus>
            Close
          </button>
        </div>
      }
    >
      {loading ? (
        <p className="py-6 text-center text-sm text-ink-subtle">Loading history...</p>
      ) : entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-subtle">No moves recorded yet.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-line bg-raised p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-ink">
                  {roomLabel(entry.roomId)}
                  {entry.bedNo ? ` · Bed ${entry.bedNo}` : ''}
                </p>
                <p className="text-xs text-ink-subtle">
                  {formatDate(entry.fromDate)} &rarr; {entry.toDate ? formatDate(entry.toDate) : 'present'}
                </p>
              </div>
              {entry.note && <p className="mt-1 text-xs text-ink-muted">{entry.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export { ConfirmDialog };
