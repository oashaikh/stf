import { getTaxBands } from './taxBands';

export interface ExpenseMethodComparison {
  actualProfitPence: number;     // income - expenses; negative is a loss
  allowanceProfitPence: number;  // income - trading allowance, never below zero
  lowerProfitMethod: 'actual' | 'allowance';
}

/** Compare profit under actual expenses with profit under the trading allowance. */
export function compareExpenseMethods(
  grossIncomePence: number,
  allowableExpensesPence: number,
  taxYear: string,
): ExpenseMethodComparison {
  const { tradingAllowancePence } = getTaxBands(taxYear);
  const actualProfitPence = grossIncomePence - allowableExpensesPence;
  const allowanceProfitPence = Math.max(0, grossIncomePence - tradingAllowancePence);
  // A tie stays on 'actual': it is the default and needs no election.
  const lowerProfitMethod = allowanceProfitPence < actualProfitPence ? 'allowance' : 'actual';
  return { actualProfitPence, allowanceProfitPence, lowerProfitMethod };
}
