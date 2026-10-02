import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CustomerList from '../components/CustomerList.jsx';
import RentRevisionDialog from '../components/RentRevisionDialog.jsx';
import { ErrorState, SkeletonList } from '../components/States.jsx';
import { Button, Badge, Card, BottomSheet } from '../components/ui.jsx';
import { UserPlusIcon, Upload as UploadIcon, Download as DownloadIcon, TrendingUp as TrendingUpIcon } from 'lucide-react';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { customerService } from '../services/index.js';
import { formatRupees } from '../utils/format.js';
import { parseImport, runImport, sampleCsv, IMPORT_COLUMNS } from '../utils/csvImport.js';
import { downloadBlob } from '../utils/agreementPdf.js';
import { formatDate } from '../utils/dateLogic.js';

/** Full tenant directory - same list as the dashboard, plus bulk CSV import. */
export default function Customers() {
  const { customers, status, error, today, refresh, createCustomer } = useData();
  const navigate = useNavigate();
  const toast = useToast();
  const fileRef = useRef(null);
  const [importOpen, setImportOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);

  const sorted = useMemo(() => customerService.sortByDueDate(customers, today), [customers, today]);
  const summary = useMemo(() => customerService.summarise(customers, today), [customers, today]);

  async function onFile(file) {
    if (!file) return;
    const text = await file.text();
    const result = parseImport(text);
    setPreview(result);
  }

  async function confirmImport() {
    if (!preview?.rows?.length) return;
    setImporting(true);
    try {
      const { imported, failed } = await runImport(preview.rows, createCustomer);
      if (failed.length) {
        toast.warning(`Imported ${imported} tenant(s); ${failed.length} failed: ${failed.map((f) => f.name).join(', ')}`);
      } else {
        toast.success(`Imported ${imported} tenant${imported === 1 ? '' : 's'}.`);
      }
      setPreview(null);
      setImportOpen(false);
    } finally {
      setImporting(false);
    }
  }

  function downloadSample() {
    const blob = new Blob([sampleCsv()], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, 'pg-manager-tenant-template.csv');
  }

  if (status === 'error') {
    return (
      <ErrorState
        title="Could not load your tenants"
        message={error?.message || 'There was a problem reading the stored data on this device.'}
        onRetry={refresh}
      />
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">All tenants</h1>
          <p className="mt-0.5 text-sm text-ink-subtle">
            {status === 'loading'
              ? 'Loading…'
              : `${summary.total} ${summary.total === 1 ? 'tenant' : 'tenants'} · ${formatRupees(summary.expected)} per month`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setRevisionOpen(true)}>
            <TrendingUpIcon className="size-4" /> Revise rent
          </Button>
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <UploadIcon className="size-4" /> Import
          </Button>
          <Button variant="gradient" onClick={() => navigate('/admission')}>
            <UserPlusIcon className="size-4" />
            New admission
          </Button>
        </div>
      </header>

      {status === 'loading' ? <SkeletonList count={6} /> : <CustomerList customers={sorted} />}

      <RentRevisionDialog open={revisionOpen} onClose={() => setRevisionOpen(false)} customers={customers} />

      <BottomSheet open={importOpen} onClose={() => setImportOpen(false)} title="Import tenants from CSV">
        <div className="space-y-3">
          <p className="rounded-xl bg-sunken px-3.5 py-3 text-xs leading-relaxed text-ink-subtle">
            Upload a CSV exported from Excel or Google Sheets. Nothing is written until you confirm the preview.
          </p>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="gradient" onClick={() => fileRef.current?.click()}>
              <UploadIcon className="size-4" /> Choose CSV file
            </Button>
            <Button variant="secondary" onClick={downloadSample}>
              <DownloadIcon className="size-4" /> Sample template
            </Button>
          </div>

          {preview && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge tone="accent">{preview.rows.length} valid</Badge>
                {preview.errors.length > 0 && <Badge tone="danger">{preview.errors.length} with errors</Badge>}
              </div>

              {preview.errors.length > 0 && (
                <Card className="p-3">
                  <p className="text-xs font-bold text-red-600 dark:text-red-400">Rows with errors</p>
                  <ul className="mt-1.5 space-y-1 text-xs text-ink-muted">
                    {preview.errors.slice(0, 8).map((e) => (
                      <li key={e.lineNumber}>
                        Line {e.lineNumber}: {e.errors.join('; ')}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {preview.rows.length > 0 && (
                <Card className="scroll-slim max-h-72 overflow-auto p-3">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-ink-subtle">
                        <th className="py-1 pr-2">Name</th>
                        <th className="py-1 pr-2">Mobile</th>
                        <th className="py-1 pr-2">Sharing</th>
                        <th className="py-1 pr-2">Rent</th>
                        <th className="py-1">Joining</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {preview.rows.map((c) => (
                        <tr key={c.id}>
                          <td className="py-1.5 pr-2 font-semibold text-ink">{c.name}</td>
                          <td className="py-1.5 pr-2 text-ink-muted">{c.mobile}</td>
                          <td className="py-1.5 pr-2 text-ink-muted">{c.sharingType}</td>
                          <td className="py-1.5 pr-2 text-ink-muted">{formatRupees(c.rentAmount)}</td>
                          <td className="py-1.5 text-ink-muted">{formatDate(c.joiningDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}

              <Button variant="gradient" className="w-full" onClick={confirmImport} disabled={importing || !preview.rows.length}>
                {importing ? 'Importing…' : `Import ${preview.rows.length} tenant${preview.rows.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          )}

          <details className="rounded-xl border border-line px-3.5 py-3 text-xs">
            <summary className="cursor-pointer font-semibold text-ink">Column reference</summary>
            <ul className="mt-2 space-y-1 text-ink-subtle">
              {IMPORT_COLUMNS.map((c) => (
                <li key={c.key}>
                  <code className="font-semibold text-ink">{c.label}</code> — {c.hint}
                </li>
              ))}
            </ul>
          </details>
        </div>
      </BottomSheet>
    </div>
  );
}
