# Trading allowance or actual expenses

The owner picks one method per tax year on the Tax page. Actual expenses is the default until they choose.

- Actual expenses: profit is turnover minus allowable expenses.
- Trading allowance: profit is turnover (plus other business income, which counts toward the threshold) minus the allowance, and no expenses can be deducted. The amount is in `src/lib/taxBands.ts`, keyed by tax year.

The Tax page shows both profits and says which is lower. Choosing a method PUTs `/api/settings/trading-allowance`, which stores it for the signed-in owner and writes an audit event. The tax year summary and the tax estimate then use the chosen method.

The figures are an estimate, not advice. Capital allowances are not covered.
