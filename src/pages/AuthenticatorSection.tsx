import { useEffect, useState, type FormEvent } from 'react';
import {
  AuthenticatorError,
  confirmAuthenticator,
  disableAuthenticator,
  fetchAuthenticatorEnabled,
  startAuthenticatorSetup,
  type AuthenticatorSetup,
} from '../lib/authenticatorApi';

const fieldClass =
  'mt-1 min-h-[44px] w-full rounded-md border border-gray-400 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const secondaryButton = 'min-h-[44px] min-w-[44px] rounded-md border border-gray-400 px-4 text-gray-900 hover:bg-gray-100';
const primaryButton = 'min-h-[44px] min-w-[44px] rounded-md bg-blue-700 px-4 text-white hover:bg-blue-800';
const dangerButton = 'min-h-[44px] min-w-[44px] rounded-md bg-red-700 px-4 text-white hover:bg-red-800';

export const TURN_OFF_WARNING =
  'Turning this off removes the authenticator and its recovery codes. Signing in will need only your password, and HMRC will again warn that multi-factor authentication is missing.';

function describeFailure(error: unknown) {
  const reason = error instanceof AuthenticatorError ? error.reason : 'error';
  if (reason === 'invalid-code') return 'That code was not accepted. Check the code and try again.';
  if (reason === 'locked') return 'Too many wrong codes. Wait a few minutes and try again.';
  return 'Something went wrong. Please try again.';
}

type Step = 'idle' | 'scan' | 'recovery' | 'turn-off';

export default function AuthenticatorSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [setup, setSetup] = useState<AuthenticatorSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchAuthenticatorEnabled().then(setEnabled, () => setError('Could not load the authenticator status.'));
  }, []);

  async function run(action: () => Promise<void>) {
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(describeFailure(failure));
    }
  }

  const start = () =>
    run(async () => {
      setSetup(await startAuthenticatorSetup());
      setCode('');
      setStep('scan');
    });

  function confirm(event: FormEvent) {
    event.preventDefault();
    return run(async () => {
      setRecoveryCodes(await confirmAuthenticator(code.trim()));
      setSetup(null);
      setCode('');
      setSaved(false);
      setCopied(false);
      setEnabled(true);
      setStep('recovery');
    });
  }

  function turnOff(event: FormEvent) {
    event.preventDefault();
    return run(async () => {
      await disableAuthenticator(code.trim());
      setCode('');
      setEnabled(false);
      setStep('idle');
    });
  }

  function copyRecoveryCodes() {
    void navigator.clipboard.writeText(recoveryCodes.join('\n')).then(() => setCopied(true));
  }

  function dismissRecoveryCodes() {
    setRecoveryCodes([]);
    setStep('idle');
  }

  return (
    <section className="mt-6 max-w-xl rounded-lg border border-gray-200 bg-white p-4 sm:p-6" aria-labelledby="authenticator-heading">
      <h2 id="authenticator-heading" className="text-lg font-semibold text-gray-900">Authenticator app</h2>
      <p className="mt-2 text-gray-700">
        A second step at sign-in: a six-digit code from an authenticator app, after your password.
      </p>
      {enabled !== null && step === 'idle' && (
        <p className="mt-2 font-medium text-gray-900" role="status">
          <span aria-hidden="true">{enabled ? '✓ ' : ''}</span>
          {enabled ? 'Authenticator is on' : 'Authenticator is off'}
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-red-800">{error}</p>}

      {step === 'idle' && enabled === false && (
        <button type="button" className={`${primaryButton} mt-3`} onClick={start}>Set up authenticator</button>
      )}
      {step === 'idle' && enabled === true && (
        <button type="button" className={`${secondaryButton} mt-3`} onClick={() => { setCode(''); setError(''); setStep('turn-off'); }}>
          Turn off authenticator
        </button>
      )}

      {step === 'scan' && setup && (
        <form onSubmit={confirm} className="mt-3">
          <p className="text-gray-700">Scan this QR code with your authenticator app.</p>
          <img src={setup.qrDataUrl} alt="QR code for setting up the authenticator app" className="mt-2 h-48 w-48 max-w-full" />
          <p className="mt-2 text-gray-700">Or type this secret into the app:</p>
          <p className="break-all font-mono text-gray-900" data-testid="authenticator-secret">{setup.secret}</p>
          <label className="mt-3 block text-gray-900">
            Code from the app
            <input className={fieldClass} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="submit" className={primaryButton}>Turn on authenticator</button>
            <button type="button" className={secondaryButton} onClick={() => { setSetup(null); setError(''); setStep('idle'); }}>Cancel</button>
          </div>
        </form>
      )}

      {step === 'recovery' && (
        <div className="mt-3" role="group" aria-labelledby="recovery-heading">
          <h3 id="recovery-heading" className="font-semibold text-gray-900">Save your recovery codes</h3>
          <p className="mt-1 text-gray-700">
            Each code works once if you lose your phone. They are shown only now and cannot be shown again.
          </p>
          <ul className="mt-2 grid grid-cols-2 gap-2 font-mono text-gray-900">
            {recoveryCodes.map((recoveryCode) => <li key={recoveryCode}>{recoveryCode}</li>)}
          </ul>
          <button type="button" className={`${secondaryButton} mt-3`} onClick={copyRecoveryCodes}>Copy codes</button>
          {copied && <span role="status" className="ml-3 text-gray-900">Copied</span>}
          <label className="mt-3 flex min-h-[44px] items-center gap-2 text-gray-900">
            <input type="checkbox" className="h-5 w-5" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
            I have saved these recovery codes
          </label>
          <button type="button" className={`${primaryButton} mt-3 disabled:opacity-50`} disabled={!saved} onClick={dismissRecoveryCodes}>Done</button>
        </div>
      )}

      {step === 'turn-off' && (
        <form onSubmit={turnOff} className="mt-3">
          <p className="text-gray-900">{TURN_OFF_WARNING}</p>
          <label className="mt-3 block text-gray-900">
            Current code
            <input className={fieldClass} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="submit" className={dangerButton} disabled={code.trim() === ''}>Turn off authenticator</button>
            <button type="button" className={secondaryButton} onClick={() => { setError(''); setStep('idle'); }}>Keep it on</button>
          </div>
        </form>
      )}
    </section>
  );
}
