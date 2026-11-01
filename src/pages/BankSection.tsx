import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import StateMessage from '../components/StateMessage';
import { consentState, disconnectBank, fetchBankConnectUrl, fetchBankStatus, type BankStatus } from '../lib/bankApi';

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const primaryButton = `min-h-11 min-w-11 rounded-md bg-blue-700 px-4 text-white hover:bg-blue-800 disabled:opacity-50 ${focusRing}`;
const secondaryButton = `min-h-11 min-w-11 rounded-md border border-gray-400 px-4 text-gray-900 hover:bg-gray-100 disabled:opacity-50 ${focusRing}`;
const dangerButton = `min-h-11 min-w-11 rounded-md bg-red-700 px-4 text-white hover:bg-red-800 disabled:opacity-50 ${focusRing}`;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export default function BankSection() {
  const [searchParams] = useSearchParams();
  const returned = searchParams.get('bank');
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoadFailed(false);
    fetchBankStatus().then(setStatus, () => setLoadFailed(true));
  }, []);

  useEffect(load, [load]);

  async function startConsent() {
    setBusy(true);
    setActionError('');
    try {
      window.location.assign(await fetchBankConnectUrl());
    } catch {
      setActionError('Could not start the bank connection. Please try again.');
      setBusy(false);
    }
  }

  async function confirmDisconnect() {
    setBusy(true);
    setActionError('');
    try {
      await disconnectBank();
      setConfirming(false);
      load();
    } catch {
      setActionError('Could not disconnect your bank. Please try again.');
    }
    setBusy(false);
  }

  const state = status?.connected && status.consentExpiresAt ? consentState(status.consentExpiresAt) : null;

  return (
    <section className="mt-6 max-w-xl rounded-lg border border-gray-200 bg-white p-4 sm:p-6" aria-labelledby="bank-heading">
      <h2 id="bank-heading" className="text-lg font-semibold text-gray-900">Bank account</h2>
      {returned === 'connected' && <p role="status" className="mt-2 text-green-800">✓ Bank account connected.</p>}
      {returned === 'error' && (
        <StateMessage kind="error" className="mt-2">The bank connection did not complete. Please try again.</StateMessage>
      )}
      {loadFailed && <StateMessage kind="error" onRetry={load}>Could not load your bank connection.</StateMessage>}
      {!loadFailed && !status && <StateMessage kind="loading">Loading your bank connection…</StateMessage>}
      {status && !status.connected && (
        <>
          <StateMessage kind="empty">No bank account is connected.</StateMessage>
          <button type="button" className={`mt-4 ${primaryButton}`} disabled={busy} onClick={startConsent}>
            Connect bank account
          </button>
        </>
      )}
      {status?.connected && (
        <>
          <dl className="mt-4 space-y-1 text-gray-900">
            <dt className="sr-only">Account</dt>
            <dd className="font-medium">{status.displayName}</dd>
            <dt className="sr-only">Account number</dt>
            <dd className="tabular-nums text-gray-700">{status.maskedAccountNumber}</dd>
            {status.consentExpiresAt && <dd className="text-gray-700">Consent expires {formatDate(status.consentExpiresAt)}</dd>}
          </dl>
          {state === 'expired' && (
            <p role="alert" className="mt-3 font-medium text-red-800">! Your bank consent has expired. Reconnect to keep your transactions up to date.</p>
          )}
          {state === 'expiring' && (
            <p role="status" className="mt-3 font-medium text-amber-900">! Your bank consent expires soon. Reconnect to avoid a gap.</p>
          )}
          {confirming ? (
            <div className="mt-4">
              <p className="text-gray-900">
                Disconnecting {status.displayName} stops syncing transactions. Entries already imported stay as they are.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" className={dangerButton} disabled={busy} onClick={confirmDisconnect}>Yes, disconnect</button>
                <button type="button" className={secondaryButton} disabled={busy} onClick={() => setConfirming(false)}>Keep connected</button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-3">
              {state && state !== 'active' && (
                <button type="button" className={primaryButton} disabled={busy} onClick={startConsent}>Reconnect</button>
              )}
              <button type="button" className={secondaryButton} onClick={() => setConfirming(true)}>Disconnect</button>
            </div>
          )}
        </>
      )}
      {actionError && <StateMessage kind="error" className="mt-3">{actionError}</StateMessage>}
    </section>
  );
}
