import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { DASHBOARD_QUERY_KEY, fetchDashboard } from "../lib/dashboardApi";
import { formatPence } from "../lib/money";

const linkClass = "inline-flex min-h-11 items-center text-blue-800 underline";

function Card({ title, period, children }: { title: string; period?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-medium text-gray-700">{title}</h2>
      {period && <p className="text-xs text-gray-600">{period}</p>}
      <dl className="mt-3 space-y-1">{children}</dl>
    </section>
  );
}

function Row({ label, pence }: { label: string; pence: number }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-700">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-gray-900">{formatPence(pence)}</dd>
    </div>
  );
}

export default function DashboardPage() {
  const summary = useQuery({ queryKey: DASHBOARD_QUERY_KEY, queryFn: fetchDashboard });
  const data = summary.data;

  return (
    <main className="p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <Link to="/expenses" className="inline-flex min-h-11 items-center rounded bg-blue-800 px-4 text-white">
          Add entry
        </Link>
      </div>

      {summary.isPending && <p role="status" className="mt-6 text-gray-700">Loading…</p>}
      {summary.isError && (
        <p role="alert" className="mt-6 text-red-800">
          Could not load the dashboard. Please try again.
        </p>
      )}

      {data && (
        <>
          {data.recentEntries.length === 0 && data.draftCount === 0 && data.taxYear.incomePence === 0 && data.taxYear.expensesPence === 0 && (
            <p className="mt-6 text-gray-700">No entries yet. Add your first income or expense to see your position here.</p>
          )}

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <Card title="Tax year to date" period={`${data.taxYear.start} to ${data.taxYear.end}`}>
              <Row label="Income" pence={data.taxYear.incomePence} />
              <Row label="Expenses" pence={data.taxYear.expensesPence} />
              <Row label="Profit" pence={data.taxYear.profitPence} />
              <Link to="/expenses" className={linkClass}>
                View entries
              </Link>
            </Card>
            <Card title="This month" period={`${data.month.start} to ${data.month.end}`}>
              <Row label="Income" pence={data.month.incomePence} />
              <Row label="Expenses" pence={data.month.expensesPence} />
              <Row label="Profit" pence={data.month.profitPence} />
              <Link to="/expenses" className={linkClass}>
                View entries
              </Link>
            </Card>
            <Card title="VAT this quarter (estimate)" period={`${data.vatQuarter.start} to ${data.vatQuarter.end}`}>
              <Row label="VAT collected" pence={data.vatQuarter.vatCollectedPence} />
              <Row label="VAT paid" pence={data.vatQuarter.vatPaidPence} />
              <Link to="/vat" className={linkClass}>
                Go to the VAT page
              </Link>
            </Card>
          </div>

          {data.draftCount > 0 && (
            <p className="mt-6">
              <Link to="/expenses?status=draft" className={linkClass}>
                {data.draftCount} {data.draftCount === 1 ? "draft" : "drafts"} to confirm
              </Link>
            </p>
          )}

          {data.recentEntries.length > 0 && (
            <section className="mt-6">
              <h2 className="text-lg font-medium text-gray-900">Latest entries</h2>
              <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
                {data.recentEntries.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-2 p-3">
                    <span className="text-sm text-gray-600">{entry.date}</span>
                    <span className="min-w-0 flex-1 truncate text-gray-900" title={entry.description}>
                      {entry.description}
                    </span>
                    <span className="text-xs text-gray-700">{entry.status === "draft" ? "Draft" : "Confirmed"}</span>
                    <span className="text-right tabular-nums text-gray-900">{formatPence(entry.grossPence)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
