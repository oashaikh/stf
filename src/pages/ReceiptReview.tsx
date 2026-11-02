import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import DuplicateNotice from '../components/DuplicateNotice';
import OfficialName from '../components/OfficialName';
import StateMessage from '../components/StateMessage';
import { fetchAccounts, type ApiAccount } from '../lib/accountsApi';
import { formatDate } from '../lib/dates';
import { dismissDuplicate, isDuplicateDismissed } from '../lib/duplicateDismissals';
import { ENTRIES_QUERY_KEY, fetchEntriesAround } from '../lib/entriesApi';
import { useDuplicateFlags } from '../lib/useDuplicateFlags';
import { vatRateOf } from '../lib/entryForm';
import { vatOnGross } from '../lib/vat';
import { formatPence, formatPenceRaw, parsePence } from '../lib/money';
import {
  confirmReceiptDraft,
  type ConfirmedReceiptFields,
  discardReceiptDraft,
  fetchReceipts,
  receiptsQueryKey,
  LOW_CONFIDENCE_THOUSANDTHS,
  type ListedReceipt,
} from '../lib/receiptsApi';

const focusClass = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const buttonClass = `inline-flex min-h-11 items-center justify-center rounded-md border border-gray-400 bg-white px-4 text-gray-900 hover:bg-gray-100 disabled:opacity-60 ${focusClass}`;
const primaryButtonClass = `inline-flex min-h-12 items-center justify-center rounded-md bg-blue-800 px-5 font-medium text-white hover:bg-blue-900 disabled:opacity-60 ${focusClass}`;
const inputClass = `mt-1 block min-h-11 w-full rounded-md border border-gray-400 bg-white px-3 text-gray-900 ${focusClass}`;

const expenseAccountsQueryKey = ['accounts', 'expense-active'];

/** The reader suggests a short category word like "travel"; match it to the owner's account by tax category or name. */
function suggestedAccountId(accounts: ApiAccount[], suggestion: string | undefined): string {
  const wanted = suggestion?.toLowerCase();
  return accounts.find((account) => account.taxCategory === wanted || account.name.toLowerCase() === wanted)?.id ?? '';
}

function ConfidenceMarker({ confidence, id }: { confidence: number | null; id: string }) {
  const sure = confidence !== null && confidence >= LOW_CONFIDENCE_THOUSANDTHS;
  return (
    <span id={id} className={`text-sm font-medium ${sure ? 'text-green-800' : 'text-amber-900'}`}>
      {sure ? 'Sure' : 'Check this one'}
    </span>
  );
}

function Field({ label, officialName, confidence, htmlFor, children }: {
  label: string;
  officialName?: string;
  confidence: number | null;
  htmlFor: string;
  children: React.ReactNode;
}) {
  const low = confidence === null || confidence < LOW_CONFIDENCE_THOUSANDTHS;
  return (
    <div
      data-field
      data-low-confidence={low ? 'true' : undefined}
      className={`rounded-md border p-3 ${low ? 'border-amber-700 bg-amber-50' : 'border-gray-200 bg-white'}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="font-medium text-gray-900">{label}</label>
        <ConfidenceMarker confidence={confidence} id={`${htmlFor}-confidence`} />
      </div>
      {officialName && <OfficialName>{officialName}</OfficialName>}
      {children}
    </div>
  );
}

function ReceiptFile({ receipt }: { receipt: ListedReceipt }) {
  if (!receipt.readUrl) return <StateMessage kind="empty">The picture is not ready to show yet.</StateMessage>;
  if (receipt.mimeType === 'application/pdf') {
    return (
      <>
        <iframe src={receipt.readUrl} title={`Receipt ${receipt.fileName}`} className="h-96 w-full rounded-md border border-gray-200 md:h-[32rem]" />
        <a href={receipt.readUrl} target="_blank" rel="noreferrer" className={`${buttonClass} mt-2`}>Open the PDF in a new tab</a>
      </>
    );
  }
  return <img src={receipt.readUrl} alt={`Receipt ${receipt.fileName}`} className="w-full rounded-md border border-gray-200" />;
}

// A native modal dialog gives the focus trap and Escape-to-close; nothing is sent until the footer button is pressed.
function DiscardDialog({ receipt, onKeep, onDiscard }: { receipt: ListedReceipt; onKeep: () => void; onDiscard: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);
  return (
    <dialog ref={dialogRef} aria-labelledby="discard-receipt-title" onClose={onKeep} className="w-full max-w-[calc(100%-2rem)] sm:max-w-md flex-col rounded p-0 open:flex backdrop:bg-black/50">
      <div className="p-6">
        <h2 id="discard-receipt-title" className="text-lg font-semibold text-gray-900">Throw this receipt away?</h2>
        <p className="mt-3 break-words text-gray-900">{receipt.fileName}</p>
        <p className="mt-2 text-gray-800">We will drop the details we read. The receipt stays in your list so you can add the expense by hand. No expense is added now.</p>
      </div>
      <div className="flex justify-end gap-3 border-t border-gray-200 p-4">
        <button type="button" className={buttonClass} onClick={onKeep}>Keep it</button>
        <button type="button" className={primaryButtonClass} onClick={onDiscard}>Discard receipt</button>
      </div>
    </dialog>
  );
}

export default function ReceiptReview({ receipt, onDone }: { receipt: ListedReceipt; onDone: () => void }) {
  const read = (field: string) => receipt.details[field]?.value ?? '';
  const confidenceOf = (field: string) => receipt.details[field]?.confidence ?? null;

  const [date, setDate] = useState(read('date'));
  const [supplier, setSupplier] = useState(read('vendor'));
  const [total, setTotal] = useState(read('totalPence') ? formatPenceRaw(Number(read('totalPence'))) : '');
  const [tax, setTax] = useState(read('vatPence') ? formatPenceRaw(Number(read('vatPence'))) : '');
  const [chosenAccountId, setChosenAccountId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const accountsQuery = useQuery({
    queryKey: expenseAccountsQueryKey,
    queryFn: async () => (await fetchAccounts(false)).filter((account) => account.accountType === 'expense'),
  });
  const accounts = accountsQuery.data ?? [];
  const accountId = chosenAccountId ?? suggestedAccountId(accounts, receipt.details.category?.value);

  // Advisory only: what is typed now is compared with expenses a few days either side; nothing here blocks Confirm.
  const typedGrossPence = parsePence(total);
  const typedSupplier = supplier.trim();
  const neighbours = useQuery({
    queryKey: [...ENTRIES_QUERY_KEY, 'around', 'expense', date],
    queryFn: () => fetchEntriesAround(date, 'expense', 3),
    enabled: Boolean(date && typedSupplier && typedGrossPence),
  });
  const candidates = useMemo(
    () => [
      ...(typedGrossPence && typedSupplier && date
        ? [{ id: 'new', date, grossPence: typedGrossPence, reference: typedSupplier, description: typedSupplier }]
        : []),
      ...(neighbours.data?.entries ?? []).map((other) => ({ ...other, reference: other.reference ?? '' })),
    ],
    [typedGrossPence, typedSupplier, date, neighbours.data],
  );
  const duplicates = useDuplicateFlags(candidates);
  const fileKey = `file|${receipt.id}`;
  const [, setFileNoticeDismissed] = useState(false);
  const showFileNotice = receipt.duplicateOfId !== null && !isDuplicateDismissed(fileKey);

  const queryClient = useQueryClient();
  const confirm = useMutation({
    mutationFn: (fields: ConfirmedReceiptFields) => confirmReceiptDraft(fields),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: receiptsQueryKey }),
      queryClient.invalidateQueries({ queryKey: ENTRIES_QUERY_KEY }),
    ]),
  });
  const discard = useMutation({
    mutationFn: (id: string) => discardReceiptDraft(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: receiptsQueryKey });
      onDone();
    },
  });

  function submit() {
    setFormError(null);
    const grossPence = parsePence(total);
    const taxPence = tax.trim() === '' ? 0 : parsePence(tax);
    if (!date) return setFormError('Pick the date on the receipt.');
    if (!supplier.trim()) return setFormError('Say who the receipt was from.');
    if (grossPence === null || grossPence === 0) return setFormError('Enter the total on the receipt, for example 12.50.');
    if (taxPence === null || taxPence >= grossPence) return setFormError('Enter the tax paid as an amount smaller than the total, or leave it empty.');
    if (!accountId) return setFormError('Choose a category.');
    // The server works the tax out from the rate, so a figure that is not one of the three rates would be saved as something else.
    const vatRatePercent = vatRateOf(grossPence - taxPence, taxPence);
    const expectedTaxPence = vatOnGross(grossPence, vatRatePercent);
    if (taxPence !== expectedTaxPence) {
      return setFormError(`Tax on a receipt is 0%, 5% or 20% of the amount before tax. For this total the closest is ${formatPenceRaw(expectedTaxPence)}. Change the tax paid or the total.`);
    }
    confirm.mutate({
      id: receipt.id,
      date,
      supplier: supplier.trim(),
      grossPence,
      vatRatePercent,
      categoryAccountId: accountId,
      description: supplier.trim(),
    });
  }

  if (confirm.isSuccess) {
    return (
      <div className="mt-6" role="status">
        <p className="text-gray-900">Saved. This receipt is now one of your expenses.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to={`/money-out?${new URLSearchParams({ entry: confirm.data, from: date, to: date })}`} className={primaryButtonClass}>See it in your expenses</Link>
          <Link to="/money-out/receipts" className={buttonClass}>Back to receipts</Link>
        </div>
      </div>
    );
  }

  const errorMessage = formError ?? (confirm.error?.message || discard.error?.message || null);

  return (
    <div className="mt-6 grid gap-6 md:grid-cols-2">
      <section aria-label="Your receipt">
        <ReceiptFile receipt={receipt} />
      </section>
      <section aria-label="What we read">
        <h2 className="text-lg font-semibold text-gray-900">Check what we read</h2>
        <p className="mt-1 text-gray-800">These are suggestions. Look at the receipt, change anything that is wrong, then confirm.</p>
        {showFileNotice && (
          <DuplicateNotice className="mt-4" onDismiss={() => { dismissDuplicate(fileKey); setFileNoticeDismissed(true); }}>
            This is the same file as a receipt you already added. Is it a repeat? You can still confirm it.
          </DuplicateNotice>
        )}
        {duplicates.flags.filter((flag) => flag.entryIds.includes('new')).map((flag) => {
          const other = neighbours.data?.entries.find((candidate) => flag.entryIds.includes(candidate.id));
          return (
            <DuplicateNotice key={flag.key} className="mt-4" onDismiss={() => duplicates.dismiss(flag)}>
              This looks like {other?.description} on {other && formatDate(other.date)} for {other && formatPence(other.grossPence)}, which you already added. Is it a repeat? You can still confirm it.
            </DuplicateNotice>
          );
        })}
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field label="Date" htmlFor="review-date" confidence={confidenceOf('date')}>
            <input id="review-date" aria-describedby="review-date-confidence" type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
          </Field>
          <Field label="Who it was from" htmlFor="review-supplier" confidence={confidenceOf('vendor')}>
            <input id="review-supplier" aria-describedby="review-supplier-confidence" type="text" value={supplier} onChange={(event) => setSupplier(event.target.value)} className={inputClass} />
          </Field>
          <Field label="Total including tax" htmlFor="review-total" confidence={confidenceOf('totalPence')}>
            <input id="review-total" aria-describedby="review-total-confidence" type="text" inputMode="decimal" value={total} onChange={(event) => setTotal(event.target.value)} className={`${inputClass} text-right tabular-nums`} />
          </Field>
          <Field label="Tax paid" officialName="VAT" htmlFor="review-tax" confidence={confidenceOf('vatPence')}>
            <input id="review-tax" aria-describedby="review-tax-confidence" type="text" inputMode="decimal" value={tax} onChange={(event) => setTax(event.target.value)} className={`${inputClass} text-right tabular-nums`} />
          </Field>
          <Field label="Category" htmlFor="review-category" confidence={confidenceOf('category')}>
            {accountsQuery.isPending && <StateMessage kind="loading" className="mt-1">Loading your categories…</StateMessage>}
            {accountsQuery.isError && <StateMessage kind="error" className="mt-1" onRetry={() => void accountsQuery.refetch()}>We could not load your categories. Your receipt is safe.</StateMessage>}
            {accountsQuery.isSuccess && (
              <select id="review-category" aria-describedby="review-category-confidence" value={accountId} onChange={(event) => setChosenAccountId(event.target.value)} className={inputClass}>
                <option value="">Choose a category</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            )}
          </Field>
          {errorMessage && <p role="alert" className="text-red-800">{errorMessage}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={primaryButtonClass} disabled={confirm.isPending}>{confirm.isPending ? 'Saving…' : 'Confirm'}</button>
            <button type="button" className={buttonClass} disabled={discard.isPending} onClick={() => setDiscarding(true)}>Discard</button>
          </div>
        </form>
      </section>
      {discarding && (
        <DiscardDialog
          receipt={receipt}
          onKeep={() => setDiscarding(false)}
          onDiscard={() => {
            setDiscarding(false);
            discard.mutate(receipt.id);
          }}
        />
      )}
    </div>
  );
}

/** The route screen: finds the draft in the same paged list the Receipts page uses, then returns to that list when done. */
export function ReceiptReviewPage() {
  const { receiptId } = useParams();
  const navigate = useNavigate();
  const list = useInfiniteQuery({
    queryKey: receiptsQueryKey,
    queryFn: ({ pageParam }) => fetchReceipts(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const receipt = list.data?.pages.flatMap((page) => page.receipts).find((candidate) => candidate.id === receiptId);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    if (!receipt && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [receipt, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (list.isError) return <StateMessage kind="error" onRetry={() => void list.refetch()}>Could not load this receipt.</StateMessage>;
  if (receipt) return <ReceiptReview key={receipt.id} receipt={receipt} onDone={() => navigate('/money-out/receipts')} />;
  if (list.isPending || hasNextPage) return <StateMessage kind="loading">Loading…</StateMessage>;
  return (
    <div className="mt-6">
      <p className="text-gray-900">We could not find that receipt. It may already have been checked or removed.</p>
      <Link to="/money-out/receipts" className={`${buttonClass} mt-4`}>Back to receipts</Link>
    </div>
  );
}
