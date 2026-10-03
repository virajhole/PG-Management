import { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { TABLES, listRows, deleteRow } from '../services/supabase.js';
import { backupService, SHARING_TYPES } from '../services/index.js';
import { formatRupees } from '../utils/format.js';
import { SunIcon, MoonIcon, TrashIcon } from '../components/icons.jsx';

function Card({ title, description, children }) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {description && <p className="mt-0.5 mb-4 text-xs text-ink-subtle">{description}</p>}
      <div className={description ? '' : 'mt-4'}>{children}</div>
    </section>
  );
}

/** Light / Dark toggle: saved in localStorage, applied before first paint. */
function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const options = [
    { value: 'light', label: 'Light', icon: SunIcon },
    { value: 'dark', label: 'Dark', icon: MoonIcon },
    { value: 'system', label: 'System', icon: null },
  ];
  return (
    <Card title="Appearance" description="The dashboard header has a quick light/dark toggle too.">
      <div className="flex gap-2">
        {options.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={theme === value}
            className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${
              theme === value
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-950 dark:text-brand-200'
                : 'border-line bg-raised text-ink-muted hover:border-line-strong'
            }`}
          >
            {Icon && <Icon className="size-4" />}
            {label}
          </button>
        ))}
      </div>
    </Card>
  );
}

function PGCard() {
  const { settings, updateSettings } = useData();
  const toast = useToast();
  const [pgName, setPgName] = useState(settings.pgName);
  const [upiId, setUpiId] = useState(settings.upiId);
  const [prices, setPrices] = useState(() => ({ ...settings.sharingPrices }));
  const [deposit, setDeposit] = useState(settings.defaultDeposit);
  const [saving, setSaving] = useState(false);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await updateSettings({
        ...settings,
        pgName: pgName.trim(),
        upiId: upiId.trim(),
        sharingPrices: prices,
        defaultDeposit: Number(deposit) || 0,
      });
      toast.success('Settings saved.');
    } catch (error) {
      toast.error(error.message || 'Could not save the settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="PG details" description="Shown on the dashboard and used to pre-fill the admission form.">
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">PG name</span>
            <input className="field-input" value={pgName} onChange={(e) => setPgName(e.target.value)} placeholder="e.g. Sunrise PG" />
          </label>
          <label className="block">
            <span className="field-label">UPI ID</span>
            <input className="field-input" value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="e.g. mypg@upi" />
          </label>
        </div>

        <div>
          <span className="field-label">Sharing room pricing (per month)</span>
          <div className="mt-1.5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {SHARING_TYPES.map((n) => (
              <label key={n} className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink-muted">{n} sharing</span>
                <input
                  type="number"
                  className="field-input"
                  min="0"
                  step="1"
                  aria-label={`${n} sharing price`}
                  value={prices[n] ?? ''}
                  onChange={(e) => setPrices((p) => ({ ...p, [n]: e.target.value === '' ? '' : Number(e.target.value) }))}
                />
              </label>
            ))}
          </div>
        </div>

        <label className="block max-w-56">
          <span className="field-label">Default security deposit</span>
          <input type="number" className="field-input" min="0" step="1" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          <span className="field-hint">{formatRupees(Number(deposit) || 0)}</span>
        </label>

        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </Card>
  );
}

function TermsCard() {
  const { settings, updateSettings } = useData();
  const toast = useToast();
  const [terms, setTerms] = useState(settings.terms);
  const [template, setTemplate] = useState(settings.whatsappTemplate);
  const [saving, setSaving] = useState(false);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await updateSettings({ ...settings, terms, whatsappTemplate: template });
      toast.success('Terms and reminder template saved.');
    } catch (error) {
      toast.error(error.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Terms & WhatsApp template"
      description="The admission form shows the terms. The reminder message supports {name}, {amount}, {due} and {pg}."
    >
      <form onSubmit={save} className="space-y-4">
        <label className="block">
          <span className="field-label">Terms and conditions</span>
          <textarea className="field-input min-h-48" value={terms} onChange={(e) => setTerms(e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">WhatsApp reminder template</span>
          <textarea className="field-input min-h-24" value={template} onChange={(e) => setTemplate(e.target.value)} />
        </label>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save text'}
          </button>
        </div>
      </form>
    </Card>
  );
}

function BackupCard() {
  const { openCycleByCustomer } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const data = await backupService.downloadBackup(openCycleByCustomer);
      toast.success(`Backup downloaded: ${data.customers.length} tenants, ${data.transactions.length} payments.`);
    } catch (error) {
      toast.error(error.message || 'Could not build the backup.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Export backup" description="A JSON file with everything, plus a tenants CSV for spreadsheets.">
      <button type="button" className="btn-primary" onClick={download} disabled={busy}>
        {busy ? 'Preparing…' : 'Download backup'}
      </button>
    </Card>
  );
}

function EraseCard() {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const { refresh } = useData();

  async function erase() {
    setBusy(true);
    try {
      // Delete every row, table by table, through the same data layer the app uses.
      for (const table of [TABLES.transactions, TABLES.lightBills, TABLES.cycles, TABLES.customers, TABLES.rooms]) {
        for (const row of await listRows(table)) {
          await deleteRow(table, row.id);
        }
      }
      await refresh();
      toast.success('All tenants, rooms and payments were erased.');
    } catch (error) {
      toast.error(error.message || 'Could not erase the data.');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Card title="Erase all data" description="Deletes every tenant, room, payment and bill. Your login stays.">
      {confirming ? (
        <div className="flex gap-2">
          <button type="button" className="btn-danger flex-1" onClick={erase} disabled={busy}>
            {busy ? 'Erasing…' : 'Yes, erase everything'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="btn-danger" onClick={() => setConfirming(true)}>
          Erase all data
        </button>
      )}
    </Card>
  );
}

export default function Settings() {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-4">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">Settings</h1>
        <p className="mt-0.5 text-sm text-ink-subtle">Signed in as {user?.email}</p>
      </header>

      <AppearanceCard />
      <PGCard />
      <TermsCard />
      <BackupCard />
      <EraseCard />
    </div>
  );
}
