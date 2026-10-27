import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { formatPence } from '../lib/money';
import { currentTaxYear, TAX_BANDS } from '../lib/taxBands';
import { fetchTaxEstimate, taxEstimateQueryKey } from '../lib/taxEstimateApi';
import MileageSection from './MileageSection';

// Newest first, only years that have bands to calculate with.
const TAX_YEARS = Object.keys(TAX_BANDS).sort().reverse();

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'border-t border-gray-200 pt-2 font-medium' : ''}`}>
      <dt className="text-gray-700">{label}</dt>
      <dd className="text-right tabular-nums text-gray-900">{value}</dd>
    </div>
  );
}

export default function TaxPage() {
  const thisYear = currentTaxYear();
  const [taxYear, setTaxYear] = useState(TAX_YEARS.includes(thisYear) ? thisYear : TAX_YEARS[0]);
  const estimate = useQuery({ queryKey: taxEstimateQueryKey(taxYear), queryFn: () => fetchTaxEstimate(taxYear) });
  const data = estimate.data;

  return (
    <main className="p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Tax Estimate</h1>

      <label className="mt-4 flex flex-col gap-1 text-sm text-gray-700">
        Tax year
        <select
          className="min-h-11 w-fit rounded border border-gray-400 px-2 text-gray-900"
          value={taxYear}
          onChange={(event) => setTaxYear(event.target.value)}
        >
          {TAX_YEARS.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </label>

      {estimate.isPending && <p role="status" className="mt-6 text-gray-700">Loading…</p>}
      {estimate.isError && (
        <p role="alert" className="mt-6 text-red-800">
          Could not load the tax estimate. Please try again.
        </p>
      )}

      {data && (
        <section className="mt-6 rounded-lg border border-gray-200 bg-white p-4 md:max-w-xl">
          <dl className="space-y-1">
            <Row label="Profit to date" value={formatPence(data.profitPence)} />
            <Row label="Income tax" value={formatPence(data.incomeTaxPence)} />
            <Row label="Class 4 NIC" value={formatPence(data.class4NicPence)} />
            <Row label="Class 2 NIC" value={data.class2NicPence === 0 ? 'Nothing to pay' : formatPence(data.class2NicPence)} />
            <Row label="Total" value={formatPence(data.totalTaxPence)} strong />
            <Row label="Suggested to set aside" value={formatPence(data.setAsidePence)} strong />
          </dl>
          <p className="mt-4 text-sm text-gray-700">
            This is an estimate from your recorded profit so far, not a tax bill. Your actual tax depends on other income, reliefs and
            the figures you file.
          </p>
        </section>
      )}

      <MileageSection />
    </main>
  );
}
