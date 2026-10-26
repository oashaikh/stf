import { describe, expect, it } from 'vitest';
import {
  boxesToHmrcPayload,
  buildVatReturnBoxes,
  grossFromNet,
  netFromGross,
  vatOnGross,
  vatOnNet,
  type VatRate,
} from './vat.js';

const RATES: VatRate[] = [0, 5, 20];

describe('vatOnNet', () => {
  it('applies standard, reduced and zero rates', () => {
    expect(vatOnNet(10000, 20)).toBe(2000);
    expect(vatOnNet(10000, 5)).toBe(500);
    expect(vatOnNet(10000, 0)).toBe(0);
  });

  it('rounds half-up to whole pence', () => {
    expect(vatOnNet(3, 20)).toBe(1); // 0.6 -> 1
    expect(vatOnNet(2, 20)).toBe(0); // 0.4 -> 0
    expect(vatOnNet(10, 5)).toBe(1); // 0.5 -> 1
    expect(vatOnNet(999, 20)).toBe(200); // 199.8 -> 200
  });

  it('handles zero and amounts above £1m', () => {
    expect(vatOnNet(0, 20)).toBe(0);
    expect(vatOnNet(123456789, 20)).toBe(24691358); // 24691357.8
  });
});

describe('vatOnGross', () => {
  it('extracts VAT from a gross amount', () => {
    expect(vatOnGross(12000, 20)).toBe(2000);
    expect(vatOnGross(10500, 5)).toBe(500);
    expect(vatOnGross(12000, 0)).toBe(0);
  });

  it('rounds half-up', () => {
    expect(vatOnGross(1, 20)).toBe(0); // 0.167
    expect(vatOnGross(3, 20)).toBe(1); // 0.5 -> 1
    expect(vatOnGross(999, 20)).toBe(167); // 166.5 -> 167
  });
});

describe('net/gross derivations', () => {
  it('netFromGross and grossFromNet use the right rate', () => {
    expect(netFromGross(12000, 20)).toBe(10000);
    expect(grossFromNet(10000, 20)).toBe(12000);
    expect(netFromGross(500, 0)).toBe(500);
    expect(grossFromNet(500, 0)).toBe(500);
  });

  it('net + VAT always equals gross, for every rate', () => {
    for (const rate of RATES) {
      for (let gross = 0; gross <= 5000; gross++) {
        expect(netFromGross(gross, rate) + vatOnGross(gross, rate)).toBe(gross);
      }
    }
  });

  it('never produces fractional pence', () => {
    for (const rate of RATES) {
      for (let pence = 0; pence <= 5000; pence++) {
        for (const value of [vatOnNet(pence, rate), vatOnGross(pence, rate), netFromGross(pence, rate), grossFromNet(pence, rate)]) {
          expect(Number.isInteger(value)).toBe(true);
        }
      }
    }
  });

  it('gross -> net -> gross is stable within one pence of rounding', () => {
    for (const rate of RATES) {
      for (let gross = 0; gross <= 5000; gross++) {
        expect(Math.abs(grossFromNet(netFromGross(gross, rate), rate) - gross)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('buildVatReturnBoxes', () => {
  it('computes boxes 1-9 with net VAT payable', () => {
    expect(
      buildVatReturnBoxes({ salesNetPence: 100000, salesVatPence: 20000, purchasesNetPence: 40000, purchasesVatPence: 8000 }),
    ).toEqual({ box1: 20000, box2: 0, box3: 20000, box4: 8000, box5: 12000, box6: 100000, box7: 40000, box8: 0, box9: 0 });
  });

  it('gives a negative box5 when a refund is due', () => {
    const boxes = buildVatReturnBoxes({ salesNetPence: 0, salesVatPence: 0, purchasesNetPence: 5000, purchasesVatPence: 1000 });
    expect(boxes.box5).toBe(-1000);
  });
});

describe('boxesToHmrcPayload', () => {
  const boxes = buildVatReturnBoxes({ salesNetPence: 100050, salesVatPence: 20010, purchasesNetPence: 40049, purchasesVatPence: 8010 });

  it('converts VAT boxes to pounds and value boxes to whole pounds', () => {
    expect(boxesToHmrcPayload(boxes, '24A1')).toMatchObject({
      periodKey: '24A1',
      vatDueSales: 200.1,
      totalVatDue: 200.1,
      vatReclaimedCurrPeriod: 80.1,
      netVatDue: 120,
      totalValueSalesExVAT: 1001, // 1000.50 rounds up
      totalValuePurchasesExVAT: 400, // 400.49 rounds down
      finalised: true,
    });
  });

  it('sends the absolute value of a refund as netVatDue', () => {
    const refund = buildVatReturnBoxes({ salesNetPence: 0, salesVatPence: 0, purchasesNetPence: 0, purchasesVatPence: 1234 });
    expect(boxesToHmrcPayload(refund, 'X', false)).toMatchObject({ netVatDue: 12.34, finalised: false });
  });
});
