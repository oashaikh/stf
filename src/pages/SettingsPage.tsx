import { useAuth } from '@clerk/clerk-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { describeHmrcStatus, fetchHmrcConnected, fetchHmrcConnectUrl } from '../lib/hmrc/settingsApi';

const toneIcon = { connected: '✓', disconnected: '○', error: '!' } as const;
const toneText = { connected: 'text-green-800', disconnected: 'text-gray-700', error: 'text-red-800' } as const;

export default function SettingsPage() {
  const { getToken } = useAuth();
  const [searchParams] = useSearchParams();
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error('No session token');
        const isConnected = await fetchHmrcConnected(token);
        if (!cancelled) setConnected(isConnected);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  async function connect() {
    setFailed(false);
    try {
      const token = await getToken();
      if (!token) throw new Error('No session token');
      window.location.assign(await fetchHmrcConnectUrl(token));
    } catch {
      setFailed(true);
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
    </main>
  );
}
