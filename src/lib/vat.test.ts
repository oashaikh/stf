import { describe, expect, it } from 'vitest';
import { boxesToHmrcPayload, buildVatReturnBoxes, buildVatReturnFromLedger, type LedgerLine } from './vat.js';

const period = { start: '2026-07-01', end: '2026-09-30' };

const line = (overrides: Partial<LedgerLine>): LedgerLine => ({
  date: '2026-08-15',
  accountType: 'income',
  amountPence: 10000,
  vatPence: 2000,
  status: 'confirmed',
  deletedAt: null,
  ...overrides,
});

describe('buildVatReturnFromLedger', () => {
  it('returns all nine boxes as zero for a nil return', () => {
    const boxes = buildVatReturnFromLedger([], period);
    expect(Object.values(boxes)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('sums income and expense lines in the period into the nine boxes', () => {
    const boxes = buildVatReturnFromLedger(
      [
        line({}),
        line({ amountPence: 5000, vatPence: 1000 }),
        line({ accountType: 'expense', amountPence: 4000, vatPence: 800 }),
      ],
      period,
    );
    expect(boxes).toEqual({
      box1: 3000, box2: 0, box3: 3000, box4: 800, box5: 2200,
      box6: 15000, box7: 4000, box8: 0, box9: 0,
    });
  });

  it('gives a negative box 5 when reclaimable VAT exceeds VAT due', () => {
    const boxes = buildVatReturnFromLedger(
      [line({ accountType: 'expense', amountPence: 10000, vatPence: 2000 })],
      period,
    );
    expect(boxes.box5).toBe(-2000);
  });

  it('includes lines on the first and last day, excludes the day outside', () => {
    const boxes = buildVatReturnFromLedger(
      [
        line({ date: '2026-07-01' }),
        line({ date: '2026-09-30' }),
        line({ date: '2026-06-30' }),
        line({ date: '2026-10-01' }),
      ],
      period,
    );
    expect(boxes.box1).toBe(4000);
  });

  it('ignores draft, voided, soft-deleted and non-P&L lines', () => {
    const boxes = buildVatReturnFromLedger(
      [
        line({ status: 'draft' }),
        line({ status: 'voided' }),
        line({ deletedAt: '2026-09-01T00:00:00Z' }),
        line({ accountType: 'asset' }),
        line({ status: 'reconciled', amountPence: 100, vatPence: 20 }),
      ],
      period,
    );
    expect(boxes.box1).toBe(20);
    expect(boxes.box6).toBe(100);
  });
});

describe('boxesToHmrcPayload', () => {
  it('converts a nil return to zero values', () => {
    const payload = boxesToHmrcPayload(buildVatReturnBoxes({
      salesNetPence: 0, salesVatPence: 0, purchasesNetPence: 0, purchasesVatPence: 0,
    }), '26A1');
    expect(payload.netVatDue).toBe(0);
    expect(payload.totalValueSalesExVAT).toBe(0);
  });

  it('converts pence to pounds at the boundary', () => {
    const payload = boxesToHmrcPayload(buildVatReturnFromLedger([line({})], period), '26A1');
    expect(payload.vatDueSales).toBe(20);
    expect(payload.totalValueSalesExVAT).toBe(100);
  });
});
