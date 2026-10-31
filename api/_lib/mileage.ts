import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';

import { mileageTrips } from '../../server/src/db/schema.js';
import type { DatePeriod } from '../../src/lib/dashboardSummary.js';
import type { VehicleType } from '../../src/lib/mileage.js';
import { db } from './db.js';
import { hasControlCharacters } from './inputRules.js';

/** One tax year of trips is far below this; the store reads one extra row to detect overflow. */
export const MILEAGE_TRIP_LIMIT = 2000;

const VEHICLE_TYPES: VehicleType[] = ['car', 'motorcycle', 'bicycle'];
const MAX_TEXT_LENGTH = 200;
// 5,000 miles in one trip, in tenths of a mile.
const MAX_DISTANCE_TENTHS = 50_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Explicit columns only (SEC-12): no user_id in responses. distanceTenths is whole tenths of a mile. */
export interface StoredTrip {
  id: string;
  date: string;
  from: string;
  to: string;
  purpose: string;
  distanceTenths: number;
  vehicleType: VehicleType;
  createdAt: string;
  deletedAt: string | null;
}

export type NewTrip = Pick<StoredTrip, 'date' | 'from' | 'to' | 'purpose' | 'distanceTenths' | 'vehicleType'>;

// Injected so tests never touch a database. Every call is scoped by userId from the session.
export interface MileageStore {
  /** Trips in the period, voided ones included (flagged by deletedAt), at most `limit` rows. */
  list(userId: string, period: DatePeriod, limit: number): Promise<StoredTrip[]>;
  insert(userId: string, trip: NewTrip): Promise<StoredTrip>;
  /** Soft-deletes the trip. Undefined when no live row matches (id, userId). */
  void(userId: string, id: string): Promise<StoredTrip | undefined>;
}

const cleanText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= MAX_TEXT_LENGTH && !hasControlCharacters(text) ? text : null;
};

const isRealDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
};

/** Returns the clean trip, or null for anything the client should not have sent. Ignores unknown keys such as userId. */
export function validateNewTrip(body: unknown): NewTrip | null {
  if (typeof body !== 'object' || body === null) return null;
  const input = body as Record<string, unknown>;
  const from = cleanText(input.from);
  const to = cleanText(input.to);
  const purpose = cleanText(input.purpose);
  const { date, distanceTenths, vehicleType } = input;
  if (!isRealDate(date) || !from || !to || !purpose) return null;
  if (!Number.isInteger(distanceTenths) || (distanceTenths as number) < 1 || (distanceTenths as number) > MAX_DISTANCE_TENTHS) return null;
  if (!VEHICLE_TYPES.includes(vehicleType as VehicleType)) return null;
  return { date, from, to, purpose, distanceTenths: distanceTenths as number, vehicleType: vehicleType as VehicleType };
}

export const validateTripId = (body: unknown): string | null => {
  const id = (body as { id?: unknown } | null)?.id;
  return typeof id === 'string' && UUID.test(id) ? id : null;
};

export class MileageLimitError extends Error {}

export async function listTrips(store: MileageStore, userId: string, period: DatePeriod): Promise<StoredTrip[]> {
  const trips = await store.list(userId, period, MILEAGE_TRIP_LIMIT + 1);
  if (trips.length > MILEAGE_TRIP_LIMIT) throw new MileageLimitError('Too many trips for one tax year');
  return trips;
}

const tripColumns = {
  id: mileageTrips.id,
  date: mileageTrips.date,
  from: mileageTrips.fromPlace,
  to: mileageTrips.toPlace,
  purpose: mileageTrips.purpose,
  distanceTenths: mileageTrips.miles,
  vehicleType: mileageTrips.vehicleType,
  createdAt: mileageTrips.createdAt,
  deletedAt: mileageTrips.deletedAt,
};

// The database enum says car_van where the claim calculation says car.
const toDatabaseVehicle = (vehicleType: VehicleType) => (vehicleType === 'car' ? 'car_van' : vehicleType);

const toStoredTrip = (
  row: { createdAt: Date; deletedAt: Date | null; vehicleType: 'car_van' | 'motorcycle' | 'bicycle' } & Omit<StoredTrip, 'createdAt' | 'deletedAt' | 'vehicleType'>,
): StoredTrip => ({
  ...row,
  vehicleType: row.vehicleType === 'car_van' ? 'car' : row.vehicleType,
  createdAt: row.createdAt.toISOString(),
  deletedAt: row.deletedAt?.toISOString() ?? null,
});

// Query audit: every query filters on mileage_trips.user_id. List is served by
// mileage_trips_user_date_idx (user_id, date) and carries a LIMIT. Insert returns one row. Void
// updates by primary key plus user_id, only while deleted_at is null, so it touches at most one row.
export const databaseMileageStore: MileageStore = {
  async list(userId, period, limit) {
    const rows = await db
      .select(tripColumns)
      .from(mileageTrips)
      .where(and(eq(mileageTrips.userId, userId), gte(mileageTrips.date, period.start), lte(mileageTrips.date, period.end)))
      .orderBy(asc(mileageTrips.date), asc(mileageTrips.createdAt))
      .limit(limit);
    return rows.map(toStoredTrip);
  },
  async insert(userId, trip) {
    const [row] = await db
      .insert(mileageTrips)
      .values({ userId, date: trip.date, fromPlace: trip.from, toPlace: trip.to, purpose: trip.purpose, miles: trip.distanceTenths, vehicleType: toDatabaseVehicle(trip.vehicleType) })
      .returning(tripColumns);
    return toStoredTrip(row);
  },
  async void(userId, id) {
    const [row] = await db
      .update(mileageTrips)
      .set({ deletedAt: new Date() })
      .where(and(eq(mileageTrips.id, id), eq(mileageTrips.userId, userId), isNull(mileageTrips.deletedAt)))
      .returning(tripColumns);
    return row ? toStoredTrip(row) : undefined;
  },
};
