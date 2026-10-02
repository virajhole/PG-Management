import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./supabase.js', async () => await import('../test/supabaseFake.js'));

import { resetDatabase } from '../test/supabaseFake.js';
import { seedSampleData, buildSampleRooms, buildSampleCustomers } from './seedService.js';
import { listCustomers } from './customerService.js';
import { listRooms, getUpcomingVacates, occupancyTotals, listRoomHistory } from './roomService.js';

beforeEach(async () => {
  await resetDatabase();
});

describe('seed data', () => {
  it('builds rooms across several floors', () => {
    const rooms = buildSampleRooms();
    expect(rooms.length).toBeGreaterThan(5);
    expect(new Set(rooms.map((r) => r.floor)).size).toBeGreaterThan(1);
    // Most rooms inherit the Settings price; one demonstrates an override.
    expect(rooms.filter((r) => r.monthlyRent === null).length).toBeGreaterThan(1);
    expect(rooms.some((r) => typeof r.monthlyRent === 'number')).toBe(true);
  });

  it('gives every sample customer a room that exists', () => {
    const roomNumbers = new Set(buildSampleRooms().map((r) => r.roomNo));
    for (const customer of buildSampleCustomers()) {
      expect(roomNumbers.has(customer.roomNo)).toBe(true);
    }
  });

  it('seeds rooms, admits every tenant and leaves a spare bed', async () => {
    await seedSampleData();

    const customers = await listCustomers();
    expect(customers).toHaveLength(6);

    const rooms = await listRooms();
    const beds = occupancyTotals(rooms);
    expect(beds.totalRooms).toBe(10);
    // Six tenants placed, so some capacity must remain for the admission picker.
    expect(beds.occupiedBeds).toBe(6);
    expect(beds.vacantBeds).toBe(beds.totalBeds - 6);
    expect(beds.vacantBeds).toBeGreaterThan(0);
  });

  it('puts every seeded tenant in a real bed with history', async () => {
    const created = await seedSampleData();
    for (const customer of created) {
      expect(customer.roomId).toBeTruthy();
      expect(customer.roomNo).toBeTruthy();
      const history = await listRoomHistory(customer.id);
      expect(history).toHaveLength(1);
    }
  });

  it('leaves the notice tenant counted as an occupant', async () => {
    await seedSampleData();

    const leaving = await getUpcomingVacates(30);
    expect(leaving).toHaveLength(1);
    expect(leaving[0].name).toBe('Sneha Patil');

    // A tenant on notice still holds her bed.
    const rooms = await listRooms();
    const room405 = rooms.find((r) => r.roomNo === '405');
    expect(room405.occupied).toBe(1);
    expect(room405.vacant).toBe(3);
  });
});
