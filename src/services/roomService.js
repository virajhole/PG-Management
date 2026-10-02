import {
  TABLES,
  insertRow,
  updateRow,
  deleteRow,
  listRows,
  rpc,
  listRoomsRpc,
} from './supabase.js';
import { createId, todayISO } from '../utils/dateLogic.js';

/**
 * Rooms, occupancy and the tenant lifecycle.
 *
 * Occupancy is computed, never stored: capacity comes from the room's
 * `sharingType`, and occupancy comes from counting customers whose status is
 * `active` or `notice`. A tenant on notice still holds their bed until they
 * actually leave, which is why `notice` counts as occupied.
 *
 * Everything that changes who lives where goes through the Postgres RPCs in
 * 002_rooms_and_lifecycle.sql. Those re-check availability under a row lock, so
 * two admissions for the last free bed cannot both succeed. The helpers here
 * exist so no screen has to know that.
 */

export const ROOM_STATUS = {
  full: 'full',
  partial: 'partial',
  empty: 'empty',
};

export const TENANT_STATUS = {
  active: 'active',
  notice: 'notice',
  vacated: 'vacated',
};

export const EXPENSE_CATEGORIES = [
  'electricity',
  'water',
  'groceries',
  'salary',
  'repairs',
  'internet',
  'other',
];

export function normalizeRoom(raw = {}) {
  const sharingType = Math.min(Math.max(Number(raw.sharingType) || 1, 1), 5);
  return {
    id: raw.id || createId('room'),
    floor: Number.isFinite(Number(raw.floor)) ? Number(raw.floor) : 0,
    roomNo: raw.roomNo || '',
    sharingType,
    // Null means "use the Settings price for this sharing type", which is why
    // it must survive as null rather than collapsing to 0.
    monthlyRent: raw.monthlyRent === null || raw.monthlyRent === undefined ? null : Number(raw.monthlyRent),
    hasAc: raw.hasAc ?? false,
    hasAttachedBathroom: raw.hasAttachedBathroom ?? false,
    notes: raw.notes || '',
    isActive: raw.isActive ?? true,
    capacity: Number(raw.capacity) || sharingType,
    occupied: Number(raw.occupied) || 0,
    vacant: Number.isFinite(Number(raw.vacant)) ? Number(raw.vacant) : sharingType,
    occupancyStatus: raw.occupancyStatus || ROOM_STATUS.empty,
    occupants: Array.isArray(raw.occupants) ? raw.occupants : [],
    createdAt: raw.createdAt || todayISO(),
    updatedAt: raw.updatedAt || todayISO(),
  };
}

/**
 * Effective rent for a room: its own override when set, otherwise the account's
 * price for that sharing type. Keeping the fallback here (not in SQL) means
 * changing a price in Settings immediately re-prices every room that has no
 * override.
 */
export function effectiveRent(room, settings) {
  if (room?.monthlyRent !== null && room?.monthlyRent !== undefined) {
    return Number(room.monthlyRent) || 0;
  }
  const price = settings?.sharingPrices?.[String(room?.sharingType)];
  return Number.isFinite(Number(price)) ? Number(price) : 0;
}

export function bedNumbers(sharingType) {
  return Array.from({ length: Math.max(1, Number(sharingType) || 1) }, (_, i) => i + 1);
}

export function isBedFree(room, bedNo) {
  if (!room) return false;
  return !room.occupants.some((o) => String(o.bedNo) === String(bedNo));
}

export function freeBeds(room) {
  return bedNumbers(room?.capacity ?? room?.sharingType).filter((bed) => isBedFree(room, bed));
}

export function hasVacancy(room) {
  return Number(room?.vacant ?? 0) > 0;
}

export function isFullyVacant(room) {
  return Number(room?.occupied ?? 0) === 0;
}

// ------------------------------------------------------------------- reads

/** All rooms with computed occupancy and occupant names, floor order. */
export async function listRooms() {
  const rows = await listRoomsRpc();
  return Array.isArray(rows) ? rows.map(normalizeRoom) : [];
}

export async function listExpenses() {
  const rows = await listRows(TABLES.expenses);
  return rows.map((row) => ({
    id: row.id,
    category: row.category || 'other',
    amount: Number(row.amount) || 0,
    date: row.date || todayISO(),
    note: row.note || '',
    createdAt: row.createdAt,
  }));
}

export async function listRoomHistory(customerId) {
  const rows = await listRows(TABLES.roomHistory);
  return rows
    .filter((row) => !customerId || row.customerId === customerId)
    .map((row) => ({
      id: row.id,
      customerId: row.customerId,
      roomId: row.roomId,
      bedNo: row.bedNo || '',
      fromDate: row.fromDate,
      toDate: row.toDate || null,
      note: row.note || '',
      createdAt: row.createdAt,
    }))
    .sort((a, b) => String(b.fromDate).localeCompare(String(a.fromDate)));
}

// ------------------------------------------------------------------ writes

export async function createRoom(input) {
  return normalizeRoom(await insertRow(TABLES.rooms, normalizeRoom(input)));
}

export async function updateRoom(id, patch) {
  return normalizeRoom(await updateRow(TABLES.rooms, id, patch));
}

/**
 * Refuses to delete an occupied room. The RPC holds the room row while it
 * checks, so a room cannot become occupied between this check and the delete.
 */
export async function deleteRoom(id) {
  await rpc('delete_room', { roomId: id });
  return true;
}

/** Create several rooms at once; used by the bulk-add form. */
export async function createRooms(inputs) {
  const created = [];
  for (const input of inputs) {
    created.push(await createRoom(input));
  }
  return created;
}

/**
 * Admit a tenant into a specific bed. The bed picker in the UI is only a
 * convenience - the RPC re-checks capacity under a lock and raises if the room
 * filled up in the meantime.
 */
export async function admitCustomer(customer, roomId, bedNo = '') {
  return rpc('admit_customer', { customer, roomId, bedNo });
}

export async function moveCustomer(customerId, roomId, bedNo = '', effectiveDate = null) {
  return rpc('move_customer', { customerId, roomId, bedNo, effectiveDate });
}

export async function giveNotice(customerId, expectedLeavingDate = null, note = '') {
  return rpc('give_notice', { customerId, expectedLeavingDate, note });
}

/**
 * Checkout. `refundAmount` is computed by the caller (see `calculateRefund`)
 * so the owner can override it; the RPC records it as a REFUND transaction and
 * frees the bed.
 */
export async function vacateCustomer({
  customerId,
  pendingRent = 0,
  pendingBill = 0,
  damageCharges = 0,
  refundAmount = 0,
  refundMode = 'cash',
  note = '',
}) {
  return rpc('vacate_customer', {
    customerId,
    pendingRent,
    pendingBill,
    damageCharges,
    refundAmount,
    refundMode,
    note,
  });
}

/**
 * Deposit refund: what the tenant paid, less what they still owe and any damage
 * charges. Floored at zero - a tenant who owes more than they deposited owes
 * the difference rather than receiving a negative refund.
 */
export function calculateRefund({ depositAmount = 0, pendingRent = 0, pendingBill = 0, damageCharges = 0 }) {
  const deposit = Number(depositAmount) || 0;
  const owed = (Number(pendingRent) || 0) + (Number(pendingBill) || 0);
  const damage = Number(damageCharges) || 0;
  return Math.max(deposit - owed - damage, 0);
}

// ------------------------------------------------------------- dashboards

export async function getDashboardSummary() {
  return rpc('dashboard_summary');
}

export async function getUpcomingVacates(days = 60) {
  const rows = await rpc('upcoming_vacates', { days });
  return Array.isArray(rows) ? rows : [];
}

export async function getMonthlyFinance(months = 6) {
  const rows = await rpc('monthly_finance', { months });
  return Array.isArray(rows) ? rows : [];
}

export async function logAudit(action, { entityType = '', entityId = null, summary = '', amount = null } = {}) {
  try {
    // Audit is a side effect: never let a logging failure block the action.
    await rpc('log_audit', { action, entityType, entityId, summary, amount });
  } catch {
    /* ignore */
  }
}

export async function getAuditFeed(limit = 100) {
  const rows = await rpc('audit_feed', { limit });
  return Array.isArray(rows) ? rows : [];
}

export async function createExpense({ category = 'other', amount = 0, date = todayISO(), note = '' }) {
  return insertRow(TABLES.expenses, {
    id: createId('exp'),
    category,
    amount,
    date,
    note,
  });
}

export async function updateExpense(id, patch) {
  return updateRow(TABLES.expenses, id, patch);
}

export async function deleteExpense(id) {
  return deleteRow(TABLES.expenses, id);
}

// ----------------------------------------------------- dashboard roll-ups

/**
 * Occupancy totals for a set of rooms, computed the same way the database does
 * so the client can render cards from an already-loaded list without another
 * round trip.
 */
export function occupancyTotals(rooms = []) {
  const active = rooms.filter((room) => room.isActive);
  const totalBeds = active.reduce((sum, room) => sum + (Number(room.capacity) || 0), 0);
  const occupiedBeds = active.reduce((sum, room) => sum + (Number(room.occupied) || 0), 0);
  const totalRooms = active.length;
  const fullyVacantRooms = active.filter(isFullyVacant).length;

  return {
    totalRooms,
    totalBeds,
    occupiedBeds,
    vacantBeds: Math.max(totalBeds - occupiedBeds, 0),
    fullyVacantRooms,
    occupancyPercent: totalBeds ? Math.round((occupiedBeds / totalBeds) * 1000) / 10 : 0,
  };
}

/** Group rooms by floor, preserving ascending floor order. */
export function groupByFloor(rooms = []) {
  const floors = new Map();
  for (const room of rooms) {
    if (!floors.has(room.floor)) floors.set(room.floor, []);
    floors.get(room.floor).push(room);
  }
  return [...floors.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([floor, list]) => ({
      floor,
      rooms: list.slice().sort((a, b) => String(a.roomNo).localeCompare(String(b.roomNo), undefined, { numeric: true })),
      totals: occupancyTotals(list),
    }));
}

/** Rooms that can take one more tenant of the given sharing type. */
export function availableRooms(rooms = [], sharingType) {
  const wanted = Number(sharingType);
  return rooms.filter(
    (room) => room.isActive && room.sharingType === wanted && hasVacancy(room),
  );
}
