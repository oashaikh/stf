/**
 * UK Income Tax and NIC bands — STF
 *
 * All thresholds stored as integer pence.
 * Add a new entry for each tax year; never modify historical entries.
 *
 * Sources (checked 26 Oct 2026; rest-of-UK rates, not Scottish):
 *   https://www.gov.uk/income-tax-rates
 *   https://www.gov.uk/self-employed-national-insurance-rates
 *   https://www.gov.uk/national-insurance-rates-letters
 *
 * Scottish bands differ. To add them, key a second record set (e.g. by region
 * and year) and pass it to calculateIncomeTax; the function reads only TaxBands.
 */

export interface TaxBands {
  year: string;           // e.g. '2025-26'
  personalAllowance: number;     // pence
  allowanceTaperLimit: number;   // adjusted net income above which allowance falls £1 per £2, pence
  basicRateLimit: number;        // upper threshold for basic rate, pence
  higherRateLimit: number;       // upper threshold for higher rate, pence
  basicRate: number;             // e.g. 20 (percent)
  higherRate: number;            // e.g. 40
  additionalRate: number;        // e.g. 45
  class2WeeklyFlat: number;      // pence/week (Class 2 NIC)
  class2SmallProfitsThreshold: number; // pence/year
  class4LowerLimit: number;      // pence
  class4UpperLimit: number;      // pence
  class4LowerRate: number;       // percent
  class4UpperRate: number;       // percent
}

export const TAX_BANDS: Record<string, TaxBands> = {
  '2026-27': {
    year: '2026-27',
    personalAllowance: 1257000,
    allowanceTaperLimit: 10000000,
    basicRateLimit: 5027000,
    higherRateLimit: 12514000,
    basicRate: 20,
    higherRate: 40,
    additionalRate: 45,
    class2WeeklyFlat: 365,          // £3.65/week
    class2SmallProfitsThreshold: 710500, // £7,105
    class4LowerLimit: 1257000,
    class4UpperLimit: 5027000,
    class4LowerRate: 6,
    class4UpperRate: 2,
  },
  '2025-26': {
    year: '2025-26',
    personalAllowance: 1257000,     // £12,570
    allowanceTaperLimit: 10000000,  // £100,000
    basicRateLimit: 5027000,        // £50,270
    higherRateLimit: 12514000,      // £125,140
    basicRate: 20,
    higherRate: 40,
    additionalRate: 45,
    class2WeeklyFlat: 345,          // £3.45/week
    class2SmallProfitsThreshold: 1257000, // £12,570
    class4LowerLimit: 1257000,      // £12,570
    class4UpperLimit: 5027000,      // £50,270
    class4LowerRate: 6,
    class4UpperRate: 2,
  },
  '2024-25': {
    year: '2024-25',
    personalAllowance: 1257000,
    allowanceTaperLimit: 10000000,
    basicRateLimit: 5027000,
    higherRateLimit: 12514000,
    basicRate: 20,
    higherRate: 40,
    additionalRate: 45,
    class2WeeklyFlat: 345,
    class2SmallProfitsThreshold: 1257000,
    class4LowerLimit: 1257000,
    class4UpperLimit: 5027000,
    class4LowerRate: 6,
    class4UpperRate: 2,
  },
};

/** Get tax bands for a given tax year string (e.g. '2025-26'). Throws if not found. */
export function getTaxBands(year: string): TaxBands {
  const bands = TAX_BANDS[year];
  if (!bands) throw new Error(`Tax bands not found for year: ${year}`);
  return bands;
}

/** Determine the current UK tax year string based on today's date. */
export function currentTaxYear(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1-indexed
  const day = now.getUTCDate();
  // UK tax year runs 6 April to 5 April
  const afterApril6 = month > 4 || (month === 4 && day >= 6);
  return afterApril6 ? `${year}-${String(year + 1).slice(2)}` : `${year - 1}-${String(year).slice(2)}`;
}

export interface IncomeTaxResult {
  personalAllowancePence: number; // after the taper
  taxableIncomePence: number;
  incomeTaxPence: number;
}

/**
 * Income tax on adjusted net income (rest-of-UK bands). Pure; integer pence.
 *
 * Rounding: the allowance reduction (half the excess over the taper limit)
 * is rounded down to a whole penny; tax in each band is rounded to the
 * nearest penny (half up) and the three band amounts are summed.
 * HMRC's own calculation works in whole pounds, so this can differ by pence.
 *
 * The basic band is a fixed width of taxable income (basic limit minus the
 * standard allowance), so it does not move when the allowance tapers.
 * The additional rate starts at higherRateLimit of taxable income.
 */
export function calculateIncomeTax(adjustedNetIncomePence: number, taxYear: string): IncomeTaxResult {
  const bands = getTaxBands(taxYear);
  const taperReduction = Math.floor(Math.max(0, adjustedNetIncomePence - bands.allowanceTaperLimit) / 2);
  const personalAllowancePence = Math.max(0, bands.personalAllowance - taperReduction);
  const taxableIncomePence = Math.max(0, adjustedNetIncomePence - personalAllowancePence);

  const basicBandWidth = bands.basicRateLimit - bands.personalAllowance;
  const basicPence = Math.min(taxableIncomePence, basicBandWidth);
  const higherPence = Math.max(0, Math.min(taxableIncomePence, bands.higherRateLimit) - basicBandWidth);
  const additionalPence = Math.max(0, taxableIncomePence - bands.higherRateLimit);

  const incomeTaxPence =
    Math.round((basicPence * bands.basicRate) / 100) +
    Math.round((higherPence * bands.higherRate) / 100) +
    Math.round((additionalPence * bands.additionalRate) / 100);

  return { personalAllowancePence, taxableIncomePence, incomeTaxPence };
}

export interface TaxEstimate {
  profitPence: number;
  taxableIncomePence: number;
  incomeTaxPence: number;
  class2NicPence: number;
  class4NicPence: number;
  totalTaxPence: number;
  effectiveRatePercent: number;
  suggestedReservePence: number; // 30% of profit, rounded
}

/**
 * Estimate income tax + NIC for a self-employed individual.
 * All inputs and outputs are integer pence.
 * This is an ESTIMATE only — not a formal tax calculation.
 */
export function estimateTax(profitPence: number, taxYear: string): TaxEstimate {
  const bands = getTaxBands(taxYear);

  const { taxableIncomePence, incomeTaxPence } = calculateIncomeTax(profitPence, taxYear);

  // Class 2 NIC (flat weekly amount if profit > small profits threshold)
  const class2NicPence =
    profitPence > bands.class2SmallProfitsThreshold
      ? bands.class2WeeklyFlat * 52
      : 0;

  // Class 4 NIC
  const class4LowerBandPence = Math.max(0, Math.min(profitPence, bands.class4UpperLimit) - bands.class4LowerLimit);
  const class4UpperBandPence = Math.max(0, profitPence - bands.class4UpperLimit);
  const class4NicPence =
    Math.round((class4LowerBandPence * bands.class4LowerRate) / 100) +
    Math.round((class4UpperBandPence * bands.class4UpperRate) / 100);

  const totalTaxPence = incomeTaxPence + class2NicPence + class4NicPence;
  const effectiveRatePercent =
    profitPence > 0 ? parseFloat(((totalTaxPence / profitPence) * 100).toFixed(1)) : 0;

  const suggestedReservePence = Math.round(profitPence * 0.3);

  return {
    profitPence,
    taxableIncomePence,
    incomeTaxPence,
    class2NicPence,
    class4NicPence,
    totalTaxPence,
    effectiveRatePercent,
    suggestedReservePence,
  };
}
