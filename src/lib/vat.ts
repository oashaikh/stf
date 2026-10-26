/**
 * VAT calculation — STF
 *
 * Pure functions for UK VAT arithmetic. All amounts are integer pence.
 * Rounding: Math.round (half-up), matching HMRC's expected behaviour.
 *
 * Standard rate: 20%  (100/120 of gross for VAT on gross)
 * Reduced rate:   5%
 * Zero rate:      0%
 */

import { multiplyPence } from "./money.js";

export type VatRate = 0 | 5 | 20;

/** Calculate VAT pence from a net (ex-VAT) amount. */
export function vatOnNet(netPence: number, ratePercent: VatRate): number {
  return multiplyPence(netPence, ratePercent, 100);
}

/** Calculate VAT pence from a gross (inc-VAT) amount. */
export function vatOnGross(grossPence: number, ratePercent: VatRate): number {
  if (ratePercent === 0) return 0;
  const denominator = 100 + ratePercent;
  return multiplyPence(grossPence, ratePercent, denominator);
}

/** Calculate net from gross. */
export function netFromGross(grossPence: number, ratePercent: VatRate): number {
  if (ratePercent === 0) return grossPence;
  return grossPence - vatOnGross(grossPence, ratePercent);
}

/** Calculate gross from net. */
export function grossFromNet(netPence: number, ratePercent: VatRate): number {
  return netPence + vatOnNet(netPence, ratePercent);
}

/**
 * Build the nine MTD VAT return boxes from arrays of transaction line totals.
 * All inputs and outputs are integer pence.
 *
 * HMRC submission converts pence → pounds at the API boundary only.
 */
export interface VatReturnLines {
  salesNetPence: number;
  salesVatPence: number;
  purchasesNetPence: number;
  purchasesVatPence: number;
}

export interface VatReturnBoxes {
  box1: number; // VAT due on sales
  box2: number; // VAT due on EC acquisitions (0 for most sole traders)
  box3: number; // Total VAT due (box1 + box2)
  box4: number; // VAT reclaimed on purchases
  box5: number; // Net VAT payable (box3 - box4; negative = refund due)
  box6: number; // Total value of sales (ex VAT)
  box7: number; // Total value of purchases (ex VAT)
  box8: number; // EC supplies (0)
  box9: number; // EC acquisitions (0)
}

export function buildVatReturnBoxes(lines: VatReturnLines): VatReturnBoxes {
  const box1 = lines.salesVatPence;
  const box2 = 0;
  const box3 = box1 + box2;
  const box4 = lines.purchasesVatPence;
  const box5 = box3 - box4;

  return {
    box1,
    box2,
    box3,
    box4,
    box5,
    box6: lines.salesNetPence,
    box7: lines.purchasesNetPence,
    box8: 0,
    box9: 0,
  };
}

/** One ledger line joined to its transaction and account, as the route loads it. */
export interface LedgerLine {
  date: string; // YYYY-MM-DD, the transaction date
  accountType: "income" | "expense" | "asset" | "liability" | "equity";
  // Raw ledger signs (architectures.md): debit positive, credit negative. VAT carries the
  // same sign as its amount. Income is a credit, expense a debit.
  amountPence: number; // net, ex VAT
  vatPence: number;
  status: "draft" | "confirmed" | "reconciled" | "voided";
  deletedAt: string | null;
}

type Period = { start: string; end: string };

/**
 * The one inclusion rule for the return: confirmed/reconciled, non-deleted income and
 * expense lines inside the inclusive period. Drafts are unreviewed, and the return must
 * never include voided records. Totals and drill-down both use this so they cannot disagree.
 */
function contributesToReturn(line: LedgerLine, period: Period): boolean {
  return (
    (line.status === "confirmed" || line.status === "reconciled") &&
    line.deletedAt === null &&
    (line.accountType === "income" || line.accountType === "expense") &&
    line.date >= period.start && // ISO dates compare correctly as strings
    line.date <= period.end
  );
}

/** Compute the nine boxes for an inclusive date period straight from ledger lines. */
export function buildVatReturnFromLedger(
  lines: LedgerLine[],
  period: Period,
): VatReturnBoxes {
  const totals: VatReturnLines = {
    salesNetPence: 0,
    salesVatPence: 0,
    purchasesNetPence: 0,
    purchasesVatPence: 0,
  };
  for (const line of lines) {
    if (!contributesToReturn(line, period)) continue;
    if (line.accountType === "income") {
      // credits are negative in the ledger; flip so sales are positive
      totals.salesNetPence -= line.amountPence;
      totals.salesVatPence -= line.vatPence;
    } else {
      totals.purchasesNetPence += line.amountPence;
      totals.purchasesVatPence += line.vatPence;
    }
  }
  return buildVatReturnBoxes(totals);
}

/** The ledger lines that make up one box, for drill-down. Boxes 2, 8 and 9 are always 0. */
export function linesForBox(
  lines: LedgerLine[],
  period: Period,
  box: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
): LedgerLine[] {
  const wanted: LedgerLine["accountType"][] =
    box === 1 || box === 6
      ? ["income"]
      : box === 4 || box === 7
        ? ["expense"]
        : box === 3 || box === 5
          ? ["income", "expense"]
          : [];
  return lines.filter(
    (line) =>
      contributesToReturn(line, period) && wanted.includes(line.accountType),
  );
}

/**
 * Convert pence boxes to the HMRC MTD submission payload (pounds, 2dp strings).
 * Called only at the API boundary in api/hmrc/vat/submit.ts.
 */
export function boxesToHmrcPayload(
  boxes: VatReturnBoxes,
  periodKey: string,
  finalised: boolean = true,
): Record<string, string | number | boolean> {
  const p = (pence: number) => parseFloat((pence / 100).toFixed(2));
  return {
    periodKey,
    vatDueSales: p(boxes.box1),
    vatDueAcquisitions: p(boxes.box2),
    totalVatDue: p(boxes.box3),
    vatReclaimedCurrPeriod: p(boxes.box4),
    netVatDue: p(Math.abs(boxes.box5)), // HMRC wants absolute value
    totalValueSalesExVAT: Math.round(boxes.box6 / 100), // whole pounds
    totalValuePurchasesExVAT: Math.round(boxes.box7 / 100),
    totalValueGoodsSuppliedExVAT: Math.round(boxes.box8 / 100),
    totalAcquisitionsExVAT: Math.round(boxes.box9 / 100),
    finalised,
  };
}
