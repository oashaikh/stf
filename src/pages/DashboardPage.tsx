import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { DASHBOARD_QUERY_KEY, fetchDashboard } from "../lib/dashboardApi";
import { formatDate } from "../lib/dates";
import { formatPence } from "../lib/money";
import { currentTaxYear } from "../lib/taxBands";
import { fetchTaxEstimate, taxEstimateQueryKey } from "../lib/taxEstimateApi";

import type { VatObligationRow } from "../lib/hmrc/vatApi";
import { getObligationDueWithin, REMINDER_WINDOW_DAYS } from "../lib/vatReminder";
import type { ApiResponse } from "../model/types";
import { useVatObligations } from "./useVatObligations";

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

// Same key and response shape as the review on VatPage, so a visit to either page warms the other.
async function fetchVatReturnDraft(period: VatObligationRow): Promise<{ boxes: { box5: number }; status: string | null }> {
  const fields = new URLSearchParams({ periodKey: period.periodKey, start: period.start, end: period.end });
  const response = await fetch(`/api/vat/return?${fields}`, { credentials: "same-origin" });
  const body = (await response.json().catch(() => null)) as ApiResponse<{ boxes: { box5: number }; status: string | null }> | null;
  if (!body?.ok) throw new Error(body?.error ?? "Request failed");
  return body.data;
}

function UpcomingVatReturnCard() {
  const obligations = useVatObligations();
  const dueSoon = Array.isArray(obligations.data)
    ? getObligationDueWithin(obligations.data, new Date().toISOString().slice(0, 10), REMINDER_WINDOW_DAYS)
    : undefined;
  const review = useQuery({
    queryKey: ["vat-return", dueSoon?.periodKey],
    queryFn: () => fetchVatReturnDraft(dueSoon as VatObligationRow),
    enabled: dueSoon !== undefined,
    retry: false,
  });
  if (!dueSoon || !review.data) return null;

  return (
    <Card title="Upcoming VAT return" period={`Period ${dueSoon.periodKey}`}>
      <div className="flex justify-between gap-4">
        <dt className="text-gray-700">Due</dt>
        <dd className="text-right font-medium text-gray-900">{formatDate(dueSoon.due)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-gray-700">Draft</dt>
        <dd className="text-right text-gray-900">{review.data.status === null ? "Not yet drafted" : "Draft saved"}</dd>
      </div>
      <Row label="Box 5: net VAT to pay" pence={review.data.boxes.box5} />
      <Link to="/vat" className={linkClass}>
        Review VAT return
      </Link>
    </Card>
  );
}

export default function DashboardPage() {
  const summary = useQuery({ queryKey: DASHBOARD_QUERY_KEY, queryFn: fetchDashboard });
  const data = summary.data;
  const taxYear = currentTaxYear();
  const taxEstimate = useQuery({ queryKey: taxEstimateQueryKey(taxYear), queryFn: () => fetchTaxEstimate(taxYear) });

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

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
            <UpcomingVatReturnCard />
            {taxEstimate.data && (
              <Card title="Tax set-aside (estimate)" period={`Tax year ${taxEstimate.data.taxYear}`}>
                <Row label="Income tax and NIC" pence={taxEstimate.data.totalTaxPence} />
                <Link to="/tax" className={linkClass}>
                  Go to the Tax page
                </Link>
              </Card>
            )}
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
