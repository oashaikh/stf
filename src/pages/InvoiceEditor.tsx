import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { formatDate } from '../lib/dates';
import { formatQuantity, formTotals, toDraftRequest, type InvoiceFormLine, type InvoiceFormState } from '../lib/invoiceForm';
import { INVOICE_VAT_RATES } from '../lib/invoiceMaths';
import { invoicesQueryKey, issueInvoice, markInvoicePaid, saveDraft, voidInvoice, type ApiInvoice } from '../lib/invoicesApi';
import { formatPence } from '../lib/money';

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
export const buttonClass = `min-h-11 rounded-md border border-gray-400 bg-white px-4 text-gray-900 hover:bg-gray-100 disabled:opacity-60 ${focusRing}`;
const primaryClass = `min-h-11 rounded-md bg-blue-700 px-4 text-white hover:bg-blue-800 disabled:opacity-60 ${focusRing}`;
const dangerClass = `min-h-11 rounded-md bg-red-800 px-4 text-white hover:bg-red-900 disabled:opacity-60 ${focusRing}`;
const inputClass = `min-h-11 w-full rounded border border-gray-400 px-2 text-gray-900 ${focusRing}`;

const today = () => new Date().toISOString().slice(0, 10);
const THIRTY_DAYS_MS = 30 * 86_400_000;

const blankLine: InvoiceFormLine = { description: '', quantity: '1', unitPrice: '', vatRatePercent: 20 };

function initialForm(invoice: ApiInvoice | null): InvoiceFormState {
  if (!invoice) {
    return {
      clientName: '',
      clientEmail: '',
      clientAddress: '',
      issueDate: today(),
      dueDate: new Date(Date.now() + THIRTY_DAYS_MS).toISOString().slice(0, 10),
      notes: '',
      lines: [blankLine],
    };
  }
  return {
    clientName: invoice.clientName,
    clientEmail: invoice.clientEmail ?? '',
    clientAddress: invoice.clientAddress ?? '',
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    notes: invoice.notes ?? '',
    lines: invoice.lines.map((line) => ({
      description: line.description,
      quantity: formatQuantity(line.quantity),
      unitPrice: (line.unitPricePence / 100).toFixed(2),
      vatRatePercent: line.vatRatePercent,
    })),
  };
}

// A native modal dialog gives the focus trap and Escape-to-close; nothing is sent until the footer button is pressed.
function ConfirmDialog({
  title,
  confirmLabel,
  danger,
  error,
  busy,
  onCancel,
  onConfirm,
  children,
}: {
  title: string;
  confirmLabel: string;
  danger?: boolean;
  error?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog ref={dialogRef} aria-labelledby="invoice-dialog-title" onClose={onCancel} className="w-full max-w-md flex-col rounded p-0 open:flex backdrop:bg-black/50">
      <div className="p-6">
        <h3 id="invoice-dialog-title" className="text-lg font-semibold text-gray-900">
          {title}
        </h3>
        {children}
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-800">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-3 border-t border-gray-200 p-4">
        <button type="button" onClick={onCancel} className={buttonClass}>
          Cancel
        </button>
        <button type="button" disabled={busy} onClick={onConfirm} className={danger ? dangerClass : primaryClass}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-gray-700">
      {label}
      {children}
      {error && <span className="text-sm text-red-800">{error}</span>}
    </label>
  );
}

function TotalsPanel({ netPence, vatPence, totalPence }: { netPence: number; vatPence: number; totalPence: number }) {
  return (
    <dl className="ml-auto mt-4 grid w-full max-w-xs grid-cols-2 gap-1 text-gray-900">
      <dt>Net</dt>
      <dd className="text-right tabular-nums" data-testid="net">{formatPence(netPence)}</dd>
      <dt>VAT</dt>
      <dd className="text-right tabular-nums" data-testid="vat">{formatPence(vatPence)}</dd>
      <dt className="font-semibold">Total</dt>
      <dd className="text-right font-semibold tabular-nums" data-testid="total">{formatPence(totalPence)}</dd>
    </dl>
  );
}

type Action = 'issue' | 'paid' | 'void';

function useInvoiceAction(invoiceId: string | null, onChanged: (invoice: ApiInvoice | null) => void) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [paymentDate, setPaymentDate] = useState(today());
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const mutation = useMutation({
    mutationFn: async (work: () => Promise<ApiInvoice | null>) => work(),
    onSuccess: async (result) => {
      setAction(null);
      await queryClient.invalidateQueries({ queryKey: invoicesQueryKey });
      onChanged(result);
    },
  });
  const close = () => {
    setAction(null);
    mutation.reset();
  };
  const confirmPaid = () => mutation.mutate(() => markInvoicePaid(invoiceId as string, paymentDate));
  const confirmVoid = () => {
    if (!reason.trim()) return setReasonError(true);
    mutation.mutate(async () => {
      await voidInvoice(invoiceId as string, reason.trim());
      return null;
    });
  };
  return { action, setAction, paymentDate, setPaymentDate, reason, setReason, reasonError, mutation, close, confirmPaid, confirmVoid };
}

// `summary` names what the confirmation is about; paid and void only open for a saved invoice.
function ActionDialogs({ summary, isDraft, state, onIssue }: { summary: string; isDraft: boolean; state: ReturnType<typeof useInvoiceAction>; onIssue?: () => void }) {
  const { action, mutation, close } = state;
  const error = mutation.error?.message;
  if (action === 'issue' && onIssue) {
    return (
      <ConfirmDialog title="Issue this invoice?" confirmLabel="Issue invoice" busy={mutation.isPending} error={error} onCancel={close} onConfirm={onIssue}>
        <p className="mt-3 text-gray-900">{summary}</p>
        <p className="mt-3 text-sm text-gray-700">The invoice gets its number, is posted as income dated the issue date, and can no longer be edited.</p>
      </ConfirmDialog>
    );
  }
  if (action === 'paid') {
    return (
      <ConfirmDialog title="Mark this invoice as paid?" confirmLabel="Mark as paid" busy={mutation.isPending} error={error} onCancel={close} onConfirm={state.confirmPaid}>
        <p className="mt-3 text-sm text-gray-700">
          {summary}. The payment is recorded to the bank on the date you choose.
        </p>
        <div className="mt-3">
          <Field label="Payment date">
            <input type="date" className={inputClass} value={state.paymentDate} onChange={(event) => state.setPaymentDate(event.target.value)} />
          </Field>
        </div>
      </ConfirmDialog>
    );
  }
  if (action === 'void') {
    return (
      <ConfirmDialog title="Void this invoice?" confirmLabel="Void invoice" danger busy={mutation.isPending} error={error} onCancel={close} onConfirm={state.confirmVoid}>
        <p className="mt-3 text-sm text-gray-700">
          The invoice stays on record, marked voided{isDraft ? '' : ', and its income and any payment postings are voided too'}. This cannot be undone.
        </p>
        <div className="mt-3">
          <Field label="Reason" error={state.reasonError ? 'Enter a reason' : undefined}>
            <input className={inputClass} maxLength={200} value={state.reason} onChange={(event) => state.setReason(event.target.value)} />
          </Field>
        </div>
      </ConfirmDialog>
    );
  }
  return null;
}

function ReadOnlyInvoice({ invoice, onBack, onChanged }: { invoice: ApiInvoice; onBack: () => void; onChanged: (invoice: ApiInvoice | null) => void }) {
  const state = useInvoiceAction(invoice.id, onChanged);
  return (
    <section aria-labelledby="invoice-title">
      <h2 id="invoice-title" className="text-xl font-semibold text-gray-900">
        Invoice {invoice.publicNumber}
        <span className="ml-3 rounded bg-gray-100 px-2 py-1 text-sm font-normal capitalize text-gray-800">{invoice.status}</span>
      </h2>
      <p className="mt-3 text-gray-900">{invoice.clientName}</p>
      {invoice.clientEmail && <p className="text-gray-700">{invoice.clientEmail}</p>}
      {invoice.clientAddress && <p className="whitespace-pre-line text-gray-700">{invoice.clientAddress}</p>}
      <p className="mt-2 text-sm text-gray-700">
        Issued {formatDate(invoice.issueDate)}, due {formatDate(invoice.dueDate)}
      </p>
      <ul className="mt-4 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
        {invoice.lines.map((line) => (
          <li key={line.id} className="grid grid-cols-2 gap-1 p-3 md:grid-cols-[1fr_6rem_8rem_5rem_8rem]">
            <span className="col-span-2 truncate text-gray-900 md:col-span-1" title={line.description}>{line.description}</span>
            <span className="tabular-nums text-gray-700 md:text-right">{formatQuantity(line.quantity)}</span>
            <span className="tabular-nums text-gray-700 md:text-right">{formatPence(line.unitPricePence)}</span>
            <span className="tabular-nums text-gray-700 md:text-right">{line.vatRatePercent}%</span>
            <span className="tabular-nums text-gray-900 md:text-right">{formatPence(line.totalPence)}</span>
          </li>
        ))}
      </ul>
      <TotalsPanel netPence={invoice.subtotalPence} vatPence={invoice.vatPence} totalPence={invoice.totalPence} />
      {invoice.notes && <p className="mt-4 whitespace-pre-line text-sm text-gray-700">{invoice.notes}</p>}
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className={buttonClass} onClick={onBack}>
          Back to invoices
        </button>
        {(invoice.status === 'sent' || invoice.status === 'overdue') && (
          <button type="button" className={primaryClass} onClick={() => state.setAction('paid')}>
            Mark paid
          </button>
        )}
        {invoice.status !== 'voided' && (
          <button type="button" className={buttonClass} onClick={() => state.setAction('void')}>
            Void
          </button>
        )}
      </div>
      <ActionDialogs summary={`${invoice.publicNumber}, ${formatPence(invoice.totalPence)}`} isDraft={false} state={state} />
    </section>
  );
}

function DraftEditor({ invoice, ownerHasVatNumber, onBack, onChanged }: { invoice: ApiInvoice | null; ownerHasVatNumber: boolean; onBack: () => void; onChanged: (invoice: ApiInvoice | null) => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => initialForm(invoice));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const totals = formTotals(form, ownerHasVatNumber);
  const state = useInvoiceAction(invoice?.id ?? null, onChanged);
  const save = useMutation({
    mutationFn: (body: NonNullable<ReturnType<typeof toDraftRequest>['body']>) => saveDraft(invoice?.id ?? null, body),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: invoicesQueryKey });
      onChanged(result);
    },
  });

  const set = (field: Exclude<keyof InvoiceFormState, 'lines'>) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));
  const setLine = (index: number, patch: Partial<InvoiceFormLine>) =>
    setForm((current) => ({ ...current, lines: current.lines.map((line, at) => (at === index ? { ...line, ...patch } : line)) }));

  function validated() {
    const { body, errors: found } = toDraftRequest(form);
    setErrors(found);
    return body;
  }

  const issue = () => {
    const body = validated();
    if (body) state.setAction('issue');
  };
  const confirmIssue = () => {
    const body = toDraftRequest(form).body;
    if (!body) return;
    // The saved draft is what gets issued, so the owner never issues figures they did not see.
    state.mutation.mutate(async () => {
      const draft = await saveDraft(invoice?.id ?? null, body);
      return issueInvoice(draft.id);
    });
  };

  return (
    <form
      aria-labelledby="invoice-title"
      onSubmit={(event) => {
        event.preventDefault();
        const body = validated();
        if (body) save.mutate(body);
      }}
    >
      <h2 id="invoice-title" className="text-xl font-semibold text-gray-900">
        {invoice ? 'Draft invoice' : 'New invoice'}
      </h2>
      <div className="mt-4 grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <Field label="Client name" error={errors.clientName}>
          <input className={inputClass} maxLength={200} value={form.clientName} onChange={set('clientName')} />
        </Field>
        <Field label="Client email">
          <input type="email" className={inputClass} maxLength={254} value={form.clientEmail} onChange={set('clientEmail')} />
        </Field>
        <Field label="Client address">
          <textarea className={`${inputClass} min-h-20`} maxLength={500} value={form.clientAddress} onChange={set('clientAddress')} />
        </Field>
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
          <Field label="Issue date" error={errors.issueDate}>
            <input type="date" className={inputClass} value={form.issueDate} onChange={set('issueDate')} />
          </Field>
          <Field label="Due date" error={errors.dueDate}>
            <input type="date" className={inputClass} value={form.dueDate} onChange={set('dueDate')} />
          </Field>
        </div>
      </div>

      <h3 className="mt-6 text-lg font-semibold text-gray-900">Lines</h3>
      {errors.lines && <p role="alert" className="mt-1 text-sm text-red-800">{errors.lines}</p>}
      <ul className="mt-2 flex flex-col gap-3">
        {form.lines.map((line, index) => (
          <li key={index} className="grid grid-cols-2 items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 md:grid-cols-[1fr_6rem_8rem_6rem_auto]">
            <div className="col-span-2 md:col-span-1">
              <Field label="Description">
                <input className={inputClass} maxLength={300} value={line.description} onChange={(event) => setLine(index, { description: event.target.value })} />
              </Field>
            </div>
            <Field label="Quantity">
              <input inputMode="decimal" className={`${inputClass} tabular-nums`} value={line.quantity} onChange={(event) => setLine(index, { quantity: event.target.value })} />
            </Field>
            <Field label="Unit price (£)">
              <input inputMode="decimal" className={`${inputClass} tabular-nums`} value={line.unitPrice} onChange={(event) => setLine(index, { unitPrice: event.target.value })} />
            </Field>
            <Field label="VAT rate">
              <select className={inputClass} value={line.vatRatePercent} onChange={(event) => setLine(index, { vatRatePercent: Number(event.target.value) as InvoiceFormLine['vatRatePercent'] })}>
                {INVOICE_VAT_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}%
                  </option>
                ))}
              </select>
            </Field>
            {form.lines.length > 1 && (
              <button
                type="button"
                className={`${buttonClass} col-span-2 md:col-span-1 md:mt-6`}
                aria-label={`Remove line ${index + 1}`}
                onClick={() => setForm((current) => ({ ...current, lines: current.lines.filter((_, at) => at !== index) }))}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className={`${buttonClass} mt-3`} onClick={() => setForm((current) => ({ ...current, lines: [...current.lines, blankLine] }))}>
        Add line
      </button>

      <TotalsPanel {...totals} />
      {!ownerHasVatNumber && <p className="mt-2 text-right text-sm text-gray-700">No VAT is charged until a VAT number is saved in Settings.</p>}

      <div className="mt-4">
        <Field label="Notes">
          <textarea className={`${inputClass} min-h-20`} maxLength={2000} value={form.notes} onChange={set('notes')} />
        </Field>
      </div>

      {save.isError && <p role="alert" className="mt-3 text-sm text-red-800">{save.error.message}</p>}
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className={buttonClass} onClick={onBack}>
          Back to invoices
        </button>
        <button type="submit" disabled={save.isPending} className={buttonClass}>
          Save draft
        </button>
        <button type="button" className={primaryClass} onClick={issue}>
          Issue
        </button>
        {invoice && (
          <button type="button" className={buttonClass} onClick={() => state.setAction('void')}>
            Void
          </button>
        )}
      </div>
      <ActionDialogs summary={`${form.clientName}, ${formatPence(totals.totalPence)}`} isDraft state={state} onIssue={confirmIssue} />
    </form>
  );
}

export default function InvoiceEditor({
  invoice,
  ownerHasVatNumber,
  onBack,
  onChanged,
}: {
  invoice: ApiInvoice | null;
  ownerHasVatNumber: boolean;
  onBack: () => void;
  onChanged: (invoice: ApiInvoice | null) => void;
}) {
  if (invoice && invoice.status !== 'draft') return <ReadOnlyInvoice invoice={invoice} onBack={onBack} onChanged={onChanged} />;
  return <DraftEditor key={invoice?.id ?? 'new'} invoice={invoice} ownerHasVatNumber={ownerHasVatNumber} onBack={onBack} onChanged={onChanged} />;
}
