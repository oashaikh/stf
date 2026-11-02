import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import OfficialName from '../components/OfficialName';
import StateMessage from '../components/StateMessage';
import { enablePropertyAccounts, fetchAccounts } from '../lib/accountsApi';
import { isPropertyCategory } from '../lib/chartOfAccounts';

// Same key the entry form reads its categories from, so turning rental categories on updates its picker.
const ACCOUNTS_KEY = ['accounts', 'active'];

export default function UkPropertyPrompt() {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ACCOUNTS_KEY, queryFn: () => fetchAccounts(false) });
  const turnOn = useMutation({
    mutationFn: () => enablePropertyAccounts(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
  });

  if (accounts.isPending) return <StateMessage kind="loading" className="mt-6">Checking your categories…</StateMessage>;
  if (accounts.isError) {
    return (
      <StateMessage kind="error" className="mt-6" onRetry={() => accounts.refetch()}>
        Could not check your categories. Nothing has changed.
      </StateMessage>
    );
  }

  const isOn = accounts.data.some((account) => isPropertyCategory(account.taxCategory));

  return (
    <section className="mt-6 rounded border border-gray-300 p-4" aria-labelledby="rental-heading">
      <h3 id="rental-heading" className="font-semibold text-gray-900">Do you let out a property in the UK?</h3>
      <OfficialName>UK property income</OfficialName>
      {isOn ? (
        <p className="mt-2 text-gray-700">
          Rental categories are on. Choose them when you add money in or out, under Rental property.
        </p>
      ) : (
        <>
          <p className="mt-2 text-gray-700">
            Turn on rental categories such as Rent received and Repairs. They stay apart from your business figures.
          </p>
          <button
            type="button"
            disabled={turnOn.isPending}
            onClick={() => turnOn.mutate()}
            className="mt-3 inline-flex min-h-11 items-center rounded bg-blue-700 px-4 font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60"
          >
            Turn on rental categories
          </button>
          {turnOn.isError && (
            <StateMessage kind="error" className="mt-3">
              Could not turn on rental categories. Nothing has changed, so please try again.
            </StateMessage>
          )}
        </>
      )}
    </section>
  );
}
