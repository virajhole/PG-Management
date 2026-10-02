import { jsPDF } from 'jspdf';

/**
 * Rent agreement PDF generator.
 *
 * Draws a clean A4 agreement: PG + tenant + rent/deposit details, the admin's
 * terms & conditions, and the tenant's signature (rendered from the signature
 * pad's PNG data URL) with the signing date. Runs fully client-side so it
 * works offline and needs no server PDF service.
 */

const LINE = 6;

function text(doc, value, x, y, { size = 11, bold = false, maxWidth = 0 } = {}) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  const str = String(value ?? '');
  if (maxWidth > 0) {
    const lines = doc.splitTextToSize(str, maxWidth);
    doc.text(lines, x, y);
    return lines.length * (size * 0.3528 + 0.8);
  }
  doc.text(str, x, y);
  return LINE;
}

/** Generate the agreement PDF and return it as a Blob. */
export function generateAgreementPdf({
  pgName = '',
  ownerName = '',
  ownerMobile = '',
  ownerAddress = '',
  terms = '',
  tenant = {},
  signatureDataUrl = null,
  today = new Date(),
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const usable = pageW - margin * 2;
  let y = 0;

  const ensureSpace = (needed) => {
    if (y + needed > pageH - 20) {
      doc.addPage();
      y = 24;
    }
  };

  // Header
  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, pageW, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('RENT AGREEMENT', margin, 13);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(pgName || 'Paying Guest House', margin, 21);
  doc.setTextColor(15, 23, 42);

  y = 42;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`This agreement is made on ${today.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`, margin, y);
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const intro =
    `between ${pgName || 'the PG'}${ownerName ? `, represented by ${ownerName}` : ''} ` +
    `("the Owner") and ${tenant.name || 'the Tenant'} ("the Tenant").`;
  y += text(doc, intro, margin, y, { maxWidth: usable }) + 4;

  // Parties
  const section = (title) => {
    ensureSpace(14);
    y += 4;
    doc.setFillColor(238, 242, 255);
    doc.rect(margin, y - 4.5, usable, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(49, 46, 129);
    doc.text(title, margin + 2, y);
    doc.setTextColor(15, 23, 42);
    y += 8;
  };

  section('1. The Parties');
  const ownerBlock = [
    ['PG name', pgName],
    ['Owner', ownerName],
    ['Contact', ownerMobile],
    ['Address', ownerAddress],
  ];
  const tenantBlock = [
    ['Tenant name', tenant.name],
    ['Mobile', tenant.mobile],
    ['Guardian', tenant.guardianName ? `${tenant.guardianName}${tenant.guardianPhone ? ` (${tenant.guardianPhone})` : ''}` : ''],
    ['ID proof', tenant.proofType ? `${tenant.proofType}: ${tenant.proofId || ''}` : ''],
    ['Permanent address', tenant.address],
    ['Occupation', tenant.occupation],
  ];

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Owner', margin, y);
  doc.text('Tenant', margin + usable / 2, y);
  y += 5.5;
  doc.setFont('helvetica', 'normal');

  const rows = Math.max(ownerBlock.length, tenantBlock.length);
  for (let i = 0; i < rows; i += 1) {
    ensureSpace(6);
    const [ol, ov] = ownerBlock[i] ?? [];
    const [tl, tv] = tenantBlock[i] ?? [];
    if (ol) {
      doc.setFont('helvetica', 'normal');
      doc.text(`${ol}:`, margin, y);
      doc.setFont('helvetica', 'bold');
      doc.text(String(ov ?? '').slice(0, 60), margin + 22, y);
    }
    if (tl) {
      doc.setFont('helvetica', 'normal');
      doc.text(`${tl}:`, margin + usable / 2, y);
      doc.setFont('helvetica', 'bold');
      doc.text(String(tv ?? '').slice(0, 60), margin + usable / 2 + 22, y);
    }
    y += LINE;
  }

  section('2. Accommodation & Charges');
  const chargeLines = [
    `Room: ${tenant.roomNo || '—'}${tenant.bedNo ? `, bed ${tenant.bedNo}` : ''} · ${tenant.sharingType || 1}-sharing`,
    `Monthly rent: Rs ${Number(tenant.rentAmount || 0).toLocaleString('en-IN')} payable in advance each month`,
    `Security deposit: Rs ${Number(tenant.depositAmount || 0).toLocaleString('en-IN')} (refundable as per terms)`,
    tenant.joiningDate ? `Agreement start: ${String(tenant.joiningDate)}` : null,
    tenant.endDate ? `Agreement end: ${String(tenant.endDate)}` : null,
    `Rent due day: ${tenant.dueDay || 1} of every month`,
  ].filter(Boolean);
  for (const line of chargeLines) {
    ensureSpace(6);
    y += text(doc, `•  ${line}`, margin, y, { maxWidth: usable });
  }

  section('3. Terms & Conditions');
  const termsText = String(terms || '').trim();
  if (termsText) {
    const paragraphs = termsText.split(/\n{2,}|\r\n\r\n/);
    for (const p of paragraphs) {
      ensureSpace(12);
      y += text(doc, p.replace(/\n/g, ' '), margin, y, { size: 9.5, maxWidth: usable }) + 1.5;
    }
  }

  // Signatures
  ensureSpace(46);
  y += 10;
  doc.setDrawColor(203, 213, 225);
  doc.line(margin, y, margin + usable / 2 - 8, y);
  doc.line(margin + usable / 2 + 8, y, margin + usable, y);

  if (signatureDataUrl) {
    try {
      doc.addImage(signatureDataUrl, 'PNG', margin + 2, y - 24, 42, 20);
    } catch {
      /* ignore malformed image */
    }
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Tenant signature', margin, y + 4.5);
  doc.text(
    `Signed on ${today.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    margin + usable / 2 + 8,
    y + 4.5,
  );
  doc.text('For the Owner', margin + usable / 2 + 8, y - 4);

  // Page numbers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${i} of ${pages}`, pageW / 2, pageH - 8, { align: 'center' });
    doc.setTextColor(15, 23, 42);
  }

  return doc.output('blob');
}

/** Trigger a browser download of a blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
