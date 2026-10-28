import { useCallback, useEffect, useState, type FormEvent } from 'react';
import StateMessage from '../components/StateMessage';
import {
  ACCOUNT_TYPE_GROUPS,
  createAccount,
  describeAccountRefusal,
  fetchAccounts,
  renameAccount,
  setAccountArchived,
  TAX_CATEGORIES,
  type ApiAccount,
} from '../lib/accountsApi';

const fieldClass =
  'mt-1 min-h-[44px] w-full rounded-md border border-gray-400 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const secondaryButton = 'min-h-[44px] min-w-[44px] rounded-md border border-gray-400 px-4 text-gray-900 hover:bg-gray-100';
const primaryButton = 'min-h-[44px] min-w-[44px] rounded-md bg-blue-700 px-4 text-white hover:bg-blue-800';

type NewType = 'income' | 'expense';

export default function ChartOfAccountsSection() {
  const [accounts, setAccounts] = useState<ApiAccount[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<NewType>('expense');
  const [taxCategory, setTaxCategory] = useState(TAX_CATEGORIES.expense[0].slug);
  const [addError, setAddError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setAccounts(await fetchAccounts(showArchived));
      setLoadError('');
      setLoaded(true);
    } catch {
      setLoadError('Could not load your accounts. Please try again.');
    }
  }, [showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  function chooseType(type: NewType) {
    setAccountType(type);
    setTaxCategory(TAX_CATEGORIES[type][0].slug);
  }

  async function submitNewAccount(event: FormEvent) {
    event.preventDefault();
    setAddError('');
    try {
      await createAccount({ code: code.trim(), name: name.trim(), accountType, taxCategory });
      setCode('');
      setName('');
      await load();
    } catch (error) {
      setAddError(describeAccountRefusal(error));
    }
  }

  async function changeRow(id: string, action: () => Promise<unknown>) {
    setRowError(null);
    try {
      await action();
      setRenamingId(null);
      setArchivingId(null);
      await load();
    } catch (error) {
      setRowError({ id, message: describeAccountRefusal(error) });
    }
  }

  return (
    <section className="mt-6 max-w-xl rounded-lg border border-gray-200 bg-white p-4 sm:p-6" aria-labelledby="accounts-heading">
      <h2 id="accounts-heading" className="text-lg font-semibold text-gray-900">Chart of accounts</h2>
      <p className="mt-2 text-gray-700">The income and expense categories you file under.</p>
      {loadError && <StateMessage kind="error" className="mt-2">{loadError}</StateMessage>}

      <label className="mt-4 flex min-h-[44px] items-center gap-3 text-gray-900">
        <input
          type="checkbox"
          className="h-6 w-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
        />
        Show archived accounts
      </label>

      {loaded && accounts.length === 0 && <p className="mt-4 text-gray-700">No accounts to show.</p>}

      {ACCOUNT_TYPE_GROUPS.map(({ type, label }) => {
        const group = accounts.filter((account) => account.accountType === type);
        if (group.length === 0) return null;
        return (
          <div key={type} className="mt-4">
            <h3 className="font-semibold text-gray-900">{label}</h3>
            <ul className="mt-1 divide-y divide-gray-200">
              {group.map((account) => (
                <li key={account.id} className="py-2">
                  {renamingId === account.id ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void changeRow(account.id, () => renameAccount(account.id, renameInput.trim()));
                      }}
                    >
                      <label htmlFor={`rename-${account.id}`} className="block text-gray-900">New name for {account.code}</label>
                      <input id={`rename-${account.id}`} className={fieldClass} value={renameInput} onChange={(event) => setRenameInput(event.target.value)} />
                      <div className="mt-2 flex gap-3">
                        <button type="submit" className={primaryButton}>Save name</button>
                        <button type="button" className={secondaryButton} onClick={() => setRenamingId(null)}>Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono text-gray-900">{account.code}</span>
                      <span className="min-w-0 flex-1 truncate text-gray-900" title={account.name}>{account.name}</span>
                      {account.isSystem && <span className="rounded border border-gray-400 px-2 text-sm text-gray-800">System</span>}
                      <button
                        type="button"
                        className={secondaryButton}
                        aria-label={`Rename ${account.name}`}
                        onClick={() => {
                          setRenamingId(account.id);
                          setRenameInput(account.name);
                          setArchivingId(null);
                        }}
                      >
                        Rename
                      </button>
                      {!account.isSystem && showArchived && (
                        <button
                          type="button"
                          className={secondaryButton}
                          aria-label={`Unarchive ${account.name}`}
                          onClick={() => void changeRow(account.id, () => setAccountArchived(account.id, false))}
                        >
                          Unarchive
                        </button>
                      )}
                      {!account.isSystem && !showArchived && (
                        <button
                          type="button"
                          className={secondaryButton}
                          aria-label={`Archive ${account.name}`}
                          onClick={() => setArchivingId(account.id)}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  )}
                  {archivingId === account.id && (
                    <div className="mt-2 rounded-md border border-amber-700 bg-amber-50 p-3" role="group" aria-label={`Confirm archive of ${account.name}`}>
                      <p className="text-gray-900">
                        Archive {account.code} {account.name}? It will leave the lists you pick from. Existing records keep it, and you can unarchive it later.
                      </p>
                      <div className="mt-2 flex gap-3">
                        <button type="button" className={primaryButton} onClick={() => void changeRow(account.id, () => setAccountArchived(account.id, true))}>
                          Confirm archive
                        </button>
                        <button type="button" className={secondaryButton} onClick={() => setArchivingId(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                  {rowError?.id === account.id && <p className="mt-1 text-red-800" role="alert">{rowError.message}</p>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <form onSubmit={submitNewAccount} className="mt-6 border-t border-gray-200 pt-4" aria-label="Add an account">
        <h3 className="font-semibold text-gray-900">Add an account</h3>
        <label htmlFor="account-code" className="mt-2 block text-gray-900">Code</label>
        <input
          id="account-code"
          className={fieldClass}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          aria-describedby={addError ? 'account-add-error' : undefined}
          aria-invalid={addError ? true : undefined}
        />
        {addError && <p id="account-add-error" className="mt-1 text-red-800" role="alert">{addError}</p>}
        <label htmlFor="account-name" className="mt-3 block text-gray-900">Name</label>
        <input id="account-name" className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} />
        <label htmlFor="account-type" className="mt-3 block text-gray-900">Type</label>
        <select id="account-type" className={fieldClass} value={accountType} onChange={(event) => chooseType(event.target.value as NewType)}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <label htmlFor="account-tax-category" className="mt-3 block text-gray-900">Tax category</label>
        <select id="account-tax-category" className={fieldClass} value={taxCategory} onChange={(event) => setTaxCategory(event.target.value)}>
          {TAX_CATEGORIES[accountType].map(({ slug, label }) => (
            <option key={slug} value={slug}>{label}</option>
          ))}
        </select>
        <button type="submit" className={`mt-4 ${primaryButton}`}>Add account</button>
      </form>
    </section>
  );
}
