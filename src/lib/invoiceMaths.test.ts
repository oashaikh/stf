import { describe, expect, it } from 'vitest';
import {
  INVOICE_VAT_RATES,
  QUANTITY_SCALE,
  invoiceTotals,
  isInvoiceVatRate,
  lineNet,
  lineTotals,
} from './invoiceMaths.js';

describe('lineNet', () => {
  it('multiplies whole quantities exactly', () => {
    expect(lineNet(2 * QUANTITY_SCALE, 1250)).toBe(2500);
  });
  it('handles 1.5 units', () => {
    expect(lineNet(15_000, 999)).toBe(1499); // 1498.5 rounds half up
  });
  it('handles 0.3333 units at an awkward price', () => {
    expect(lineNet(3_333, 1000)).toBe(333); // 333.3
    expect(lineNet(3_333, 1999)).toBe(666); // 666.3
  });
  it('rounds half up at the boundary', () => {
    expect(lineNet(5_000, 1)).toBe(1); // 0.5 -> 1
    expect(lineNet(4_999, 1)).toBe(0); // just under
  });
  it('returns zero for zero quantity', () => {
    expect(lineNet(0, 12345)).toBe(0);
  });
});

describe('lineTotals', () => {
  it.each([
    [0, 0, 1000],
    [5, 50, 1050],
    [20, 200, 1200],
  ] as const)('rate %i%% on £10.00', (rate, vat, total) => {
    expect(lineTotals(QUANTITY_SCALE, 1000, rate, true)).toEqual({
      netPence: 1000,
      vatPence: vat,
      totalPence: total,
    });
  });
  it('forces VAT to 0 when the owner has no VAT number', () => {
    expect(lineTotals(QUANTITY_SCALE, 1000, 20, false).vatPence).toBe(0);
  });
  it('rounds VAT half up per line', () => {
    expect(lineTotals(QUANTITY_SCALE, 10, 5, true).vatPence).toBe(1); // 0.5
  });
});

describe('invoiceTotals', () => {
  it('is zero for no lines', () => {
    expect(invoiceTotals([], true)).toEqual({ netPence: 0, vatPence: 0, totalPence: 0 });
  });
  it('sums per-line rounded values so lines add up to the header', () => {
    const lines = Array.from({ length: 3 }, () => ({
      quantityScaled: QUANTITY_SCALE,
      unitPricePence: 10,
      vatRate: 5 as const,
    }));
    const totals = invoiceTotals(lines, true);
    // each line VAT rounds 0.5 -> 1; rounding the pooled 1.5 would give 2 but 3 is the line sum
    expect(totals).toEqual({ netPence: 30, vatPence: 3, totalPence: 33 });
    expect(totals.totalPence).toBe(totals.netPence + totals.vatPence);
  });
  it('forces all VAT to 0 without a VAT number', () => {
    const totals = invoiceTotals(
      [{ quantityScaled: 15_000, unitPricePence: 999, vatRate: 20 }],
      false,
    );
    expect(totals.vatPence).toBe(0);
    expect(totals.totalPence).toBe(totals.netPence);
  });
  it('copes with a large line set and returns integers', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => ({
      quantityScaled: 3_333 + i,
      unitPricePence: 1999 + i,
      vatRate: INVOICE_VAT_RATES[i % 3],
    }));
    const totals = invoiceTotals(lines, true);
    for (const value of Object.values(totals)) expect(Number.isInteger(value)).toBe(true);
  });
});

describe('isInvoiceVatRate', () => {
  it('accepts only 0, 5 and 20', () => {
    expect([0, 5, 20].every(isInvoiceVatRate)).toBe(true);
    for (const bad of [1, 17.5, -5, 100, '20', null, undefined, NaN]) {
      expect(isInvoiceVatRate(bad)).toBe(false);
    }
  });
});
