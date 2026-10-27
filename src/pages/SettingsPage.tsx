import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import ChartOfAccountsSection from './ChartOfAccountsSection';
import AuthenticatorSection from './AuthenticatorSection';
import BusinessProfileSection from './BusinessProfileSection';
import TaxIdentifiersSection from './TaxIdentifiersSection';
import { LegalLinks } from './LegalPages';
import {
  describeHmrcStatus,
  fetchHmrcConnected,
  fetchHmrcConnectUrl,
  fetchHmrcMode,
  fetchVatNumberMask,
  runFraudHeadersCheck,
  isEffectivelyLive,
  saveHmrcLiveOptIn,
  saveVatNumber,
  VatNumberRefusedError,
  type FraudCheckOutcome,
  type HmrcModeState,
} from '../lib/hmrc/settingsApi';

export const LIVE_CONFIRMATION_TEXT = 'FILE LIVE';

const toneIcon = { connected: '✓', disconnected: '○', error: '!' } as const;
const toneText = { connected: 'text-green-800', disconnected: 'text-gray-700', error: 'text-red-800' } as const;

export default function SettingsPage() {
  const [searchParams] = useSearchParams();
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<HmrcModeState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [modeFailed, setModeFailed] = useState(false);
  const queryClient = useQueryClient();
  const [vatMask, setVatMask] = useState<string | null>(null);
  const [editingVat, setEditingVat] = useState(false);
  const [vatInput, setVatInput] = useState('');
  const [vatError, setVatError] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<FraudCheckOutcome | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);

  useEffect(() => {
    fetchVatNumberMask().then(
      (mask) => {
        setVatMask(mask);
        setEditingVat(mask === null);
      },
      () => setVatError('Could not load your VAT number. Please try again.'),
    );
  }, []);

  async function submitVatNumber(event: FormEvent) {
    event.preventDefault();
    setVatError('');
    try {
      setVatMask(await saveVatNumber(vatInput));
      setEditingVat(false);
      setVatInput('');
      // The VAT page may be holding a "VAT number missing" failure.
      await queryClient.invalidateQueries({ queryKey: ['vat-obligations'] });
    } catch (error) {
      const code = error instanceof VatNumberRefusedError ? error.code : '';
      setVatError(
        code === 'BAD_REQUEST'
          ? 'Enter 9 digits. A leading GB and spaces are fine.'
          : code === 'SUBMISSION_PENDING'
            ? 'A live VAT submission is pending. Change the number after it finishes.'
            : 'Could not save your VAT number. Please try again.',
      );
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [isConnected, currentMode] = await Promise.all([fetchHmrcConnected(), fetchHmrcMode()]);
        if (!cancelled) {
          setConnected(isConnected);
          setMode(currentMode);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function connect() {
    setFailed(false);
    try {
      window.location.assign(await fetchHmrcConnectUrl());
    } catch {
      setFailed(true);
    }
  }

  async function changeLiveOptIn(live: boolean) {
    setModeFailed(false);
    try {
      setMode(await saveHmrcLiveOptIn(live));
      setConfirming(false);
      setConfirmText('');
    } catch {
      setModeFailed(true);
    }
  }

  async function checkFraudHeaders() {
    setChecking(true);
    setCheckFailed(false);
    setCheckResult(null);
    try {
      setCheckResult(await runFraudHeadersCheck());
    } catch {
      setCheckFailed(true);
    } finally {
      setChecking(false);
    }
  }

  function toggleLive(checked: boolean) {
    if (checked) {
      setConfirming(true);
    } else {
      setConfirming(false);
      void changeLiveOptIn(false);
    }
  }

  const status = describeHmrcStatus(connected, searchParams.get('hmrc'));

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
      <section className="mt-6 max-w-xl rounded-lg border border-gray-200 bg-white p-6" aria-labelledby="hmrc-heading">
        <h2 id="hmrc-heading" className="text-lg font-semibold text-gray-900">HMRC (Government Gateway)</h2>
        {loading ? (
          <p className="mt-2 text-gray-500" role="status">Loading…</p>
        ) : (
          <p className={`mt-2 ${toneText[status.tone]}`} role="status">
            <span aria-hidden="true">{toneIcon[status.tone]} </span>
            {status.label}
          </p>
        )}
        {failed && !loading && (
          <p className="mt-2 text-red-800" role="alert">Could not reach HMRC. Please try again.</p>
        )}
        <button
          type="button"
          onClick={connect}
          disabled={loading}
          className="mt-4 min-h-[44px] min-w-[44px] rounded-md bg-blue-700 px-4 text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {connected ? 'Reconnect to HMRC' : 'Connect to HMRC'}
        </button>
      </section>
      <section className="mt-6 max-w-xl rounded-lg border border-gray-200 bg-white p-6" aria-labelledby="vat-number-heading">
        <h2 id="vat-number-heading" className="text-lg font-semibold text-gray-900">VAT registration number</h2>
        {editingVat ? (
          <form onSubmit={submitVatNumber} className="mt-2">
            <label htmlFor="vat-number-input" className="block text-gray-900">VAT registration number</label>
            <input
              id="vat-number-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={vatInput}
              onChange={(event) => setVatInput(event.target.value)}
              aria-describedby="vat-number-help"
              className="mt-1 min-h-[44px] w-full rounded-md border border-gray-400 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            />
            <p id="vat-number-help" className="mt-1 text-gray-700">9 digits. A leading GB and spaces are ignored.</p>
            <div className="mt-3 flex gap-3">
              <button type="submit" className="min-h-[44px] min-w-[44px] rounded-md bg-blue-700 px-4 text-white hover:bg-blue-800">
                Save VAT number
              </button>
              {vatMask && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingVat(false);
                    setVatInput('');
                    setVatError('');
                  }}
                  className="min-h-[44px] min-w-[44px] rounded-md border border-gray-400 px-4 text-gray-900 hover:bg-gray-100"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="mt-2 flex items-center gap-4">
            <p className="font-mono text-gray-900">GB {vatMask}</p>
            <button
              type="button"
              onClick={() => setEditingVat(true)}
              className="min-h-[44px] min-w-[44px] rounded-md border border-gray-400 px-4 text-gray-900 hover:bg-gray-100"
            >
              Edit
            </button>
          </div>
        )}
        {vatError && <p className="mt-2 text-red-800" role="alert">{vatError}</p>}
      </section>
      <section className="mt-6 max-w-xl rounded-lg border border-gray-200 bg-white p-6" aria-labelledby="mode-heading">
        <h2 id="mode-heading" className="text-lg font-semibold text-gray-900">Live HMRC submission</h2>
        <p className="mt-2 text-gray-700">
          Off by default: returns go to the HMRC test service only. Live filing needs this switch on and the server in
          production mode as well. Neither one alone is enough.
        </p>
        {mode && (
          <>
            <label className="mt-4 flex min-h-[44px] items-center gap-3 text-gray-900">
              <input
                type="checkbox"
                className="h-6 w-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                checked={mode.live || confirming}
                onChange={(event) => toggleLive(event.target.checked)}
              />
              Allow live filing with HMRC
            </label>
            {confirming && (
              <div className="mt-4 rounded-md border border-amber-700 bg-amber-50 p-4" role="group" aria-labelledby="live-confirm-heading">
                <p id="live-confirm-heading" className="font-semibold text-gray-900">Confirm live filing</p>
                <p className="mt-1 text-gray-800">
                  Live returns are legally binding and cannot be undone. Type {LIVE_CONFIRMATION_TEXT} to turn this on.
                </p>
                <input
                  type="text"
                  aria-label="Confirmation text"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  className="mt-2 min-h-[44px] w-full rounded-md border border-gray-400 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                />
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    disabled={confirmText !== LIVE_CONFIRMATION_TEXT}
                    onClick={() => void changeLiveOptIn(true)}
                    className="min-h-[44px] min-w-[44px] rounded-md bg-blue-700 px-4 text-white hover:bg-blue-800 disabled:opacity-50"
                  >
                    Turn on live filing
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(false);
                      setConfirmText('');
                    }}
                    className="min-h-[44px] min-w-[44px] rounded-md border border-gray-400 px-4 text-gray-900 hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <p className="mt-4 text-gray-900" role="status">
              Effective mode: <strong>{isEffectivelyLive(mode) ? 'Live' : 'Sandbox (test)'}</strong>
              {mode.live && !mode.envLive && ' (the server is not in production mode)'}
            </p>
            <p className="mt-2 text-gray-700">
              HMRC connections are per environment. After changing this, use Reconnect to HMRC above.
            </p>
          </>
        )}
        {modeFailed && <p className="mt-2 text-red-800" role="alert">Could not change the setting. Please try again.</p>}
      </section>
      <section className="mt-6 max-w-xl rounded-lg border border-gray-200 bg-white p-6" aria-labelledby="fraud-heading">
        <h2 id="fraud-heading" className="text-lg font-semibold text-gray-900">HMRC fraud prevention headers</h2>
        <p className="mt-2 text-gray-700">
          Sends the headers a real submission sends to HMRC's sandbox validator and shows what it reports.
        </p>
        <button
          type="button"
          onClick={() => void checkFraudHeaders()}
          disabled={checking}
          className="mt-4 min-h-[44px] min-w-[44px] rounded-md bg-blue-700 px-4 text-white hover:bg-blue-800 disabled:opacity-50"
        >
          Check HMRC fraud headers
        </button>
        {checking && <p className="mt-2 text-gray-500" role="status">Checking…</p>}
        {checkFailed && <p className="mt-2 text-red-800" role="alert">Could not run the check. Please try again.</p>}
        {checkResult && (
          <div className="mt-4" role="status">
            {checkResult.outcome === 'pass' && (
              <p className="text-green-800">
                <span aria-hidden="true">✓ </span>
                Pass: HMRC accepted every fraud prevention header.
              </p>
            )}
            {checkResult.errors.length + checkResult.warnings.length > 0 && (
              <ul className="space-y-2">
                {[
                  ...checkResult.errors.map((finding) => ({ finding, label: 'Error', icon: '!', tone: 'text-red-800' })),
                  ...checkResult.warnings.map((finding) => ({ finding, label: 'Warning', icon: '▲', tone: 'text-gray-900' })),
                ].map(({ finding, label, icon, tone }, index) => (
                  <li key={index} className={`break-words ${tone}`}>
                    <span aria-hidden="true">{icon} </span>
                    <strong>{label}</strong>: <code>{finding.headers.join(', ')}</code>
                    <p>{finding.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
      <BusinessProfileSection />
      <TaxIdentifiersSection />
      <AuthenticatorSection />
      <ChartOfAccountsSection />
      <section className="mt-6 max-w-xl" aria-labelledby="legal-heading">
        <h2 id="legal-heading" className="text-lg font-semibold text-gray-900">Privacy and terms</h2>
        <LegalLinks />
      </section>
    </main>
  );
}
