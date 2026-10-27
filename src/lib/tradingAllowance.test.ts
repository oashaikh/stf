import { describe, expect, it } from 'vitest';
import { compareExpenseMethods } from './tradingAllowance';

const pounds = (amount: number) => amount * 100;

describe('compareExpenseMethods', () => {
  it('gives nil allowance profit when income is below the allowance', () => {
    const result = compareExpenseMethods(pounds(600), pounds(100), '2025-26');
    expect(result.actualProfitPence).toBe(pounds(500));
    expect(result.allowanceProfitPence).toBe(0);
    expect(result.lowerProfitMethod).toBe('allowance');
  });

  it('returns actual on a tie, when expenses equal the allowance', () => {
    const result = compareExpenseMethods(pounds(5000), pounds(1000), '2025-26');
    expect(result.actualProfitPence).toBe(pounds(4000));
    expect(result.allowanceProfitPence).toBe(pounds(4000));
    expect(result.lowerProfitMethod).toBe('actual');
  });

  it('prefers actual when expenses are above the allowance', () => {
    expect(compareExpenseMethods(pounds(5000), pounds(1500), '2025-26').lowerProfitMethod).toBe('actual');
  });

  it('prefers the allowance when expenses are below it', () => {
    const result = compareExpenseMethods(pounds(5000), pounds(400), '2025-26');
    expect(result.allowanceProfitPence).toBe(pounds(4000));
    expect(result.lowerProfitMethod).toBe('allowance');
  });

  it('handles zero income', () => {
    const result = compareExpenseMethods(0, 0, '2025-26');
    expect(result.actualProfitPence).toBe(0);
    expect(result.allowanceProfitPence).toBe(0);
    expect(result.lowerProfitMethod).toBe('actual');
  });

  it('allows a loss under actual expenses', () => {
    const result = compareExpenseMethods(pounds(500), pounds(2000), '2025-26');
    expect(result.actualProfitPence).toBe(pounds(-1500));
    expect(result.allowanceProfitPence).toBe(0);
    expect(result.lowerProfitMethod).toBe('actual');
  });

  it('throws for an unknown tax year', () => {
    expect(() => compareExpenseMethods(100, 0, '1999-00')).toThrow();
  });
});
