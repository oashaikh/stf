import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import StateMessage from '../components/StateMessage';
import { formatDate } from '../lib/dates';
import type { CumulativePeriodSummary } from '../lib/hmrc/client';
import type { ItsObligationRow } from '../lib/hmrc/itsObligationsApi';
import { confirmItsUpdate, ItsUpdateError, previewItsUpdate, quarterOf, submitItsUpdate } from '../lib/hmrc/itsUpdateApi';
import { formatPence } from '../lib/money';

// The plain label comes first; the HMRC field name goes under it in small text for checking against a letter.
const INCOME_LABELS: Record<string, string> = { turnover: 'Sales and fees', other: 'Other business income' };
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
const UNKNOWN_LABEL = 'Other amount';

/** HMRC amounts arrive as pounds strings; string maths on the parts keeps floats out of money. */
function poundsToPence(pounds: string): number {
  const [whole, fraction = ''] = pounds.replace('-', '').split('.');
  const pence = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  return pounds.startsWith('-') ? -pence : pence;
}

type Figure = { key: string; label: string; pence: number };

function figuresOf(summary: CumulativePeriodSummary) {
  const income: Figure[] = Object.entries(summary.periodIncome).map(([key, value]) => ({ key, label: INCOME_LABELS[key] ?? UNKNOWN_LABEL, pence: poundsToPence(value) }));
  const costs: Figure[] = summary.periodAllowances
    ? [{ key: 'tradingIncomeAllowance', label: 'Trading allowance', pence: poundsToPence(summary.periodAllowances.tradingIncomeAllowance) }]
    : Object.entries(summary.periodExpenses ?? {}).map(([key, value]) => ({ key, label: EXPENSE_LABELS[key] ?? UNKNOWN_LABEL, pence: poundsToPence(value ?? '0') }));
  return { income, costs };
}

const sumPence = (figures: Figure[]) => figures.reduce((total, figure) => total + figure.pence, 0);

const ERROR_ADVICE: Record<string, string> = {
  DECLARATION_REQUIRED: 'Tick the declaration before you send.',
  NOT_CONFIRMED: 'This update needs confirming again. Choose Save and leave, open the update again and send it.',
  STALE_CONFIRMATION: 'Your records changed since you confirmed. Choose Save and leave, open the update again and check the figures.',
  ALREADY_SUBMITTED: 'This update has already been sent to HMRC, or is being sent now.',
  OUTCOME_UNKNOWN: 'We could not tell whether HMRC received this update. Do not send it again. Check your HMRC account first.',
};

function errorMessage(error: unknown): string {
  if (error instanceof ItsUpdateError) {
    if (ERROR_ADVICE[error.code]) return ERROR_ADVICE[error.code];
    if (error.code === 'REQUEST_FAILED') return 'We could not reach the server. Check your connection and try again.';
    return `${error.message.replace(/[.!?]$/, '')}.`;
  }
  return 'Something went wrong. Try again.';
}

function Figures({ figures, whyText, paymentsPath, paymentsLabel }: { figures: Figure[]; whyText: string; paymentsPath: string; paymentsLabel: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="mt-4 divide-y divide-gray-100 text-sm">
      {figures.map(({ key, label, pence }) => (
        <li key={key} className="py-3">
          <div className="flex justify-between gap-4">
            <div>
              <p className="text-gray-900">{label}</p>
              <p className="text-xs text-gray-600">{key}</p>
            </div>
            <p className="text-right tabular-nums text-gray-900">{formatPence(pence)}</p>
          </div>
          <button
            type="button"
            aria-expanded={open === key}
            onClick={() => setOpen(open === key ? null : key)}
            className="inline-flex min-h-11 items-center text-blue-800 underline"
          >
            Why is this {formatPence(pence)}?
          </button>
          {open === key && (
            <p className="text-gray-700">
              {whyText}{' '}
              <Link to={paymentsPath} className="inline-flex min-h-11 items-center text-blue-800 underline">{paymentsLabel}</Link>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

const PREVIEW_FIX: Record<string, { advice: string; to: string; action: string }> = {
  NINO_MISSING: { advice: 'We need your National Insurance number before we can prepare this update.', to: '/settings', action: 'Add it in Settings' },
  NO_NINO: { advice: 'We need your National Insurance number before we can prepare this update.', to: '/settings', action: 'Add it in Settings' },
  HMRC_NOT_CONNECTED: { advice: 'Your HMRC account is not connected, so nothing has been prepared.', to: '/settings', action: 'Connect HMRC in Settings' },
  ITS_SCOPE_MISSING: { advice: 'HMRC needs you to allow Income Tax access again. Nothing has been sent.', to: '/settings', action: 'Reconnect HMRC in Settings' },
  NO_BUSINESS_SELECTED: { advice: 'Choose which business this update is for. Nothing has been sent.', to: '/settings', action: 'Choose it in Settings' },
};

type Step = 'income' | 'costs' | 'send';
const STEPS: Step[] = ['income', 'costs', 'send'];

export default function ItsQuarterlyReview({ obligation, onClose }: { obligation: ItsObligationRow; onClose: () => void }) {
  const quarter = quarterOf(obligation)!;
  const queryClient = useQueryClient();
  // Remembered per quarter so "Save and leave" lets the person come back to the same step.
  const stepKey = `its-review-step:${obligation.taxYear}:${quarter}`;
  const [step, setStepState] = useState<Step>(() => {
    const saved = sessionStorage.getItem(stepKey) as Step | null;
    return saved && STEPS.includes(saved) ? saved : 'income';
  });
  const setStep = (next: Step) => {
    sessionStorage.setItem(stepKey, next);
    setStepState(next);
  };
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
    onSuccess: () => {
      sessionStorage.removeItem(stepKey);
      return queryClient.invalidateQueries({ queryKey: ['its-obligations'] });
    },
  });
  const period = `${formatDate(obligation.periodStart)} to ${formatDate(obligation.periodEnd)}`;
  const data = preview.data;
  // Sending again after these would risk a duplicate filing.
  const blocked = submit.error instanceof ItsUpdateError && ['OUTCOME_UNKNOWN', 'ALREADY_SUBMITTED'].includes(submit.error.code);
  const sandbox = submit.data?.sandbox ?? data?.endpoint.sandbox;
  const figures = data ? figuresOf(data.body) : null;
  const stepNumber = STEPS.indexOf(step) + 1;
  const previewFix = preview.error instanceof ItsUpdateError ? PREVIEW_FIX[preview.error.code] : undefined;

  const stepButtons = (
    <div className="mt-4 flex flex-wrap gap-3">
      {step === 'send' ? (
        !submit.isSuccess && !blocked && (
          <button
            type="button"
            disabled={!declared || submit.isPending}
            onClick={() => submit.mutate()}
            className="inline-flex min-h-11 items-center rounded-md bg-blue-800 px-4 text-white hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submit.isPending ? 'Sending…' : 'Send to HMRC'}
          </button>
        )
      ) : (
        <button type="button" onClick={() => setStep(STEPS[stepNumber])} className="inline-flex min-h-11 items-center rounded-md bg-blue-800 px-4 text-white hover:bg-blue-900">
          Next
        </button>
      )}
      {stepNumber > 1 && !submit.isSuccess && (
        <button type="button" onClick={() => setStep(STEPS[stepNumber - 2])} className="inline-flex min-h-11 items-center rounded-md border border-gray-300 bg-white px-4 text-gray-900 hover:bg-gray-50">
          Back
        </button>
      )}
    </div>
  );

  return (
    // The bottom padding keeps the buttons clear of the fixed phone menu.
    <section aria-labelledby="its-review-heading" className="mt-6 rounded-md border border-gray-300 bg-white p-4 pb-24 md:p-6 md:pb-6">
      <h3 id="its-review-heading" className="text-base font-semibold text-gray-900">Send your Income Tax update</h3>
      <p className="mt-1 text-sm text-gray-700">{period}. Figures add up from the start of the tax year.</p>
      {data && !submit.isSuccess && <p className="mt-1 text-sm font-medium text-gray-900">Step {stepNumber} of {STEPS.length}</p>}

      {sandbox !== undefined && (
        <p className={`mt-4 rounded-md border px-3 py-2 text-sm font-medium ${sandbox ? 'border-amber-700 bg-amber-50 text-amber-900' : 'border-red-800 bg-red-50 text-red-900'}`}>
          {sandbox ? 'Test mode: this is a practice run. Nothing reaches your real HMRC record.' : 'Live mode: this goes to your real HMRC record.'}
        </p>
      )}

      {preview.isPending && <StateMessage kind="loading">Preparing your figures…</StateMessage>}
      {preview.isError && (
        <>
          <StateMessage kind="error">{previewFix?.advice ?? errorMessage(preview.error)}</StateMessage>
          {previewFix && <Link to={previewFix.to} className="inline-flex min-h-11 items-center text-blue-800 underline">{previewFix.action}</Link>}
        </>
      )}

      {data && figures && submit.isSuccess && (
        <div role="status" className="mt-4 text-gray-900">
          <p className="font-medium">HMRC has your update</p>
          <p className="mt-1 text-sm text-gray-700">
            Your update for {period} was sent as {submit.data.sandbox ? 'a test' : 'a live update'}. HMRC does not give a receipt number for this update, so keep this page as your record.
          </p>
        </div>
      )}

      {data && figures && !submit.isSuccess && step === 'income' && (
        <>
          <h4 className="mt-4 font-medium text-gray-900">Check the money you made</h4>
          <Figures figures={figures.income} whyText="This is the total of the invoices and other money in you recorded from the start of the tax year." paymentsPath="/invoices" paymentsLabel="See the payments behind it" />
        </>
      )}

      {data && figures && !submit.isSuccess && step === 'costs' && (
        <>
          <h4 className="mt-4 font-medium text-gray-900">Check what you spent</h4>
          <Figures figures={figures.costs} whyText="This is the total of the business costs you recorded in this group from the start of the tax year." paymentsPath="/expenses" paymentsLabel="See the payments behind it" />
        </>
      )}

      {data && figures && !submit.isSuccess && step === 'send' && (
        <>
          <p className="mt-4 font-medium text-gray-900">
            You are telling HMRC your income was {formatPence(sumPence(figures.income))} and your costs were {formatPence(sumPence(figures.costs))} for {period}.
          </p>
          <label className="mt-4 flex min-h-11 items-start gap-3 text-sm text-gray-900">
            <input type="checkbox" checked={declared} onChange={(event) => setDeclared(event.target.checked)} className="mt-1 h-5 w-5" />
            <span>I declare that the information is correct and complete to the best of my knowledge.</span>
          </label>
          {submit.isError && <StateMessage kind="error">{errorMessage(submit.error)}</StateMessage>}
          <details className="mt-4 text-xs text-gray-600">
            <summary className="inline-flex min-h-11 cursor-pointer items-center">Technical details</summary>
            <p className="mt-2 break-all">{data.endpoint.method} {data.endpoint.url}</p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-gray-50 p-3 text-gray-900">{JSON.stringify(data.body, null, 2)}</pre>
          </details>
        </>
      )}

      {data && !submit.isSuccess && stepButtons}
      <div className="mt-3">
        <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center text-blue-800 underline">
          {submit.isSuccess ? 'Done' : 'Save and leave'}
        </button>
      </div>
    </section>
  );
}
