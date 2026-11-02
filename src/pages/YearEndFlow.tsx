import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import OfficialName from '../components/OfficialName';
import StateMessage from '../components/StateMessage';
import type { PropertyAnnualSubmission } from '../lib/hmrc/client';
import { previewItsPropertyUpdate } from '../lib/hmrc/itsUpdateApi';
import { fetchItsBusinesses } from '../lib/hmrc/settingsApi';
import { confirmItsAnnual, previewItsAnnual, submitItsAnnual, type ItsAnnualTarget } from '../lib/itsAnnualApi';
import { formatPence, parsePence } from '../lib/money';
import { getTaxBands } from '../lib/taxBands';

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

function WhyThisAmount({ children, label = 'Why is this amount?' }: { children: string; label?: string }) {
  return (
    <details className="mt-4 text-sm text-gray-700">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-blue-800 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-800">
        {label}
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

/** The self-employment year-end allowances and adjustments as a guided flow that resumes at the step the owner left on. */
function SelfEmploymentYearEnd({ taxYear, onLeave, onContinueToProperty }: { taxYear: string; onLeave: () => void; onContinueToProperty?: () => void }) {
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
  if (preview.isError) {
    return (
      <>
        <StateMessage kind="error" onRetry={() => preview.refetch()}>{preview.error.message}</StateMessage>
        {onContinueToProperty && <button type="button" onClick={onContinueToProperty} className={`mt-4 ${secondaryButton}`}>Skip to your rental property</button>}
      </>
    );
  }

  if (submit.isSuccess) {
    localStorage.removeItem(stepKey(taxYear));
    return (
      <section role="status" className="rounded-md border border-gray-300 bg-white p-4 md:p-6">
        <h1 className="text-2xl font-semibold text-gray-900">Your year-end figures are sent</h1>
        <p className="mt-2 text-gray-700">{submit.data.sandbox ? 'They were sent to HMRC test mode, so nothing was filed for real.' : 'They were sent to HMRC.'}</p>
        {onContinueToProperty ? (
          <button type="button" onClick={onContinueToProperty} className={`mt-4 ${primaryButton}`}>Continue to your rental property</button>
        ) : (
          <button type="button" onClick={onLeave} className={`mt-4 ${primaryButton}`}>Done</button>
        )}
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
          <input type="checkbox" checked={declared} onChange={(event) => tickDeclaration(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-800" />
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
        {onContinueToProperty && <button type="button" onClick={onContinueToProperty} className={secondaryButton}>Skip to your rental property</button>}
      </div>
    </section>
  );
}

const propertyStepKey = (taxYear: string) => `its-property-annual-step:${taxYear}`;
const propertyChoiceKey = (taxYear: string) => `its-property-annual-choice:${taxYear}`;
const PROPERTY_STEPS = 3;

type PropertyChoice = ItsAnnualTarget['choice'];

// HMRC sends pounds as JSON numbers; parsePence is the one place they become pence.
const poundsToPence = (pounds: number) => parsePence(String(pounds)) ?? 0;

function ExplainedFigure({ label, official, pence, why }: { label: string; official: string; pence: number; why: string }) {
  return (
    <div className="mt-4 border-t border-gray-300 pt-4">
      <p className="text-gray-900">{label}</p>
      <OfficialName>{official}</OfficialName>
      <p className="mt-2 text-right text-3xl font-semibold tabular-nums text-gray-900">{formatPence(pence)}</p>
      <WhyThisAmount>{why}</WhyThisAmount>
    </div>
  );
}

/** The rental property year-end steps: what you earned and spent, the allowance or actual costs, then check and send. */
function PropertyYearEnd({ taxYear, onLeave }: { taxYear: string; onLeave: () => void }) {
  const [step, setStep] = useState(() => Number(localStorage.getItem(propertyStepKey(taxYear))) || 0);
  const [savedChoice, setSavedChoice] = useState(() => localStorage.getItem(propertyChoiceKey(taxYear)) as PropertyChoice | null);
  const [declared, setDeclared] = useState(false);
  const goToStep = (next: number) => {
    localStorage.setItem(propertyStepKey(taxYear), String(next));
    setStep(next);
  };
  // A year's rent and costs so far are the quarter 4 totals, which end on the last day of the tax year.
  const figures = useQuery({ queryKey: ['its-property-figures', taxYear], queryFn: () => previewItsPropertyUpdate(taxYear, 4), retry: false });
  const rentPence = poundsToPence(figures.data?.body.ukProperty.income?.periodAmount ?? 0);
  const costsPence = Object.values(figures.data?.body.ukProperty.expenses ?? {}).reduce((sum, pounds) => sum + poundsToPence(pounds), 0);
  // The allowance cannot be more than the rent received.
  const allowancePence = Math.min(getTaxBands(taxYear).propertyAllowancePence, rentPence);
  const choice: PropertyChoice = savedChoice ?? (costsPence > allowancePence ? 'actual' : 'allowance');
  const isLast = step >= PROPERTY_STEPS - 1;
  const stepIndex = Math.min(step, PROPERTY_STEPS - 1);

  const target: ItsAnnualTarget = { taxYear, business: 'uk-property', choice };
  const annual = useQuery({
    queryKey: ['its-annual-preview', taxYear, 'uk-property', choice],
    queryFn: () => previewItsAnnual<PropertyAnnualSubmission>(target),
    enabled: isLast,
    retry: false,
  });
  const confirm = useMutation({ mutationFn: () => confirmItsAnnual(target) });
  const submit = useMutation({
    mutationFn: () => submitItsAnnual(target),
    onSuccess: () => {
      localStorage.removeItem(propertyStepKey(taxYear));
      localStorage.removeItem(propertyChoiceKey(taxYear));
    },
  });

  const chooseOption = (next: PropertyChoice) => {
    localStorage.setItem(propertyChoiceKey(taxYear), next);
    setSavedChoice(next);
    setDeclared(false);
    confirm.reset();
  };
  const tickDeclaration = (ticked: boolean) => {
    setDeclared(ticked);
    if (ticked) confirm.mutate();
    else confirm.reset();
  };

  if (figures.isPending) return <StateMessage kind="loading">Getting your rental figures…</StateMessage>;
  if (figures.isError) return <StateMessage kind="error" onRetry={() => figures.refetch()}>{figures.error.message}</StateMessage>;
  const sandbox = figures.data.endpoint.sandbox;

  if (submit.isSuccess) {
    return (
      <section role="status" className="rounded-md border border-gray-300 bg-white p-4 md:p-6">
        <h1 className="text-2xl font-semibold text-gray-900">Your rental property figures are sent</h1>
        <p className="mt-2 text-gray-700">{submit.data.sandbox ? 'They were sent to HMRC test mode, so nothing was filed for real.' : 'They were sent to HMRC.'}</p>
        <button type="button" onClick={onLeave} className={`mt-4 ${primaryButton}`}>Done</button>
      </section>
    );
  }

  const allowanceLeavesMore = allowancePence >= costsPence;
  let heading: string;
  let content: React.ReactNode;
  if (stepIndex === 0) {
    heading = 'What you earned and spent on your rental';
    content = (
      <>
        <p className="mt-2 text-gray-700">These come from the payments you have sorted for the year.</p>
        <ExplainedFigure label="Rent you received" official="Property income" pence={rentPence} why="This is the rent from every payment you sorted as rental income in this tax year." />
        <ExplainedFigure label="Costs you paid for the rental" official="Property expenses" pence={costsPence} why="This adds up every payment you sorted as a rental cost in this tax year, such as repairs, fees and running costs." />
      </>
    );
  } else if (stepIndex === 1) {
    heading = 'How do you want to count your costs?';
    const radioLabel = 'flex min-h-11 items-center gap-3 text-gray-900';
    const radioInput = 'h-5 w-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-800';
    content = (
      <fieldset className="mt-2">
        <legend className="text-gray-700">
          The flat allowance leaves {formatPence(allowancePence)} tax-free. Your actual costs leave {formatPence(costsPence)}.{' '}
          <strong className="font-semibold text-gray-900">{allowanceLeavesMore ? 'The flat allowance leaves more tax-free.' : 'Your actual costs leave more tax-free.'}</strong>
        </legend>
        <label className={`mt-3 ${radioLabel}`}>
          <input type="radio" name="property-choice" checked={choice === 'allowance'} onChange={() => chooseOption('allowance')} className={radioInput} />
          <span>Flat {formatPence(getTaxBands(taxYear).propertyAllowancePence)} rental allowance</span>
        </label>
        <OfficialName>Property allowance</OfficialName>
        <label className={`mt-3 ${radioLabel}`}>
          <input type="radio" name="property-choice" checked={choice === 'actual'} onChange={() => chooseOption('actual')} className={radioInput} />
          <span>Claim my actual costs</span>
        </label>
        <WhyThisAmount label="Which should I pick?">You can have one or the other, not both. Pick the one that leaves more of your rent tax-free. We have already picked it for you, and you can change it.</WhyThisAmount>
      </fieldset>
    );
  } else {
    heading = 'Check and send';
    const sentAllowance = annual.data?.body.ukProperty.allowances?.propertyIncomeAllowance;
    content = annual.isPending ? (
      <StateMessage kind="loading">Checking what will be sent…</StateMessage>
    ) : annual.isError ? (
      <StateMessage kind="error" onRetry={() => annual.refetch()}>{annual.error.message}</StateMessage>
    ) : (
      <>
        <p className="mt-2 text-gray-700">
          {sentAllowance === undefined
            ? `You are telling HMRC you are claiming your actual costs for ${taxYear}, so no rental allowance is sent.`
            : `You are telling HMRC you are using the flat rental allowance for ${taxYear}, instead of your actual costs.`}
        </p>
        {sentAllowance !== undefined && (
          <ExplainedFigure
            label="Rental allowance"
            official="propertyIncomeAllowance"
            pence={poundsToPence(sentAllowance)}
            why="HMRC sets this flat amount for the tax year. It is never more than the rent you received."
          />
        )}
        <label className="mt-4 flex min-h-11 items-start gap-3 text-gray-900">
          <input type="checkbox" checked={declared} onChange={(event) => tickDeclaration(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-800" />
          <span>I declare that these figures are correct and complete to the best of my knowledge.</span>
        </label>
        {confirm.isError && <StateMessage kind="error" className="mt-2">{confirm.error.message}</StateMessage>}
        {submit.isError && <StateMessage kind="error" className="mt-2">{submit.error.message}</StateMessage>}
      </>
    );
  }

  return (
    <section aria-labelledby="property-year-end-heading" className="rounded-md border border-gray-300 bg-white p-4 md:p-6">
      <p className="text-sm font-medium text-gray-900">Step {stepIndex + 1} of {PROPERTY_STEPS}</p>
      {sandbox && <p className="mt-2 rounded-md border border-amber-700 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">HMRC test mode: nothing here is filed for real.</p>}
      <h1 id="property-year-end-heading" className="mt-2 text-2xl font-semibold text-gray-900">{heading}</h1>
      {content}
      <div className="mt-6 flex flex-wrap gap-3">
        {stepIndex > 0 && <button type="button" onClick={() => goToStep(stepIndex - 1)} className={secondaryButton}>Back</button>}
        {isLast ? (
          <button type="button" disabled={!declared || !confirm.isSuccess || submit.isPending} onClick={() => submit.mutate()} className={primaryButton}>Send to HMRC</button>
        ) : (
          <button type="button" onClick={() => goToStep(stepIndex + 1)} className={primaryButton}>Next</button>
        )}
        <button type="button" onClick={onLeave} className={secondaryButton}>Save and leave</button>
      </div>
    </section>
  );
}

/** The Income Tax year end: self-employment first, then the rental property when the owner has one. */
export default function YearEndFlow({ taxYear, onLeave }: { taxYear: string; onLeave: () => void }) {
  // Returning part-way through the rental steps goes straight back to them.
  const [onProperty, setOnProperty] = useState(() => localStorage.getItem(propertyStepKey(taxYear)) !== null);
  // A failed lookup just hides the rental steps; it must not block the self-employment figures.
  const businesses = useQuery({ queryKey: ['its-businesses'], queryFn: () => fetchItsBusinesses(), retry: false });
  if (onProperty) return <PropertyYearEnd taxYear={taxYear} onLeave={onLeave} />;
  // Wait for the lookup so a property-only owner never sees the self-employment steps flash up.
  if (businesses.isPending) return <StateMessage kind="loading">Getting your businesses…</StateMessage>;
  const hasProperty = Boolean(businesses.data?.propertyBusinessId);
  // Without a self-employment business there is nothing to send for it, and its preview would only refuse.
  if (hasProperty && !businesses.data?.selectedBusinessId) return <PropertyYearEnd taxYear={taxYear} onLeave={onLeave} />;
  return (
    <SelfEmploymentYearEnd
      taxYear={taxYear}
      onLeave={onLeave}
      onContinueToProperty={
        hasProperty
          ? () => {
              localStorage.setItem(propertyStepKey(taxYear), '0');
              setOnProperty(true);
            }
          : undefined
      }
    />
  );
}
