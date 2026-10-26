import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formatDate } from "../lib/dates";
import {
  ENTRIES_QUERY_KEY,
  PeriodLockedError,
  confirmEntry,
  voidEntry,
  type ApiEntry,
} from "../lib/entriesApi";
import { formatPence } from "../lib/money";

const buttonClass =
  "min-h-[44px] rounded-md border border-gray-400 bg-white px-4 text-gray-900 hover:bg-gray-100 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

// A native modal dialog gives the focus trap and Escape-to-close; nothing is sent until the footer button is pressed.
function VoidDialog({
  entry,
  onCancel,
  onVoid,
}: {
  entry: ApiEntry;
  onCancel: () => void;
  onVoid: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`void-title-${entry.id}`}
      onClose={onCancel}
      className="w-full max-w-md flex-col rounded p-0 open:flex backdrop:bg-black/50"
    >
      <div className="p-6">
        <h2
          id={`void-title-${entry.id}`}
          className="text-lg font-semibold text-gray-900"
        >
          Void this entry?
        </h2>
        <p className="mt-3 text-gray-900">
          {formatDate(entry.date)}, {entry.description},{" "}
          {formatPence(entry.grossPence)}
        </p>
        <p className="mt-3 text-sm text-gray-700">
          The entry is marked voided and stays on record. It no longer counts
          towards your totals.
        </p>
      </div>
      <div className="flex justify-end gap-3 border-t border-gray-200 p-4">
        <button type="button" onClick={onCancel} className={buttonClass}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onVoid}
          className="min-h-[44px] rounded-md bg-red-800 px-4 text-white hover:bg-red-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          Void entry
        </button>
      </div>
    </dialog>
  );
}

export default function EntryActions({
  entry,
  onVoided,
}: {
  entry: ApiEntry;
  onVoided: (entryId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [voidOpen, setVoidOpen] = useState(false);
  const confirm = useMutation({
    mutationFn: () => confirmEntry(entry.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ENTRIES_QUERY_KEY }),
  });
  const voiding = useMutation({
    mutationFn: () => voidEntry(entry.id),
    onSuccess: () => onVoided(entry.id),
  });
  const failure = confirm.error ?? voiding.error;

  return (
    <div className="md:col-span-full">
      <div className="flex flex-wrap gap-2">
        {entry.status === "draft" && (
          <button
            type="button"
            className={buttonClass}
            disabled={confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            Confirm
          </button>
        )}
        <button
          type="button"
          className={buttonClass}
          disabled={voiding.isPending}
          onClick={() => setVoidOpen(true)}
        >
          Void
        </button>
      </div>
      {voidOpen && (
        <VoidDialog
          entry={entry}
          onCancel={() => setVoidOpen(false)}
          onVoid={() => {
            setVoidOpen(false);
            voiding.mutate();
          }}
        />
      )}
      {failure instanceof PeriodLockedError ? (
        <p role="alert" className="mt-2 text-red-800">
          This entry is in a VAT period that has been confirmed or filed, so it
          cannot be changed.{" "}
          <Link
            to="/vat"
            className="inline-flex min-h-[44px] items-center font-medium underline"
          >
            Go to VAT
          </Link>
        </p>
      ) : failure ? (
        <p role="alert" className="mt-2 text-red-800">
          Something went wrong, so nothing was changed.{" "}
          <button
            type="button"
            className={buttonClass}
            onClick={() =>
              confirm.error ? confirm.mutate() : voiding.mutate()
            }
          >
            Try again
          </button>
        </p>
      ) : null}
    </div>
  );
}
