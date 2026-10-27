import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { formatDate } from '../lib/dates';
import {
  addTrip,
  fetchMileage,
  formatMiles,
  mileageQueryKey,
  parseMilesToTenths,
  voidTrip,
  type ApiTrip,
  type NewTripRequest,
  type VehicleType,
} from '../lib/mileageApi';
import { formatPence } from '../lib/money';
import { currentTaxYear, TAX_BANDS } from '../lib/taxBands';

// Newest first, only years that have rates to claim with.
const TAX_YEARS = Object.keys(TAX_BANDS).sort().reverse();

const VEHICLE_LABELS: Record<VehicleType, string> = { car: 'Car or van', motorcycle: 'Motorcycle', bicycle: 'Bicycle' };

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const buttonClass = `min-h-11 rounded-md border border-gray-400 bg-white px-4 text-gray-900 hover:bg-gray-100 disabled:opacity-60 ${focusRing}`;
const inputClass = `min-h-11 w-full rounded border border-gray-400 px-2 text-gray-900 ${focusRing}`;

// A native modal dialog gives the focus trap and Escape-to-close; nothing is sent until the footer button is pressed.
function VoidTripDialog({ trip, claimPence, error, onCancel, onVoid }: { trip: ApiTrip; claimPence: number; error?: string; onCancel: () => void; onVoid: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`void-trip-title-${trip.id}`}
      onClose={onCancel}
      className="w-full max-w-md flex-col rounded p-0 open:flex backdrop:bg-black/50"
    >
      <div className="p-6">
        <h3 id={`void-trip-title-${trip.id}`} className="text-lg font-semibold text-gray-900">
          Void this trip?
        </h3>
        <p className="mt-3 text-gray-900">
          {formatDate(trip.date)}, {trip.from} to {trip.to}, {formatMiles(trip.distanceTenths)} miles
        </p>
        <p className="mt-3 text-sm text-gray-700">
          The trip stays on record, marked voided. Your mileage claim drops by {formatPence(claimPence)}, and later car trips this tax
          year may be claimed at a different rate.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-800">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-3 border-t border-gray-200 p-4">
        <button type="button" onClick={onCancel} className={buttonClass}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onVoid}
          className={`min-h-11 rounded-md bg-red-800 px-4 text-white hover:bg-red-900 ${focusRing}`}
        >
          Void trip
        </button>
      </div>
    </dialog>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-gray-700">
      {label}
      {children}
      {error && <span className="text-sm text-red-800">{error}</span>}
    </label>
  );
}

const emptyForm = { date: '', from: '', to: '', purpose: '', miles: '', vehicleType: 'car' as VehicleType };

function AddTripForm({ taxYear }: { taxYear: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (trip: NewTripRequest) => addTrip(trip),
    onSuccess: () => {
      setForm(emptyForm);
      // The tax year summary feeds from the same trips.
      return queryClient.invalidateQueries({ queryKey: ['mileage'] });
    },
  });
  const set = (field: keyof typeof emptyForm) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const distanceTenths = parseMilesToTenths(form.miles);
    const found: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) found.date = 'Enter the date of the trip';
    if (!form.from.trim()) found.from = 'Enter where the trip started';
    if (!form.to.trim()) found.to = 'Enter where the trip ended';
    if (!form.purpose.trim()) found.purpose = 'Enter the business purpose';
    if (distanceTenths === null) found.miles = 'Enter miles as a number with at most one decimal, such as 12.4';
    setErrors(found);
    if (distanceTenths === null || Object.keys(found).length > 0) return;
    save.mutate({
      date: form.date,
      from: form.from.trim(),
      to: form.to.trim(),
      purpose: form.purpose.trim(),
      distanceTenths,
      vehicleType: form.vehicleType,
    });
  }

  return (
    <form onSubmit={submit} noValidate aria-label={`Add a trip for ${taxYear}`} className="mt-4 grid grid-cols-1 items-start gap-3 md:grid-cols-3">
      <Field label="Date" error={errors.date}>
        <input type="date" className={inputClass} value={form.date} onChange={set('date')} />
      </Field>
      <Field label="From" error={errors.from}>
        <input type="text" className={inputClass} value={form.from} onChange={set('from')} />
      </Field>
      <Field label="To" error={errors.to}>
        <input type="text" className={inputClass} value={form.to} onChange={set('to')} />
      </Field>
      <Field label="Purpose" error={errors.purpose}>
        <input type="text" className={inputClass} value={form.purpose} onChange={set('purpose')} />
      </Field>
      <Field label="Miles" error={errors.miles}>
        <input type="text" inputMode="decimal" className={`${inputClass} text-right tabular-nums`} value={form.miles} onChange={set('miles')} />
      </Field>
      <Field label="Vehicle type">
        <select className={inputClass} value={form.vehicleType} onChange={set('vehicleType')}>
          {Object.entries(VEHICLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <div className="md:col-span-3">
        <button type="submit" disabled={save.isPending} className={buttonClass}>
          Add trip
        </button>
        {save.isError && (
          <p role="alert" className="mt-2 text-sm text-red-800">
            {save.error.message}
          </p>
        )}
      </div>
    </form>
  );
}

export default function MileageSection() {
  const queryClient = useQueryClient();
  const thisYear = currentTaxYear();
  const [taxYear, setTaxYear] = useState(TAX_YEARS.includes(thisYear) ? thisYear : TAX_YEARS[0]);
  const [voiding, setVoiding] = useState<ApiTrip | null>(null);
  const mileage = useQuery({ queryKey: mileageQueryKey(taxYear), queryFn: () => fetchMileage(taxYear) });
  const voidMutation = useMutation({
    mutationFn: (id: string) => voidTrip(id),
    onSuccess: () => {
      setVoiding(null);
      return queryClient.invalidateQueries({ queryKey: ['mileage'] });
    },
  });

  const trips = mileage.data?.trips ?? [];
  const claimFor = (id: string) => mileage.data?.claim.tripClaims.find((tripClaim) => tripClaim.id === id)?.claimPence ?? 0;
  const claimedTenths = trips.filter((trip) => !trip.deletedAt).reduce((sum, trip) => sum + trip.distanceTenths, 0);

  return (
    <section aria-labelledby="mileage-heading" className="mt-10">
      <h2 id="mileage-heading" className="text-xl font-semibold text-gray-900">
        Mileage
      </h2>
      <p className="mt-2 text-sm text-gray-700">
        Simplified mileage replaces actual running costs: if you claim it for a vehicle, you cannot also claim fuel, insurance or repairs
        for that vehicle.
      </p>

      <label className="mt-4 flex flex-col gap-1 text-sm text-gray-700">
        Mileage tax year
        <select className={`min-h-11 w-fit rounded border border-gray-400 px-2 text-gray-900 ${focusRing}`} value={taxYear} onChange={(event) => setTaxYear(event.target.value)}>
          {TAX_YEARS.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </label>

      {mileage.isPending && <p role="status" className="mt-4 text-gray-700">Loading mileage…</p>}
      {mileage.isError && (
        <p role="alert" className="mt-4 text-red-800">
          Could not load mileage. Please try again.
        </p>
      )}

      {mileage.data && (
        <>
          <dl className="mt-4 flex gap-8 rounded-lg border border-gray-200 bg-white p-4 md:max-w-xl">
            <div>
              <dt className="text-sm text-gray-700">Claim for {taxYear}</dt>
              <dd className="text-lg font-medium tabular-nums text-gray-900">{formatPence(mileage.data.claim.totalPence)}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-700">Miles</dt>
              <dd className="text-lg font-medium tabular-nums text-gray-900">{formatMiles(claimedTenths)}</dd>
            </div>
          </dl>

          <AddTripForm taxYear={taxYear} />

          {trips.length === 0 ? (
            <p className="mt-6 text-gray-700">No trips recorded for {taxYear} yet.</p>
          ) : (
            <ul className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
              {trips.map((trip) => (
                <li key={trip.id} className="grid grid-cols-1 items-center gap-2 p-3 md:grid-cols-[8rem_1fr_6rem_8rem_auto]">
                  <span className="text-gray-900">{formatDate(trip.date)}</span>
                  <span className="truncate text-gray-900" title={`${trip.from} to ${trip.to}: ${trip.purpose}`}>
                    {trip.from} to {trip.to}, {trip.purpose}
                  </span>
                  <span className="tabular-nums text-gray-700 md:text-right">{formatMiles(trip.distanceTenths)} mi</span>
                  <span className="tabular-nums text-gray-900 md:text-right">
                    {trip.deletedAt ? 'Voided' : formatPence(claimFor(trip.id))}
                  </span>
                  {trip.deletedAt ? (
                    <span className="inline-block w-fit rounded bg-gray-100 px-2 py-1 text-sm text-gray-800">Voided</span>
                  ) : (
                    <button type="button" className={buttonClass} onClick={() => setVoiding(trip)} aria-label={`Void trip ${trip.from} to ${trip.to} on ${formatDate(trip.date)}`}>
                      Void
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {voiding && (
        <VoidTripDialog
          trip={voiding}
          claimPence={claimFor(voiding.id)}
          error={voidMutation.error?.message}
          onCancel={() => setVoiding(null)}
          onVoid={() => voidMutation.mutate(voiding.id)}
        />
      )}
    </section>
  );
}
