/**
 * Posting rules — STF
 *
 * Pure function turning an income or expense entry into balanced ledger lines.
 * Signs follow architectures.md: debit positive, credit negative; income is a credit,
 * expense a debit; vatPence carries the same sign as its amountPence.
 */

import { netFromGross, vatOnGross, vatOnNet, type VatRate } from './vat.js';

export interface PostingEntry {
  kind: 'income' | 'expense';
  categoryAccountId: string;
  amountPence: number;
  amountIs: 'gross' | 'net';
  /** null means no VAT. */
  vatRatePercent: VatRate | null;
  /** Without a VAT number the rate is forced to no VAT. */
  hasVatNumber: boolean;
  bankAccountId: string;
  vatControlAccountId: string;
  debtorsAccountId: string;
  /** Invoices settle against trade debtors; everything else hits the bank. */
  settleAgainst?: 'bank' | 'debtors';
}

export interface PostedLine {
  accountId: string;
  amountPence: number;
  vatPence: number;
  vatRatePercent: VatRate | null;
}

export function postEntry(entry: PostingEntry): PostedLine[] {
  if (!Number.isInteger(entry.amountPence)) {
    throw new Error('amountPence must be an integer number of pence');
  }
  const rate = entry.hasVatNumber ? entry.vatRatePercent : null;
  const effectiveRate: VatRate = rate ?? 0;

  const vat = entry.amountIs === 'gross' ? vatOnGross(entry.amountPence, effectiveRate) : vatOnNet(entry.amountPence, effectiveRate);
  const net = entry.amountIs === 'gross' ? netFromGross(entry.amountPence, effectiveRate) : entry.amountPence;
  const gross = net + vat;

  const sign = entry.kind === 'expense' ? 1 : -1;
  const lines: PostedLine[] = [
    { accountId: entry.categoryAccountId, amountPence: sign * net, vatPence: sign * vat, vatRatePercent: rate },
  ];
  if (vat !== 0) {
    lines.push({ accountId: entry.vatControlAccountId, amountPence: sign * vat, vatPence: 0, vatRatePercent: null });
  }
  const settleAccountId = entry.settleAgainst === 'debtors' ? entry.debtorsAccountId : entry.bankAccountId;
  lines.push({ accountId: settleAccountId, amountPence: -sign * gross, vatPence: 0, vatRatePercent: null });
  return lines;
}
