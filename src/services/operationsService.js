import { TABLES, listRows, getRow, insertRow, updateRow, deleteRow } from './supabase.js';
import { createId, todayISO } from '../utils/dateLogic.js';

/**
 * Operations records: complaints, notices, enquiries and visitor log.
 *
 * These tables are additive (migration 003) and are exposed through the same
 * tiny table surface as every other service, so the in-memory test fake can
 * support them without any RPC plumbing.
 */

export const COMPLAINT_CATEGORIES = ['electricity', 'water', 'wifi', 'cleaning', 'furniture', 'other'];
export const COMPLAINT_PRIORITIES = ['low', 'medium', 'high'];
export const COMPLAINT_STATUSES = ['open', 'in_progress', 'resolved'];
export const ENQUIRY_STATUSES = ['new', 'contacted', 'visited', 'joined', 'lost'];

const COMPLAINT_COLUMNS = [
  'id', 'title', 'category', 'priority', 'status', 'roomNo', 'customerId', 'description',
  'photoId', 'assignedTo', 'resolvedDate', 'createdAt', 'updatedAt',
];

const NOTICE_COLUMNS = ['id', 'title', 'body', 'date', 'createdAt', 'updatedAt'];

const ENQUIRY_COLUMNS = [
  'id', 'name', 'phone', 'preferredSharing', 'budget', 'expectedJoinDate', 'status', 'note', 'createdAt', 'updatedAt',
];

const VISITOR_COLUMNS = [
  'id', 'name', 'phone', 'visitingWhom', 'purpose', 'inTime', 'outTime', 'date', 'createdAt',
];

export { COMPLAINT_COLUMNS, NOTICE_COLUMNS, ENQUIRY_COLUMNS, VISITOR_COLUMNS };

function normalizeComplaint(row = {}) {
  return {
    id: row.id || createId('cmp'),
    title: row.title || '',
    category: row.category || 'other',
    priority: row.priority || 'medium',
    status: row.status || 'open',
    roomNo: row.roomNo || '',
    customerId: row.customerId || null,
    description: row.description || '',
    photoId: row.photoId || null,
    assignedTo: row.assignedTo || '',
    resolvedDate: row.resolvedDate || null,
    createdAt: row.createdAt || new Date().toISOString(),
    updatedAt: row.updatedAt || new Date().toISOString(),
  };
}

function normalizeNotice(row = {}) {
  return {
    id: row.id || createId('ntc'),
    title: row.title || '',
    body: row.body || '',
    date: row.date || todayISO(),
    createdAt: row.createdAt || new Date().toISOString(),
    updatedAt: row.updatedAt || new Date().toISOString(),
  };
}

function normalizeEnquiry(row = {}) {
  return {
    id: row.id || createId('enq'),
    name: row.name || '',
    phone: row.phone || '',
    preferredSharing: Number(row.preferredSharing) || 1,
    budget: Number(row.budget) || 0,
    expectedJoinDate: row.expectedJoinDate || null,
    status: row.status || 'new',
    note: row.note || '',
    createdAt: row.createdAt || new Date().toISOString(),
    updatedAt: row.updatedAt || new Date().toISOString(),
  };
}

function normalizeVisitor(row = {}) {
  return {
    id: row.id || createId('vis'),
    name: row.name || '',
    phone: row.phone || '',
    visitingWhom: row.visitingWhom || '',
    purpose: row.purpose || '',
    inTime: row.inTime || '',
    outTime: row.outTime || null,
    date: row.date || todayISO(),
    createdAt: row.createdAt || new Date().toISOString(),
  };
}

export async function listComplaints() {
  const rows = await listRows(TABLES.complaints);
  return rows.map(normalizeComplaint);
}

export async function getComplaint(id) {
  const row = await getRow(TABLES.complaints, id);
  return row ? normalizeComplaint(row) : null;
}

export async function createComplaint(input) {
  return normalizeComplaint(await insertRow(TABLES.complaints, normalizeComplaint(input)));
}

export async function updateComplaint(id, patch) {
  return normalizeComplaint(await updateRow(TABLES.complaints, id, { ...patch, updatedAt: new Date().toISOString() }));
}

export async function deleteComplaint(id) {
  await deleteRow(TABLES.complaints, id);
  return true;
}

export async function listNotices() {
  const rows = await listRows(TABLES.notices);
  return rows.map(normalizeNotice);
}

export async function createNotice(input) {
  return normalizeNotice(await insertRow(TABLES.notices, normalizeNotice(input)));
}

export async function updateNotice(id, patch) {
  return normalizeNotice(await updateRow(TABLES.notices, id, { ...patch, updatedAt: new Date().toISOString() }));
}

export async function deleteNotice(id) {
  await deleteRow(TABLES.notices, id);
  return true;
}

export async function listEnquiries() {
  const rows = await listRows(TABLES.enquiries);
  return rows.map(normalizeEnquiry);
}

export async function getEnquiry(id) {
  const row = await getRow(TABLES.enquiries, id);
  return row ? normalizeEnquiry(row) : null;
}

export async function createEnquiry(input) {
  return normalizeEnquiry(await insertRow(TABLES.enquiries, normalizeEnquiry(input)));
}

export async function updateEnquiry(id, patch) {
  return normalizeEnquiry(await updateRow(TABLES.enquiries, id, { ...patch, updatedAt: new Date().toISOString() }));
}

export async function deleteEnquiry(id) {
  await deleteRow(TABLES.enquiries, id);
  return true;
}

export async function listVisitors() {
  const rows = await listRows(TABLES.visitors);
  return rows.map(normalizeVisitor);
}

export async function createVisitor(input) {
  return normalizeVisitor(await insertRow(TABLES.visitors, normalizeVisitor(input)));
}

export async function updateVisitor(id, patch) {
  return normalizeVisitor(await updateRow(TABLES.visitors, id, patch));
}

export async function deleteVisitor(id) {
  await deleteRow(TABLES.visitors, id);
  return true;
}
