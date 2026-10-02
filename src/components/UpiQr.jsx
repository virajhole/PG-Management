import { useMemo, useState } from 'react';
import { useData } from '../context/DataContext.jsx';
import { useQrCode } from '../hooks/useQrCode.js';
import { buildUpiLink } from '../utils/upi.js';
import { formatCurrency } from '../utils/format.js';
import { Card, Button, Badge } from './ui.jsx';
import { QrCodeIcon } from './icons.jsx';

/**
 * UPI QR for the exact outstanding amount. Reads the UPI ID from Settings;
 * when it is not configured the card explains how to turn the feature on
 * rather than rendering a broken QR.
 */
export default function UpiQr({ customer, remaining, amount = null, compact = false }) {
  const { settings } = useData();
  const [copied, setCopied] = useState(false);

  const payAmount = Number(amount ?? remaining) || 0;
  const link = useMemo(
    () =>
      buildUpiLink({
        payeeVpa: settings.upiId,
        payeeName: settings.pgName,
        amount: payAmount,
        note: `${customer?.code || customer?.name || 'PG'} rent`,
      }),
    [settings.upiId, settings.pgName, payAmount, customer],
  );
  const qr = useQrCode(link);

  if (!settings.upiId) {
    return compact ? null : (
      <Card className="p-4 text-sm text-ink-subtle">
        <p className="font-semibold text-ink">UPI QR not set up</p>
        <p className="mt-1 text-xs leading-relaxed">
          Add your UPI ID in Settings → Payments to show a scannable QR for the exact balance.
        </p>
      </Card>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
            <QrCodeIcon className="size-4" /> Pay via UPI
          </p>
          <p className="mt-0.5 text-xs text-ink-subtle">{settings.upiId}</p>
        </div>
        <Badge tone="accent">{formatCurrency(payAmount)}</Badge>
      </div>

      <div className="mt-3 flex items-center gap-4">
        {qr ? (
          <img src={qr} alt={`UPI QR code for ${formatCurrency(payAmount)}`} className="size-32 rounded-xl border border-line bg-white p-1.5" />
        ) : (
          <div className="flex size-32 items-center justify-center rounded-xl border border-dashed border-line-strong text-xs text-ink-subtle">
            Invalid UPI ID
          </div>
        )}
        <div className="flex flex-1 flex-col gap-2">
          <Button size="sm" variant="gradient" onClick={copy}>
            {copied ? 'Copied!' : 'Copy link'}
          </Button>
          <a href={link} className="btn-secondary min-h-9 px-3 text-xs">
            Open pay app
          </a>
          <p className="text-[10px] leading-snug text-ink-subtle">Works with GPay, PhonePe, Paytm &amp; BHIM. Amount is pre-filled.</p>
        </div>
      </div>
    </Card>
  );
}
