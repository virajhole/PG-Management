import { useState } from 'react';
import Modal from './Modal.jsx';
import SignaturePad from './SignaturePad.jsx';
import { Button } from './ui.jsx';
import { downloadBlob } from '../utils/agreementPdf.js';
import { formatCurrency } from '../utils/format.js';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

/**
 * Digital agreement flow for one tenant: sign -> generate -> download/share.
 * The generated PDF is also uploaded to the private bucket via the agreements
 * service so it can be re-downloaded later.
 */
export default function AgreementDialog({ open, onClose, customer }) {
  const { settings, createAgreement } = useData();
  const toast = useToast();
  const [signature, setSignature] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!open || !customer) return null;

  async function generate() {
    if (!signature) {
      toast.error('Draw the tenant signature first.');
      return;
    }
    setBusy(true);
    try {
      const { generateAgreementPdf } = await import('../utils/agreementPdf.js');
      const blob = generateAgreementPdf({
        pgName: settings.pgName,
        ownerName: settings.ownerName,
        ownerMobile: settings.ownerMobile,
        terms: settings.terms,
        tenant: {
          name: customer.name,
          mobile: customer.mobile,
          guardianName: customer.guardianName,
          guardianPhone: customer.guardianPhone,
          address: customer.address,
          occupation: customer.occupation,
          proofType: customer.proofType,
          proofId: customer.proofId,
          roomNo: customer.roomNo,
          bedNo: customer.bedNo,
          sharingType: customer.sharingType,
          rentAmount: customer.rentAmount,
          depositAmount: customer.depositAmount,
          joiningDate: customer.joiningDate,
          dueDay: customer.dueDay,
        },
        signatureDataUrl: signature,
      });

      const filename = `agreement-${(customer.code || customer.name).replace(/\s+/g, '-')}.pdf`;
      downloadBlob(blob, filename);

      // Persist the PDF + signature in the private bucket and the metadata row.
      try {
        await createAgreement({ customer, blob, signatureDataUrl: signature });
      } catch {
        toast.info('Agreement downloaded. Storing a copy in the cloud failed - you can retry later.');
      }

      toast.success('Agreement PDF generated.');
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'Could not generate the agreement.');
    } finally {
      setBusy(false);
    }
  }

  function shareWhatsApp() {
    const text = `Hello ${customer.name.split(' ')[0]}, here is your PG rent agreement for ${settings.pgName}.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  return (
    <Modal open={open} onClose={onClose} title="Rent agreement" description={`${customer.name} · ${formatCurrency(customer.rentAmount)}/month`} size="md">
      <div className="space-y-4">
        <p className="rounded-xl bg-sunken px-3.5 py-3 text-xs leading-relaxed text-ink-subtle">
          The PDF includes the PG details, tenant details, rent, deposit, the full terms &amp; conditions and today's date, signed below.
        </p>

        <SignaturePad value={signature} onChange={setSignature} />

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="gradient" className="flex-1" onClick={generate} disabled={busy}>
            {busy ? 'Generating…' : 'Generate & download PDF'}
          </Button>
          <Button variant="secondary" onClick={shareWhatsApp}>
            Share via WhatsApp
          </Button>
        </div>
      </div>
    </Modal>
  );
}
