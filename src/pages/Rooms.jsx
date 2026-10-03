import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal, { ConfirmDialog } from '../components/Modal.jsx';
import { EmptyState, LoadingBlock } from '../components/States.jsx';
import {
  BuildingIcon,
  UserPlusIcon,
  ChevronDownIcon,
  EditIcon,
  TrashIcon,
  CheckIcon,
} from '../components/icons.jsx';
import { roomService } from '../services/index.js';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatRupees, formatNumber } from '../utils/format.js';
import { SHARING_TYPES } from '../services/index.js';

const OCCUPANCY_TONE = {
  full: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  partial: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  empty: 'bg-sunken text-ink-muted dark:bg-slate-800 dark:text-slate-300',
};

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'vacant', label: 'Has vacancy' },
  { value: 'empty', label: 'Fully vacant' },
  { value: 'full', label: 'Full' },
];

const emptyForm = {
  floor: 0,
  roomNo: '',
  sharingType: 2,
  monthlyRent: '',
  notes: '',
};

function StatCard({ label, value, tone = '' }) {
  return (
    <div className={`card p-3.5 ${tone}`}>
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 text-xl font-bold text-ink">{value}</p>
    </div>
  );
}

/**
 * Bed occupancy as a row of pips. Each bed is one dot: filled means someone
 * holds it, including a tenant on notice who has not left yet.
 */
function BedIndicator({ room }) {
  const occupiedBeds = room.occupants.map((o) => String(o.bedNo));

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="list" aria-label={`Beds in room ${room.roomNo}`}>
      {Array.from({ length: room.capacity }, (_, i) => i + 1).map((bed) => {
        const taken = occupiedBeds.includes(String(bed));
        return (
          <span
            key={bed}
            role="listitem"
            title={`Bed ${bed}: ${taken ? 'occupied' : 'free'}`}
            aria-label={`Bed ${bed} ${taken ? 'occupied' : 'free'}`}
            className={`flex size-6 items-center justify-center rounded-md text-[11px] font-semibold ${
              taken
                ? 'bg-brand-600 text-white'
                : 'border border-dashed border-line-strong text-ink-subtle'
            }`}
          >
            {taken ? <CheckIcon className="size-3.5" /> : bed}
          </span>
        );
      })}
    </div>
  );
}

function RoomCard({ room, onEdit, onDelete, rent }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-ink">Room {room.roomNo}</h3>
            <span className={`chip text-xs ${OCCUPANCY_TONE[room.occupancyStatus]}`}>
              {room.occupantCount === 0
                ? 'Vacant'
                : room.occupied === room.capacity
                  ? 'Full'
                  : 'Partial'}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-ink-subtle">
            Floor {room.floor} &middot; {room.sharingType}-sharing &middot; {formatRupees(rent)}/month
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" className="btn-ghost !min-h-9 !px-2" onClick={() => onEdit(room)} aria-label={`Edit room ${room.roomNo}`}>
            <EditIcon className="size-4" />
          </button>
          <button
            type="button"
            className="btn-ghost !min-h-9 !px-2 text-red-600 dark:text-red-400"
            onClick={() => onDelete(room)}
            aria-label={`Delete room ${room.roomNo}`}
          >
            <TrashIcon className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <BedIndicator room={room} />
        <p className="shrink-0 text-xs font-medium text-ink-muted">
          {room.occupied}/{room.capacity} &middot; {room.vacant} free
        </p>
      </div>

      {room.occupants.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3">
          {room.occupants.map((occupant) => (
            <li key={occupant.id} className="flex items-center gap-2 text-xs">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-sunken text-[10px] font-bold text-ink-muted">
                {occupant.bedNo || '-'}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">{occupant.name}</span>
              {occupant.status === 'notice' && (
                <span className="chip border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  Leaving
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RoomForm({ initial, onSubmit, onCancel, busy }) {
  const [form, setForm] = useState(() => ({ ...emptyForm, ...initial }));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(form);
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Room number</span>
          <input
            className="field-input"
            value={form.roomNo}
            onChange={(e) => set({ roomNo: e.target.value })}
            required
            autoFocus
          />
        </label>
        <label className="block">
          <span className="field-label">Floor</span>
          <input
            type="number"
            className="field-input"
            value={form.floor}
            onChange={(e) => set({ floor: e.target.value })}
          />
        </label>
      </div>

      <label className="block">
        <span className="field-label">Sharing type (also the bed count)</span>
        <select
          className="field-input"
          value={form.sharingType}
          onChange={(e) => set({ sharingType: Number(e.target.value) })}
        >
          {SHARING_TYPES.map((n) => (
            <option key={n} value={n}>
              {n}-sharing &middot; {n} {n === 1 ? 'bed' : 'beds'}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="field-label">Rent override</span>
        <input
          type="number"
          className="field-input"
          placeholder="Leave blank to use the Settings price"
          value={form.monthlyRent}
          onChange={(e) => set({ monthlyRent: e.target.value })}
        />
        <span className="field-hint">
          Blank means this room follows the standard price for its sharing type.
        </span>
      </label>

      <div className="space-y-2">

      </div>

      <label className="block">
        <span className="field-label">Notes</span>
        <textarea
          className="field-input"
          rows={2}
          value={form.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </label>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving...' : 'Save room'}
        </button>
      </div>
    </form>
  );
}

export default function Rooms() {
  const { settings } = useData();
  const toast = useToast();
  const navigate = useNavigate();

  const [rooms, setRooms] = useState([]);
  const [status, setStatus] = useState('loading');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setRooms(await roomService.listRooms());
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      toast.error(error.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => roomService.occupancyTotals(rooms), [rooms]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return roomService
      .groupByFloor(rooms)
      .map((group) => ({
        ...group,
        rooms: group.rooms
          // `occupantCount` keeps the card template from doing O(occupants)
          // work per render; computed once alongside the other view fields.
          .map((room) => ({ ...room, occupantCount: room.occupants.length }))
          .filter((room) => {
          if (needle && !String(room.roomNo).toLowerCase().includes(needle)) return false;
          switch (filter) {
            case 'vacant':
              return room.vacant > 0;
            case 'empty':
              return room.occupied === 0;
            case 'full':
              return room.vacant === 0;
            default:
              return true;
          }
          }),
      }))
      .filter((group) => group.rooms.length > 0);
  }, [rooms, filter, query]);

  const toggleFloor = (floor) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(floor)) next.delete(floor);
      else next.add(floor);
      return next;
    });

  const submitRoom = async (form) => {
    setBusy(true);
    try {
      const payload = {
        floor: Number(form.floor) || 0,
        roomNo: form.roomNo.trim(),
        sharingType: Number(form.sharingType),
        // An empty rent override must stay null so the room follows Settings.
        monthlyRent: form.monthlyRent === '' ? null : Number(form.monthlyRent),
        notes: form.notes,
      };
      if (editing) await roomService.updateRoom(editing.id, payload);
      else await roomService.createRoom(payload);
      await load();
      setFormOpen(false);
      setEditing(null);
      toast.success(editing ? 'Room updated.' : 'Room added.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await roomService.deleteRoom(deleting.id);
      await load();
      toast.success(`Room ${deleting.roomNo} deleted.`);
      setDeleting(null);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  // Hand the chosen room over to the admission form. This has to navigate, not
  // just write the query string - otherwise we would only be setting params on
  // /rooms and the tenant would never see the form.
  const admitHere = (room) => {
    navigate(`/admission?room=${encodeURIComponent(room.id)}&sharing=${room.sharingType}`);
  };

  if (status === 'loading') return <LoadingBlock label="Loading rooms..." />;

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink sm:text-2xl">Rooms</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            Beds, occupancy and vacancy across every floor.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <BuildingIcon className="size-4" />
          Add room
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Rooms" value={formatNumber(totals.totalRooms)} />
        <StatCard label="Total beds" value={formatNumber(totals.totalBeds)} />
        <StatCard label="Occupied" value={formatNumber(totals.occupiedBeds)} />
        <StatCard label="Vacant beds" value={formatNumber(totals.vacantBeds)} />
        <StatCard label="Occupancy" value={`${totals.occupancyPercent}%`} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="scroll-slim -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              aria-pressed={filter === option.value}
              className={`chip ${
                filter === option.value
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200'
                  : 'border-line-strong bg-surface text-ink-muted'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="field-input sm:max-w-48"
          placeholder="Find room"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search rooms by number"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={BuildingIcon}
          title={rooms.length === 0 ? 'No rooms yet' : 'No rooms match'}
          message={
            rooms.length === 0
              ? 'Add your first room to start tracking beds and vacancy.'
              : 'Try a different filter or search term.'
          }
          action={
            rooms.length === 0 ? (
              <button type="button" className="btn-primary mt-1" onClick={() => setFormOpen(true)}>
                Add room
              </button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-4">
          {visible.map((group) => {
            const isCollapsed = collapsed.has(group.floor);
            return (
              <section key={group.floor}>
                <button
                  type="button"
                  onClick={() => toggleFloor(group.floor)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center gap-2 rounded-xl px-1 py-2 text-left"
                >
                  <ChevronDownIcon
                    className={`size-4 shrink-0 text-ink-subtle transition ${isCollapsed ? '-rotate-90' : ''}`}
                  />
                  <h2 className="text-sm font-semibold text-ink">
                    Floor {group.floor}
                  </h2>
                  <span className="text-xs text-ink-subtle">
                    {group.totals.occupiedBeds}/{group.totals.totalBeds} beds &middot; {group.rooms.length} rooms
                  </span>
                </button>

                {!isCollapsed && (
                  <div className="mt-1 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {group.rooms.map((room) => (
                      <RoomCard
                        key={room.id}
                        room={room}
                        rent={roomService.effectiveRent(room, settings)}
                        onEdit={(target) => {
                          setEditing({
                            ...target,
                            monthlyRent: target.monthlyRent === null ? '' : String(target.monthlyRent),
                          });
                          setFormOpen(true);
                        }}
                        onDelete={setDeleting}
                      />
                    ))}
                    {group.rooms.some((room) => room.vacant > 0) && (
                      <button
                        type="button"
                        onClick={() => admitHere(group.rooms.find((room) => room.vacant > 0))}
                        className="flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-strong text-ink-subtle transition hover:border-brand-400 hover:text-brand-600"
                      >
                        <UserPlusIcon className="size-5" />
                        <span className="text-sm font-medium">Admit into a free bed</span>
                      </button>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit room ${editing.roomNo}` : 'Add room'}
        description={
          editing
            ? 'Occupancy is worked out from the tenants in this room.'
            : 'Sharing type doubles as the number of beds.'
        }
      >
        <RoomForm
          initial={editing}
          onSubmit={submitRoom}
          onCancel={() => setFormOpen(false)}
          busy={busy}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        busy={busy}
        title={`Delete room ${deleting?.roomNo ?? ''}?`}
        message="A room can only be deleted once every tenant in it has moved out or vacated."
        confirmLabel="Delete room"
      />
    </div>
  );
}
