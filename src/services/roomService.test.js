import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./supabase.js', async () => await import('../test/supabaseFake.js'));

import { resetDatabase } from '../test/supabaseFake.js';
import { startSession } from './authService.js';
import {
  createRoom,
  updateRoom,
  deleteRoom,
  listRooms,
  freeBeds,
  availableRooms,
  effectiveRent,
  occupancyTotals,
  groupByFloor,
  attachOccupancy,
} from './roomService.js';
import { createCustomer } from './customerService.js';

beforeEach(async () => {
  resetDatabase();
  startSession();
});

describe('rooms', () => {
  it('creates and edits rooms with database-generated ids', async () => {
    const room = await createRoom({ floor: 2, roomNo: '201', sharingType: 3 });
    expect(room.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(room.sharingType).toBe(3);
    expect((await listRooms()).find((r) => r.id === room.id).vacant).toBe(3);

    const updated = await updateRoom(room.id, { roomNo: '201A', monthlyRent: 14000 });
    expect(updated.roomNo).toBe('201A');
    expect(updated.monthlyRent).toBe(14000);
  });

  it('occupancy is computed from the active tenants', async () => {
    const room = await createRoom({ floor: 1, roomNo: '101', sharingType: 2 });
    const tenant = await createCustomer({ name: 'A', roomId: room.id, bedNo: '1', sharingType: 2 });

    const rooms = await listRooms();
    expect(rooms[0].occupied).toBe(1);
    expect(rooms[0].vacant).toBe(1);
    expect(rooms[0].occupants).toEqual([{ customerId: tenant.id, name: 'A', bedNo: '1' }]);
    expect(freeBeds(rooms[0])).toEqual([2]);
  });

  it('availableRooms filters by sharing type and vacancy', async () => {
    const triple = await createRoom({ floor: 1, roomNo: '101', sharingType: 3 });
    await createRoom({ floor: 1, roomNo: '102', sharingType: 1 });
    await createCustomer({ name: 'A', roomId: triple.id, bedNo: '1', sharingType: 3 });

    const rooms = await listRooms();
    const options = availableRooms(rooms, 3);
    expect(options).toHaveLength(1);
    expect(availableRooms(rooms, 1)).toHaveLength(1);
  });

  it('deleting an occupied room is refused', async () => {
    const room = await createRoom({ floor: 1, roomNo: '101', sharingType: 2 });
    await createCustomer({ name: 'A', roomId: room.id, bedNo: '1', sharingType: 2 });
    await expect(deleteRoom(room.id)).rejects.toThrow('still has 1 tenant');
  });

  it('deleting an empty room works', async () => {
    const room = await createRoom({ floor: 1, roomNo: '101', sharingType: 2 });
    await deleteRoom(room.id);
    expect(await listRooms()).toHaveLength(0);
  });

  it('effective rent prefers the room override, else the settings price', () => {
    const settings = { sharingPrices: { 3: 13000 } };
    expect(effectiveRent({ monthlyRent: null, sharingType: 3 }, settings)).toBe(13000);
    expect(effectiveRent({ monthlyRent: 14000, sharingType: 3 }, settings)).toBe(14000);
    expect(effectiveRent({ monthlyRent: null, sharingType: 5 }, settings)).toBe(0);
  });

  it('occupancy totals and floor grouping stay consistent', async () => {
    const a = await createRoom({ floor: 1, roomNo: '101', sharingType: 2 });
    await createRoom({ floor: 2, roomNo: '201', sharingType: 1 });
    await createCustomer({ name: 'A', roomId: a.id, bedNo: '1', sharingType: 2 });

    const rooms = await listRooms();
    const totals = occupancyTotals(rooms);
    expect(totals.totalBeds).toBe(3);
    expect(totals.occupiedBeds).toBe(1);
    expect(totals.vacantBeds).toBe(2);
    expect(totals.occupancyPercent).toBeCloseTo(33.3, 1);

    const floors = groupByFloor(rooms);
    expect(floors.map((f) => f.floor)).toEqual([1, 2]);
    expect(floors[0].rooms[0].roomNo).toBe('101');
  });

  it('attachOccupancy ignores vacated tenants', () => {
    const rooms = [{ id: 'r1', roomNo: '101', sharingType: 2, monthlyRent: null, notes: '', floor: 1 }];
    const customers = [
      { id: 'c1', status: 'active', roomId: 'r1', name: 'A', bedNo: '1' },
      { id: 'c2', status: 'vacated', roomId: 'r1', name: 'B', bedNo: '2' },
    ];
    const [room] = attachOccupancy(rooms, customers);
    expect(room.occupied).toBe(1);
    expect(room.occupants[0].name).toBe('A');
  });
});
