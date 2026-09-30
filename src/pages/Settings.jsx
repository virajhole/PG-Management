import { useEffect, useRef, useState } from 'react';
import { TextField, Textarea } from '../components/FormFields.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { SettingsIcon, RupeeIcon, LockIcon, IdCardIcon, DownloadIcon } from '../components/icons.jsx';
import { useData } from '../context/DataContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { seedService, settingsService, backupService, migrationService } from '../services/index.js';
import { formatCurrency } from '../utils/format.js';
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
  ]);
}

function Card({ title, description, icon: Icon, children }) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        {Icon && (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon className="size-4.5" />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>}
        </div>
      </div>
      {children}
    </section>
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
  const [savingSection, setSavingSection] = useState(null);

  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmSeed, setConfirmSeed] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmImportLocal, setConfirmImportLocal] = useState(false);
  const fileRef = useRef(null);
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
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Settings</h1>
        <p className="mt-0.5 text-sm text-slate-500">Pricing, deposit defaults, house rules and app security.</p>
      </header>

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
          <p className="text-xs text-slate-500">
            If every bed of every room were occupied, monthly income would be{' '}
            <span className="font-semibold text-slate-700">{formatCurrency(totalMonthly)}</span>.
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

      {/* ------------------------------------------------------ account */}
      <Card
        title="Your account"
        description="Tenant records and ID documents are stored in your own Supabase project and are visible only to this account, enforced by Row Level Security on every table."
        icon={LockIcon}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">{user?.email || 'Signed in'}</p>
              <p className="text-xs text-slate-500">{customers.length} tenant records in this account</p>
            </div>
            <button type="button" className="btn-secondary" onClick={logout}>
              Sign out
            </button>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            ID documents sit in a private storage bucket and are only ever read through short-lived signed URLs.
          </p>
        </div>
      </Card>

      {/* ---------------------------------------------------- backup / data */}
      <Card
        title="Backup & restore"
        description="Your data is never locked in. Download a full copy, keep it somewhere safe, or import one into a new account."
        icon={IdCardIcon}
      >
        <div className="space-y-3">
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

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
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
            <span className="text-xs text-slate-500">Adds a home screen icon and works offline.</span>
          </div>
        ) : isIos ? (
          <p className="text-sm text-slate-600">
            On iPhone, tap <span className="font-semibold">Share</span> and then{' '}
            <span className="font-semibold">Add to Home Screen</span>.
          </p>
        ) : (
          <p className="text-sm text-slate-600">
            Use your browser menu and choose <span className="font-semibold">Install app</span> or{' '}
            <span className="font-semibold">Add to Home screen</span>.
          </p>
        )}
      </Card>

      <p className="pt-2 text-center text-xs text-slate-400">
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
