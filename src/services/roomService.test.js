import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./supabase.js', async () => await import('../test/supabaseFake.js'));

import { resetDatabase } from '../test/supabaseFake.js';
import {
  listRooms,
  createRoom,
  updateRoom,
  deleteRoom,
  admitCustomer,
  moveCustomer,
  giveNotice,
  vacateCustomer,
  listRoomHistory,
  freeBeds,
  isFullyVacant,
  hasVacancy,
  effectiveRent,
  calculateRefund,
  availableRooms,
  occupancyTotals,
  groupByFloor,
} from './roomService.js';
import { listCustomers, getCustomer } from './customerService.js';
import { listTransactions } from './transactionService.js';
import { getOpenCycle, ensureOpenCycle } from './cycleService.js';
import { getRemaining, TX_REFUND } from '../utils/ledger.js';

/**
 * Room and lifecycle behaviour, driven through the real service layer over the
 * in-memory backend. The point of these tests is the guarantees the UI cannot
 * make on its own: capacity is never exceeded, a bed is never double-booked, a
 * notice tenant still holds their bed, and a checkout frees exactly one bed and
 * writes exactly one refund.
 */

// Shape matches Settings: prices are keyed by sharing type, not by a flat field.
const SETTINGS = { sharingPrices: { 1: 6000, 2: 5000, 3: 11500, 4: 15000, 5: 0 } };

async function makeRoom(overrides = {}) {
  return createRoom({ floor: 1, roomNo: '101', sharingType: 3, ...overrides });
}

async function admit(room, overrides = {}) {
  return admitCustomer(
    {
      name: 'Asha Rao',
      mobile: '9000000001',
      joiningDate: '2025-01-01',
      rentAmount: 0,
      sharingType: room.sharingType,
      ...overrides,
    },
    room.id,
    overrides.bedNo ?? '',
  );
}

beforeEach(async () => {
  await resetDatabase();
});

describe('room occupancy maths', () => {
  it('derives vacant beds from the sharing type', () => {
    const room = { capacity: 3, sharingType: 3, vacant: 3, occupied: 0, occupants: [] };
    expect(hasVacancy(room)).toBe(true);
    expect(isFullyVacant(room)).toBe(true);
    expect(freeBeds(room)).toEqual([1, 2, 3]);
  });

  it('treats the room rent override as winning over the settings price', () => {
    expect(effectiveRent({ monthlyRent: 7200 }, SETTINGS)).toBe(7200);
    // Null means "inherit", so the 3-sharing price from settings applies.
    expect(effectiveRent({ monthlyRent: null, sharingType: 3 }, SETTINGS)).toBe(11500);
  });

  it('only offers rooms that match the sharing type and still have space', () => {
    const rooms = [
      { id: 'a', isActive: true, sharingType: 3, vacant: 1, capacity: 3, occupants: [] },
      { id: 'b', isActive: true, sharingType: 3, vacant: 0, capacity: 3, occupants: [{ bedNo: 1 }, { bedNo: 2 }, { bedNo: 3 }] },
      { id: 'c', isActive: true, sharingType: 2, vacant: 2, capacity: 2, occupants: [] },
    ];
    // Only rooms whose sharing type matches, and only those with a free bed.
    expect(availableRooms(rooms, 3).map((r) => r.id)).toEqual(['a']);
    // 'a' is a 3-sharing, so it is not offered to a 2-sharing tenant.
    expect(availableRooms(rooms, 2).map((r) => r.id)).toEqual(['c']);
  });

  it('totals and groups by floor', () => {
    const rooms = [
      { isActive: true, floor: 0, capacity: 3, occupied: 2, occupants: [{ bedNo: 1 }, { bedNo: 2 }] },
      { isActive: true, floor: 1, capacity: 2, occupied: 0, occupants: [] },
    ];
    const totals = occupancyTotals(rooms);
    expect(totals.totalBeds).toBe(5);
    expect(totals.vacantBeds).toBe(3);
    expect(groupByFloor(rooms).map((g) => g.floor)).toEqual([0, 1]);
  });
});

describe('admission', () => {
  it('places a tenant, records history and fills occupancy', async () => {
    const room = await makeRoom();
    const result = await admit(room, { bedNo: 2 });

    expect(result.occupied).toBe(1);
    expect(result.capacity).toBe(3);

    const [fresh] = await listRooms();
    expect(fresh.occupied).toBe(1);
    expect(fresh.vacant).toBe(2);
    expect(freeBeds(fresh)).toEqual([1, 3]);

    const history = await listRoomHistory(result.customerId);
    expect(history).toHaveLength(1);
    expect(history[0].bedNo).toBe(2);
    expect(history[0].toDate).toBeNull();
  });

  it('prices the tenant from the room, not the submitted figure', async () => {
    const room = await makeRoom({ monthlyRent: 9400 });
    const result = await admit(room, { rentAmount: 1 });
    const customer = await getCustomer(result.customerId);
    expect(customer.rentAmount).toBe(9400);
  });

  it('refuses to overfill a room', async () => {
    const room = await makeRoom({ sharingType: 1 });
    await admit(room, { name: 'First' });
    await expect(admit(room, { name: 'Second' })).rejects.toThrow(/now full/i);
  });

  it('refuses to double-book a bed', async () => {
    const room = await makeRoom();
    await admit(room, { name: 'First', bedNo: 1 });
    await expect(admit(room, { name: 'Second', bedNo: 1 })).rejects.toThrow(/just taken/i);
  });
});

describe('notice', () => {
  it('keeps the tenant occupying their bed', async () => {
    const room = await makeRoom();
    const { customerId } = await admit(room);

    await giveNotice(customerId, '2025-03-31', 'moving to a hostel');

    const customer = await getCustomer(customerId);
    expect(customer.status).toBe('notice');
    expect(customer.expectedLeavingDate).toBe('2025-03-31');

    // Still occupying: a notice is not a checkout.
    const [fresh] = await listRooms();
    expect(fresh.occupied).toBe(1);
    expect(fresh.vacant).toBe(2);
  });
});

describe('move', () => {
  it('frees the old bed and fills the new one, and closes the history range', async () => {
    const first = await makeRoom({ roomNo: '101' });
    const second = await makeRoom({ roomNo: '102' });
    const { customerId } = await admit(first, { bedNo: 1 });

    await moveCustomer(customerId, second.id, 2);

    const rooms = await listRooms();
    expect(rooms.find((r) => r.id === first.id).vacant).toBe(3);
    expect(rooms.find((r) => r.id === second.id).occupied).toBe(1);

    const history = await listRoomHistory(customerId);
    expect(history).toHaveLength(2);
    const closed = history.find((h) => h.toDate !== null);
    expect(closed.bedNo).toBe(1);
    expect(history.find((h) => h.toDate === null).bedNo).toBe(2);
  });

  it('refuses to move into a full room', async () => {
    const source = await makeRoom({ roomNo: '101' });
    const tiny = await makeRoom({ roomNo: '102', sharingType: 1 });
    // Fill the single bed in `tiny` with someone else, then try to move our
    // tenant (who is in `source`) into it.
    await admit(tiny, { name: 'Occupant' });
    const { customerId } = await admit(source, { name: 'Mover' });

    await expect(moveCustomer(customerId, tiny.id, 1)).rejects.toThrow(/now full/i);
  });
});

describe('checkout and refund', () => {
  it('calculates the refund as deposit minus dues minus damage', () => {
    expect(calculateRefund({ depositAmount: 10000, pendingRent: 4000 })).toBe(6000);
    expect(calculateRefund({ depositAmount: 10000, pendingRent: 4000, damageCharges: 1500 })).toBe(4500);
    // Never negative: the tenant owes the difference instead.
    expect(calculateRefund({ depositAmount: 5000, pendingRent: 9000 })).toBe(0);
  });

  it('vacates the tenant, frees the bed and records one refund', async () => {
    // A real rent so there is genuine outstanding rent to deduct from the
    // deposit - a zero-rent cycle would make the refund maths vacuous.
    const room = await makeRoom({ monthlyRent: 5000 });
    const { customerId } = await admit(room, { bedNo: 1, depositAmount: 11000 });
    const customer = await getCustomer(customerId);
    await ensureOpenCycle(customer);

    const pendingRent = getRemaining(await getOpenCycle(customerId));
    expect(pendingRent).toBe(5000);
    await vacateCustomer({
      customerId,
      pendingRent,
      pendingBill: 0,
      damageCharges: 1000,
      refundAmount: calculateRefund({
        depositAmount: customer.depositAmount,
        pendingRent,
        damageCharges: 1000,
      }),
      refundMode: 'cash',
    });

    const vacated = await getCustomer(customerId);
    expect(vacated.status).toBe('vacated');
    expect(vacated.vacatedAt).toBeTruthy();
    expect(vacated.damageCharges).toBe(1000);

    // Bed released.
    const [fresh] = await listRooms();
    expect(fresh.occupied).toBe(0);
    expect(fresh.vacant).toBe(3);
    expect(isFullyVacant(fresh)).toBe(true);

    const history = await listRoomHistory(customerId);
    expect(history.every((h) => h.toDate !== null)).toBe(true);

    const refunds = (await listTransactions()).filter((tx) => tx.type === TX_REFUND);
    expect(refunds).toHaveLength(1);
    // 11000 deposit - 5000 unpaid rent - 1000 damage.
    expect(refunds[0].amount).toBe(5000);
    expect(refunds[0].note).toMatch(/damage 1000/);
    expect(vacated.depositRefund).toBe(5000);
  });

  it('vacated tenants stop being counted as occupants', async () => {
    const room = await makeRoom();
    const { customerId } = await admit(room);
    await vacateCustomer({ customerId, pendingRent: 0, refundAmount: 0 });

    const active = (await listCustomers()).filter((c) => c.status === 'active');
    expect(active).toHaveLength(0);
  });
});

describe('room deletion', () => {
  it('refuses to delete an occupied room', async () => {
    const room = await makeRoom();
    await admit(room);
    await expect(deleteRoom(room.id)).rejects.toThrow(/still has/i);
  });

  it('deletes a vacant room', async () => {
    const room = await makeRoom();
    await deleteRoom(room.id);
    expect(await listRooms()).toHaveLength(0);
  });
});

describe('room updates', () => {
  it('keeps a null rent as null so the settings price still applies', async () => {
    const room = await makeRoom({ monthlyRent: 8000 });
    const updated = await updateRoom(room.id, { monthlyRent: null, notes: 'near lift' });
    expect(updated.monthlyRent).toBeNull();
    expect(updated.notes).toBe('near lift');
    expect(effectiveRent(updated, SETTINGS)).toBe(SETTINGS.sharingPrices[updated.sharingType]);
  });
});
