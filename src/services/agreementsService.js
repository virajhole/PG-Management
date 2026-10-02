import { TABLES, insertRow, listRows, uploadImage, uploadFile } from './supabase.js';
import { createId, todayISO } from '../utils/dateLogic.js';

/**
 * Digital agreements: the generated PDF and the signature PNG are stored in
 * the private identity-docs bucket (owner-scoped like ID proofs); only paths
 * and key figures live in the agreements table.
 */

export async function listAgreements() {
  return listRows(TABLES.agreements);
}

export async function createAgreement({ customer, blob, signatureDataUrl }) {
  const id = createId('agr');
  const signaturePath = `a/${customer.id}/${id}-signature.png`;
  const pdfPath = `a/${customer.id}/${id}.pdf`;

  await uploadImage(signaturePath, signatureDataUrl);
  if (blob) await uploadFile(pdfPath, blob);

  return insertRow(TABLES.agreements, {
    id,
    customerId: customer.id,
    rentAmount: Number(customer.rentAmount) || 0,
    depositAmount: Number(customer.depositAmount) || 0,
    startDate: customer.joiningDate || todayISO(),
    endDate: customer.agreementEndDate || null,
    signaturePath,
    pdfPath,
    signedAt: new Date().toISOString(),
  });
}
