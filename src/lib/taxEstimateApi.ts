import type { TaxEstimateResult } from '../../api/_lib/taxEstimate';

export type { TaxEstimateResult };

export const taxEstimateQueryKey = (taxYear: string) => ['tax-estimate', taxYear];

export async function fetchTaxEstimate(taxYear: string): Promise<TaxEstimateResult> {
  const response = await fetch(`/api/tax-estimate?${new URLSearchParams({ taxYear })}`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not load the tax estimate');
  return (await response.json()).data;
}
