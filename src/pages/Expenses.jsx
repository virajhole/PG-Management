import { useEffect, useMemo, useState } from 'react';
import Modal from '../components/Modal.jsx';
import { LoadingBlock, EmptyState } from '../components/States.jsx';
import { ReceiptIcon, TrashIcon, BoltIcon } from '../components/icons.jsx';
import { roomService } from '../services/index.js';
import { useToast } from '../context/ToastContext.jsx';
import { formatRupees } from '../utils/format.js';
import { todayISO } from '../utils/dateLogic.js';

const CATEGORY_LABEL = {
  electricity: 'Electricity',
  water: 'Water',
  groceries: 'Groceries',
  salary: 'Staff salary',
  repairs: 'Repairs',
  internet: 'Internet',
  other: 'Other',
};

const emptyForm = { category: 'electricity', amount: '', date: todayISO(), note: '' };

function StatCard({ label, value, tone = 'text-ink' }) {
  return (
    <div className="card p-3.5">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

/** Collection vs costs as a stacked bar, no charting library. */
function FinanceBars({ rows }) {
  const peak = Math.max(1, ...rows.flatMap((r) => [r.collected, r.expenses]));
  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold text-ink">Collection vs costs</h2>
      <p className="mt-0.5 text-xs text-ink-subtle">Last {rows.length} months</p>
      <div className="mt-4 flex items-end gap-2">
        {rows.map((row) => (
          <div key={row.month} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="flex h-28 w-full items-end justify-center gap-1">
              <div
                className="w-1/2 rounded-t bg-brand-500"
                style={{ height: `${(row.collected / peak) * 100}%` }}
                title={`Collected ${formatRupees(row.collected)}`}
              />
              <div
                className="w-1/2 rounded-t bg-amber-500"
                style={{ height: `${(row.expenses / peak) * 100}%` }}
                title={`Costs ${formatRupees(row.expenses)}`}
              />
            </div>
            <span className="text-[11px] text-ink-subtle">{row.label}</span>
            <span
              className={`text-[11px] font-semibold ${
                row.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
              }`}
            >
              {formatRupees(row.profit)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-brand-500" />
          Collected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-amber-500" />
          Costs
        </span>
      </div>
    </div>
  );
}

export default function Expenses() {
  const toast = useToast();
  const [expenses, setExpenses] = useState([]);
  const [finance, setFinance] = useState([]);
  const [status, setStatus] = useState('loading');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');

  const load = async () => {
    try {
      const [list, months] = await Promise.all([
        roomService.listExpenses(),
        roomService.getMonthlyFinance(6),
      ]);
      setExpenses(list);
      setFinance(months);
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

  const thisMonth = finance[finance.length - 1] ?? { collected: 0, expenses: 0, profit: 0 };
  const allTime = useMemo(() => expenses.reduce((sum, e) => sum + e.amount, 0), [expenses]);

  const byCategory = useMemo(() => {
    const totals = new Map();
    for (const expense of expenses) {
      totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amount);
    }
    return [...totals.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);
  }, [expenses]);

  const visible = useMemo(
    () =>
      (categoryFilter === 'all'
        ? expenses
        : expenses.filter((e) => e.category === categoryFilter)
      ).slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [expenses, categoryFilter],
  );

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await roomService.createExpense({
        category: form.category,
        amount: Number(form.amount) || 0,
        date: form.date,
        note: form.note,
      });
      setForm(emptyForm);
      setFormOpen(false);
      await load();
      toast.success('Expense recorded.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (expense) => {
    try {
      await roomService.deleteExpense(expense.id);
      await load();
      toast.success('Expense removed.');
    } catch (error) {
      toast.error(error.message);
    }
  };

  if (status === 'loading') return <LoadingBlock label="Loading expenses..." />;

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink sm:text-2xl">Expenses</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            Running costs, so collected rent can be turned into actual profit.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setFormOpen(true)}>
          <ReceiptIcon className="size-4" />
          Record expense
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Collected this month" value={formatRupees(thisMonth.collected)} />
        <StatCard label="Costs this month" value={formatRupees(thisMonth.expenses)} />
        <StatCard
          label="Profit this month"
          value={formatRupees(thisMonth.profit)}
          tone={thisMonth.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}
        />
        <StatCard label="Costs all time" value={formatRupees(allTime)} />
      </div>

      {finance.length > 0 && <FinanceBars rows={finance} />}

      {byCategory.length > 0 && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-ink">By category</h2>
          <ul className="mt-3 space-y-2">
            {byCategory.map(({ category, total }) => {
              const share = allTime ? Math.round((total / allTime) * 100) : 0;
              return (
                <li key={category}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink">{CATEGORY_LABEL[category] ?? category}</span>
                    <span className="font-medium text-ink-muted">
                      {formatRupees(total)} &middot; {share}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${share}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="scroll-slim -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <button
          type="button"
          onClick={() => setCategoryFilter('all')}
          aria-pressed={categoryFilter === 'all'}
          className={`chip ${
            categoryFilter === 'all'
              ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200'
              : 'border-line-strong bg-surface text-ink-muted'
          }`}
        >
          All
        </button>
        {Object.entries(CATEGORY_LABEL).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setCategoryFilter(key)}
            aria-pressed={categoryFilter === key}
            className={`chip ${
              categoryFilter === key
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200'
                : 'border-line-strong bg-surface text-ink-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={BoltIcon}
          title="No expenses yet"
          message="Record electricity, water, salaries and repairs to see your real profit."
          action={
            <button type="button" className="btn-primary mt-1" onClick={() => setFormOpen(true)}>
              Record expense
            </button>
          }
        />
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {visible.map((expense) => (
            <li key={expense.id} className="flex items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {CATEGORY_LABEL[expense.category] ?? expense.category}
                </p>
                <p className="truncate text-xs text-ink-subtle">
                  {expense.date}
                  {expense.note ? ` \u00b7 ${expense.note}` : ''}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-ink">
                {formatRupees(expense.amount)}
              </span>
              <button
                type="button"
                className="btn-ghost !min-h-9 !px-2 text-red-600 dark:text-red-400"
                onClick={() => remove(expense)}
                aria-label={`Delete expense ${expense.note || expense.category}`}
              >
                <TrashIcon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Record expense"
        description="Running costs are subtracted from collected rent to show profit."
      >
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="field-label">Category</span>
            <select
              className="field-input"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            >
              {Object.entries(CATEGORY_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="field-label">Amount</span>
              <input
                type="number"
                className="field-input"
                min="0"
                step="1"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                required
                autoFocus
              />
            </label>
            <label className="block">
              <span className="field-label">Date</span>
              <input
                type="date"
                className="field-input"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                required
              />
            </label>
          </div>

          <label className="block">
            <span className="field-label">Note</span>
            <textarea
              className="field-input"
              rows={2}
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
          </label>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving...' : 'Save expense'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
