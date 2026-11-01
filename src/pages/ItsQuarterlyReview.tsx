import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import StateMessage from '../components/StateMessage';
import { formatDate } from '../lib/dates';
import type { CumulativePeriodSummary } from '../lib/hmrc/client';
import type { ItsObligationRow } from '../lib/hmrc/itsObligationsApi';
import { confirmItsUpdate, ItsUpdateError, previewItsUpdate, quarterOf, submitItsUpdate } from '../lib/hmrc/itsUpdateApi';
import { formatPence } from '../lib/money';

const INCOME_LABELS = { turnover: 'Sales and fees', other: 'Other business income' };
const EXPENSE_LABELS: Record<string, string> = {
  costOfGoods: 'Cost of goods',
  carVanTravelExpenses: 'Car, van and travel',
  premisesRunningCosts: 'Premises running costs',
  adminCosts: 'Admin costs',
  advertisingCosts: 'Advertising',
  professionalFees: 'Professional fees',
  financeCharges: 'Finance charges',
  otherExpenses: 'Other expenses',
};

/** HMRC amounts arrive as pounds strings; string maths on the parts keeps floats out of money. */
function poundsToDisplay(pounds: string): string {
  const [whole, fraction = ''] = pounds.replace('-', '').split('.');
  const pence = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  return `${pounds.startsWith('-') ? '-' : ''}${formatPence(pence)}`;
}

const ERROR_ADVICE: Record<string, string> = {
  DECLARATION_REQUIRED: 'Tick the declaration before you submit.',
  NOT_CONFIRMED: 'This update needs confirming again. Close this review, open it again and submit.',
  STALE_CONFIRMATION: 'Your records changed since you confirmed. Close this review, open it again and check the figures.',
  ALREADY_SUBMITTED: 'This update has already been sent to HMRC, or is being sent now.',
  OUTCOME_UNKNOWN: 'We could not tell whether HMRC received this update. Do not submit again. Check your HMRC account first.',
};

function errorMessage(error: unknown): string {
  if (error instanceof ItsUpdateError) {
    if (ERROR_ADVICE[error.code]) return ERROR_ADVICE[error.code];
    if (error.code === 'REQUEST_FAILED') return 'We could not reach the server. Check your connection and try again.';
    return `${error.message.replace(/[.!?]$/, '')}.`;
  }
  return 'Something went wrong. Try again.';
}

function Figures({ summary }: { summary: CumulativePeriodSummary }) {
  const rows: [string, string][] = [
    ...Object.entries(summary.periodIncome).map(([key, value]): [string, string] => [INCOME_LABELS[key as keyof typeof INCOME_LABELS] ?? key, value]),
    ...Object.entries(summary.periodExpenses ?? {}).map(([key, value]): [string, string] => [EXPENSE_LABELS[key] ?? key, value]),
  ];
  if (summary.periodAllowances) rows.push(['Trading allowance', summary.periodAllowances.tradingIncomeAllowance]);
  return (
    <dl className="mt-4 divide-y divide-gray-100 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 py-2">
          <dt className="text-gray-700">{label}</dt>
          <dd className="text-right tabular-nums text-gray-900">{poundsToDisplay(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ItsQuarterlyReview({ obligation, onClose }: { obligation: ItsObligationRow; onClose: () => void }) {
  const quarter = quarterOf(obligation)!;
  const [declared, setDeclared] = useState(false);
  const preview = useQuery({
    queryKey: ['its-update-preview', obligation.taxYear, quarter],
    queryFn: () => previewItsUpdate(obligation.taxYear, quarter),
    retry: false,
    gcTime: 0,
  });
  const submit = useMutation({
    mutationFn: async () => {
      await confirmItsUpdate(obligation.taxYear, quarter);
      return submitItsUpdate(obligation.taxYear, quarter);
    },
  });
  const period = `${formatDate(obligation.periodStart)} to ${formatDate(obligation.periodEnd)}`;
  const data = preview.data;
  // Submitting again after these would risk a duplicate filing.
  const blocked = submit.error instanceof ItsUpdateError && ['OUTCOME_UNKNOWN', 'ALREADY_SUBMITTED'].includes(submit.error.code);
  const sandbox = submit.data?.sandbox ?? data?.endpoint.sandbox;

  return (
    <section aria-labelledby="its-review-heading" className="mt-6 rounded-md border border-gray-300 bg-white p-4 md:p-6">
      <h3 id="its-review-heading" className="text-base font-semibold text-gray-900">Review quarterly update</h3>
      <p className="mt-1 text-sm text-gray-700">{period}. Figures are cumulative from the start of the tax year.</p>

      {sandbox !== undefined && (
        <p className={`mt-4 rounded-md border px-3 py-2 text-sm font-medium ${sandbox ? 'border-amber-700 bg-amber-50 text-amber-900' : 'border-red-800 bg-red-50 text-red-900'}`}>
          {sandbox ? 'Sandbox mode: this is a test. Nothing reaches your real HMRC record.' : 'Live mode: this goes to your real HMRC record.'}
        </p>
      )}

      {preview.isPending && <StateMessage kind="loading">Preparing your figures…</StateMessage>}
      {preview.isError && <StateMessage kind="error">{errorMessage(preview.error)}</StateMessage>}

      {data && submit.isSuccess && (
        <div role="status" className="mt-4 text-gray-900">
          <p className="font-medium">HMRC accepted this update</p>
          <p className="mt-1 text-sm text-gray-700">
            Quarterly update for {period}, sent as {submit.data.sandbox ? 'a sandbox test' : 'a live submission'}. HMRC does not send a receipt number for this update, so keep this page as your record.
          </p>
        </div>
      )}

      {data && (
        <>
          <Figures summary={data.body} />
          <details className="mt-4 text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-blue-800 underline">What will be sent to HMRC</summary>
            <p className="mt-2 break-all text-gray-700">{data.endpoint.method} {data.endpoint.url}</p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-gray-50 p-3 text-xs text-gray-900">{JSON.stringify(data.body, null, 2)}</pre>
          </details>

          {!submit.isSuccess && (
            <>
              <label className="mt-4 flex min-h-11 items-start gap-3 text-sm text-gray-900">
                <input type="checkbox" checked={declared} onChange={(event) => setDeclared(event.target.checked)} className="mt-1 h-5 w-5" />
                <span>I declare that the information is correct and complete to the best of my knowledge.</span>
              </label>
              {submit.isError && <StateMessage kind="error">{errorMessage(submit.error)}</StateMessage>}
            </>
          )}
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {data && !submit.isSuccess && !blocked && (
          <button
            type="button"
            disabled={!declared || submit.isPending}
            onClick={() => submit.mutate()}
            className="inline-flex min-h-11 items-center rounded-md bg-blue-800 px-4 text-white hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submit.isPending ? 'Submitting…' : 'Submit to HMRC'}
          </button>
        )}
        <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center rounded-md border border-gray-300 bg-white px-4 text-gray-900 hover:bg-gray-50">
          {submit.isSuccess ? 'Done' : 'Close'}
        </button>
      </div>
    </section>
  );
}
