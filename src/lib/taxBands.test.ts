import { describe, expect, it } from 'vitest';
import { TAX_BANDS, calculateIncomeTax, estimateTax } from './taxBands';

const pounds = (amount: number) => amount * 100;

// Rest-of-UK thresholds are the same in every year held in the file.
// HMRC publishes no worked tax totals for the taper, only the rule
// (https://www.gov.uk/income-tax-rates: allowance falls £1 per £2 over £100,000
// and is nil at £125,140). The allowance column below follows that rule; the tax
// column is hand-derived from the gov.uk band rates, not copied from an HMRC example.
const cases: Array<[string, number, number, number]> = [
  // label, adjusted net income £, allowance £, tax £
  ['zero income', 0, 12570, 0],
  ['at personal allowance', 12570, 12570, 0],
  ['£1 over allowance', 12571, 12570, 0.2],
  ['top of basic band', 50270, 12570, 7540],
  ['£1 into higher band', 50271, 12570, 7540.4],
  ['at taper limit', 100000, 12570, 27432],
  ['mid taper', 110000, 7570, 33432],
  ['allowance fully tapered', 125140, 0, 42516],
  ['just past tapered limit, additional rate', 150000, 0, 53703],
];

describe.each(Object.keys(TAX_BANDS))('calculateIncomeTax %s', (year) => {
  it.each(cases)('%s', (_label, income, allowance, tax) => {
    const result = calculateIncomeTax(Math.round(income * 100), year);
    expect(result.personalAllowancePence).toBe(pounds(allowance));
    expect(result.incomeTaxPence).toBe(Math.round(tax * 100));
  });

  it('reduces the allowance by £1 for every £2 over the taper limit', () => {
    expect(calculateIncomeTax(pounds(100001), year).personalAllowancePence).toBe(pounds(12570) - 50);
    expect(calculateIncomeTax(pounds(100003), year).personalAllowancePence).toBe(pounds(12570) - 150);
  });

  it('rounds the odd penny of an odd-pence taper down to the penny', () => {
    // £1 over by 1p: half a penny removed, rounded down, so allowance loses 0p
    expect(calculateIncomeTax(pounds(100000) + 1, year).personalAllowancePence).toBe(pounds(12570));
  });
});

it('includes 2026-27', () => {
  expect(TAX_BANDS['2026-27'].allowanceTaperLimit).toBe(pounds(100000));
});

it('estimateTax uses the tapered income tax', () => {
  expect(estimateTax(pounds(125140), '2025-26').incomeTaxPence).toBe(pounds(42516));
});
