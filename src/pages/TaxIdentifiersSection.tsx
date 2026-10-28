import { useEffect, useState, type FormEvent } from 'react';
import { fetchTaxIdentifiers, saveTaxIdentifiers, type MaskedTaxIdentifiers } from '../lib/taxIdentifiersApi';

const fieldClass =
  'mt-1 min-h-[44px] w-full rounded-md border border-gray-400 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const secondaryButton = 'min-h-[44px] min-w-[44px] rounded-md border border-gray-400 px-4 text-gray-900 hover:bg-gray-100';
const primaryButton = 'min-h-[44px] min-w-[44px] rounded-md bg-blue-700 px-4 text-white hover:bg-blue-800';

export default function TaxIdentifiersSection() {
  const [saved, setSaved] = useState<MaskedTaxIdentifiers | null>(null);
  const [draft, setDraft] = useState<{ nino: string; utr: string } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    setError('');
    fetchTaxIdentifiers().then(setSaved, () => setError('Could not load your tax identifiers.'));
  }

  useEffect(load, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    // Stored values are never sent back to the browser, so a blank field means "keep what is saved".
    const changes = { ...(draft.nino.trim() && { nino: draft.nino }), ...(draft.utr.trim() && { utr: draft.utr }) };
    setSaving(true);
    setError('');
    try {
      setSaved(await saveTaxIdentifiers(changes));
      setDraft(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save your tax identifiers.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 max-w-xl rounded-lg border border-gray-200 bg-white p-4 sm:p-6" aria-labelledby="tax-identifiers-heading">
      <h2 id="tax-identifiers-heading" className="text-lg font-semibold text-gray-900">Tax identifiers</h2>
      <p className="mt-2 text-gray-700">HMRC needs these for Income Tax submissions. They are stored encrypted and only shown masked.</p>
      {error && <p role="alert" className="mt-2 text-red-800">{error}</p>}
      {/* Without saved values the only error possible is a failed load, so offer another go. */}
      {error && !saved && (
        <button type="button" className={`${secondaryButton} mt-3`} onClick={load}>Try again</button>
      )}

      {saved && !draft && (
        <>
          <dl className="mt-3 space-y-2">
            <div>
              <dt className="text-sm text-gray-700">National Insurance number</dt>
              <dd className="text-gray-900">{saved.nino ?? 'Not set'}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-700">Unique Taxpayer Reference (UTR)</dt>
              <dd className="text-gray-900">{saved.utr ?? 'Not set'}</dd>
            </div>
          </dl>
          <button type="button" className={`${secondaryButton} mt-3`} onClick={() => { setError(''); setDraft({ nino: '', utr: '' }); }}>
            Edit tax identifiers
          </button>
        </>
      )}

      {draft && (
        <form className="mt-3 space-y-3" onSubmit={save}>
          <label className="block text-gray-900">
            National Insurance number
            <input className={fieldClass} autoComplete="off" placeholder="AB123456C" value={draft.nino} onChange={(event) => setDraft({ ...draft, nino: event.target.value })} />
          </label>
          <label className="block text-gray-900">
            UTR (10 digits)
            <input className={fieldClass} autoComplete="off" inputMode="numeric" value={draft.utr} onChange={(event) => setDraft({ ...draft, utr: event.target.value })} />
          </label>
          <p className="text-sm text-gray-700">Leave a field blank to keep the value already saved.</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primaryButton} disabled={saving}>Save tax identifiers</button>
            <button type="button" className={secondaryButton} onClick={() => { setError(''); setDraft(null); }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
