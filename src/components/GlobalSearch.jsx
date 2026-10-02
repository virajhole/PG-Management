import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext.jsx';
import { listComplaints } from '../services/operationsService.js';
import { BottomSheet, Avatar, Badge, Input } from './ui.jsx';
import { SearchIcon, FileTextIcon, AlertIcon } from './icons.jsx';

/**
 * Global search across tenants, rooms, transactions and complaints.
 * Ctrl/Cmd+K on desktop, magnifier icon in the mobile header.
 *
 * Two rules keep this sheet from ever taking the app down:
 *
 *  1. Every collection is read through `?? []`. This component used to
 *     destructure `rooms` from the data context, which never published it, so
 *     the very first keystroke threw `Cannot read properties of undefined
 *     (reading 'filter')`. Data that is missing now means "no results", never a
 *     crash.
 *  2. The complaints fetch is optional. Operations data lives in migration
 *     003, so on an older backend the read legitimately fails; that is shown
 *     as an inline note and the other three groups keep working.
 *
 * Search itself is a flat filter over data already in memory, so keystrokes are
 * debounced through `useDeferredValue` rather than a timer - React keeps the
 * input responsive and the list catches up.
 *
 * The complaints read is a static import on purpose: three other modules load
 * this service eagerly, so a dynamic import would not split it into its own
 * chunk anyway, it would only delay the first search result.
 */
export default function GlobalSearch({ open, onClose }) {
  const navigate = useNavigate();
  const { customers, rooms, transactions } = useData();
  const [query, setQuery] = useState('');
  const [complaints, setComplaints] = useState([]);
  const [complaintsError, setComplaintsError] = useState(false);
  const [loadedComplaints, setLoadedComplaints] = useState(false);

  // Trailing-edge debounce: `query` updates instantly (so the field never
  // lags behind the caret) while `deferredQuery` only settles once typing pauses.
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (!open || loadedComplaints) return undefined;
    let cancelled = false;
    listComplaints()
      .then((list) => {
        if (cancelled) return;
        setComplaints(Array.isArray(list) ? list : []);
        setLoadedComplaints(true);
      })
      .catch(() => {
        // Migration 003 may not be applied yet; complaints are optional.
        if (cancelled) return;
        setComplaintsError(true);
        setLoadedComplaints(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, loadedComplaints]);

  // Clear the previous search when the sheet is reopened, so it never opens
  // showing the last query typed somewhere else.
  useEffect(() => {
    if (open) return;
    setQuery('');
    setComplaintsError(false);
  }, [open]);

  const groups = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return [];

    const matches = (row, fields) => fields.filter(Boolean).some((v) => String(v).toLowerCase().includes(q));

    const tenantHits = (customers ?? [])
      .filter((c) => c.status !== 'vacated')
      .filter((c) => matches(c, [c.name, c.mobile, c.roomNo, c.code]))
      .slice(0, 5)
      .map((c) => ({
        key: `c-${c.id}`,
        label: c.name,
        sub: `${c.roomNo ? `Room ${c.roomNo} · ` : ''}${c.mobile ?? ''}`,
        kind: 'Tenant',
        go: () => navigate(`/customer/${c.id}`),
        avatar: c.name,
      }));

    const roomHits = (rooms ?? [])
      .filter((r) => matches(r, [r.roomNo, r.notes]))
      .slice(0, 4)
      .map((r) => ({
        key: `r-${r.id}`,
        label: `Room ${r.roomNo}`,
        sub: `${r.sharingType}-sharing · ${r.occupied}/${r.capacity} occupied`,
        kind: 'Room',
        go: () => navigate('/rooms'),
      }));

    const txHits = (transactions ?? [])
      .filter((t) => matches(t, [t.customerName, t.note, t.mode]))
      .slice(0, 5)
      .map((t) => ({
        key: `t-${t.id}`,
        label: `₹${Number(t.amount).toLocaleString('en-IN')} · ${t.customerName}`,
        sub: `${t.type === 'LIGHT_BILL' ? 'Light bill' : t.type === 'REFUND' ? 'Refund' : t.type === 'LATE_FEE' ? 'Late fee' : 'Rent'} · ${t.date}`,
        kind: 'Payment',
        go: () => navigate('/transactions'),
      }));

    const complaintHits = (complaints ?? [])
      .filter((c) => matches(c, [c.title, c.category, c.roomNo, c.description]))
      .slice(0, 4)
      .map((c) => ({
        key: `k-${c.id}`,
        label: c.title || `${c.category} complaint`,
        sub: `${c.roomNo ? `Room ${c.roomNo} · ` : ''}${c.status}`,
        kind: 'Complaint',
        go: () => navigate('/operations?tab=complaints'),
      }));

    return [tenantHits, roomHits, txHits, complaintHits].filter((g) => g.length > 0);
  }, [deferredQuery, customers, rooms, transactions, complaints, navigate]);

  const total = groups.reduce((sum, g) => sum + g.length, 0);
  const trimmed = query.trim();

  function go(hit) {
    onClose();
    hit.go();
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Search">
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Tenants, rooms, payments, complaints…"
        aria-label="Search everything"
      />
      <div className="mt-3 space-y-4">
        {trimmed && total === 0 && (
          <p className="py-8 text-center text-sm text-ink-subtle">No matches for “{trimmed}”.</p>
        )}
        {!trimmed && (
          <p className="flex items-center justify-center gap-2 py-8 text-center text-sm text-ink-subtle">
            <FileTextIcon className="size-4" /> Start typing to search across the whole PG.
          </p>
        )}
        {complaintsError && trimmed && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
            <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
            Complaints could not be searched. Tenants, rooms and payments above are complete.
          </p>
        )}
        {groups.map((group) => (
          <div key={group[0]?.kind}>
            <p className="mb-1.5 text-[10px] font-bold tracking-widest text-ink-subtle uppercase">{group[0].kind}s</p>
            <ul className="space-y-1">
              {group.map((hit) => (
                <li key={hit.key}>
                  <button
                    type="button"
                    onClick={() => go(hit)}
                    className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-sunken"
                  >
                    {hit.avatar ? (
                      <Avatar name={hit.avatar} size="sm" />
                    ) : (
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-subtle">
                        <SearchIcon className="size-4" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{hit.label}</span>
                      <span className="block truncate text-xs text-ink-subtle">{hit.sub}</span>
                    </span>
                    <Badge tone="neutral">{hit.kind}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}