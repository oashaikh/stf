import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { formatDate } from '../lib/dates';
import { fetchHasVatNumber } from '../lib/entriesApi';
import { fetchInvoice, fetchInvoices, INVOICE_STATUSES, invoicesQueryKey, type InvoiceStatus } from '../lib/invoicesApi';
import { formatPence } from '../lib/money';
import InvoiceEditor, { buttonClass } from './InvoiceEditor';
import StateMessage from '../components/StateMessage';

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'open'; id: string };

function OpenInvoice({ id, onBack, onOpen }: { id: string; onBack: () => void; onOpen: (view: View) => void }) {
  const invoice = useQuery({ queryKey: [...invoicesQueryKey, id], queryFn: () => fetchInvoice(id) });
  const vat = useQuery({ queryKey: ['vat-number-present'], queryFn: fetchHasVatNumber });
  if (invoice.isError) return <StateMessage kind="error" className="mt-6">Could not load the invoice.</StateMessage>;
  if (!invoice.data || vat.isPending) return <StateMessage kind="loading" className="mt-6">Loading…</StateMessage>;
  return (
    <InvoiceEditor
      invoice={invoice.data}
      ownerHasVatNumber={vat.data === true}
      onBack={onBack}
      onChanged={(changed) => onOpen(changed ? { kind: 'open', id: changed.id } : { kind: 'list' })}
    />
  );
}

function NewInvoice({ onBack, onOpen }: { onBack: () => void; onOpen: (view: View) => void }) {
  const vat = useQuery({ queryKey: ['vat-number-present'], queryFn: fetchHasVatNumber });
  if (vat.isPending) return <StateMessage kind="loading" className="mt-6">Loading…</StateMessage>;
  return (
    <InvoiceEditor
      invoice={null}
      ownerHasVatNumber={vat.data === true}
      onBack={onBack}
      onChanged={(changed) => onOpen(changed ? { kind: 'open', id: changed.id } : { kind: 'list' })}
    />
  );
}

function InvoiceList({ onOpen }: { onOpen: (view: View) => void }) {
  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const list = useInfiniteQuery({
    queryKey: [...invoicesQueryKey, 'list', status],
    queryFn: ({ pageParam }) => fetchInvoices(status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((page) => page.invoices) ?? [];

  return (
    <>
      <label className="mt-4 flex flex-col gap-1 text-sm text-gray-700">
        Status
        <select
          className="min-h-11 w-fit rounded border border-gray-400 px-2 text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          value={status}
          onChange={(event) => setStatus(event.target.value as InvoiceStatus | '')}
        >
          <option value="">All</option>
          {INVOICE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value[0].toUpperCase() + value.slice(1)}
            </option>
          ))}
        </select>
      </label>
      {list.isError && <StateMessage kind="error">Could not load invoices.</StateMessage>}
      {list.isPending && <StateMessage kind="loading">Loading…</StateMessage>}
      {list.isSuccess && rows.length === 0 && <StateMessage kind="empty">No invoices yet.</StateMessage>}
      {rows.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onOpen({ kind: 'open', id: row.id })}
                className="grid min-h-11 w-full grid-cols-2 items-center gap-1 p-3 text-left hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 md:grid-cols-[6rem_1fr_9rem_9rem_8rem_6rem]"
              >
                <span className="text-gray-900">{row.publicNumber ?? 'Draft'}</span>
                <span className="truncate text-right text-gray-900 md:text-left" title={row.clientName}>{row.clientName}</span>
                <span className="text-sm text-gray-700"><span className="md:hidden">Issued </span>{formatDate(row.issueDate)}</span>
                <span className="text-right text-sm text-gray-700 md:text-left"><span className="md:hidden">Due </span>{formatDate(row.dueDate)}</span>
                <span className="text-gray-900 md:text-right">
                  <span className="text-sm text-gray-700 md:hidden">Total </span>
                  <span className="tabular-nums">{formatPence(row.totalPence)}</span>
                </span>
                <span className="text-right text-sm capitalize text-gray-800 md:text-left">{row.status}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <button type="button" className={`${buttonClass} mt-4`} disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
          Load more
        </button>
      )}
    </>
  );
}

export default function InvoicesPage() {
  const [view, setView] = useState<View>({ kind: 'list' });
  const toList = () => setView({ kind: 'list' });
  return (
    <main className="p-4 md:p-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Invoices</h1>
        {view.kind === 'list' && (
          <button type="button" onClick={() => setView({ kind: 'new' })} className="min-h-11 rounded-md bg-blue-700 px-4 text-white hover:bg-blue-800">
            New invoice
          </button>
        )}
      </div>
      {view.kind === 'list' && <InvoiceList onOpen={setView} />}
      {view.kind === 'new' && <NewInvoice onBack={toList} onOpen={setView} />}
      {view.kind === 'open' && <OpenInvoice key={view.id} id={view.id} onBack={toList} onOpen={setView} />}
    </main>
  );
}
