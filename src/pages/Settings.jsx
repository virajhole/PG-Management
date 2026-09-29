import { useEffect, useState } from 'react';
import { TextField, Textarea } from '../components/FormFields.jsx';
import { AmountField } from '../components/AmountField.jsx';
import Modal, { ConfirmDialog } from '../components/Modal.jsx';
import { SettingsIcon, RupeeIcon, LockIcon, IdCardIcon, DownloadIcon } from '../components/icons.jsx';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { authService, seedService, settingsService, imageService, customerService } from '../services/index.js';
import { formatCurrency, formatBytes } from '../utils/format.js';
import { SHARING_TYPES, DEFAULT_TERMS } from '../services/index.js';
import { Spinner } from '../components/States.jsx';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';

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
  const toast = useToast();

  const [prices, setPrices] = useState(() => ({ ...settings.sharingPrices }));
  const [deposit, setDeposit] = useState(settings.defaultDeposit);
  const [terms, setTerms] = useState(settings.terms);
  const [pgName, setPgName] = useState(settings.pgName);
  const [ownerName, setOwnerName] = useState(settings.ownerName);
  const [ownerMobile, setOwnerMobile] = useState(settings.ownerMobile);
  const [savingSection, setSavingSection] = useState(null);

  const [pinOpen, setPinOpen] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmSeed, setConfirmSeed] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [usage, setUsage] = useState(null);
  const { canInstall, isIos, installed, promptInstall } = useInstallPrompt();

  // Re-sync when settings change elsewhere (e.g. after a reset).
  useEffect(() => {
    setPrices({ ...settings.sharingPrices });
    setDeposit(settings.defaultDeposit);
    setTerms(settings.terms);
  }, [settings]);

  useEffect(() => {
    imageService.getStorageUsage().then(setUsage);
  }, [customers]);

  const totalMonthly = SHARING_TYPES.reduce((sum, n) => sum + (Number(prices[n]) || 0), 0);

  function savePricing() {
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
      updateSettings({ ...settings, sharingPrices: parsed });
      toast.success('Sharing prices saved. New admissions will use these rates.');
    } catch (error) {
      toast.error(error.message || 'Could not save the prices.');
    } finally {
      setSavingSection(null);
    }
  }

  function savePolicy() {
    if (!terms.trim()) {
      toast.error('The Terms & Conditions text cannot be empty.');
      return;
    }
    setSavingSection('policy');
    try {
      updateSettings({
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

  async function savePin() {
    if (!/^\d{4,6}$/.test(newPin)) {
      toast.error('PIN must be 4 to 6 digits.');
      return;
    }
    setPinBusy(true);
    try {
      await authService.setPin(newPin);
      setPinOpen(false);
      setNewPin('');
      toast.success('PIN updated. You will need it the next time you open the app.');
    } catch (error) {
      toast.error(error.message || 'Could not update the PIN.');
    } finally {
      setPinBusy(false);
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
      await customerService.clearAllCustomers();
      await imageService.clearImages();
      await refresh();
      toast.success('All tenant data erased from this device.');
    } catch (error) {
      toast.error(error.message || 'Could not erase the data.');
    } finally {
      setSavingSection(null);
      setConfirmWipe(false);
    }
  }

  function handleResetSettings() {
    const defaults = settingsService.resetSettings();
    updateSettings(defaults);
    setConfirmReset(false);
    toast.success('Settings restored to defaults.');
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

      {/* ------------------------------------------------------ security */}
      <Card
        title="App lock"
        description="A PIN is required to open the app because Aadhaar and PAN images are stored on this device. This is a deterrent, not encryption."
        icon={LockIcon}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
            PIN is set
          </span>
          <button type="button" className="btn-secondary" onClick={() => setPinOpen(true)}>
            Change PIN
          </button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Data lives in this browser only. If you move to a shared or cloud-backed device, read the security notes
          in the README before storing real identity documents.
        </p>
      </Card>

      {/* --------------------------------------------------------- data */}
      <Card
        title="Data on this device"
        description="Everything is stored locally. Nothing is uploaded anywhere."
        icon={IdCardIcon}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">{customers.length} tenant records</p>
              <p className="text-xs text-slate-500">
                {usage ? `${formatBytes(usage.usage)} used of roughly ${formatBytes(usage.quota)} available` : 'Calculating storage usage…'}
              </p>
            </div>
            {usage && (
              <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-brand-500"
                  style={{ width: `${Math.max(2, Math.min(100, usage.percent * 100))}%` }}
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
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
        PG Manager · v1.0 · all data is stored locally in this browser
      </p>

      {/* -------------------------------------------------------- modals */}
      <Modal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        title="Set a new app PIN"
        description="Choose a 4 to 6 digit PIN."
        size="sm"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn-secondary" onClick={() => setPinOpen(false)} disabled={pinBusy}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={savePin} disabled={pinBusy}>
              {pinBusy ? 'Saving…' : 'Save PIN'}
            </button>
          </div>
        }
      >
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          maxLength={6}
          value={newPin}
          onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && savePin()}
          className="field-input text-center text-2xl tracking-[0.5em]"
          placeholder="••••"
          aria-label="New PIN"
        />
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          The app asks for this PIN each time it opens. If you forget it, clear the site data in your browser
          to reset the app.
        </p>
      </Modal>

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
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        onConfirm={handleWipe}
        busy={savingSection === 'wipe'}
        title="Erase all tenant data?"
        confirmLabel="Erase everything"
        message={`All ${customers.length} tenant records, their payment history and every uploaded photo or ID document will be permanently deleted from this device. This cannot be undone.`}
      />
    </div>
  );
}
