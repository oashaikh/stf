import { useEffect, useState, type FormEvent } from 'react';
import { fetchBusinessProfile, maskAccountNumber, saveBusinessProfile, type BusinessProfile } from '../lib/businessProfileApi';

const fieldClass =
  'mt-1 min-h-[44px] w-full rounded-md border border-gray-400 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const secondaryButton = 'min-h-[44px] min-w-[44px] rounded-md border border-gray-400 px-4 text-gray-900 hover:bg-gray-100';
const primaryButton = 'min-h-[44px] min-w-[44px] rounded-md bg-blue-700 px-4 text-white hover:bg-blue-800';

interface Draft {
  businessName: string;
  businessAddress: string;
  paymentBankName: string;
  paymentSortCode: string;
  paymentAccountNumber: string;
  invoicePrefix: string;
  nextInvoiceNumber: string;
}

const toDraft = (profile: BusinessProfile): Draft => ({
  businessName: profile.businessName ?? '',
  businessAddress: profile.businessAddress ?? '',
  paymentBankName: profile.paymentBankName ?? '',
  paymentSortCode: profile.paymentSortCode ?? '',
  paymentAccountNumber: profile.paymentAccountNumber ?? '',
  invoicePrefix: profile.invoicePrefix,
  nextInvoiceNumber: String(profile.nextInvoiceNumber),
});

const textFields: Array<{ key: keyof Draft; label: string; inputMode?: 'numeric' }> = [
  { key: 'businessName', label: 'Business name' },
  { key: 'businessAddress', label: 'Address' },
  { key: 'paymentBankName', label: 'Bank name' },
  { key: 'paymentSortCode', label: 'Sort code (6 digits)', inputMode: 'numeric' },
  { key: 'paymentAccountNumber', label: 'Account number (8 digits)', inputMode: 'numeric' },
  { key: 'invoicePrefix', label: 'Invoice prefix' },
  { key: 'nextInvoiceNumber', label: 'Next invoice number', inputMode: 'numeric' },
];

export default function BusinessProfileSection() {
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchBusinessProfile().then(setProfile, () => setError('Could not load the business profile.'));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      setProfile(
        await saveBusinessProfile({ ...draft, nextInvoiceNumber: Number(draft.nextInvoiceNumber) }),
      );
      setDraft(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the business profile.');
    } finally {
      setSaving(false);
    }
  }

  const rows: Array<[string, string]> = profile
    ? [
        ['Business name', profile.businessName ?? 'Not set'],
        ['Address', profile.businessAddress ?? 'Not set'],
        ['Bank name', profile.paymentBankName ?? 'Not set'],
        ['Sort code', profile.paymentSortCode ? '••••' + profile.paymentSortCode.slice(-2) : 'Not set'],
        ['Account number', profile.paymentAccountNumber ? maskAccountNumber(profile.paymentAccountNumber) : 'Not set'],
        ['Invoice prefix', profile.invoicePrefix],
        ['Next invoice number', String(profile.nextInvoiceNumber)],
      ]
    : [];

  return (
    <section className="mt-6 max-w-xl rounded-lg border border-gray-200 bg-white p-4 sm:p-6" aria-labelledby="business-profile-heading">
      <h2 id="business-profile-heading" className="text-lg font-semibold text-gray-900">Business profile</h2>
      <p className="mt-2 text-gray-700">These details appear on your invoices.</p>
      {error && <p role="alert" className="mt-2 text-red-800">{error}</p>}

      {profile && !draft && (
        <>
          <dl className="mt-3 space-y-2">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-gray-700">{label}</dt>
                <dd className="whitespace-pre-line break-words text-gray-900">{value}</dd>
              </div>
            ))}
          </dl>
          <button type="button" className={`${secondaryButton} mt-3`} onClick={() => { setError(''); setDraft(toDraft(profile)); }}>
            Edit business profile
          </button>
        </>
      )}

      {draft && (
        <form className="mt-3 space-y-3" onSubmit={save}>
          {textFields.map(({ key, label, inputMode }) => (
            <label key={key} className="block text-gray-900">
              {label}
              {key === 'businessAddress' ? (
                <textarea className={`${fieldClass} py-2`} rows={3} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
              ) : (
                <input className={fieldClass} inputMode={inputMode} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
              )}
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primaryButton} disabled={saving}>Save business profile</button>
            <button type="button" className={secondaryButton} onClick={() => { setError(''); setDraft(null); }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
