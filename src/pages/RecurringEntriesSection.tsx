import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { fetchAccounts } from '../lib/accountsApi';
import { formatDate } from '../lib/dates';
import { parseEntryAmount } from '../lib/entryForm';
import { formatPence } from '../lib/money';
import {
  createTemplate,
  deleteTemplate,
  fetchTemplates,
  RECURRING_QUERY_KEY,
  updateTemplate,
  type ApiTemplate,
  type RecurringSchedule,
} from '../lib/recurringEntriesApi';

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const buttonClass = `min-h-11 rounded-md border border-gray-400 bg-white px-4 text-gray-900 hover:bg-gray-100 disabled:opacity-60 ${focusRing}`;
const primaryClass = `min-h-11 rounded-md bg-blue-700 px-4 text-white hover:bg-blue-800 disabled:opacity-60 ${focusRing}`;
const inputClass = `min-h-11 w-full rounded border border-gray-400 px-2 text-gray-900 ${focusRing}`;
const choiceClass = (selected: boolean) =>
  `min-h-11 flex-1 rounded-md border px-4 ${focusRing} ${selected ? 'border-blue-700 bg-blue-700 text-white' : 'border-gray-400 text-gray-900 hover:bg-gray-100'}`;

const SCHEDULE_LABELS: Record<RecurringSchedule, string> = { monthly: 'Monthly', yearly: 'Yearly' };

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-gray-700">
      {label}
      {children}
      {error && <span className="text-sm text-red-800">{error}</span>}
    </label>
  );
}

// A native modal dialog gives the focus trap and Escape-to-close; nothing is sent until the footer button is pressed.
function DeleteTemplateDialog({ template, error, onCancel, onDelete }: { template: ApiTemplate; error?: string; onCancel: () => void; onDelete: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog ref={dialogRef} aria-labelledby="delete-template-title" onClose={onCancel} className="w-full max-w-md flex-col rounded p-0 open:flex backdrop:bg-black/50">
      <div className="p-6">
        <h3 id="delete-template-title" className="text-lg font-semibold text-gray-900">
          Delete {template.description}?
        </h3>
        <p className="mt-3 text-sm text-gray-700">
          No more drafts will be created from this template. Drafts and entries it already made stay on record.
        </p>
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
        <button type="button" onClick={onDelete} className={`min-h-11 rounded-md bg-red-800 px-4 text-white hover:bg-red-900 ${focusRing}`}>
          Delete template
        </button>
      </div>
    </dialog>
  );
}

// With `template` the form edits it; kind, category and schedule are fixed once created (the API refuses to change them).
function TemplateForm({ hasVatNumber, template, onDone }: { hasVatNumber: boolean; template?: ApiTemplate; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'income' | 'expense'>(template?.kind ?? 'expense');
  const [categoryId, setCategoryId] = useState(template?.categoryAccountId ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [amount, setAmount] = useState(template ? formatPence(template.amountPence) : '');
  const [amountIs, setAmountIs] = useState<'gross' | 'net'>(template?.amountIs ?? 'gross');
  const [vatRate, setVatRate] = useState(template?.vatRatePercent ?? 0);
  const [schedule, setSchedule] = useState<RecurringSchedule>(template?.schedule ?? 'monthly');
  const [nextDate, setNextDate] = useState(template?.nextDate ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  // A template that already carries VAT keeps showing its rate even if the VAT number was removed since.
  const showVat = hasVatNumber || vatRate !== 0;

  const accounts = useQuery({ queryKey: ['accounts', 'active'], queryFn: () => fetchAccounts(false) });
  const categories = (accounts.data ?? []).filter((account) => account.accountType === kind);

  const save = useMutation({
    mutationFn: (request: Omit<ApiTemplate, 'id' | 'paused'>) =>
      template
        ? updateTemplate(template.id, {
            amountPence: request.amountPence,
            amountIs: request.amountIs,
            vatRatePercent: request.vatRatePercent,
            description: request.description,
            nextDate: request.nextDate,
          })
        : createTemplate(request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: RECURRING_QUERY_KEY });
      onDone();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsedAmount = parseEntryAmount(amount);
    const found: Record<string, string> = {};
    if (!description.trim()) found.description = 'Enter a description';
    if (!template && !categoryId) found.category = 'Choose a category';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) found.nextDate = 'Enter the first date';
    if ('error' in parsedAmount) found.amount = parsedAmount.error;
    setErrors(found);
    if (Object.keys(found).length > 0 || !('pence' in parsedAmount)) return;
    save.mutate({
      kind,
      categoryAccountId: categoryId,
      amountPence: parsedAmount.pence,
      amountIs,
      vatRatePercent: showVat ? vatRate : 0,
      description: description.trim(),
      schedule,
      nextDate,
    });
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={template ? `Edit ${template.description}` : 'Add a recurring entry'}
      className="mt-4 grid grid-cols-1 items-start gap-3 rounded-lg border border-gray-300 bg-white p-4 md:grid-cols-2"
    >
      {template ? (
        <p className="text-sm text-gray-700 md:col-span-2">Kind, category and schedule cannot be changed. Delete this template and add a new one to change them.</p>
      ) : (
        <>
          <div role="group" aria-label="Money in or out" className="flex gap-2 md:col-span-2">
            {(['expense', 'income'] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                aria-pressed={kind === choice}
                className={choiceClass(kind === choice)}
                onClick={() => {
                  setKind(choice);
                  setCategoryId('');
                }}
              >
                {choice === 'expense' ? 'Money out' : 'Money in'}
              </button>
            ))}
          </div>
          <Field label="Category" error={errors.category}>
            <select className={inputClass} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">Choose a category</option>
              {categories.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Repeats">
            <select className={inputClass} value={schedule} onChange={(event) => setSchedule(event.target.value as RecurringSchedule)}>
              {Object.entries(SCHEDULE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      <Field label="Description" error={errors.description}>
        <input className={inputClass} maxLength={200} value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <Field label="First date" error={errors.nextDate}>
        <input type="date" className={inputClass} value={nextDate} onChange={(event) => setNextDate(event.target.value)} />
      </Field>
      <Field label="Amount in pounds" error={errors.amount}>
        <input inputMode="decimal" autoComplete="off" className={`${inputClass} text-right tabular-nums`} value={amount} onChange={(event) => setAmount(event.target.value)} />
      </Field>
      <fieldset className="flex gap-2">
        <legend className="mb-1 text-sm text-gray-700">The amount is</legend>
        {(['gross', 'net'] as const).map((choice) => (
          <button key={choice} type="button" aria-pressed={amountIs === choice} className={choiceClass(amountIs === choice)} onClick={() => setAmountIs(choice)}>
            {choice === 'gross' ? 'Gross (with VAT)' : 'Net (before VAT)'}
          </button>
        ))}
      </fieldset>
      {showVat && (
        <Field label="VAT rate">
          <select className={inputClass} value={vatRate} onChange={(event) => setVatRate(Number(event.target.value))}>
            <option value={0}>0% (no VAT)</option>
            <option value={5}>5%</option>
            <option value={20}>20%</option>
          </select>
        </Field>
      )}
      <div className="flex flex-wrap gap-3 md:col-span-2">
        <button type="submit" disabled={save.isPending} className={primaryClass}>
          {save.isPending ? 'Saving…' : template ? 'Save changes' : 'Save recurring entry'}
        </button>
        <button type="button" onClick={onDone} className={buttonClass}>
          Cancel
        </button>
      </div>
      {save.isError && (
        <p role="alert" className="text-sm text-red-800 md:col-span-2">
          {save.error.message}
        </p>
      )}
    </form>
  );
}

// Drafts made from these templates land in the entries list below, where the owner confirms them.
export default function RecurringEntriesSection({ hasVatNumber }: { hasVatNumber: boolean }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ApiTemplate | null>(null);
  const [deleting, setDeleting] = useState<ApiTemplate | null>(null);
  const templates = useQuery({ queryKey: RECURRING_QUERY_KEY, queryFn: fetchTemplates });
  const refresh = () => queryClient.invalidateQueries({ queryKey: RECURRING_QUERY_KEY });
  const togglePause = useMutation({
    mutationFn: (template: ApiTemplate) => updateTemplate(template.id, { paused: !template.paused }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (template: ApiTemplate) => deleteTemplate(template.id),
    onSuccess: () => {
      setDeleting(null);
      return refresh();
    },
  });

  return (
    <section aria-labelledby="recurring-heading" className="mt-8">
      <div className="flex items-center justify-between gap-3">
        <h2 id="recurring-heading" className="text-xl font-semibold text-gray-900">
          Recurring entries
        </h2>
        <button
          type="button"
          aria-expanded={adding}
          className={buttonClass}
          onClick={() => {
            setEditing(null);
            setAdding(!adding);
          }}
        >
          Add recurring entry
        </button>
      </div>
      <p className="mt-2 text-sm text-gray-700">Rent, subscriptions and other regular items. Each due date creates a draft in the list below for you to confirm.</p>

      {editing ? (
        <TemplateForm key={editing.id} hasVatNumber={hasVatNumber} template={editing} onDone={() => setEditing(null)} />
      ) : (
        adding && <TemplateForm hasVatNumber={hasVatNumber} onDone={() => setAdding(false)} />
      )}

      {templates.isPending && (
        <p role="status" className="mt-4 text-gray-700">
          Loading recurring entries…
        </p>
      )}
      {templates.isError && (
        <p role="alert" className="mt-4 text-red-800">
          Could not load recurring entries. Please try again.
        </p>
      )}
      {templates.data?.length === 0 && <p className="mt-4 text-gray-700">No recurring entries yet.</p>}
      {togglePause.isError && (
        <p role="alert" className="mt-4 text-red-800">
          {togglePause.error.message}
        </p>
      )}

      {templates.data && templates.data.length > 0 && (
        <table className="mt-4 w-full border-collapse rounded-lg border border-gray-200 bg-white text-left">
          <caption className="sr-only">Recurring entries</caption>
          <thead className="hidden md:table-header-group">
            <tr className="border-b border-gray-200 text-sm text-gray-700">
              <th scope="col" className="p-3 font-medium">Description</th>
              <th scope="col" className="p-3 font-medium">Schedule</th>
              <th scope="col" className="p-3 font-medium">Next date</th>
              <th scope="col" className="p-3 text-right font-medium">Amount</th>
              <th scope="col" className="p-3 font-medium">Status</th>
              <th scope="col" className="p-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {templates.data.map((template) => (
              <tr key={template.id} className="block border-b border-gray-200 p-3 last:border-b-0 md:table-row md:p-0">
                <td className="block break-words py-1 font-medium text-gray-900 md:table-cell md:w-1/3 md:max-w-0 md:truncate md:p-3 md:font-normal" title={template.description}>
                  {template.description}
                </td>
                <td data-label="Schedule" className="block py-1 text-gray-900 before:mr-2 before:text-sm before:text-gray-700 before:content-[attr(data-label)] md:table-cell md:p-3 md:before:content-none">
                  {template.kind === 'income' ? 'Money in' : 'Money out'}, {SCHEDULE_LABELS[template.schedule]}
                </td>
                <td data-label="Next date" className="block py-1 text-gray-900 before:mr-2 before:text-sm before:text-gray-700 before:content-[attr(data-label)] md:table-cell md:p-3 md:before:content-none">
                  {formatDate(template.nextDate)}
                </td>
                <td data-label="Amount" className="block py-1 tabular-nums text-gray-900 before:mr-2 before:text-sm before:text-gray-700 before:content-[attr(data-label)] md:table-cell md:p-3 md:text-right md:before:content-none">
                  {formatPence(template.amountPence)}
                </td>
                <td data-label="Status" className="block py-1 text-gray-900 before:mr-2 before:text-sm before:text-gray-700 before:content-[attr(data-label)] md:table-cell md:p-3 md:before:content-none">
                  {template.paused ? 'Paused' : 'Active'}
                </td>
                <td className="block py-1 md:table-cell md:p-3">
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <button type="button" className={buttonClass} aria-label={`Edit ${template.description}`} onClick={() => { setAdding(false); setEditing(template); }}>
                      Edit
                    </button>
                    <button type="button" className={buttonClass} disabled={togglePause.isPending} aria-label={`${template.paused ? 'Resume' : 'Pause'} ${template.description}`} onClick={() => togglePause.mutate(template)}>
                      {template.paused ? 'Resume' : 'Pause'}
                    </button>
                    <button type="button" className={buttonClass} aria-label={`Delete ${template.description}`} onClick={() => setDeleting(template)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {deleting && <DeleteTemplateDialog template={deleting} error={remove.error?.message} onCancel={() => setDeleting(null)} onDelete={() => remove.mutate(deleting)} />}
    </section>
  );
}
