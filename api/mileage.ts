import { withAuth, type AuthDeps } from './_lib/auth.js';
import { parseTaxYearPeriod } from './_lib/taxYearSummary.js';
import { databaseMileageStore, listTrips, MileageLimitError, validateNewTrip, validateTripId, type MileageStore } from './_lib/mileage.js';
import { calculateMileageClaim } from '../src/lib/mileage.js';
import { TAX_BANDS } from '../src/lib/taxBands.js';

const refuse = (status: number, error: string, code: string) => Response.json({ ok: false, error, code }, { status });

export function createMileageHandler(store: MileageStore = databaseMileageStore, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      const taxYear = params.get('taxYear') ?? '';
      const period = parseTaxYearPeriod(params);
      if (!period || !(taxYear in TAX_BANDS)) return refuse(400, 'taxYear must be a supported tax year such as 2026-27', 'BAD_REQUEST');
      try {
        const trips = await listTrips(store, auth.userId, period);
        // Voided trips stay listed but never count toward the claim or the mileage threshold.
        const claim = calculateMileageClaim(
          trips.filter((trip) => !trip.deletedAt),
          taxYear,
        );
        return Response.json({ ok: true, trips, claim });
      } catch (error) {
        if (error instanceof MileageLimitError) return refuse(413, error.message, 'TOO_MANY_TRIPS');
        throw error;
      }
    }

    if (request.method === 'POST') {
      const newTrip = validateNewTrip(await request.json().catch(() => null));
      if (!newTrip) return refuse(400, 'Trip needs a real date, from, to, purpose, distance in tenths of a mile and a vehicle type', 'BAD_REQUEST');
      return Response.json({ ok: true, trip: await store.insert(auth.userId, newTrip) });
    }

    if (request.method === 'PATCH' || request.method === 'DELETE') {
      const id = validateTripId(await request.json().catch(() => null));
      if (!id) return refuse(400, 'Trip id must be a uuid', 'BAD_REQUEST');
      const trip = await store.void(auth.userId, id);
      if (!trip) return refuse(404, 'Trip not found', 'NOT_FOUND');
      return Response.json({ ok: true, trip });
    }

    return refuse(405, 'Method not allowed', 'METHOD');
  }, authDeps);
}

export default { fetch: createMileageHandler() };
