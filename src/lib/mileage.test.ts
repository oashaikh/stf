import { describe, expect, it } from 'vitest';
import { calculateMileageClaim, type MileageTrip } from './mileage';

let counter = 0;
const trip = (date: string, miles: number, vehicleType: MileageTrip['vehicleType'] = 'car'): MileageTrip => {
  counter += 1;
  return { id: `t${counter}`, date, createdAt: `2026-01-01T00:00:${String(counter % 60).padStart(2, '0')}Z`, vehicleType, distanceTenths: Math.round(miles * 10) };
};

describe('calculateMileageClaim', () => {
  it('pays 45p a mile below the threshold', () => {
    expect(calculateMileageClaim([trip('2026-05-01', 100)], '2026-27').totalPence).toBe(4500);
  });

  it('handles fractional miles, rounding to pence at the end', () => {
    expect(calculateMileageClaim([trip('2026-05-01', 12.4)], '2026-27').totalPence).toBe(558);
    expect(calculateMileageClaim([trip('2026-05-01', 0.1)], '2026-27').totalPence).toBe(5); // 4.5p rounds up
  });

  it('pays 45p for exactly 10,000 miles', () => {
    expect(calculateMileageClaim([trip('2026-05-01', 10000)], '2026-27').totalPence).toBe(450000);
  });

  it('splits a trip that straddles the threshold', () => {
    const first = trip('2026-05-01', 9990);
    const second = trip('2026-05-02', 20);
    const result = calculateMileageClaim([first, second], '2026-27');
    expect(result.tripClaims).toEqual([
      { id: first.id, claimPence: 449550 },
      { id: second.id, claimPence: 10 * 45 + 10 * 25 },
    ]);
    expect(result.totalPence).toBe(449550 + 700);
  });

  it('pays 25p for trips after the threshold', () => {
    const result = calculateMileageClaim([trip('2026-05-01', 10000), trip('2026-05-02', 100)], '2026-27');
    expect(result.tripClaims[1].claimPence).toBe(2500);
  });

  it('keeps per-trip claims summing to the total', () => {
    const trips = [trip('2026-05-01', 0.1), trip('2026-05-02', 0.1), trip('2026-05-03', 0.3)];
    const result = calculateMileageClaim(trips, '2026-27');
    expect(result.tripClaims.reduce((sum, t) => sum + t.claimPence, 0)).toBe(result.totalPence);
  });

  it('pays flat rates for motorcycles and bicycles without using the car threshold', () => {
    const result = calculateMileageClaim(
      [trip('2026-05-01', 20000, 'motorcycle'), trip('2026-05-02', 20000, 'bicycle'), trip('2026-05-03', 100)],
      '2026-27',
    );
    expect(result.tripClaims.map((t) => t.claimPence)).toEqual([480000, 400000, 4500]);
  });

  it('counts 5 April in the old year and 6 April in the new year, restarting the threshold', () => {
    const trips = [trip('2026-04-05', 10000), trip('2026-04-06', 100)];
    expect(calculateMileageClaim(trips, '2025-26').totalPence).toBe(450000);
    expect(calculateMileageClaim(trips, '2026-27').totalPence).toBe(4500);
  });

  it('throws for a year with no rates', () => {
    expect(() => calculateMileageClaim([], '2019-20')).toThrow('Tax bands not found');
  });

  it('gives the same answer whatever order the trips arrive in', () => {
    const trips = [trip('2026-06-01', 6000), trip('2026-05-01', 5000), trip('2026-07-01', 1000)];
    const forward = calculateMileageClaim(trips, '2026-27');
    const backward = calculateMileageClaim([...trips].reverse(), '2026-27');
    expect(backward.totalPence).toBe(forward.totalPence);
    expect(backward.totalPence).toBe(10000 * 45 + 2000 * 25);
  });
});
