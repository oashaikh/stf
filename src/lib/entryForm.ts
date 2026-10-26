import { formatPence, parsePence } from './money.js';
import { grossFromNet, netFromGross, vatOnGross, vatOnNet, type VatRate } from './vat.js';

export const MAX_AMOUNT_PENCE = 1_000_000_000; // £10m; also keeps sums inside the integer column

export function parseEntryAmount(input: string): { pence: number } | { error: string } {
  const typed = input.replace(/[£,\s]/g, '');
  if (typed === '') return { error: 'Enter an amount' };
  if (typed.startsWith('-')) return { error: 'The amount cannot be negative. Choose money in or money out instead.' };
  if (!/^\d*\.?\d*$/.test(typed) || typed === '.') return { error: 'Enter the amount as a number, for example 12.50' };
  if (/\.\d{3,}/.test(typed)) return { error: 'Use at most two decimal places, for example 12.34' };
  const pence = parsePence(typed);
  if (pence === null) return { error: 'Enter the amount as a number, for example 12.50' };
  if (pence === 0) return { error: `The amount must be more than ${formatPence(0)}` };
  if (pence > MAX_AMOUNT_PENCE) return { error: `The amount cannot be more than ${formatPence(MAX_AMOUNT_PENCE)}` };
  return { pence };
}

/** Same functions postEntry uses, so the preview always matches what the server will post. */
export function entryFigures(amountPence: number, amountIs: 'gross' | 'net', rate: VatRate) {
  if (amountIs === 'gross') {
    return { netPence: netFromGross(amountPence, rate), vatPence: vatOnGross(amountPence, rate), grossPence: amountPence };
  }
  return { netPence: amountPence, vatPence: vatOnNet(amountPence, rate), grossPence: grossFromNet(amountPence, rate) };
}

/** Reads the rate back from the stored pence with integers only: the one of 0, 5 or 20 whose VAT on net is closest. */
export function vatRateOf(netPence: number, vatPence: number): VatRate {
  const rates: VatRate[] = [0, 5, 20];
  return rates.reduce((best, rate) =>
    Math.abs(vatPence * 100 - netPence * rate) < Math.abs(vatPence * 100 - netPence * best) ? rate : best,
  );
}
