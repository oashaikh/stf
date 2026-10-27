/**
 * Invoice line maths — STF
 *
 * Pure integer functions. Quantity is stored scaled by 10,000 (1.5 units = 15000).
 * Rounding is half-up and happens per line, so invoice totals are sums of the
 * rounded line values and the lines always add up to the header.
 */

import { multiplyPence, sumPence } from './money.js';
import { vatOnNet, type VatRate } from './vat.js';

export const QUANTITY_SCALE = 10_000;

/** The only VAT rates an invoice line may carry; the route schema reuses this. */
export const INVOICE_VAT_RATES: readonly VatRate[] = [0, 5, 20];

export function isInvoiceVatRate(value: unknown): value is VatRate {
  return INVOICE_VAT_RATES.includes(value as VatRate);
}

export interface InvoiceLineInput {
  quantityScaled: number;
  unitPricePence: number;
  vatRate: VatRate;
}

export interface Totals {
  netPence: number;
  vatPence: number;
  totalPence: number;
}

export function lineNet(quantityScaled: number, unitPricePence: number): number {
  return multiplyPence(unitPricePence, quantityScaled, QUANTITY_SCALE);
}

/** `ownerHasVatNumber` false forces VAT to 0: only VAT-registered owners charge VAT. */
export function lineTotals(
  quantityScaled: number,
  unitPricePence: number,
  vatRate: VatRate,
  ownerHasVatNumber: boolean,
): Totals {
  const netPence = lineNet(quantityScaled, unitPricePence);
  const vatPence = ownerHasVatNumber ? vatOnNet(netPence, vatRate) : 0;
  return { netPence, vatPence, totalPence: netPence + vatPence };
}

export function invoiceTotals(lines: InvoiceLineInput[], ownerHasVatNumber: boolean): Totals {
  const perLine = lines.map((line) =>
    lineTotals(line.quantityScaled, line.unitPricePence, line.vatRate, ownerHasVatNumber),
  );
  return {
    netPence: sumPence(perLine.map((l) => l.netPence)),
    vatPence: sumPence(perLine.map((l) => l.vatPence)),
    totalPence: sumPence(perLine.map((l) => l.totalPence)),
  };
}
