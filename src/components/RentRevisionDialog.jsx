import { useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { applyRevision, applyBulkRevision } from '../services/rentRevisionService.js';
import { formatCurrency } from '../utils/format.js';
import { todayISO } from '../utils/dateLogic.js';

/**
 * Rent revision flow (migration 004 rent_revisions history).
 *
 * Two modes from one dialog:
 *  - single: one tenant moves to an exact new rent
 *  - bulk:   every selected tenant moves by a percent bump or to one flat rent
 * Each applied revision writes a rent_revisions history row AND updates the
 * tenant, so the audit trail can never drift from the ledger.
 */
export default function RentRevisionDialog({ open, onClose, customers = [], preselect = null }) {
  const { updateCustomer, refresh } = useData();
  const toast = useToast();

  const [mode, setMode] = useState(preselect ? 'single' : 'bulk');
  const [selected, setSelected] = useState(() => new Set(preselect ? [preselect.id] : []));
  const [query, setQuery] = useState('');
  const [newRent, setNewRent] = useState(preselect ? String(preselect.rentAmount ?? '') : '');
  const [percent, setPercent] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers
      .filter((c) => c.status === 'active' || c.status === 'notice' || !c.status)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.roomNo || '').includes(q));
  }, [customers, query]);

  const preview = useMemo(() => {
    if (mode === 'single') {
      const target = preselect ?? customers.find((c) => selected.has(c.id));
      if (!target) return null;
      const value = Number(newRent) || 0;
      return { count: 1, from: target.rentAmount, to: value, delta: value - Number(target.rentAmount || 0) };
    }
    const targets = customers.filter((c) => selected.has(c.id));
    const pct = Number(percent) || 0;
    const flat = newRent === '' ? null : Number(newRent) || 0;
    let totalFrom = 0;
    let totalTo = 0;
    for (const c of targets) {
      const to = flat != null ? flat : Math.round(Number(c.rentAmount || 0) * (1 + pct / 100));
      totalFrom += Number(c.rentAmount || 0);
      totalTo += to;
    }
    return { count: targets.length, from: totalFrom, to: totalTo, delta: totalTo - totalFrom };
  }, [mode, preselect, customers, selected, newRent, percent]);

  if (!open) return null;

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply() {
    const targets = mode === 'single'
      ? [preselect ?? customers.find((c) => selected.has(c.id))].filter(Boolean)
      : customers.filter((c) => selected.has(c.id));

    if (targets.length === 0) {
      toast.error('Select at least one tenant.');
      return;
    }
    if (mode === 'single' && !(Number(newRent) > 0)) {
      toast.error('Enter the new rent amount.');
      return;
    }
    if (mode === 'bulk' && newRent === '' && !(Number(percent) !== 0)) {
      toast.error('Enter a percent change or a flat new rent.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'single') {
        await applyRevision({
          customerId: targets[0].id,
          customerName: targets[0].name,
          oldRent: targets[0].rentAmount,
          newRent: Number(newRent),
          effectiveDate,
          note,
          updateCustomer,
        });
        toast.success(`${targets[0].name}'s rent revised to ${formatCurrency(Number(newRent))}.`);
      } else {
        const results = await applyBulkRevision({
          customers: targets,
          newRent: newRent === '' ? null : Number(newRent),
          percentBump: Number(percent) || 0,
          effectiveDate,
          note,
          updateCustomer,
        });
        toast.success(`Revised rent for ${results.length} tenant${results.length === 1 ? '' : 's'}.`);
      }
      await refresh();
      onClose();
    } catch (error) {
      toast.error(error.message || 'Could not revise the rent.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'single' ? `Revise rent · ${preselect?.name ?? ''}` : 'Bulk rent revision'}
      description="Every change is recorded in the rent history with its effective date."
      size="lg"
    >
      <div className="space-y-4">
        {/* mode switch - hidden when opened for one tenant */}
        {!preselect && (
          <div role="radiogroup" aria-label="Revision mode" className="grid grid-cols-2 gap-2">
            {[
              { key: 'bulk', label: 'Bulk (select tenants)' },
              { key: 'single', label: 'Single tenant' },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                role="radio"
                aria-checked={mode === opt.key}
                onClick={() => setMode(opt.key)}
                className={`min-h-10 rounded-xl border px-3 text-sm font-semibold transition ${
                  mode === opt.key
                    ? 'border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/20 dark:bg-brand-950 dark:text-brand-200'
                    : 'border-line-strong bg-raised text-ink-muted hover:bg-sunken'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {mode === 'single' && !preselect && (
          <div>
            <label className="field-label" htmlFor="revTenant">Tenant</label>
            <select
              id="revTenant"
              data-autofocus
              className="field-input"
              value={selected.size ? [...selected][0] : ''}
              onChange={(e) => setSelected(new Set([e.target.value]))}
            >
              <option value="">Choose a tenant…</option>
              {visible.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.roomNo ? `· Room ${c.roomNo}` : ''} · {formatCurrency(c.rentAmount)}
                </option>
              ))}
            </select>
          </div>
        )}

        {mode === 'bulk' && (
          <div className="space-y-2">
            <label className="field-label" htmlFor="revSearch">Tenants ({selected.size} selected)</label>
            <input
              id="revSearch"
              type="search"
              className="field-input"
              placeholder="Search by name or room…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="scroll-slim max-h-44 space-y-1 overflow-y-auto rounded-xl border border-line p-1.5">
              {visible.map((c) => (
                <li key={c.id}>
                  <label className="flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-sm text-ink hover:bg-sunken">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand-600"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {c.name}
                      {c.roomNo ? <span className="text-ink-subtle"> · Room {c.roomNo}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-ink-subtle">{formatCurrency(c.rentAmount)}</span>
                  </label>
                </li>
              ))}
              {visible.length === 0 && <li className="px-2 py-3 text-center text-xs text-ink-subtle">No tenants match.</li>}
            </ul>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {mode === 'bulk' && (
            <div>
              <label className="field-label" htmlFor="revPercent">Percent change</label>
              <input
                id="revPercent"
                type="number"
                step="0.5"
                className="field-input"
                placeholder="e.g. 10 for +10%"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
              />
            </div>
          )}
          <div>
            <label className="field-label" htmlFor="revRent">{mode === 'bulk' ? 'Or a flat new rent' : 'New rent'}</label>
            <input
              id="revRent"
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              className="field-input"
              value={newRent}
              onChange={(e) => setNewRent(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="revDate">Effective date</label>
            <input
              id="revDate"
              type="date"
              className="field-input"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="revNote">Note (optional)</label>
            <input
              id="revNote"
              type="text"
              className="field-input"
              placeholder="e.g. annual increase"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        {preview && preview.count > 0 && (
          <p className="rounded-xl bg-sunken px-3.5 py-2.5 text-xs text-ink-muted">
            {preview.count} tenant{preview.count === 1 ? '' : 's'} · {formatCurrency(preview.from)} &rarr;{' '}
            <span className="font-semibold text-ink">{formatCurrency(preview.to)}</span>
            {preview.delta !== 0 && (
              <span className={preview.delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                {' '}({preview.delta > 0 ? '+' : ''}{formatCurrency(preview.delta)}/month)
              </span>
            )}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={apply} disabled={busy}>
            {busy ? 'Applying…' : 'Apply revision'}
          </button>
          <button type="button" className="btn-ghost ml-auto" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
