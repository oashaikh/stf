import { useState } from "react";

import { dashboardPeriods } from "../lib/dashboardSummary";
import { downloadEntriesCsv } from "../lib/exportApi";

const inputClass = "mt-1 block min-h-11 rounded border border-gray-300 px-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-800";

export default function ReportsPage() {
  const [from, setFrom] = useState(() => dashboardPeriods(new Date()).taxYear.start);
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (!from || !to) return setError("Choose both a From and a To date.");
    if (from > to) return setError("The From date must be before the To date.");
    setError(null);
    setPending(true);
    try {
      await downloadEntriesCsv(from, to);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not export entries");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Reports</h1>
      <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-medium text-gray-700">Export entries</h2>
        <p className="text-xs text-gray-600">All entries and their lines in the range, including voided ones, as a CSV file.</p>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="text-sm text-gray-700">
            From
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={inputClass} />
          </label>
          <label className="text-sm text-gray-700">
            To
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={inputClass} />
          </label>
          <button
            type="button"
            onClick={download}
            disabled={pending}
            className="inline-flex min-h-11 items-center rounded bg-blue-800 px-4 text-white focus:outline-none focus:ring-2 focus:ring-blue-800 focus:ring-offset-2 disabled:opacity-60"
          >
            {pending ? "Downloading..." : "Download CSV"}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-800">
            Error: {error}
          </p>
        )}
      </section>
    </main>
  );
}
