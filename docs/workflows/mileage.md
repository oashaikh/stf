# Mileage log

Business trips are logged on the Mileage section of the Tax page (`src/pages/MileageSection.tsx`) and claimed at HMRC simplified mileage rates. The route is `api/mileage.ts` (add, list, void); the claim maths is the pure function `calculateMileageClaim` in `src/lib/mileage.ts`.

## Rates and where they live

Rates sit in `src/lib/taxBands.ts`, keyed by tax year, never in components:

| Vehicle | Rate |
| --- | --- |
| Car or van | 45p a mile for the first 10,000 miles in the tax year, 25p after |
| Motorcycle | 24p a mile |
| Bicycle | 20p a mile |

The values are the same for 2024-25, 2025-26 and 2026-27. A new tax year needs a new entry in `TAX_BANDS`.

## Units and rounding

Distance is stored as integer tenths of a mile (12.4 miles is 124), so the threshold is 100,000. Rate times tenths gives tenths of a penny, and the claim is rounded to whole pence on the running total, so per-trip figures add up to the total. No floats hold a distance or an amount.

## Threshold and the 5/6 April rule

The 10,000 mile threshold counts across the whole tax year, 6 April to 5 April inclusive. Car and van trips are taken in date order and one trip can straddle the threshold, part at 45p and part at 25p. A trip on 5 April belongs to the year ending that day; a trip on 6 April starts the next year with the threshold reset. Motorcycle and bicycle trips do not count towards it.

## Voiding

Trips are never deleted. Voiding sets `deleted_at`; the trip stays in the list with a Voided badge and drops out of the claim. Because the threshold runs in date order, voiding an early car trip can move later car trips to a different rate. The void dialog says so.

## Feed into the tax summary

The year's claim is added to the tax year summary as a travel expense (`api/_lib/taxYearSummary.ts`), so it reduces profit in the tax estimate.

## No actual running costs

Simplified mileage replaces actual running costs. If the owner claims it for a vehicle, they cannot also claim fuel, insurance, repairs or similar for that vehicle. The Mileage section shows this caveat; the app does not enforce it against expense entries.
