import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Field, Input, Button, EmptyState, BottomSheet } from '../components/ui.jsx';
import { Gauge as GaugeIcon, Zap as BoltIcon } from 'lucide-react';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { roomService } from '../services/index.js';
import { listMeterReadings, saveMeterReading, applyMeterReading } from '../services/meterService.js';
import { planMeterSplit, unitsConsumed, billForUnits } from '../utils/meterSplit.js';
import { monthKeyOf } from '../utils/meterSplitDate.js';
import { formatRupees } from '../utils/format.js';

function ReadingSheet({ open, onClose, rooms, reading, onSave, onApply }) {
  const [form, setForm] = useState({ roomId: '', month: monthKeyOf(), previousReading: '', currentReading: '', ratePerUnit: '' });
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (open && reading) {
      setForm({
        roomId: reading.roomId ?? '',
        month: reading.month,
        previousReading: String(reading.previousReading ?? ''),
        currentReading: String(reading.currentReading ?? ''),
        ratePerUnit: String(reading.ratePerUnit ?? ''),
      });
    }
  }, [open, reading]);

  const room = rooms.find((r) => r.id === form.roomId) ?? null;
  const units = unitsConsumed(form.previousReading, form.currentReading);
  const total = billForUnits(units, form.ratePerUnit);
  // Depend on `room` rather than on `room?.occupants ?? []`: that fallback
  // builds a fresh array on every render, so the memo never held anything and
  // the split was recomputed (and the room object compared) for no reason.
  const plan = useMemo(
    () =>
      planMeterSplit({
        reading: {
          previousReading: form.previousReading,
          currentReading: form.currentReading,
          ratePerUnit: form.ratePerUnit,
        },
        occupants: room?.occupants ?? [],
      }),
    [form, room],
  );
  const occupants = room?.occupants ?? [];

  function submit(e) {
    e.preventDefault();
    if (!form.roomId) return;
    onSave({
      ...form,
      roomNo: room?.roomNo ?? '',
      totalUnits: units,
      totalAmount: total,
    });
  }

  async function apply() {
    if (!room) return;
    setApplying(true);
    try {
      await onApply({ reading: { ...form, roomNo: room.roomNo }, occupants });
    } finally {
      setApplying(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={reading ? `Meter reading · Room ${reading.roomNo || ''}` : 'New meter reading'}>
      <form onSubmit={submit} className="space-y-3">
        <Field id="mtr-room" label="Room" required>
          <select
            id="mtr-room"
            className="field-input"
            value={form.roomId}
            onChange={(e) => setForm({ ...form, roomId: e.target.value })}
            required
          >
            <option value="" disabled>
              Pick a room
            </option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                Room {r.roomNo} · {r.occupied} occupant{r.occupied === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="mtr-month" label="Month">
            <Input id="mtr-month" type="month" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} required />
          </Field>
          <Field id="mtr-rate" label="Rate per unit (₹)" required>
            <Input id="mtr-rate" type="number" min="0" step="0.01" value={form.ratePerUnit} onChange={(e) => setForm({ ...form, ratePerUnit: e.target.value })} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="mtr-prev" label="Previous reading" required>
            <Input id="mtr-prev" type="number" min="0" step="0.01" value={form.previousReading} onChange={(e) => setForm({ ...form, previousReading: e.target.value })} required />
          </Field>
          <Field id="mtr-cur" label="Current reading" required>
            <Input id="mtr-cur" type="number" min="0" step="0.01" value={form.currentReading} onChange={(e) => setForm({ ...form, currentReading: e.target.value })} required />
          </Field>
        </div>

        {units > 0 && (
          <div className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-3 text-xs leading-relaxed text-brand-800 dark:border-brand-800 dark:bg-brand-950/50 dark:text-brand-200">
            <p className="font-semibold">
              {units} units × ₹{form.ratePerUnit} = {formatRupees(total)}
            </p>
            {plan.entries.length > 0 ? (
              <ul className="mt-1.5 space-y-0.5">
                {plan.entries.map((e) => (
                  <li key={e.customerId}>
                    {e.customerName}: {formatRupees(e.share)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 font-medium text-red-600 dark:text-red-400">This room has no active occupants.</p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button type="submit" variant="secondary" className="flex-1">
            Save reading
          </Button>
          <Button type="button" variant="gradient" className="flex-1" onClick={apply} disabled={applying || !room || units <= 0 || plan.entries.length === 0}>
            {applying ? 'Applying…' : 'Save & bill occupants'}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}

export default function Meters() {
  const { status } = useData();
  const toast = useToast();
  const [rooms, setRooms] = useState([]);
  const [readings, setReadings] = useState([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    roomService
      .listRooms()
      .then(setRooms)
      .catch(() => setRooms([]));
    listMeterReadings()
      .then(setReadings)
      .catch(() => setReadings([]));
  }, []);

  const latestByRoom = useMemo(() => {
    const map = new Map();
    for (const r of readings) {
      if (!map.has(r.roomId)) map.set(r.roomId, r);
    }
    return map;
  }, [readings]);

  async function save(form) {
    try {
      const saved = await saveMeterReading(form);
      setReadings((list) => [saved, ...list.filter((r) => !(r.roomId === saved.roomId && r.month === saved.month))]);
      setSheetOpen(false);
      setEditing(null);
      toast.success(`Reading saved for room ${saved.roomNo}.`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function apply({ reading, occupants }) {
    try {
      const saved = await saveMeterReading(reading);
      const { plan } = await applyMeterReading({ reading: saved, occupants });
      setReadings((list) => [saved, ...list.filter((r) => !(r.roomId === saved.roomId && r.month === saved.month))]);
      setSheetOpen(false);
      setEditing(null);
      toast.success(`Billed ${plan.entries.length} occupant(s) — light bills created for ${saved.month}.`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">Meter readings</h1>
          <p className="mt-0.5 text-sm text-ink-subtle">Per-room electricity readings, split equally among occupants as light bills.</p>
        </div>
        <Button
          variant="gradient"
          onClick={() => {
            setEditing(null);
            setSheetOpen(true);
          }}
        >
          <GaugeIcon className="size-4" /> New reading
        </Button>
      </header>

      {status === 'loading' ? (
        <p className="py-10 text-center text-sm text-ink-subtle">Loading…</p>
      ) : rooms.length === 0 ? (
        <EmptyState icon={GaugeIcon} title="No rooms yet" message="Create rooms first — meter readings are per room." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rooms.map((room) => {
            const latest = latestByRoom.get(room.id);
            return (
              <li key={room.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-ink">Room {room.roomNo}</p>
                      <p className="text-xs text-ink-subtle">
                        {room.occupied} occupant{room.occupied === 1 ? '' : 's'} · {room.sharingType}-sharing
                      </p>
                    </div>
                    <Badge tone={latest ? 'brand' : 'neutral'}>{latest ? latest.month : 'No readings'}</Badge>
                  </div>
                  {latest && (
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-ink-subtle">Prev</p>
                        <p className="font-semibold text-ink">{latest.previousReading}</p>
                      </div>
                      <div>
                        <p className="text-ink-subtle">Current</p>
                        <p className="font-semibold text-ink">{latest.currentReading}</p>
                      </div>
                      <div>
                        <p className="text-ink-subtle">Bill</p>
                        <p className="font-semibold text-ink">{formatRupees(latest.totalAmount ?? 0)}</p>
                      </div>
                    </div>
                  )}
                  <div className="mt-3 border-t border-line pt-3">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditing(latest ?? { roomId: room.id, roomNo: room.roomNo, month: monthKeyOf(), previousReading: 0, currentReading: 0, ratePerUnit: 0 });
                        setSheetOpen(true);
                      }}
                    >
                      <BoltIcon className="size-4" /> {latest ? 'New reading' : 'Add reading'}
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <ReadingSheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          setEditing(null);
        }}
        rooms={rooms}
        reading={editing}
        onSave={save}
        onApply={apply}
      />
    </div>
  );
}
