import { TABLES, listRows, insertRow, updateRow, deleteRow, notReturned } from './supabase.js';
import { listCustomers } from './customerService.js';

/**
 * Rooms. Occupancy is computed here, never stored: a room's capacity is its
 * sharing type, and its occupants are the active tenants pointing at it. A
 * room cannot be deleted while someone still lives in it.
 */

export function normalizeRoom(raw = {}) {
  const sharingType = Math.min(Math.max(Number(raw.sharingType) || 1, 1), 5);
  return {
    id: raw.id ?? null,
    floor: Number.isFinite(Number(raw.floor)) ? Number(raw.floor) : 0,
    roomNo: raw.roomNo || '',
    sharingType,
    // null means "use the Settings price for this sharing type"
    monthlyRent: raw.monthlyRent === null || raw.monthlyRent === undefined ? null : Number(raw.monthlyRent),
    notes: raw.notes || '',
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
}

/** Effective rent for a room: its own override, else the Settings price. */
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

export function freeBeds(room) {
  const taken = new Set((room?.occupants ?? []).map((o) => String(o.bedNo)));
  return bedNumbers(room?.sharingType).filter((bed) => !taken.has(String(bed)));
}

export function hasVacancy(room) {
  return Number(room?.vacant ?? 0) > 0;
}

export function isFullyVacant(room) {
  return Number(room?.occupied ?? 0) === 0;
}

/** All rooms with occupants attached, from the tenants list. */
export async function listRooms() {
  const [rooms, customers] = await Promise.all([listRows(TABLES.rooms), listCustomers()]);
  return attachOccupancy(rooms, customers);
}

export function attachOccupancy(rooms, customers) {
  const byRoom = new Map();
  for (const customer of customers) {
    if (customer.status !== 'active' || !customer.roomId) continue;
    const list = byRoom.get(customer.roomId) ?? [];
    list.push({ customerId: customer.id, name: customer.name, bedNo: customer.bedNo });
    byRoom.set(customer.roomId, list);
  }

  return rooms.map((room) => {
    const occupants = byRoom.get(room.id) ?? [];
    const capacity = room.sharingType;
    const occupied = occupants.length;
    return {
      ...normalizeRoom(room),
      capacity,
      occupied,
      vacant: Math.max(capacity - occupied, 0),
      occupants,
    };
  });
}

// ------------------------------------------------------------------ writes

export async function createRoom(input) {
  return normalizeRoom(await insertRow(TABLES.rooms, normalizeRoom(input)));
}

export async function updateRoom(id, patch) {
  return normalizeRoom(await updateRow(TABLES.rooms, id, patch));
}

/** Refuses to delete a room that still has an active tenant. */
export async function deleteRoom(id) {
  const rooms = await listRooms();
  const room = rooms.find((r) => r.id === id);
  if (room && room.occupied > 0) {
    throw new Error(`Room ${room.roomNo} still has ${room.occupied} tenant(s). Move them out first.`);
  }
  const removed = await deleteRow(TABLES.rooms, id);
  if (removed === 0) throw notReturned('delete', TABLES.rooms, id);
  return true;
}

// ---------------------------------------------------------------- roll-ups

export function occupancyTotals(rooms = []) {
  const totalBeds = rooms.reduce((sum, room) => sum + (Number(room.capacity) || 0), 0);
  const occupiedBeds = rooms.reduce((sum, room) => sum + (Number(room.occupied) || 0), 0);
  return {
    totalRooms: rooms.length,
    totalBeds,
    occupiedBeds,
    vacantBeds: Math.max(totalBeds - occupiedBeds, 0),
    fullyVacantRooms: rooms.filter(isFullyVacant).length,
    occupancyPercent: totalBeds ? Math.round((occupiedBeds / totalBeds) * 1000) / 10 : 0,
  };
}

/** Group rooms by floor, ascending, rooms sorted by number. */
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
  return rooms.filter((room) => room.sharingType === wanted && hasVacancy(room));
}
