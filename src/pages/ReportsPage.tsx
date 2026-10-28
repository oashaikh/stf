import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { downloadEntriesCsv } from '../lib/exportApi';
import { formatPence } from '../lib/money';
import { profitAndLossPresets, type ProfitAndLossPreset } from '../lib/profitAndLoss';
import { fetchProfitAndLoss, profitAndLossCsv, type ProfitAndLoss } from '../lib/profitAndLossReport';

type RangeChoice = ProfitAndLossPreset | 'custom';

const CHOICES: { value: RangeChoice; label: string }[] = [
  { value: 'this-tax-year', label: 'This tax year' },
  { value: 'last-tax-year', label: 'Last tax year' },
  { value: 'last-quarter', label: 'Last quarter' },
  { value: 'custom', label: 'Custom' },
];

const inputClass = 'min-h-11 rounded border border-gray-400 px-2 text-gray-900';

function CategoryTable({ title, rows, totalLabel, totalPence, range }: {
  title: string;
  rows: ProfitAndLoss['income'];
  totalLabel: string;
  totalPence: number;
  range: { start: string; end: string };
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-medium text-gray-700">{title}</h2>
      {rows.length === 0 && <p className="mt-3 text-gray-700">Nothing recorded in this range.</p>}
      <dl className="mt-3 space-y-1">
        {rows.map((row) => (
          <div key={row.accountId} className="flex justify-between gap-4">
            <dt className="min-w-0 truncate" title={row.accountName}>
              <Link
                to={`/expenses?${new URLSearchParams({ from: range.start, to: range.end, categoryAccountId: row.accountId })}`}
                className="flex min-h-11 items-center text-blue-800 underline"
              >
                <span className="truncate">{row.accountName}</span>
              </Link>
            </dt>
            <dd className="shrink-0 self-center whitespace-nowrap text-right tabular-nums text-gray-900">{formatPence(row.totalPence)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-gray-200 pt-2 font-medium">
          <dt className="text-gray-900">{totalLabel}</dt>
          <dd className="text-right tabular-nums text-gray-900">{formatPence(totalPence)}</dd>
        </div>
      </dl>
    </section>
  );
}

function downloadCsv(report: ProfitAndLoss) {
  const url = URL.createObjectURL(new Blob([profitAndLossCsv(report)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `profit-and-loss-${report.start}-to-${report.end}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const presets = profitAndLossPresets(new Date());
  const [choice, setChoice] = useState<RangeChoice>('this-tax-year');
  const [custom, setCustom] = useState(presets['this-tax-year']);
  const range = choice === 'custom' ? custom : presets[choice];
  // The API refuses an empty or reversed range, so wait until the dates make sense.
  const rangeValid = Boolean(range.start && range.end && range.start <= range.end);

  const report = useQuery({
    enabled: rangeValid,
    queryKey: ['profit-and-loss', range.start, range.end],
    queryFn: () => fetchProfitAndLoss(range.start, range.end),
  });
  const data = report.data;

  const [exportPending, setExportPending] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function downloadEntries() {
    setExportError(null);
    setExportPending(true);
    try {
      await downloadEntriesCsv(range.start, range.end);
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : 'Could not export entries');
    } finally {
      setExportPending(false);
    }
  }

  return (
    <main className="p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Reports</h1>
      <h2 className="mt-1 text-lg text-gray-800">Profit and loss</h2>

      <div className="mt-4 flex flex-wrap items-start gap-4">
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Period
          <select className={inputClass} value={choice} onChange={(event) => setChoice(event.target.value as RangeChoice)}>
            {CHOICES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {choice === 'custom' && (
          <>
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              From
              <input type="date" className={inputClass} value={custom.start} onChange={(event) => setCustom({ ...custom, start: event.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              To
              <input type="date" className={inputClass} value={custom.end} onChange={(event) => setCustom({ ...custom, end: event.target.value })} />
            </label>
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-600">
        {range.start} to {range.end}
      </p>

      {!rangeValid && (
        <p role="alert" className="mt-4 text-red-800">
          Choose a start date that is on or before the end date.
        </p>
      )}
      {rangeValid && report.isPending && <p role="status" className="mt-6 text-gray-700">Loading…</p>}
      {report.isError && (
        <p role="alert" className="mt-6 text-red-800">
          Could not load the report. Please try again.
        </p>
      )}

      {data && (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <CategoryTable title="Income by category" rows={data.income} totalLabel="Total income" totalPence={data.incomePence} range={data} />
            <CategoryTable title="Expenses by category" rows={data.expenses} totalLabel="Total expenses" totalPence={data.expensesPence} range={data} />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4">
            <p className="font-medium text-gray-900">
              Net profit <span className="ml-2 tabular-nums">{formatPence(data.profitPence)}</span>
            </p>
            <button type="button" onClick={() => downloadCsv(data)} className="inline-flex min-h-11 items-center rounded bg-blue-800 px-4 text-white">
              Download CSV
            </button>
          </div>
        </>
      )}

      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-medium text-gray-700">Export entries</h2>
        <p className="text-xs text-gray-600">All entries and their lines in the chosen period, excluding voided ones, as a CSV file.</p>
        <button
          type="button"
          onClick={downloadEntries}
          disabled={!rangeValid || exportPending}
          className="mt-3 inline-flex min-h-11 items-center rounded bg-blue-800 px-4 text-white focus:outline-none focus:ring-2 focus:ring-blue-800 focus:ring-offset-2 disabled:opacity-60"
        >
          {exportPending ? 'Downloading...' : 'Download entries CSV'}
        </button>
        {exportError && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-800">
            Error: {exportError}
          </p>
        )}
      </section>
    </main>
  );
}
