import { describe, expect, it } from 'vitest';
import { TAX_BANDS, calculateClass2Nic, calculateClass4Nic, calculateIncomeTax, estimateTax } from './taxBands';

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

// HMRC published rates (https://www.gov.uk/self-employed-national-insurance-rates).
const nicRates: Record<string, { smallProfits: number; weekly: number }> = {
  '2024-25': { smallProfits: 6725, weekly: 3.45 },
  '2025-26': { smallProfits: 6845, weekly: 3.5 },
  '2026-27': { smallProfits: 7105, weekly: 3.65 },
};

describe.each(Object.keys(TAX_BANDS))('NIC bands %s', (year) => {
  const { smallProfits, weekly } = nicRates[year];
  const voluntaryPence = Math.round(weekly * 100) * 52;

  it('holds the published small profits threshold and weekly rate', () => {
    expect(TAX_BANDS[year].class2SmallProfitsThreshold).toBe(pounds(smallProfits));
    expect(TAX_BANDS[year].class2WeeklyFlat).toBe(Math.round(weekly * 100));
  });

  it('charges no Class 2 above the small profits threshold, even when voluntary is chosen', () => {
    expect(calculateClass2Nic(pounds(smallProfits) + 1, year, true)).toBe(0);
    expect(calculateClass2Nic(pounds(50000), year, true)).toBe(0);
  });

  it('charges Class 2 at or below the threshold only when voluntary is chosen', () => {
    expect(calculateClass2Nic(pounds(smallProfits), year, true)).toBe(voluntaryPence);
    expect(calculateClass2Nic(pounds(smallProfits), year, false)).toBe(0);
    expect(calculateClass2Nic(0, year, false)).toBe(0);
  });

  it('charges Class 4 at each limit', () => {
    expect(calculateClass4Nic(pounds(12570), year)).toBe(0);
    expect(calculateClass4Nic(pounds(12571), year)).toBe(6); // 6% of 100p
    expect(calculateClass4Nic(pounds(50270), year)).toBe(pounds(2262));
    expect(calculateClass4Nic(pounds(50271), year)).toBe(pounds(2262) + 2);
    expect(calculateClass4Nic(pounds(60270), year)).toBe(pounds(2262 + 200));
  });
});

it('estimateTax adds no Class 2 for profits above the small profits threshold', () => {
  const estimate = estimateTax(pounds(30000), '2025-26');
  expect(estimate.class2NicPence).toBe(0);
  expect(estimate.class4NicPence).toBe(calculateClass4Nic(pounds(30000), '2025-26'));
});

it('estimateTax adds voluntary Class 2 below the threshold when asked', () => {
  expect(estimateTax(pounds(6000), '2025-26', true).class2NicPence).toBe(350 * 52);
  expect(estimateTax(pounds(6000), '2025-26').class2NicPence).toBe(0);
});

describe.each(Object.keys(TAX_BANDS))('mileage rates %s', (year) => {
  it('hold the published simplified-mileage rates', () => {
    const bands = TAX_BANDS[year];
    expect([bands.mileageCarFirstRate, bands.mileageCarAfterRate, bands.mileageMotorcycleRate, bands.mileageBicycleRate]).toEqual([45, 25, 24, 20]);
    expect(bands.mileageCarThresholdTenths).toBe(100000);
  });
});
