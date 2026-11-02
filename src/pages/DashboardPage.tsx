import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import StateMessage from "../components/StateMessage";
import { consentState, fetchBankStatus } from "../lib/bankApi";
import { DASHBOARD_QUERY_KEY, fetchDashboard } from "../lib/dashboardApi";
import { fetchItsObligations } from "../lib/hmrc/itsObligationsApi";
import { buildHomeTodos } from "../lib/homeTodos";
import { formatPence } from "../lib/money";
import { currentTaxYear } from "../lib/taxBands";
import { fetchTaxEstimate, taxEstimateQueryKey } from "../lib/taxEstimateApi";
import { useVatObligations } from "./useVatObligations";
import SetupTodos from "./SetupTodos";

const actionClass = "inline-flex min-h-11 shrink-0 items-center rounded bg-blue-800 px-4 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-800";
const figureClass = "flex min-h-11 items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4 text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-800";

function Figure({ label, pence, to }: { label: string; pence: number; to: string }) {
  return (
    <li>
      <Link to={to} className={figureClass}>
        <span>{label}</span>
        <span className="text-right font-medium tabular-nums">{formatPence(pence)}</span>
      </Link>
    </li>
  );
}

export default function DashboardPage() {
  const taxYear = currentTaxYear();
  const vat = useVatObligations();
  const its = useQuery({ queryKey: ["its-obligations"], queryFn: () => fetchItsObligations(), retry: false });
  const bank = useQuery({ queryKey: ["bank-status"], queryFn: fetchBankStatus, retry: false });
  const summary = useQuery({ queryKey: DASHBOARD_QUERY_KEY, queryFn: fetchDashboard, retry: false });
  const taxEstimate = useQuery({ queryKey: taxEstimateQueryKey(taxYear), queryFn: () => fetchTaxEstimate(taxYear), retry: false });

  const loadingTodos = [vat, its, bank, summary].some((source) => source.isPending);
  const failures = [
    vat.isError && "Could not check your VAT returns.",
    its.isError && "Could not check your Income Tax updates.",
    bank.isError && "Could not check your bank connection.",
    summary.isError && "Could not load your money summary.",
    taxEstimate.isError && "Could not work out your tax to set aside.",
  ].filter(Boolean);

  const now = new Date();
  const itsResult = its.data && "obligations" in its.data ? its.data.obligations : [];
  const bankStatus = bank.data?.connected && bank.data.consentExpiresAt ? bank.data : null;
  const todos = loadingTodos
    ? null
    : buildHomeTodos(
        {
          vatObligations: vat.data ?? [],
          itsObligations: itsResult,
          unsortedBankCount: summary.data?.unsortedBankCount ?? 0,
          receiptsToCheckCount: summary.data?.receiptsToCheckCount ?? 0,
          bank: bankStatus ? { state: consentState(bankStatus.consentExpiresAt!, now), expiresAt: bankStatus.consentExpiresAt! } : null,
          // Skipped setup steps render in <SetupTodos /> above, with their own fetch and error state.
          skippedSetupSteps: [],
        },
        now,
      );

  return (
    <main className="p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Home</h1>

      {failures.length > 0 && (
        <StateMessage kind="error" className="mt-4">{failures.join(" ")}</StateMessage>
      )}

      <SetupTodos />

      <section aria-labelledby="todo-heading" className="mt-6">
        <h2 id="todo-heading" className="text-lg font-medium text-gray-900">What needs doing</h2>
        {todos === null && <StateMessage kind="loading">Loading…</StateMessage>}
        {todos?.upToDate && <StateMessage kind="empty">{todos.upToDate}</StateMessage>}
        {todos && todos.items.length > 0 && (
          <ul aria-label="To-do list" className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {todos.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <span className="min-w-0 flex-1 text-gray-900">
                  {item.daysLate !== undefined && <strong className="mr-2 text-red-800">Overdue</strong>}
                  {item.title}
                </span>
                <Link to={item.route} className={actionClass}>{item.buttonLabel}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="money-heading" className="mt-8">
        <h2 id="money-heading" className="text-lg font-medium text-gray-900">This month</h2>
        <ul className="mt-2 grid gap-3 md:grid-cols-3">
          {summary.data && <Figure label="Money in" pence={summary.data.month.incomePence} to="/money-in" />}
          {summary.data && <Figure label="Money out" pence={summary.data.month.expensesPence} to="/money-out" />}
          {taxEstimate.data && <Figure label="Tax to set aside" pence={taxEstimate.data.setAsidePence} to="/tax/income-tax" />}
        </ul>
      </section>
    </main>
  );
}
