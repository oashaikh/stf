import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { fetchAccounts } from "../lib/accountsApi";
import { formatDate } from "../lib/dates";
import {
  createEntry,
  EntryRefusedError,
  ENTRIES_QUERY_KEY,
  fetchHasVatNumber,
} from "../lib/entriesApi";
import { entryFigures, parseEntryAmount } from "../lib/entryForm";
import { formatPence } from "../lib/money";
import type { VatRate } from "../lib/vat";
import EntriesList from "./EntriesList";

const fieldClass =
  "mt-1 min-h-[44px] w-full rounded-md border border-gray-400 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";
const choiceClass = (selected: boolean) =>
  `min-h-[44px] flex-1 rounded-md border px-4 ${selected ? "border-blue-700 bg-blue-700 text-white" : "border-gray-400 text-gray-900 hover:bg-gray-100"}`;

type Kind = "income" | "expense";
type Errors = Partial<
  Record<
    | "date"
    | "description"
    | "amount"
    | "category"
    | "vat"
    | "reference"
    | "form",
    string
  >
>;

// Server field names (api/_lib/entries.ts newEntrySchema) to the form fields that show them.
const FORM_FIELD: Record<string, keyof Errors> = {
  date: "date",
  description: "description",
  reference: "reference",
  categoryAccountId: "category",
  amountPence: "amount",
  vatRatePercent: "vat",
};

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block font-medium text-gray-900">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-gray-700">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-1 text-sm text-red-800"
        >
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, error?: string, hint?: string) =>
  [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ") ||
  undefined;

function AddEntryForm({ hasVatNumber }: { hasVatNumber: boolean }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Kind>("expense");
  const [date, setDate] = useState(todayIso);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [amountIs, setAmountIs] = useState<"gross" | "net">("gross");
  const [vatRate, setVatRate] = useState<VatRate>(0);
  const [categoryId, setCategoryId] = useState("");
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const accounts = useQuery({
    queryKey: ["accounts", "active"],
    queryFn: () => fetchAccounts(false),
  });
  const categories = (accounts.data ?? []).filter(
    (account) => account.accountType === kind,
  );

  const parsedAmount = parseEntryAmount(amount);
  const figures =
    "pence" in parsedAmount
      ? entryFigures(parsedAmount.pence, amountIs, hasVatNumber ? vatRate : 0)
      : null;

  const save = useMutation({
    mutationFn: createEntry,
    onSuccess: async () => {
      setDescription("");
      setAmount("");
      setCategoryId("");
      setReference("");
      setErrors({});
      await queryClient.invalidateQueries({ queryKey: ENTRIES_QUERY_KEY });
    },
    onError: (error) => {
      const fields =
        error instanceof EntryRefusedError
          ? error.fields.flatMap((field) => FORM_FIELD[field] ?? [])
          : [];
      const message =
        error instanceof EntryRefusedError
          ? error.message
          : "Could not save the entry. Please try again.";
      setErrors(
        fields.length > 0
          ? Object.fromEntries(fields.map((field) => [field, message]))
          : { form: message },
      );
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const found: Errors = {};
    if (!description.trim()) found.description = "Enter a description";
    if (!categoryId) found.category = "Choose a category";
    if (!date) found.date = "Enter a date";
    if ("error" in parsedAmount) found.amount = parsedAmount.error;
    setErrors(found);
    if (Object.keys(found).length > 0 || !("pence" in parsedAmount)) return;
    save.mutate({
      date,
      description: description.trim(),
      ...(reference.trim() && { reference: reference.trim() }),
      kind,
      categoryAccountId: categoryId,
      amountPence: parsedAmount.pence,
      amountIs,
      vatRatePercent: hasVatNumber ? vatRate : 0,
      status: "draft",
    });
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="mt-4 grid gap-4 rounded-lg border border-gray-300 bg-white p-4 md:grid-cols-2"
    >
      <div
        role="group"
        aria-label="Money in or out"
        className="flex gap-2 md:col-span-2"
      >
        {(["expense", "income"] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={kind === choice}
            className={choiceClass(kind === choice)}
            onClick={() => {
              setKind(choice);
              setCategoryId("");
            }}
          >
            {choice === "expense" ? "Money out" : "Money in"}
          </button>
        ))}
      </div>

      <Field
        id="entry-date"
        label="Date"
        error={errors.date}
        hint={date ? formatDate(date) : undefined}
      >
        <input
          id="entry-date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className={fieldClass}
          aria-describedby={describedBy("entry-date", errors.date, date)}
          aria-invalid={Boolean(errors.date)}
        />
      </Field>

      <Field
        id="entry-description"
        label="Description"
        error={errors.description}
      >
        <input
          id="entry-description"
          value={description}
          maxLength={200}
          onChange={(event) => setDescription(event.target.value)}
          className={fieldClass}
          aria-describedby={describedBy(
            "entry-description",
            errors.description,
          )}
          aria-invalid={Boolean(errors.description)}
        />
      </Field>

      <Field id="entry-amount" label="Amount in pounds" error={errors.amount}>
        <input
          id="entry-amount"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className={`${fieldClass} text-right tabular-nums`}
          aria-describedby={describedBy("entry-amount", errors.amount)}
          aria-invalid={Boolean(errors.amount)}
        />
      </Field>

      <fieldset className="flex gap-2 self-start">
        <legend className="mb-1 font-medium text-gray-900">
          The amount is
        </legend>
        {(["gross", "net"] as const).map((choice) => (
          <label
            key={choice}
            className={`flex min-h-[44px] flex-1 cursor-pointer items-center justify-center rounded-md border px-4 ${amountIs === choice ? "border-blue-700 bg-blue-700 text-white" : "border-gray-400 text-gray-900"}`}
          >
            <input
              type="radio"
              name="amount-is"
              className="sr-only"
              checked={amountIs === choice}
              onChange={() => setAmountIs(choice)}
            />
            {choice === "gross" ? "Gross (with VAT)" : "Net (before VAT)"}
          </label>
        ))}
      </fieldset>

      {hasVatNumber && (
        <Field id="entry-vat" label="VAT rate" error={errors.vat}>
          <select
            id="entry-vat"
            value={vatRate}
            onChange={(event) =>
              setVatRate(Number(event.target.value) as VatRate)
            }
            className={fieldClass}
          >
            <option value={0}>0% (no VAT)</option>
            <option value={5}>5%</option>
            <option value={20}>20%</option>
          </select>
        </Field>
      )}

      <Field id="entry-category" label="Category" error={errors.category}>
        <select
          id="entry-category"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          className={fieldClass}
          aria-describedby={describedBy("entry-category", errors.category)}
          aria-invalid={Boolean(errors.category)}
        >
          <option value="">Choose a category</option>
          {categories.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id="entry-reference"
        label="Reference (optional)"
        error={errors.reference}
      >
        <input
          id="entry-reference"
          value={reference}
          maxLength={60}
          onChange={(event) => setReference(event.target.value)}
          className={fieldClass}
          aria-describedby={describedBy("entry-reference", errors.reference)}
        />
      </Field>

      {figures && (
        <dl
          data-testid="figures"
          className="grid grid-cols-3 gap-2 rounded-md bg-gray-100 p-3 md:col-span-2"
        >
          {[
            ["Net", figures.netPence],
            ["VAT", figures.vatPence],
            ["Gross", figures.grossPence],
          ].map(([label, pence]) => (
            <div key={label}>
              <dt className="text-right text-sm text-gray-700">{label}</dt>
              <dd className="text-right font-medium tabular-nums">
                {formatPence(pence as number)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {errors.form && (
        <p role="alert" className="text-red-800 md:col-span-2">
          {errors.form}
        </p>
      )}

      <button
        type="submit"
        disabled={save.isPending}
        className="min-h-[44px] rounded-md bg-blue-700 px-4 text-white hover:bg-blue-800 disabled:opacity-60 md:col-span-2 md:justify-self-start"
      >
        {save.isPending ? "Saving…" : "Save as draft"}
      </button>
    </form>
  );
}

export default function ExpensesPage() {
  const [adding, setAdding] = useState(false);
  const vat = useQuery({
    queryKey: ["vat-number-present"],
    queryFn: fetchHasVatNumber,
  });
  return (
    <main className="p-4 md:p-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Expenses</h1>
        <button
          type="button"
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
          className="min-h-[44px] rounded-md bg-blue-700 px-4 text-white hover:bg-blue-800"
        >
          Add entry
        </button>
      </div>
      {adding && <AddEntryForm hasVatNumber={vat.data === true} />}
      <EntriesList />
    </main>
  );
}
