import { describe, expect, it } from 'vitest';
import { compareWithHmrc, FINAL_DECLARATION_WORDING } from './finalDeclaration';

const estimate = { incomeTaxPence: 100_000, class2NicPence: 0, class4NicPence: 20_000 };

describe('compareWithHmrc', () => {
  it('reports no difference when the figures match', () => {
    const result = compareWithHmrc(estimate, { incomeTaxPence: 100_000, class2NicPence: 0, class4NicPence: 20_000, totalPence: 120_000 });
    expect(result).toEqual({ incomeTaxDifferencePence: 0, nicDifferencePence: 0, totalDifferencePence: 0, differs: false });
  });

  it('is positive when HMRC is higher than STF', () => {
    const result = compareWithHmrc(estimate, { incomeTaxPence: 105_000, class2NicPence: 0, class4NicPence: 21_000, totalPence: 126_000 });
    expect(result.incomeTaxDifferencePence).toBe(5_000);
    expect(result.nicDifferencePence).toBe(1_000);
    expect(result.totalDifferencePence).toBe(6_000);
    expect(result.differs).toBe(true);
  });

  it('is negative when HMRC is lower than STF, adding both NIC classes', () => {
    const result = compareWithHmrc(estimate, { incomeTaxPence: 90_000, class2NicPence: 500, class4NicPence: 15_000, totalPence: 105_500 });
    expect(result.incomeTaxDifferencePence).toBe(-10_000);
    expect(result.nicDifferencePence).toBe(-4_500);
    expect(result.totalDifferencePence).toBe(-14_500);
    expect(result.differs).toBe(true);
  });

  it('flags a difference that only shows in the total', () => {
    const result = compareWithHmrc(estimate, { incomeTaxPence: 100_000, class2NicPence: 0, class4NicPence: 20_000, totalPence: 120_001 });
    expect(result.differs).toBe(true);
  });
});

it('has one non-empty declaration wording', () => {
  expect(FINAL_DECLARATION_WORDING.length).toBeGreaterThan(20);
});
