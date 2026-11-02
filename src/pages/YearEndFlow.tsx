import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import StateMessage from '../components/StateMessage';
import { confirmItsAnnual, previewItsAnnual, submitItsAnnual } from '../lib/itsAnnualApi';
import { formatPence, parsePence } from '../lib/money';

type Figure = { hmrcName: string; label: string; pounds: string; why: string };

// The plain label leads; the HMRC field name goes in small muted text for checking against HMRC's own pages.
const ADJUSTMENT_LABELS: Record<string, string> = {
  includedNonTaxableProfits: 'Profits that are not taxable',
  basisAdjustment: 'Change in how your profit is worked out',
  accountingAdjustment: 'Accounting change',
  averagingAdjustment: 'Averaging adjustment',
  outstandingBusinessIncome: 'Income you are still owed',
  balancingChargeBpra: 'Balancing charge (business premises)',
  balancingChargeOther: 'Balancing charge (other)',
  goodsAndServicesOwnUse: 'Goods or services you used yourself',
};

const buttonBase = 'inline-flex min-h-11 items-center rounded-md px-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-800';
const primaryButton = `${buttonBase} bg-blue-800 text-white hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50`;
const secondaryButton = `${buttonBase} border border-gray-300 bg-white text-gray-900 hover:bg-gray-50`;

function WhyThisAmount({ children }: { children: string }) {
  return (
    <details className="mt-4 text-sm text-gray-700">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-blue-800 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-800">
        Why is this amount?
      </summary>
      <p className="mt-1">{children}</p>
    </details>
  );
}

function FigureAmount({ figure }: { figure: Figure }) {
  const pence = parsePence(figure.pounds);
  return (
    <>
      <p className="mt-4 text-right text-3xl font-semibold tabular-nums text-gray-900">{pence === null ? figure.pounds : formatPence(pence)}</p>
      <p className="text-right text-xs text-gray-600">{figure.hmrcName}</p>
      <WhyThisAmount>{figure.why}</WhyThisAmount>
    </>
  );
}

// Only the step number is kept, so a returning owner resumes where they stopped; the figures are rebuilt
// from the books by the server preview each time. The declaration is deliberately not kept.
const stepKey = (taxYear: string) => `its-annual-step:${taxYear}`;

/** The year-end allowances and adjustments as a guided flow that resumes at the step the owner left on. */
export default function YearEndFlow({ taxYear, onLeave }: { taxYear: string; onLeave: () => void }) {
  const [savedStep, setSavedStep] = useState(() => Number(localStorage.getItem(stepKey(taxYear))) || 0);
  const setStepIndex = (step: number) => {
    localStorage.setItem(stepKey(taxYear), String(step));
    setSavedStep(step);
  };
  const [declared, setDeclared] = useState(false);
  const preview = useQuery({ queryKey: ['its-annual-preview', taxYear], queryFn: () => previewItsAnnual(taxYear), retry: false });
  const confirm = useMutation({ mutationFn: () => confirmItsAnnual(taxYear) });
  const submit = useMutation({ mutationFn: () => submitItsAnnual(taxYear) });

  const allowance = preview.data?.body.allowances?.tradingIncomeAllowance;
  const adjustments: Figure[] = Object.entries(preview.data?.body.adjustments ?? {}).map(([hmrcName, pounds]) => ({
    hmrcName,
    label: ADJUSTMENT_LABELS[hmrcName] ?? 'Other adjustment',
    pounds,
    why: 'This adjustment is already on your tax record for the year. Check it matches your own records before you send.',
  }));
  const totalSteps = 2 + adjustments.length;
  // A saved step can outlive a change in the figures, so keep it inside the steps that exist now.
  const stepIndex = Math.min(Math.max(savedStep, 0), totalSteps - 1);
  const sandbox = preview.data?.endpoint.sandbox ?? true;

  const tickDeclaration = (ticked: boolean) => {
    setDeclared(ticked);
    if (ticked) confirm.mutate();
    else confirm.reset();
  };

  if (preview.isPending) return <StateMessage kind="loading">Getting your year-end figures…</StateMessage>;
  if (preview.isError) return <StateMessage kind="error" onRetry={() => preview.refetch()}>{preview.error.message}</StateMessage>;

  if (submit.isSuccess) {
    localStorage.removeItem(stepKey(taxYear));
    return (
      <section role="status" className="rounded-md border border-gray-300 bg-white p-4 md:p-6">
        <h1 className="text-2xl font-semibold text-gray-900">Your year-end figures are sent</h1>
        <p className="mt-2 text-gray-700">{submit.data.sandbox ? 'They were sent to HMRC test mode, so nothing was filed for real.' : 'They were sent to HMRC.'}</p>
        <button type="button" onClick={onLeave} className={`mt-4 ${primaryButton}`}>Done</button>
      </section>
    );
  }

  const isLast = stepIndex === totalSteps - 1;
  let heading: string;
  let content: React.ReactNode;
  if (stepIndex === 0) {
    heading = 'How are you counting your costs?';
    content = allowance === undefined ? (
      <>
        <p className="mt-2 text-gray-700">You are claiming your actual costs, so there is no trading allowance to send.</p>
        <WhyThisAmount>You chose to claim what you really spent. HMRC does not let you claim the trading allowance as well.</WhyThisAmount>
      </>
    ) : (
      <>
        <p className="mt-2 text-gray-700">You are using the trading allowance instead of listing your costs. It takes this much off your income before tax:</p>
        <FigureAmount
          figure={{
            hmrcName: 'tradingIncomeAllowance',
            label: 'Trading allowance',
            pounds: allowance,
            why: 'You chose the trading allowance in your tax settings. It is a fixed amount set by HMRC for the tax year, so it is not worked out from your own costs.',
          }}
        />
      </>
    );
  } else if (!isLast) {
    const figure = adjustments[stepIndex - 1];
    heading = figure.label;
    content = <FigureAmount figure={figure} />;
  } else {
    heading = 'Check and send';
    content = (
      <>
        <p className="mt-2 text-gray-700">
          {allowance === undefined
            ? 'You are about to send HMRC your year-end figures for ' + taxYear + ': no trading allowance, because you claim your actual costs.'
            : `You are about to send HMRC your year-end figures for ${taxYear}: a trading allowance of ${formatPence(parsePence(allowance) ?? 0)}.`}
        </p>
        <label className="mt-4 flex min-h-11 items-start gap-3 text-gray-900">
          <input type="checkbox" checked={declared} onChange={(event) => tickDeclaration(event.target.checked)} className="mt-1 h-5 w-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-800" />
          <span>I declare that these figures are correct and complete to the best of my knowledge.</span>
        </label>
        {confirm.isError && <StateMessage kind="error" className="mt-2">{confirm.error.message}</StateMessage>}
        {submit.isError && <StateMessage kind="error" className="mt-2">{submit.error.message}</StateMessage>}
      </>
    );
  }

  return (
    <section aria-labelledby="year-end-heading" className="rounded-md border border-gray-300 bg-white p-4 md:p-6">
      <p className="text-sm font-medium text-gray-900">Step {stepIndex + 1} of {totalSteps}</p>
      {sandbox && <p className="mt-2 rounded-md border border-amber-700 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">HMRC test mode: nothing here is filed for real.</p>}
      <h1 id="year-end-heading" className="mt-2 text-2xl font-semibold text-gray-900">{heading}</h1>
      {content}
      <div className="mt-6 flex flex-wrap gap-3">
        {stepIndex > 0 && <button type="button" onClick={() => setStepIndex(stepIndex - 1)} className={secondaryButton}>Back</button>}
        {isLast ? (
          <button type="button" disabled={!declared || !confirm.isSuccess || submit.isPending} onClick={() => submit.mutate()} className={primaryButton}>Send to HMRC</button>
        ) : (
          <button type="button" onClick={() => setStepIndex(stepIndex + 1)} className={primaryButton}>Next</button>
        )}
        <button type="button" onClick={onLeave} className={secondaryButton}>Save and leave</button>
      </div>
    </section>
  );
}
