import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Badge, Field, Input, Select, Button, EmptyState, BottomSheet } from '../components/ui.jsx';
import { ErrorState } from '../components/States.jsx';
import { Boxes as BoxesIcon, Plus as PlusIcon, Trash as TrashIcon } from 'lucide-react';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { TABLES, listRows, insertRow, updateRow, deleteRow } from '../services/supabase.js';
import { createId } from '../utils/dateLogic.js';

/**
 * Assets inventory per room: cot, mattress, cupboard, fan, AC… with condition
 * and notes. Shown in room details and used for damage charges at checkout.
 */

const CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'good', label: 'Good' },
  { value: 'worn', label: 'Worn' },
  { value: 'broken', label: 'Broken' },
];

const COMMON_ITEMS = ['cot', 'mattress', 'cupboard', 'fan', 'AC', 'table', 'chair'];

const CONDITION_TONES = { new: 'accent', good: 'brand', worn: 'warning', broken: 'danger' };

function AssetSheet({ open, onClose, rooms, onSave }) {
  const [form, setForm] = useState({ roomId: '', item: 'cot', quantity: 1, condition: 'good', note: '' });
  // `rooms` is a list by contract everywhere above this component; the default
  // keeps a bad caller from turning "no rooms loaded" into a render crash.
  const roomList = Array.isArray(rooms) ? rooms : [];
  const room = roomList.find((r) => r.id === form.roomId) ?? null;

  function submit(e) {
    e.preventDefault();
    if (!room) return;
    onSave({ ...form, roomNo: room.roomNo });
    setForm({ roomId: '', item: 'cot', quantity: 1, condition: 'good', note: '' });
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Add asset">
      <form onSubmit={submit} className="space-y-3">
        <Field id="ast-room" label="Room" required>
          <Select id="ast-room" value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })} required>
            <option value="" disabled>
              {roomList.length ? 'Pick a room' : 'No rooms yet - add one first'}
            </option>
            {roomList.map((r) => (
              <option key={r.id} value={r.id}>
                Room {r.roomNo}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="ast-item" label="Item">
            <Input id="ast-item" list="common-items" value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} />
          </Field>
          <Field id="ast-qty" label="Quantity">
            <Input id="ast-qty" type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
          </Field>
        </div>
        <datalist id="common-items">
          {COMMON_ITEMS.map((i) => (
            <option key={i} value={i} />
          ))}
        </datalist>
        <Field id="ast-cond" label="Condition">
          <Select id="ast-cond" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ast-note" label="Note">
          <Input id="ast-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. hinge loose" />
        </Field>
        <Button type="submit" variant="gradient" className="w-full">
          Add asset
        </Button>
      </form>
    </BottomSheet>
  );
}

export default function Assets() {
  const toast = useToast();
  // Rooms come from the shared data context now. They used to be read from
  // here *and* fetched again on mount, and the context never published them,
  // so `ctxRooms` was undefined and the first render of AssetSheet threw
  // `Cannot read properties of undefined (reading 'find')` - the Assets page
  // could not be opened at all.
  const { rooms } = useData();
  const roomList = Array.isArray(rooms) ? rooms : [];
  const [assets, setAssets] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const rows = await listRows(TABLES.assets);
      setAssets(Array.isArray(rows) ? rows : []);
      setError(null);
      setStatus('ready');
    } catch (err) {
      // Most often: migration 005 has not been run, so `assets` does not
      // exist. Say exactly that instead of rendering an empty page that looks
      // like the owner has no assets.
      setAssets([]);
      setError(err);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const roomLabel = (id) =>
    roomList.find((r) => r.id === id)?.roomNo ?? assets.find((a) => a.roomId === id)?.roomNo ?? '—';

  async function save(form) {
    try {
      const row = await insertRow(TABLES.assets, {
        id: createId('ast'),
        roomId: form.roomId,
        roomNo: form.roomNo,
        item: form.item,
        quantity: Number(form.quantity) || 1,
        condition: form.condition,
        note: form.note,
      });
      setAssets((list) => [row, ...list]);
      setSheetOpen(false);
      toast.success('Asset added.');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function remove(id) {
    try {
      await deleteRow(TABLES.assets, id);
      setAssets((list) => list.filter((a) => a.id !== id));
      toast.success('Asset removed.');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function setCondition(id, condition) {
    try {
      const row = await updateRow(TABLES.assets, id, { condition });
      setAssets((list) => list.map((a) => (a.id === id ? row : a)));
    } catch (err) {
      toast.error(err.message);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map();
    for (const a of assets) {
      const list = map.get(a.roomId) ?? [];
      list.push(a);
      map.set(a.roomId, list);
    }
    return [...map.entries()].sort((x, y) => String(roomLabel(x[0])).localeCompare(String(roomLabel(y[0]))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, roomList]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">Assets</h1>
          <p className="mt-0.5 text-sm text-ink-subtle">Room inventory with condition — the checkout damage check reads this.</p>
        </div>
        {roomList.length === 0 && (
          <p className="w-full rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Add a room first — every asset belongs to one.
          </p>
        )}
        <Button variant="gradient" onClick={() => setSheetOpen(true)} disabled={roomList.length === 0}>
          <PlusIcon className="size-4" /> Add asset
        </Button>
      </header>

      {status === 'loading' ? (
        <p className="py-10 text-center text-sm text-ink-subtle">Loading…</p>
      ) : status === 'error' ? (
        <ErrorState
          title="Could not load the assets inventory"
          message={
            error?.message?.includes('does not exist') || error?.code === '42P01'
              ? 'The assets table is missing. Run supabase/schema.sql in the Supabase SQL editor (or supabase/repair.sql if you want to keep your existing data).'
              : error?.message || 'The assets table could not be read.'
          }
          onRetry={load}
        />
      ) : assets.length === 0 ? (
        <EmptyState icon={BoxesIcon} title="No assets recorded" message="Track cots, mattresses, fans and ACs per room to settle damage charges fairly at checkout." />
      ) : (
        <div className="space-y-4">
          {grouped.map(([roomId, list]) => (
            <Card key={roomId} className="p-4">
              <h2 className="section-title">Room {roomLabel(roomId)}</h2>
              <ul className="mt-2 divide-y divide-line">
                {list.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {a.item} × {a.quantity}
                      </span>
                      {a.note && <span className="block truncate text-xs text-ink-subtle">{a.note}</span>}
                    </span>
                    <select
                      value={a.condition}
                      onChange={(e) => setCondition(a.id, e.target.value)}
                      aria-label={`Condition of ${a.item}`}
                      className="min-h-9 rounded-lg border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink"
                    >
                      {CONDITIONS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <Badge tone={CONDITION_TONES[a.condition] ?? 'neutral'}>{a.condition}</Badge>
                    <button
                      type="button"
                      onClick={() => remove(a.id)}
                      className="rounded-lg p-2 text-ink-subtle hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                      aria-label={`Remove ${a.item}`}
                    >
                      <TrashIcon className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <AssetSheet open={sheetOpen} onClose={() => setSheetOpen(false)} rooms={roomList} onSave={save} />
    </div>
  );
}
