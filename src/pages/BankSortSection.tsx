import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchAccounts } from '../lib/accountsApi';
import type { BankLine, MatchProposal } from '../lib/bankMatching';
import { createDraftFromLine, dismissLine, fetchReconcile, matchLine, undismissLine, unmatchLine } from '../lib/bankReconcileApi';
import { formatPence } from '../lib/money';
import StateMessage from '../components/StateMessage';

const QUERY_KEY = ['bank-sort'];
const REASONS: Record<MatchProposal['kind'], string> = {
  exact: 'Same amount, same day',
  close: 'Same amount, a few days apart',
};

interface Undoable {
  notice: string;
  undo: () => Promise<void>;
}

const buttonClass =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-gray-300 bg-white px-4 text-gray-900 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50';
const primaryClass = buttonClass.replace('border-gray-300 bg-white text-gray-900 hover:bg-gray-50', 'border-blue-800 bg-blue-800 text-white hover:bg-blue-900');
const fieldClass = 'min-h-11 rounded-md border border-gray-400 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

export default function BankSortSection() {
  const queryClient = useQueryClient();
  const sort = useQuery({ queryKey: QUERY_KEY, queryFn: fetchReconcile });
  const accounts = useQuery({ queryKey: ['accounts', 'active'], queryFn: () => fetchAccounts(false) });
  const [passed, setPassed] = useState<string[]>([]);
  const [asideFor, setAsideFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [categoryFor, setCategoryFor] = useState<Record<string, string>>({});
  const [last, setLast] = useState<Undoable | null>(null);

  const run = useMutation({
    mutationFn: async ({ act }: { act: () => Promise<Undoable> }) => act(),
    onSuccess: (done) => {
      setLast(done);
      setAsideFor(null);
      setReason('');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
  const undo = useMutation({
    mutationFn: async (action: Undoable) => action.undo(),
    onSuccess: () => setLast(null),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const proposalFor = (lineId: string) => sort.data?.proposals.find((proposal) => proposal.lineId === lineId && !passed.includes(lineId));
  const categoriesFor = (line: BankLine) => (accounts.data ?? []).filter((account) => account.accountType === (line.amountPence < 0 ? 'expense' : 'income'));
  const chosenCategory = (line: BankLine) => categoryFor[line.id] ?? categoriesFor(line)[0]?.id ?? '';

  const accept = (line: BankLine, proposal: MatchProposal) =>
    run.mutate({
      act: async () => {
        await matchLine(line.id, proposal.entryId);
        return { notice: 'Matched.', undo: () => unmatchLine(line.id) };
      },
    });
  const setAside = (line: BankLine) =>
    run.mutate({
      act: async () => {
        await dismissLine(line.id, reason.trim());
        return { notice: 'Set aside.', undo: () => undismissLine(line.id) };
      },
    });
  const addNew = (line: BankLine) =>
    run.mutate({
      act: async () => {
        await createDraftFromLine(line.id, chosenCategory(line));
        // The draft stays in your list after Undo; only the link to this payment is removed.
        return { notice: 'Added as a draft for you to check.', undo: () => unmatchLine(line.id) };
      },
    });

  return (
    <section aria-labelledby="bank-sort-heading" className="mt-8">
      <h2 id="bank-sort-heading" className="text-lg font-semibold text-gray-900">Sort your bank payments</h2>

      {sort.isPending && <StateMessage kind="loading">Loading your bank payments…</StateMessage>}
      {sort.isError && (
        <StateMessage kind="error" onRetry={() => void sort.refetch()}>Could not load your bank payments.</StateMessage>
      )}
      {sort.data?.lines.length === 0 && <StateMessage kind="empty">All sorted. Every bank payment is matched or set aside.</StateMessage>}

      {last && (
        <div role="status" className="mt-4 flex flex-wrap items-center gap-3 text-gray-900">
          <span>{last.notice}</span>
          <button type="button" className={buttonClass} disabled={undo.isPending} onClick={() => undo.mutate(last)}>Undo</button>
        </div>
      )}
      {(run.isError || undo.isError) && (
        <StateMessage kind="error">{(run.error ?? undo.error)?.message}</StateMessage>
      )}

      {sort.data && sort.data.lines.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-200 border-y border-gray-200">
          {sort.data.lines.map((line) => {
            const proposal = proposalFor(line.id);
            const categories = categoriesFor(line);
            return (
              <li key={line.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 sm:flex-1">
                  <p className="truncate font-medium text-gray-900" title={line.description}>{line.description}</p>
                  <p className="text-sm text-gray-700">{line.date} · {line.amountPence < 0 ? 'Paid out' : 'Paid in'}</p>
                  {proposal && <p className="mt-1 text-sm text-gray-900">{REASONS[proposal.kind]}</p>}
                </div>
                <p className="text-right tabular-nums font-medium text-gray-900 sm:w-28">{formatPence(Math.abs(line.amountPence))}</p>
                <div className="flex flex-wrap gap-2 sm:w-80 sm:justify-end">
                  {proposal && (
                    <>
                      <button type="button" className={primaryClass} disabled={run.isPending} onClick={() => accept(line, proposal)}>Yes, match it</button>
                      <button type="button" className={buttonClass} onClick={() => setPassed([...passed, line.id])}>No</button>
                    </>
                  )}
                  <label className="flex w-full flex-col text-sm text-gray-700">
                    Category
                    <select className={fieldClass} value={chosenCategory(line)} onChange={(event) => setCategoryFor({ ...categoryFor, [line.id]: event.target.value })}>
                      {categories.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                    </select>
                  </label>
                  <button type="button" className={buttonClass} disabled={run.isPending || !chosenCategory(line)} onClick={() => addNew(line)}>Add as new payment</button>
                  <button type="button" className={buttonClass} onClick={() => { setAsideFor(line.id); setReason(''); }}>Set aside</button>
                  {asideFor === line.id && (
                    <div className="flex w-full flex-col gap-2">
                      <label className="flex flex-col text-sm text-gray-700">
                        Why are you setting it aside?
                        <input className={fieldClass} maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} />
                      </label>
                      <button type="button" className={buttonClass} disabled={run.isPending || !reason.trim()} onClick={() => setAside(line)}>Confirm set aside</button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
