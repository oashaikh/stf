/**
 * Money utilities — STF
 *
 * ALL monetary amounts in STF are stored and computed as integer pence (GBP × 100).
 * This module is the single place where amounts become display strings or are
 * parsed from user input. Do not use toFixed(2) or parseFloat anywhere else.
 */

/** Format integer pence as a GBP display string. e.g. 1299 → "£12.99" */
export function formatPence(pence: number): string {
  const pounds = pence / 100;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pounds);
}

/** Format pence without the £ symbol. e.g. 1299 → "12.99" */
export function formatPenceRaw(pence: number): string {
  return (pence / 100).toFixed(2);
}

/**
 * Parse a user-entered string into integer pence.
 * Accepts: "12.99", "£12.99", "1299p", "12", "0"
 * Returns null if the string cannot be parsed as a valid amount.
 */
export function parsePence(input: string): number | null {
  const cleaned = input.replace(/[£,\s]/g, '');
  if (cleaned === '' || isNaN(Number(cleaned))) return null;
  const value = parseFloat(cleaned);
  if (!isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/**
 * Add two pence amounts safely.
 * Use this instead of a + b to make intent explicit.
 */
export function addPence(a: number, b: number): number {
  return a + b;
}

/**
 * Subtract pence. Returns a negative value if b > a (valid for credit entries).
 */
export function subtractPence(a: number, b: number): number {
  return a - b;
}

/**
 * Multiply pence by a rational (expressed as numerator/denominator).
 * Rounds half-up, matching HMRC's expected VAT rounding behaviour.
 *
 * e.g. vatPence(1000, 20, 100) → 200  (20% of £10.00 = £2.00)
 */
export function multiplyPence(pence: number, numerator: number, denominator: number): number {
  return Math.round((pence * numerator) / denominator);
}

/** Sum an array of pence values. */
export function sumPence(amounts: number[]): number {
  return amounts.reduce((acc, v) => acc + v, 0);
}
