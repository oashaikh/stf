import { getTaxBands } from './taxBands.js';
import { taxYearPeriod } from './taxYearSummary.js';

export type VehicleType = 'car' | 'motorcycle' | 'bicycle';

export interface MileageTrip {
  id: string;
  date: string; // YYYY-MM-DD
  createdAt: string; // ISO timestamp, breaks ties between trips on the same date
  vehicleType: VehicleType;
  distanceTenths: number; // whole tenths of a mile
}

export interface MileageClaim {
  totalPence: number;
  tripClaims: Array<{ id: string; claimPence: number }>;
}

// Rates are pence per mile and distances are tenths of a mile, so rate x tenths is tenths of a penny.
const roundToPence = (tenthsOfPenny: number) => Math.floor((tenthsOfPenny + 5) / 10);

/**
 * Simplified-mileage claim for one tax year, integer arithmetic only. Cars and vans share the
 * annual threshold, which runs through trips in date order so one trip can straddle it.
 * The claim is rounded to pence on the running total, so the per-trip figures add up to the total.
 */
export function calculateMileageClaim(trips: MileageTrip[], taxYear: string): MileageClaim {
  const bands = getTaxBands(taxYear);
  const period = taxYearPeriod(taxYear);
  if (!period) throw new Error(`Invalid tax year: ${taxYear}`);

  const inYear = trips
    .filter((trip) => trip.date >= period.start && trip.date <= period.end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  let carTenthsSoFar = 0;
  let runningTenthsOfPenny = 0;
  let runningPence = 0;
  const tripClaims = inYear.map((trip) => {
    let tenthsOfPenny: number;
    if (trip.vehicleType === 'car') {
      const atFirstRate = Math.max(0, Math.min(trip.distanceTenths, bands.mileageCarThresholdTenths - carTenthsSoFar));
      tenthsOfPenny = atFirstRate * bands.mileageCarFirstRate + (trip.distanceTenths - atFirstRate) * bands.mileageCarAfterRate;
      carTenthsSoFar += trip.distanceTenths;
    } else {
      const rate = trip.vehicleType === 'motorcycle' ? bands.mileageMotorcycleRate : bands.mileageBicycleRate;
      tenthsOfPenny = trip.distanceTenths * rate;
    }
    runningTenthsOfPenny += tenthsOfPenny;
    const claimPence = roundToPence(runningTenthsOfPenny) - runningPence;
    runningPence += claimPence;
    return { id: trip.id, claimPence };
  });

  return { totalPence: runningPence, tripClaims };
}
