import type { MileageClaim, VehicleType } from './mileage';

export type { VehicleType };

export interface ApiTrip {
  id: string;
  date: string;
  from: string;
  to: string;
  purpose: string;
  distanceTenths: number;
  vehicleType: VehicleType;
  deletedAt: string | null;
}

export type NewTripRequest = Pick<ApiTrip, 'date' | 'from' | 'to' | 'purpose' | 'distanceTenths' | 'vehicleType'>;

export const mileageQueryKey = (taxYear: string) => ['mileage', taxYear];

/** Parses "12.4" into 124 tenths of a mile with string maths, so no float ever holds a distance. */
export function parseMilesToTenths(input: string): number | null {
  const match = /^(\d{1,4})(?:\.(\d))?$/.exec(input.trim());
  if (!match) return null;
  const tenths = Number(match[1]) * 10 + Number(match[2] ?? 0);
  return tenths > 0 ? tenths : null;
}

export const formatMiles = (tenths: number) => `${Math.floor(tenths / 10)}.${tenths % 10}`;

async function refusalMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return typeof body.error === 'string' ? body.error : fallback;
}

export async function fetchMileage(taxYear: string): Promise<{ trips: ApiTrip[]; claim: MileageClaim }> {
  const response = await fetch(`/api/mileage?${new URLSearchParams({ taxYear })}`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not load mileage');
  const body = await response.json();
  return { trips: body.trips, claim: body.claim };
}

export async function addTrip(trip: NewTripRequest): Promise<void> {
  const response = await fetch('/api/mileage', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trip),
  });
  if (!response.ok) throw new Error(await refusalMessage(response, 'Could not save the trip. Please try again.'));
}

export async function voidTrip(id: string): Promise<void> {
  const response = await fetch('/api/mileage', {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) throw new Error(await refusalMessage(response, 'Could not void the trip. Please try again.'));
}
