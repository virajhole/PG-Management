import { useEffect, useRef, useState, useCallback } from 'react';
import { TextField, Textarea } from '../components/FormFields.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import {
  SettingsIcon,
  RupeeIcon,
  LockIcon,
  IdCardIcon,
  DownloadIcon,
  SunIcon,
  MoonIcon,  MonitorIcon,
  WalletIcon,
  UtensilsCrossedIcon,
  ShieldCheckIcon,
  ClockIcon,
  UserPlusIcon,
} from '../components/icons.jsx';
import { useData } from '../context/DataContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { listAdmins, addAdmin, removeAdmin } from '../services/supabase.js';
import { seedService, settingsService, backupService, migrationService } from '../services/index.js';
import { formatCurrency, formatDate } from '../utils/format.js';
import { dayjs } from '../utils/dateLogic.js';
import { SHARING_TYPES, DEFAULT_TERMS } from '../services/index.js';
import { Spinner } from '../components/States.jsx';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';

/**
 * Identity of the server-side values the editable fields mirror. Comparing this
 * instead of object identity keeps an async re-render from overwriting edits.
 */
function settingsSignature(settings) {
  return JSON.stringify([
    settings.sharingPrices,
    settings.defaultDeposit,
    settings.terms,
    settings.upiId,
    settings.lateFeeMode,
    settings.lateFeeValue,
    settings.lateFeeGraceDays,
    settings.lateFeeMax,
    settings.messEnabled,
    settings.messCharges,
  ]);
}

function Card({ title, description, icon: Icon, children }) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        {Icon && (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
            <Icon className="size-4.5" />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon },
];

function AppearanceCard() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <Card
      title="Appearance"
      description="Applies immediately and is remembered on this device. System follows your phone or computer's light or dark setting."
      icon={resolvedTheme === 'dark' ? MoonIcon : SunIcon}
    >
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
        {THEME_OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = theme === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(option.value)}
              className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border px-2 py-3 text-sm font-medium transition ${
                selected
                  ? 'border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/20 dark:bg-brand-950 dark:text-brand-200'
                  : 'border-line-strong bg-surface text-ink-muted hover:bg-sunken'
              }`}
            >
              <Icon className="size-5" />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
      <p className="field-hint">
        Currently showing the {resolvedTheme} theme.
        {theme === 'system' ? ' Following your device setting.' : ''}
      </p>
    </Card>
  );
}

/**
 * Settings -> Team: the allowlist.
 *
 * `admins` is the only gate between a signed-in account and the ledger (see
 * is_admin() in schema.sql). Anyone whose address is not here can sign in
 * successfully and will still be shown "Access denied, contact the owner".
 * Staff accounts can read and record, admins can also manage the team, so the
 * owner is never locked out of their own PG by a mistake here.
 */
function TeamCard({ currentEmail }) {
  const toast = useToast();
  const [members, setMembers] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('admin');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const list = await listAdmins();
      setMembers(Array.isArray(list) ? list : []);
      setError(null);
      setStatus('ready');
    } catch (err) {
      setError(err);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clean = email.trim().toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean);
  const already = members.some((m) => m.email === clean);

  async function add(event) {
    event.preventDefault();
    if (!valid || already || busy) return;
    setBusy(true);
    try {
      await addAdmin({ email: clean, role });
      setEmail('');
      await load();
      toast.success(`${clean} can now sign in.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing || busy) return;
    setBusy(true);
    try {
      await removeAdmin(removing.email);
      setRemoving(null);
      await load();
      toast.success(`${removing.email} removed.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Team"
      description="Only these email addresses can open the ledger. Everyone else can sign in with Google but is shown an access-denied screen and signed straight back out."
      icon={ShieldCheckIcon}
    >
      {status === 'loading' ? (
        <p className="flex items-center gap-2 py-4 text-sm text-ink-subtle">
          <Spinner className="size-4" /> Loading the team list…
        </p>
      ) : status === 'error' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
          <p className="text-sm font-medium text-amber-900">The admins table is not available.</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            {error?.message || 'Run supabase/schema.sql in the Supabase SQL editor to create it.'}
          </p>
          <button type="button" className="btn-secondary mt-3" onClick={load}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {members.map((member) => (
              <li key={member.email} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{member.email}</p>
                  <p className="text-xs text-ink-subtle">
                    {member.role === 'staff' ? 'Staff · record payments' : 'Admin · full access'}
                    {member.email === String(currentEmail ?? '').toLowerCase() && ' · you'}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost px-2 text-xs text-red-600 hover:bg-red-50"
                  onClick={() => setRemoving(member)}
                  disabled={member.email === String(currentEmail ?? '').toLowerCase()}
                  title={
                    member.email === String(currentEmail ?? '').toLowerCase()
                      ? 'You cannot remove yourself'
                      : 'Remove from the team'
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <label htmlFor="team-email" className="mb-1 block text-xs font-semibold text-ink">
                Add by email
              </label>
              <input
                id="team-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@gmail.com"
                className={`field-input ${email && !valid ? 'field-input-error' : ''}`}
              />
            </div>
            <select
              aria-label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="field-input w-32"
            >
              <option value="admin">Admin</option>
              <option value="staff">Staff</option>
            </select>
            <button type="submit" className="btn-primary" disabled={!valid || already || busy}>
              <UserPlusIcon className="size-4" />
              Add
            </button>
          </form>
          {email && !valid && <p className="field-error mt-1">Enter a valid email address.</p>}
          {already && <p className="field-hint mt-1">That address is already on the team.</p>}
          <p className="field-hint mt-2">
            Admins can manage the team. Staff can use the app but cannot change who has access.
          </p>
        </>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        busy={busy}
        title="Remove from the team?"
        confirmLabel="Remove"
        tone="danger"
        message={`${removing?.email ?? ''} will be signed out the next time they load the app and will see an access-denied screen.`}
      />
    </Card>
  );
}

export default function Settings() {
  const { settings, updateSettings, customers, refresh } = useData();
  const { user, logout } = useAuth();
  const toast = useToast();

  const [prices, setPrices] = useState(() => ({ ...settings.sharingPrices }));
  const [deposit, setDeposit] = useState(settings.defaultDeposit);
  const [terms, setTerms] = useState(settings.terms);
  const [pgName, setPgName] = useState(settings.pgName);
  const [ownerName, setOwnerName] = useState(settings.ownerName);
  const [ownerMobile, setOwnerMobile] = useState(settings.ownerMobile);
  const [upiId, setUpiId] = useState(settings.upiId);
  const [lateFeeMode, setLateFeeMode] = useState(settings.lateFeeMode);
  const [lateFeeValue, setLateFeeValue] = useState(settings.lateFeeValue ?? 0);
  const [lateFeeGraceDays, setLateFeeGraceDays] = useState(settings.lateFeeGraceDays ?? 0);
  const [lateFeeMax, setLateFeeMax] = useState(settings.lateFeeMax ?? '');
  const [messEnabled, setMessEnabled] = useState(settings.messEnabled);
  const [messCharges, setMessCharges] = useState(settings.messCharges ?? 0);
  const [savingSection, setSavingSection] = useState(null);

  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmSeed, setConfirmSeed] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmImportLocal, setConfirmImportLocal] = useState(false);
  const fileRef = useRef(null);
  const [lastBackupAt, setLastBackupAt] = useState(() => localStorage.getItem('pgm.lastBackupAt') || '');
  const { canInstall, isIos, installed, promptInstall } = useInstallPrompt();

  // Settings arrive asynchronously from Supabase, so a re-render can land while
  // the user is mid-edit. Re-sync the editable fields only when the values they
  // came from actually change, rather than on every `settings` identity change -
  // otherwise the load clobbers keystrokes (a half-typed price turning into
  // 1500016000). An explicit reset/save rewrites the same values, and the
  // identity check alone would miss it, so track the source signature instead.
  const signature = settingsSignature(settings);
  const lastSyncedRef = useRef(signature);

  useEffect(() => {
    if (lastSyncedRef.current === signature) return;
    lastSyncedRef.current = signature;
    setPrices({ ...settings.sharingPrices });
    setDeposit(settings.defaultDeposit);
    setTerms(settings.terms);
    setUpiId(settings.upiId);
    setLateFeeMode(settings.lateFeeMode);
    setLateFeeValue(settings.lateFeeValue ?? 0);
    setLateFeeGraceDays(settings.lateFeeGraceDays ?? 0);
    setLateFeeMax(settings.lateFeeMax ?? '');
    setMessEnabled(settings.messEnabled);
    setMessCharges(settings.messCharges ?? 0);
  }, [signature, settings]);

  const totalMonthly = SHARING_TYPES.reduce((sum, n) => sum + (Number(prices[n]) || 0), 0);

  async function savePricing() {
    const parsed = {};
    for (const n of SHARING_TYPES) {
      const value = Number(prices[n]);
      if (!Number.isFinite(value) || value < 0) {
        toast.error(`Enter a valid amount for ${n} sharing.`);
        return;
      }
      parsed[n] = Math.round(value);
    }
    setSavingSection('pricing');
    try {
      await updateSettings({ ...settings, sharingPrices: parsed });
      toast.success('Sharing prices saved. New admissions will use these rates.');
    } catch (error) {
      toast.error(error.message || 'Could not save the prices.');
    } finally {
      setSavingSection(null);
    }
  }

  async function savePolicy() {
    if (!terms.trim()) {
      toast.error('The Terms & Conditions text cannot be empty.');
      return;
    }
    setSavingSection('policy');
    try {
      await updateSettings({
        ...settings,
        defaultDeposit: Number(deposit) || 0,
        terms,
        pgName: pgName.trim() || settings.pgName,
        ownerName: ownerName.trim() || settings.ownerName,
        ownerMobile: ownerMobile.trim(),
      });
      toast.success('Settings saved.');
    } catch (error) {
      toast.error(error.message || 'Could not save the settings.');
    } finally {
      setSavingSection(null);
    }
  }

  async function savePayments() {
    const vpa = upiId.trim();
    if (vpa && !(vpa.includes('@') && vpa.length <= 60)) {
      toast.error('Enter a valid UPI ID like yourname@bank.');
      return;
    }
    setSavingSection('payments');
    try {
      await updateSettings({ ...settings, upiId: vpa });
      toast.success('UPI ID saved. Receipts and reminders can now show a QR code.');
    } catch (error) {
      toast.error(error.message || 'Could not save the UPI ID.');
    } finally {
      setSavingSection(null);
    }
  }

  async function saveLateFee() {
    const value = Number(lateFeeValue) || 0;
    if (lateFeeMode !== 'none' && value <= 0) {
      toast.error('Enter a late fee amount greater than zero.');
      return;
    }
    setSavingSection('latefee');
    try {
      await updateSettings({
        ...settings,
        lateFeeMode,
        lateFeeValue: lateFeeMode === 'none' ? 0 : value,
        lateFeeGraceDays: Math.max(Number(lateFeeGraceDays) || 0, 0),
        lateFeeMax: lateFeeMax === '' || Number(lateFeeMax) <= 0 ? null : Number(lateFeeMax),
      });
      toast.success('Late fee settings saved.');
    } catch (error) {
      toast.error(error.message || 'Could not save the late fee settings.');
    } finally {
      setSavingSection(null);
    }
  }

  async function saveMess() {
    setSavingSection('mess');
    try {
      await updateSettings({
        ...settings,
        messEnabled,
        messCharges: Math.max(Number(messCharges) || 0, 0),
      });
      toast.success('Mess settings saved.');
    } catch (error) {
      toast.error(error.message || 'Could not save the mess settings.');
    } finally {
      setSavingSection(null);
    }
  }

  async function handleSeed() {
    setSavingSection('seed');
    try {
      await seedService.seedSampleData();
      await refresh();
      toast.success('Sample tenants added. Check the colour coding on the dashboard.');
    } catch (error) {
      toast.error(error.message || 'Could not add sample data.');
    } finally {
      setSavingSection(null);
      setConfirmSeed(false);
    }
  }

  async function handleWipe() {
    setSavingSection('wipe');
    try {
      await backupService.wipeEverything();
      await refresh();
      toast.success('All tenant data erased from your account.');
    } catch (error) {
      toast.error(error.message || 'Could not erase the data.');
    } finally {
      setSavingSection(null);
      setConfirmWipe(false);
    }
  }

  async function handleResetSettings() {
    try {
      const defaults = await settingsService.resetSettings();
      await updateSettings(defaults);
      setConfirmReset(false);
      toast.success('Settings restored to defaults.');
    } catch (error) {
      toast.error(error.message || 'Could not restore the defaults.');
    }
  }

  async function handleExport(kind) {
    setSavingSection(`export-${kind}`);
    try {
      const snapshot = await backupService.buildSnapshot();
      const stamp = snapshot.exportedAt.slice(0, 10);
      if (kind === 'json') {
        backupService.downloadText(`pg-manager-${stamp}.json`, backupService.snapshotToJSON(snapshot));
      } else if (kind === 'tenants') {
        backupService.downloadText(
          `pg-manager-tenants-${stamp}.csv`,
          backupService.customersToCSV(snapshot.customers),
          'text/csv',
        );
      } else {
        backupService.downloadText(
          `pg-manager-payments-${stamp}.csv`,
          backupService.transactionsToCSV(snapshot.transactions),
          'text/csv',
        );
      }
      toast.success('Backup downloaded.');
      const backupStamp = new Date().toISOString();
      localStorage.setItem('pgm.lastBackupAt', backupStamp);
      setLastBackupAt(backupStamp);
    } catch (error) {
      toast.error(error.message || 'Could not build the backup.');
    } finally {
      setSavingSection(null);
    }
  }

  /**
   * Pull data the previous on-device version left in localStorage into this
   * account. Conversion is one-way and keeps a copy of the original under
   * `pgm.backup.v1`, so always confirm first.
   */
  async function handleImportLocal() {
    setSavingSection('import-local');
    try {
      const report = await migrationService.runMigration();
      await refresh();
      setConfirmImportLocal(false);
      if (!report.migrated) {
        toast.info('There is nothing on this device left to import.');
        return;
      }
      toast.success(
        `Imported ${report.customers} tenants, ${report.cycles} cycles and ${report.transactions} payments from this device.`,
      );
    } catch (error) {
      toast.error(error.message || 'Could not import the on-device data.');
    } finally {
      setSavingSection(null);
    }
  }

  async function handleImport(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setSavingSection('import');
    try {
      const snapshot = JSON.parse(await file.text());
    const counts = await backupService.importSnapshot(snapshot);
    await refresh();
    toast.success(
      `Imported ${counts.customers} tenants, ${counts.cycles} cycles, ${counts.transactions} payments${
        counts.images ? ` and ${counts.images} documents` : ''
      }.`,
    );
    } catch (error) {
      toast.error(error.message || 'Could not import that file.');
    } finally {
      setSavingSection(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-4">
      <header>
        <h1 className="text-xl font-bold text-ink sm:text-2xl">Settings</h1>
        <p className="mt-0.5 text-sm text-ink-muted">
          Appearance, pricing, deposit defaults, house rules and app security.
        </p>
      </header>

      {/* --------------------------------------------------- appearance */}
      <AppearanceCard />

      {/* ---------------------------------------------------------- team */}
      <TeamCard currentEmail={user?.email} />

      {/* ------------------------------------------------------- prices */}
      <Card
        title="Sharing room pricing"
        description="Default monthly rent per sharing type. The admission form fills these in automatically, and you can still override the rent for an individual tenant."
        icon={RupeeIcon}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {SHARING_TYPES.map((n) => (
            <AmountField
              key={n}
              id={`price-${n}`}
              label={`${n} sharing`}
              min="0"
              step="1"
              value={prices[n] ?? ''}
              onChange={(e) => setPrices((p) => ({ ...p, [n]: e.target.value }))}
            />
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-subtle">
            If every bed of every room were occupied, monthly income would be{' '}
            <span className="font-semibold text-ink">{formatCurrency(totalMonthly)}</span>.
          </p>
          <button type="button" className="btn-primary" onClick={savePricing} disabled={savingSection === 'pricing'}>
            {savingSection === 'pricing' ? 'Saving…' : 'Save prices'}
          </button>
        </div>
      </Card>

      {/* -------------------------------------------------------- policy */}
      <Card
        title="Deposit & house rules"
        description="The default deposit pre-fills the admission form. The rules text below is shown in a scrollable box that every tenant must accept."
        icon={SettingsIcon}
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="pgName"
              label="PG name"
              value={pgName}
              maxLength={80}
              onChange={(e) => setPgName(e.target.value)}
            />
            <TextField
              id="ownerName"
              label="Owner / manager name"
              value={ownerName}
              maxLength={80}
              onChange={(e) => setOwnerName(e.target.value)}
            />
            <TextField
              id="ownerMobile"
              label="Contact number"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              placeholder="optional"
              value={ownerMobile}
              onChange={(e) => setOwnerMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
            />
            <AmountField
              id="defaultDeposit"
              label="Default deposit"
              min="0"
              step="1"
              hint="Pre-fills the admission form."
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
            />
          </div>

          <Textarea
            id="terms"
            label="Terms & Conditions text"
            rows={14}
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            hint={`${terms.length} characters · shown in the admission form`}
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setTerms(DEFAULT_TERMS);
                toast.info('Default terms restored. Remember to save.');
              }}
            >
              Reset to default text
            </button>
            <button type="button" className="btn-primary ml-auto" onClick={savePolicy} disabled={savingSection === 'policy'}>
              {savingSection === 'policy' ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------ payments */}
      <Card
        title="Payments (UPI)"
        description="Your UPI ID is turned into a scannable QR code on receipts and WhatsApp reminders, pre-filled with the exact remaining amount."
        icon={WalletIcon}
      >
        <div className="space-y-4">
          <TextField
            id="upiId"
            label="UPI ID"
            placeholder="yourname@bank"
            value={upiId}
            maxLength={60}
            hint="Leave empty to hide QR codes."
            onChange={(e) => setUpiId(e.target.value.trim())}
          />
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={savePayments} disabled={savingSection === 'payments'}>
              {savingSection === 'payments' ? 'Saving…' : 'Save UPI ID'}
            </button>
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------ late fee */}
      <Card
        title="Late fee"
        description="Suggested automatically once a tenant is past the grace period. You review and confirm every fee before it is recorded, and any fee can be waived."
        icon={ClockIcon}
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="lateFeeMode">Charge mode</label>
              <select
                id="lateFeeMode"
                className="field-input"
                value={lateFeeMode}
                onChange={(e) => setLateFeeMode(e.target.value)}
              >
                <option value="none">No late fee</option>
                <option value="fixed">Fixed rupees per day</option>
                <option value="percent">Percent of balance per day</option>
              </select>
            </div>
            <AmountField
              id="lateFeeValue"
              label={lateFeeMode === 'percent' ? 'Percent per day' : 'Rupees per day'}
              min="0"
              step={lateFeeMode === 'percent' ? '0.1' : '1'}
              value={lateFeeValue}
              disabled={lateFeeMode === 'none'}
              onChange={(e) => setLateFeeValue(e.target.value)}
            />
            <AmountField
              id="lateFeeGraceDays"
              label="Grace period (days)"
              min="0"
              step="1"
              hint="Days after the due date before the fee starts."
              value={lateFeeGraceDays}
              disabled={lateFeeMode === 'none'}
              onChange={(e) => setLateFeeGraceDays(e.target.value)}
            />
            <AmountField
              id="lateFeeMax"
              label="Maximum fee (optional)"
              min="0"
              step="1"
              hint="Leave empty for no cap."
              value={lateFeeMax}
              disabled={lateFeeMode === 'none'}
              onChange={(e) => setLateFeeMax(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={saveLateFee} disabled={savingSection === 'latefee'}>
              {savingSection === 'latefee' ? 'Saving…' : 'Save late fee settings'}
            </button>
          </div>
        </div>
      </Card>

      {/* --------------------------------------------------------- mess */}
      <Card
        title="Mess / food"
        description="Enable if the PG charges a monthly mess fee. The menu itself is edited on the Mess page."
        icon={UtensilsCrossedIcon}
      >
        <div className="space-y-4">
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-ink">
            <input
              type="checkbox"
              className="size-4.5 accent-brand-600"
              checked={messEnabled}
              onChange={(e) => setMessEnabled(e.target.checked)}
            />
            Offer the mess (show the weekly menu and charges)
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <AmountField
              id="messCharges"
              label="Monthly mess charges"
              min="0"
              step="1"
              value={messCharges}
              disabled={!messEnabled}
              onChange={(e) => setMessCharges(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={saveMess} disabled={savingSection === 'mess'}>
              {savingSection === 'mess' ? 'Saving…' : 'Save mess settings'}
            </button>
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------ account */}
      <Card
        title="Your account"
        description="Tenant records and ID documents are stored in your own Supabase project and are visible only to this account, enforced by Row Level Security on every table."
        icon={LockIcon}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sunken px-3.5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{user?.email || 'Signed in'}</p>
              <p className="text-xs text-ink-subtle">{customers.length} tenant records in this account</p>
            </div>
            <button type="button" className="btn-secondary" onClick={logout}>
              Sign out
            </button>
          </div>
          <p className="text-xs leading-relaxed text-ink-subtle">
            ID documents sit in a private storage bucket and are only ever read through short-lived signed URLs.
          </p>
        </div>
      </Card>

      {/* ------------------------------------------------------- privacy */}
      <Card
        title="Data privacy"
        description="Who can see what, and how tenants' documents are protected."
        icon={ShieldCheckIcon}
      >
        <ul className="space-y-2.5 text-xs leading-relaxed text-ink-muted">
          <li className="flex gap-2.5">
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>
              <span className="font-semibold text-ink">Only this account</span> can open tenant records, payments and ID
              proofs. Every table enforces Row Level Security, so the database itself refuses other readers.
            </span>
          </li>
          <li className="flex gap-2.5">
            <LockIcon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>
              <span className="font-semibold text-ink">ID proofs</span> live in a private storage bucket and are served
              only through short-lived signed URLs that expire quickly - never public links, never indexed.
            </span>
          </li>
          <li className="flex gap-2.5">
            <DownloadIcon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>
              <span className="font-semibold text-ink">Backups</span> you download are plain files on your device - keep
              them somewhere safe, because they contain the same private data.
            </span>
          </li>
          <li className="flex gap-2.5">
            <ClockIcon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>
              <span className="font-semibold text-ink">Deleting a tenant</span> removes their record, document links and
              images; the recycle bin keeps deleted rows for 30 days and then purges them.
            </span>
          </li>
        </ul>
      </Card>

      {/* ---------------------------------------------------- backup / data */}
      <Card
        title="Backup & restore"
        description="Your data is never locked in. Download a full copy, keep it somewhere safe, or import one into a new account."
        icon={IdCardIcon}
      >
        <div className="space-y-3">
          <p className="rounded-xl bg-sunken px-3.5 py-2.5 text-xs text-ink-muted">
            {lastBackupAt ? (
              <>
                Last backup downloaded:{' '}
                <span className="font-semibold text-ink">
                  {formatDate(lastBackupAt)} at {dayjs(lastBackupAt).format('HH:mm')}
                </span>
              </>
            ) : (
              'No backup downloaded from this device yet.'
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => handleExport('json')}
              disabled={savingSection === 'export-json'}
            >
              {savingSection === 'export-json' ? <Spinner className="size-4" /> : null}
              Download backup (JSON)
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => handleExport('tenants')}
              disabled={savingSection === 'export-tenants'}
            >
              Tenants (CSV)
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => handleExport('payments')}
              disabled={savingSection === 'export-payments'}
            >
              Payments (CSV)
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => fileRef.current?.click()}
              disabled={savingSection === 'import'}
            >
              {savingSection === 'import' ? <Spinner className="size-4" /> : null}
              Import a backup
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImport} />
          </div>

          {migrationService.needsMigration() && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 px-3.5 py-3">
              <p className="text-xs leading-relaxed text-amber-800">
                This device still holds data from the older on-device version of the app. Import it into your account to
                carry it over.
              </p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmImportLocal(true)}
                disabled={savingSection === 'import-local'}
              >
                {savingSection === 'import-local' ? <Spinner className="size-4" /> : null}
                Import local data
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <button type="button" className="btn-secondary" onClick={() => setConfirmSeed(true)} disabled={savingSection === 'seed'}>
              {savingSection === 'seed' ? <Spinner className="size-4" /> : null}
              Add sample tenants
            </button>
            <button type="button" className="btn-secondary" onClick={() => setConfirmReset(true)}>
              Restore default settings
            </button>
            <button type="button" className="btn-danger" onClick={() => setConfirmWipe(true)}>
              Erase all tenant data
            </button>
          </div>
        </div>
      </Card>

      <Card
        title="Install this app"
        description="Runs full screen and opens without a browser address bar."
        icon={DownloadIcon}
      >
        {installed ? (
          <p className="text-sm text-emerald-700">
            Installed. You are running the standalone version of the app.
          </p>
        ) : canInstall ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                const outcome = await promptInstall();
                if (outcome === 'accepted') toast.success('Installed. Open it from your home screen.');
                else if (outcome === 'dismissed') toast.info('Install dismissed.');
              }}
            >
              Install app
            </button>
            <span className="text-xs text-ink-subtle">Adds a home screen icon and works offline.</span>
          </div>
        ) : isIos ? (
          <p className="text-sm text-ink-muted">
            On iPhone, tap <span className="font-semibold">Share</span> and then{' '}
            <span className="font-semibold">Add to Home Screen</span>.
          </p>
        ) : (
          <p className="text-sm text-ink-muted">
            Use your browser menu and choose <span className="font-semibold">Install app</span> or{' '}
            <span className="font-semibold">Add to Home screen</span>.
          </p>
        )}
      </Card>

      <p className="pt-2 text-center text-xs text-ink-subtle">
        PG Manager · v2.0 · data stored in your own Supabase account
      </p>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={handleResetSettings}
        tone="primary"
        title="Restore default settings?"
        confirmLabel="Restore defaults"
        message="Sharing prices, the default deposit and the Terms & Conditions text will go back to their original values. Tenant records are not affected."
      />

      <ConfirmDialog
        open={confirmSeed}
        onClose={() => setConfirmSeed(false)}
        onConfirm={handleSeed}
        tone="primary"
        title="Add sample tenants?"
        confirmLabel="Add samples"
        message="Six demo tenants will be added, including one overdue, one due in 3 days and one due in 20 days, so you can check the colour coding. They can be deleted individually."
      />

      <ConfirmDialog
        open={confirmImportLocal}
        onClose={() => setConfirmImportLocal(false)}
        onConfirm={handleImportLocal}
        busy={savingSection === 'import-local'}
        title="Import data from this device?"
        confirmLabel="Import"
        message="Any tenants the older on-device version stored in this browser will be converted and added to your account. A copy of the original is kept on this device. Nothing in your account is changed or deleted."
      />

      <ConfirmDialog
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        onConfirm={handleWipe}
        busy={savingSection === 'wipe'}
        title="Erase all tenant data?"
        confirmLabel="Erase everything"
        message={`All ${customers.length} tenant records, their payment history and every uploaded photo or ID document will be permanently deleted from your Supabase account. This cannot be undone - download a backup first if you may need it.`}
      />
    </div>
  );
}
