/**
 * UK Income Tax and NIC bands — STF
 *
 * All thresholds stored as integer pence.
 * Add a new entry for each tax year; never modify historical entries.
 *
 * Sources:
 *   https://www.gov.uk/income-tax-rates
 *   https://www.gov.uk/national-insurance-rates-letters
 */

export interface TaxBands {
  year: string;           // e.g. '2025-26'
  personalAllowance: number;     // pence
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
  '2025-26': {
    year: '2025-26',
    personalAllowance: 1257000,     // £12,570
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
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-indexed
  const day = now.getDate();
  // UK tax year runs 6 April to 5 April
  const afterApril6 = month > 4 || (month === 4 && day >= 6);
  return afterApril6 ? `${year}-${String(year + 1).slice(2)}` : `${year - 1}-${String(year).slice(2)}`;
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

  // Taxable income after personal allowance
  const taxableIncomePence = Math.max(0, profitPence - bands.personalAllowance);

  // Income tax
  const basicBandWidth = bands.basicRateLimit - bands.personalAllowance;
  const basicTaxablePence = Math.min(taxableIncomePence, basicBandWidth);
  const higherBandWidth = bands.higherRateLimit - bands.basicRateLimit;
  const higherTaxablePence = Math.max(0, Math.min(taxableIncomePence - basicBandWidth, higherBandWidth));
  const additionalTaxablePence = Math.max(0, taxableIncomePence - basicBandWidth - higherBandWidth);

  const incomeTaxPence =
    Math.round((basicTaxablePence * bands.basicRate) / 100) +
    Math.round((higherTaxablePence * bands.higherRate) / 100) +
    Math.round((additionalTaxablePence * bands.additionalRate) / 100);

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
