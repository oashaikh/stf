import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import StateMessage from '../components/StateMessage';
import { fetchBankConnectUrl } from '../lib/bankApi';
import { VatNumberRefusedError, fetchHmrcConnectUrl, saveVatNumber } from '../lib/hmrc/settingsApi';
import { fetchSetupFacts, saveSetupAnswers, type SetupAnswers } from '../lib/setupApi';
import { SETUP_STEPS, stepLabel, stepsDone, type BusinessType, type SetupFacts, type SetupStepId } from '../lib/setupFlow';

/** Set just before leaving for HMRC or the bank, whose callbacks land on other pages. */
export const SETUP_RETURN_KEY = 'stf-setup-return';

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const primaryButton = `min-h-11 min-w-11 rounded-md bg-blue-700 px-4 text-white hover:bg-blue-800 disabled:opacity-50 ${focusRing}`;
const secondaryButton = `min-h-11 min-w-11 rounded-md border border-gray-400 px-4 text-gray-900 hover:bg-gray-100 disabled:opacity-50 ${focusRing}`;

const BUSINESS_TYPES: { value: BusinessType; label: string; officialName: string }[] = [
  { value: 'sole_trader', label: 'I work for myself', officialName: 'Sole trader' },
  { value: 'partnership', label: 'I run a business with partners', officialName: 'Partnership' },
  { value: 'limited_company', label: 'I run a limited company', officialName: 'Limited company' },
];

/** Sends the user back to /setup after HMRC or the bank returns them to another page. */
export function ReturnToSetup() {
  const { pathname } = useLocation();
  if (!sessionStorage.getItem(SETUP_RETURN_KEY)) return null;
  // Cleared on /setup too, or the bank's callback landing there would send a later visit to Home straight back.
  sessionStorage.removeItem(SETUP_RETURN_KEY);
  return pathname === '/setup' ? null : <Navigate to="/setup" replace />;
}

function Choice({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-gray-300 px-4 py-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-700">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="size-5" />
      <span>{children}</span>
    </label>
  );
}

export default function SetupFlow() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [facts, setFacts] = useState<SetupFacts | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [current, setCurrent] = useState<SetupStepId | 'finished'>('business_type');
  const [changing, setChanging] = useState(false);
  const [businessType, setBusinessType] = useState<BusinessType>('sole_trader');
  const [vatChoice, setVatChoice] = useState<'yes' | 'no' | null>(null);
  const [vatInput, setVatInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    setLoadFailed(false);
    fetchSetupFacts().then(
      (loaded) => {
        setFacts(loaded);
        setBusinessType(loaded.setup.businessType);
        setVatChoice(loaded.setup.vatRegistered === null ? null : loaded.setup.vatRegistered ? 'yes' : 'no');
        // Resume where the user left off; skipped steps are not asked again here.
        const resumeAt = SETUP_STEPS.find(
          (step) => !stepsDone(loaded).includes(step.id) && !loaded.setup.skippedSteps.includes(step.id),
        );
        // A to-do on Home reopens its own step with ?step=.
        const requested = SETUP_STEPS.find((step) => step.id === searchParams.get('step'));
        setCurrent(requested?.id ?? resumeAt?.id ?? 'finished');
      },
      () => setLoadFailed(true),
    );
  }
  // Runs once on arrival; the ?step= it reads is only the way in, not something to reload on.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  if (loadFailed) return <StateMessage kind="error" className="p-6" onRetry={load}>We could not load your setup. Please try again.</StateMessage>;
  if (!facts) return <StateMessage kind="loading" className="p-6">Loading…</StateMessage>;

  const done = stepsDone(facts);
  const skipped = facts.setup.skippedSteps;

  /** Runs a save; on failure the user stays on the step with a plain message. */
  async function attempt(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch {
      setError('We could not save that. Nothing was lost. Please try again.');
    }
    setBusy(false);
  }

  async function save(answers: SetupAnswers) {
    const setup = await saveSetupAnswers(answers);
    setFacts((previous) => previous && { ...previous, setup });
    return setup;
  }

  function goTo(id: SetupStepId | 'finished') {
    setChanging(false);
    setVatInput('');
    setCurrent(id);
  }

  function stepAfter(id: SetupStepId) {
    return SETUP_STEPS[SETUP_STEPS.findIndex((step) => step.id === id) + 1]?.id ?? 'finished';
  }

  async function completeStep(id: SetupStepId, answers: SetupAnswers = {}) {
    // Answering a step that was skipped earlier takes it off the to-do list.
    await save({ ...answers, ...(skipped.includes(id) && { skippedSteps: skipped.filter((step) => step !== id) }) });
    goTo(stepAfter(id));
  }

  /** What the current screen has chosen but not yet saved. */
  const pendingAnswers = (): SetupAnswers => {
    if (confirming) return {};
    if (current === 'business_type') return { businessType };
    return current === 'vat' && vatChoice === 'no' ? { vatRegistered: false } : {};
  };

  async function connect(id: 'hmrc' | 'bank') {
    setBusy(true);
    setError('');
    try {
      const address = await (id === 'hmrc' ? fetchHmrcConnectUrl() : fetchBankConnectUrl());
      sessionStorage.setItem(SETUP_RETURN_KEY, '1');
      window.location.assign(address);
    } catch {
      setError(id === 'hmrc' ? 'We could not start the HMRC connection. Please try again.' : 'We could not start the bank connection. Please try again.');
      setBusy(false);
    }
  }

  async function continueFromVat() {
    if (vatChoice === 'no') return completeStep('vat', { vatRegistered: false });
    try {
      await saveVatNumber(vatInput);
    } catch (refused) {
      setError(
        refused instanceof VatNumberRefusedError && refused.code === 'BAD_REQUEST'
          ? 'Enter 9 digits. A leading GB and spaces are fine.'
          : 'We could not save your VAT number. Please try again.',
      );
      return;
    }
    setFacts((previous) => previous && { ...previous, hasVatNumber: true });
    return completeStep('vat', { vatRegistered: true });
  }

  const footer = (id: SetupStepId) => (
    <div className="mt-8 flex flex-wrap gap-3 border-t border-gray-200 pt-4">
      <button type="button" className={secondaryButton} disabled={busy || id === 'business_type'} onClick={() => goTo(SETUP_STEPS[SETUP_STEPS.findIndex((step) => step.id === id) - 1].id)}>
        Back
      </button>
      <button
        type="button"
        className={secondaryButton}
        disabled={busy}
        onClick={() =>
          attempt(async () => {
            await save({ ...pendingAnswers(), skippedSteps: skipped });
            navigate('/home');
          })
        }
      >
        Save and leave
      </button>
      <button
        type="button"
        className={secondaryButton}
        disabled={busy}
        onClick={() =>
          attempt(async () => {
            await save({ skippedSteps: skipped.includes(id) ? skipped : [...skipped, id] });
            goTo(stepAfter(id));
          })
        }
      >
        Skip for now
      </button>
    </div>
  );

  if (current === 'finished') {
    return (
      <section className="p-4 sm:p-6" aria-labelledby="setup-heading">
        <h1 id="setup-heading" className="text-2xl font-semibold text-gray-900">You are all set</h1>
        <p className="mt-2 text-gray-700">Anything you skipped is waiting for you on Home.</p>
        {error && <StateMessage kind="error">{error}</StateMessage>}
        <div className="mt-6">
          <button
            type="button"
            className={primaryButton}
            disabled={busy}
            onClick={() =>
              attempt(async () => {
                await save({ finish: true });
                navigate('/home');
              })
            }
          >
            Go to Home
          </button>
        </div>
      </section>
    );
  }

  const info = SETUP_STEPS.find((step) => step.id === current)!;
  const confirming = done.includes(current) && !changing;

  let body: ReactNode;
  if (confirming) {
    const confirmText: Record<SetupStepId, string> = {
      business_type: `We have you down as: ${BUSINESS_TYPES.find((type) => type.value === facts.setup.businessType)?.label.toLowerCase()}.`,
      vat: facts.setup.vatRegistered === false ? 'You told us you are not registered for VAT.' : 'You are registered for VAT and we have your VAT number.',
      hmrc: 'HMRC is connected.',
      bank: 'Your bank is connected.',
    };
    body = (
      <>
        <p className="mt-6 text-gray-900">{confirmText[current]}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className={primaryButton} disabled={busy} onClick={() => goTo(stepAfter(current))}>
            Continue
          </button>
          {(current === 'business_type' || current === 'vat') && (
            <button type="button" className={secondaryButton} onClick={() => setChanging(true)}>
              Change
            </button>
          )}
        </div>
      </>
    );
  } else if (current === 'business_type') {
    body = (
      <>
        <div role="radiogroup" aria-label={info.title} className="mt-6 grid gap-3">
          {BUSINESS_TYPES.map((type) => (
            <Choice key={type.value} name="business-type" checked={businessType === type.value} onChange={() => setBusinessType(type.value)}>
              {type.label} <small className="block text-sm text-gray-600">{type.officialName}</small>
            </Choice>
          ))}
        </div>
        <div className="mt-4">
          <button type="button" className={primaryButton} disabled={busy} onClick={() => attempt(() => completeStep('business_type', { businessType }))}>
            Continue
          </button>
        </div>
      </>
    );
  } else if (current === 'vat') {
    body = (
      <>
        <div role="radiogroup" aria-label={info.title} className="mt-6 grid gap-3">
          <Choice name="vat" checked={vatChoice === 'yes'} onChange={() => setVatChoice('yes')}>Yes</Choice>
          <Choice name="vat" checked={vatChoice === 'no'} onChange={() => setVatChoice('no')}>No</Choice>
        </div>
        {vatChoice === 'yes' && (
          <div className="mt-4">
            <label htmlFor="setup-vat-number" className="block text-gray-900">Your VAT number</label>
            <input
              id="setup-vat-number"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={vatInput}
              onChange={(event) => setVatInput(event.target.value)}
              className={`mt-1 min-h-11 w-full rounded-md border border-gray-400 px-3 text-gray-900 ${focusRing}`}
            />
          </div>
        )}
        <div className="mt-4">
          <button type="button" className={primaryButton} disabled={busy || vatChoice === null || (vatChoice === 'yes' && !vatInput.trim())} onClick={() => attempt(continueFromVat)}>
            Continue
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        {current === 'hmrc' && (
          <p className="mt-6 rounded-md border border-gray-300 bg-gray-50 p-3 text-gray-900">
            Test mode: nothing you do here is sent to HMRC for real.
          </p>
        )}
        <div className="mt-6">
          <button type="button" className={primaryButton} disabled={busy} onClick={() => connect(current)}>
            {current === 'hmrc' ? 'Connect to HMRC' : 'Connect your bank'}
          </button>
        </div>
      </>
    );
  }

  return (
    <section className="p-4 sm:p-6" aria-labelledby="setup-heading">
      <p className="text-sm text-gray-700">{stepLabel(current)}</p>
      <h1 id="setup-heading" className="mt-1 text-2xl font-semibold text-gray-900">{info.title}</h1>
      <p className="mt-2 text-gray-700">{info.purpose}</p>
      {info.officialName && <small className="block text-sm text-gray-600">{info.officialName}</small>}
      {body}
      {error && <StateMessage kind="error">{error}</StateMessage>}
      {footer(current)}
    </section>
  );
}
