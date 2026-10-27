import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router-dom";
import EntryActions from "./EntryActions";
import { fetchAccounts } from "../lib/accountsApi";
import { formatDate } from "../lib/dates";
import { ENTRIES_QUERY_KEY, fetchEntries, type ApiEntry } from "../lib/entriesApi";
import {
  activeFilterCount,
  DEFAULT_ENTRY_FILTERS,
  filtersFromParams,
  taxYearRange,
  toEntryListParams,
  vatQuarterRange,
  type EntryFilters,
} from "../lib/entryFilters";
import { formatPence } from "../lib/money";
import { useVatObligations } from "./useVatObligations";

const fieldClass =
  "mt-1 min-h-[44px] w-full rounded-md border border-gray-400 bg-white px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";
const buttonClass =
  "min-h-[44px] rounded-md border border-gray-400 bg-white px-4 text-gray-900 hover:bg-gray-100 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

function FilterFields({
  filters,
  onChange,
}: {
  filters: EntryFilters;
  onChange: (filters: EntryFilters) => void;
}) {
  const set = (change: Partial<EntryFilters>) =>
    onChange({ ...filters, ...change });
  const accounts = useQuery({
    queryKey: ["accounts", "active"],
    queryFn: () => fetchAccounts(false),
  });
  const obligations = useVatObligations();
  const quarter = obligations.data
    ? vatQuarterRange(obligations.data, new Date().toISOString().slice(0, 10))
    : undefined;
  const quarterReason = quarter
    ? undefined
    : obligations.isPending
      ? "Loading VAT periods"
      : "No VAT period is open today, or VAT is not set up";
  const categories = (accounts.data ?? []).filter(
    (account) =>
      account.accountType === "income" || account.accountType === "expense",
  );

  return (
    <>
      <label className="block text-sm">
        From
        <input
          type="date"
          value={filters.from}
          onChange={(event) => set({ from: event.target.value })}
          className={fieldClass}
        />
      </label>
      <label className="block text-sm">
        To
        <input
          type="date"
          value={filters.to}
          onChange={(event) => set({ to: event.target.value })}
          className={fieldClass}
        />
      </label>
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
        <button
          type="button"
          className={buttonClass}
          onClick={() => set(taxYearRange())}
        >
          This tax year
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!quarter}
          title={quarterReason}
          onClick={() => quarter && set(quarter)}
        >
          This VAT quarter
        </button>
        {quarterReason && (
          <span className="w-full text-sm text-gray-700">{quarterReason}</span>
        )}
      </div>
      <label className="block text-sm">
        Money
        <select
          value={filters.kind}
          onChange={(event) =>
            set({ kind: event.target.value as EntryFilters["kind"] })
          }
          className={fieldClass}
        >
          <option value="both">In and out</option>
          <option value="income">Money in</option>
          <option value="expense">Money out</option>
        </select>
      </label>
      <label className="block text-sm">
        Filter by category
        <select
          value={filters.categoryAccountId}
          onChange={(event) => set({ categoryAccountId: event.target.value })}
          className={fieldClass}
        >
          <option value="">All categories</option>
          {categories.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Status
        <select
          value={filters.status}
          onChange={(event) =>
            set({ status: event.target.value as EntryFilters["status"] })
          }
          className={fieldClass}
        >
          <option value="">Any status</option>
          <option value="draft">Draft</option>
          <option value="confirmed">Confirmed</option>
        </select>
      </label>
    </>
  );
}

// jsdom has no matchMedia; treating it as a wide screen keeps the inline row there.
const PHONE_QUERY = "(max-width: 639px)";
function usePhoneWidth() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia?.(PHONE_QUERY);
      query?.addEventListener("change", notify);
      return () => query?.removeEventListener("change", notify);
    },
    () => window.matchMedia?.(PHONE_QUERY).matches ?? false,
  );
}

function SearchBox({
  filters,
  onChange,
}: {
  filters: EntryFilters;
  onChange: (filters: EntryFilters) => void;
}) {
  return (
    <label className="block text-sm">
      Search
      <input
        type="search"
        value={filters.search}
        onChange={(event) => onChange({ ...filters, search: event.target.value })}
        placeholder="Description"
        maxLength={100}
        className={fieldClass}
      />
    </label>
  );
}

// A native modal dialog gives the focus trap and Escape-to-close; nothing changes the list until Apply.
function FiltersSheet({
  filters,
  onApply,
  onClose,
}: {
  filters: EntryFilters;
  onApply: (filters: EntryFilters) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(filters);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="filters-sheet-title"
      onClose={onClose}
      className="m-0 mt-auto max-h-[90vh] w-full max-w-none overflow-y-auto rounded-t-lg p-4 backdrop:bg-black/40"
    >
      <h2 id="filters-sheet-title" className="text-lg font-semibold">
        Filters
      </h2>
      <div className="mt-3 grid gap-3">
        <FilterFields filters={draft} onChange={setDraft} />
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className={`${buttonClass} flex-1`}
          onClick={() => setDraft({ ...DEFAULT_ENTRY_FILTERS, search: filters.search })}
        >
          Clear
        </button>
        <button
          type="button"
          className="min-h-[44px] flex-1 rounded-md border border-blue-700 bg-blue-700 px-4 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          onClick={() => {
            onApply(draft);
            dialogRef.current?.close();
          }}
        >
          Apply
        </button>
      </div>
    </dialog>
  );
}

function FilterBar({
  filters,
  onChange,
}: {
  filters: EntryFilters;
  onChange: (filters: EntryFilters) => void;
}) {
  const phone = usePhoneWidth();
  const [sheetOpen, setSheetOpen] = useState(false);
  if (!phone) {
    return (
      <form
        aria-label="Filter entries"
        onSubmit={(event) => event.preventDefault()}
        className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <FilterFields filters={filters} onChange={onChange} />
        <SearchBox filters={filters} onChange={onChange} />
      </form>
    );
  }
  const count = activeFilterCount(filters);
  return (
    <form
      aria-label="Filter entries"
      onSubmit={(event) => event.preventDefault()}
      className="mt-6 flex items-end gap-2"
    >
      <div className="min-w-0 flex-1">
        <SearchBox filters={filters} onChange={onChange} />
      </div>
      <button
        type="button"
        className={buttonClass}
        onClick={() => setSheetOpen(true)}
      >
        Filters{count > 0 && <span aria-label={`, ${count} active`}> {count}</span>}
      </button>
      {sheetOpen && (
        <FiltersSheet
          filters={filters}
          onApply={onChange}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </form>
  );
}

export default function EntriesList({
  onEdit,
}: {
  onEdit: (entry: ApiEntry) => void;
}) {
  // The URL query holds the filters so the dashboard (?status=draft) and the VAT drill-down can link here.
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const setFilters = (next: EntryFilters) =>
    setSearchParams(toEntryListParams(next), { replace: true });
  // The API refuses a range that ends before it starts, so wait until the dates make sense.
  const rangeReversed = Boolean(
    filters.from && filters.to && filters.from > filters.to,
  );
  const entries = useInfiniteQuery({
    enabled: !rangeReversed,
    queryKey: [...ENTRIES_QUERY_KEY, filters],
    queryFn: ({ pageParam }) => fetchEntries(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  // The list API drops voided entries, so a voided row stays here until the next refetch.
  const sectionRef = useRef<HTMLElement>(null);
  const [voidedIds, setVoidedIds] = useState<string[]>([]);
  const rows = entries.data?.pages.flatMap((page) => page.entries) ?? [];
  const isFiltered =
    JSON.stringify(filters) !== JSON.stringify(DEFAULT_ENTRY_FILTERS);

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label="Entries"
      className="mt-6 focus:outline-none"
    >
      <FilterBar filters={filters} onChange={setFilters} />
      {rangeReversed ? (
        <p role="alert" className="mt-6 text-red-800">
          The From date is after the To date. Change one of them to see entries.
        </p>
      ) : entries.isPending ? (
        <p role="status" className="mt-6 text-gray-700">
          Loading entries…
        </p>
      ) : entries.isError ? (
        <p role="alert" className="mt-6 text-red-800">
          Could not load your entries. Please try again.
        </p>
      ) : rows.length === 0 ? (
        <div className="mt-6 text-gray-700">
          {isFiltered ? (
            <>
              <p>No entries match these filters.</p>
              <button
                type="button"
                className={`${buttonClass} mt-2`}
                onClick={() => setFilters(DEFAULT_ENTRY_FILTERS)}
              >
                Clear filters
              </button>
            </>
          ) : (
            <p>
              No entries yet. Choose Add entry above, fill in the date,
              description, category and amount, and save it as a draft.
            </p>
          )}
        </div>
      ) : (
        <>
          <ul className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-300 bg-white">
            {rows.map((entry) => (
              <li
                key={entry.id}
                className="grid min-h-[44px] gap-1 px-4 py-2 md:grid-cols-[7rem_minmax(0,1fr)_10rem_9rem_16rem] md:items-center md:gap-3"
              >
                <span>
                  <span className="text-sm text-gray-700 md:hidden">Date: </span>
                  {formatDate(entry.date)}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`truncate font-medium${voidedIds.includes(entry.id) ? " line-through" : ""}`}
                    title={entry.description}
                  >
                    {entry.description}
                  </span>
                  {voidedIds.includes(entry.id) ? (
                    <span className="shrink-0 rounded bg-gray-200 px-2 text-sm text-gray-900">
                      Voided
                    </span>
                  ) : entry.status === "draft" && (
                    <span className="shrink-0 rounded bg-amber-100 px-2 text-sm text-amber-900">
                      Draft
                    </span>
                  )}
                  {entry.hasReceipt && (
                    <svg
                      role="img"
                      aria-label="Receipt attached"
                      viewBox="0 0 24 24"
                      className="h-5 w-5 shrink-0 text-gray-700"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <title>Receipt attached</title>
                      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />
                    </svg>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="text-sm text-gray-700 md:hidden">
                    Category:{" "}
                  </span>
                  <span className="truncate" title={entry.categoryName}>
                    {entry.categoryName}
                  </span>
                </span>
                <span className="tabular-nums md:text-right">
                  {entry.kind === "income" ? "In " : "Out "}
                  {formatPence(entry.grossPence)}
                </span>
                {!voidedIds.includes(entry.id) && (
                  <EntryActions
                    entry={entry}
                    onEdit={onEdit}
                    onVoided={(id) => {
                      setVoidedIds((ids) => [...ids, id]);
                      // The row's buttons disappear, so move focus somewhere that still exists.
                      sectionRef.current?.focus();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
          {entries.hasNextPage && (
            <button
              type="button"
              className={`${buttonClass} mt-4`}
              disabled={entries.isFetchingNextPage}
              onClick={() => entries.fetchNextPage()}
            >
              {entries.isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
