import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, FileText } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useDropzone } from 'react-dropzone';
import { Link } from 'react-router-dom';
import StateMessage from '../components/StateMessage';
import { formatDate } from '../lib/dates';
import { formatPence } from '../lib/money';
import {
  confirmReceiptUpload,
  fetchReceipts,
  readReceiptDetails,
  receiptsQueryKey,
  removeReceipt,
  startReceiptUpload,
  uploadToSignedUrl,
  validateReceiptFile,
  type ListedReceipt,
} from '../lib/receiptsApi';

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const focusClass = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const buttonClass = `inline-flex min-h-11 items-center justify-center rounded-md border border-gray-400 bg-white px-4 text-gray-900 hover:bg-gray-100 disabled:opacity-60 ${focusClass}`;
const primaryButtonClass = `inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-blue-800 px-5 font-medium text-white hover:bg-blue-900 ${focusClass}`;

const FILTERS = ['All', 'This month', 'Needs checking'] as const;
type Filter = (typeof FILTERS)[number];

interface UploadProgress {
  key: number;
  fileName: string;
  percent: number;
  error: string | null;
  done: boolean;
}

/** What a person calls the receipt: who it was from, or the file name until it has been read. */
const titleOf = (receipt: ListedReceipt) => readReceiptDetails(receipt).who ?? receipt.fileName;

const localMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

function matchesFilter(receipt: ListedReceipt, filter: Filter, search: string): boolean {
  const read = readReceiptDetails(receipt);
  if (filter === 'Needs checking' && !read.needsCheck) return false;
  if (filter === 'This month' && read.date.slice(0, 7) !== localMonth()) return false;
  const words = [receipt.fileName, read.who, read.category].join(' ').toLowerCase();
  return words.includes(search.trim().toLowerCase());
}

function AddReceipt({ cameraInput }: { cameraInput: RefObject<HTMLInputElement> }) {
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const nextKey = useRef(0);

  const update = (key: number, change: Partial<UploadProgress>) =>
    setUploads((current) => current.map((upload) => (upload.key === key ? { ...upload, ...change } : upload)));

  const uploadOne = useCallback(
    async (file: File) => {
      const key = nextKey.current++;
      const problem = validateReceiptFile(file);
      setUploads((current) => [...current, { key, fileName: file.name, percent: 0, error: problem, done: false }]);
      if (problem) return;
      try {
        const { receipt, uploadUrl } = await startReceiptUpload(file);
        await uploadToSignedUrl(uploadUrl, file, (percent) => update(key, { percent }));
        await confirmReceiptUpload(receipt.id);
        update(key, { percent: 100, done: true });
      } catch (error) {
        update(key, { error: error instanceof Error ? error.message : 'The upload failed.' });
      }
      await queryClient.invalidateQueries({ queryKey: receiptsQueryKey });
    },
    [queryClient],
  );

  // No `accept` here: the dropzone would drop a wrong type silently, and the person needs to be told why.
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => files.forEach((file) => void uploadOne(file)),
  });

  return (
    <section aria-label="Add a receipt" className="mt-4">
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label="Take a photo of a receipt"
        onChange={(event) => {
          Array.from(event.target.files ?? []).forEach((file) => void uploadOne(file));
          event.target.value = '';
        }}
      />
      <button type="button" className={`${primaryButtonClass} w-full md:w-auto`} onClick={() => cameraInput.current?.click()}>
        <Camera aria-hidden="true" className="h-5 w-5" />
        Add a receipt
      </button>
      <div
        {...getRootProps()}
        className={`mt-3 hidden cursor-pointer rounded-lg border-2 border-dashed p-4 text-center text-gray-800 md:block ${focusClass} ${isDragActive ? 'border-blue-700 bg-blue-50' : 'border-gray-400 bg-white'}`}
      >
        <input {...getInputProps({ accept: ACCEPT })} aria-label="Choose receipt files" />
        <p className="text-gray-900">Or drop a photo or PDF here</p>
        <p className="text-sm text-gray-700">Up to 10 MB each</p>
      </div>
      <ul className="mt-2 space-y-2" aria-live="polite">
        {uploads.map((upload) => (
          <li key={upload.key} className="text-sm">
            {upload.error ? (
              <p role="alert" className="text-red-800">{upload.fileName}: {upload.error}</p>
            ) : upload.done ? (
              <p className="text-gray-800">{upload.fileName} added. Check the details below once we have read it.</p>
            ) : (
              <>
                <p className="truncate text-gray-800" title={upload.fileName}>{upload.fileName}</p>
                <div
                  role="progressbar"
                  aria-label={`Uploading ${upload.fileName}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={upload.percent}
                  className="mt-1 h-2 w-full overflow-hidden rounded bg-gray-200"
                >
                  <div className="h-full bg-blue-700" style={{ width: `${upload.percent}%` }} />
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// A native modal dialog gives the focus trap and Escape-to-close; nothing is sent until the footer button is pressed.
function RemoveDialog({ receipt, onCancel, onRemove }: { receipt: ListedReceipt; onCancel: () => void; onRemove: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);
  return (
    <dialog ref={dialogRef} aria-labelledby="remove-receipt-title" onClose={onCancel} className="w-full max-w-[calc(100%-2rem)] sm:max-w-md flex-col rounded p-0 open:flex backdrop:bg-black/50">
      <div className="p-6">
        <h2 id="remove-receipt-title" className="text-lg font-semibold text-gray-900">Remove this receipt?</h2>
        <p className="mt-3 break-words text-gray-900">{titleOf(receipt)}</p>
        <p className="mt-3 text-sm text-gray-700">It disappears from your list but is kept on record.</p>
      </div>
      <div className="flex justify-end gap-3 border-t border-gray-200 p-4">
        <button type="button" onClick={onCancel} className={buttonClass}>Cancel</button>
        <button
          type="button"
          onClick={onRemove}
          className="min-h-11 rounded-md bg-red-800 px-4 text-white hover:bg-red-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          Remove receipt
        </button>
      </div>
    </dialog>
  );
}

function ReceiptRow({ receipt, onRemove }: { receipt: ListedReceipt; onRemove: () => void }) {
  const read = readReceiptDetails(receipt);
  const title = titleOf(receipt);
  return (
    <li className="p-3">
      <div className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-x-3 gap-y-1">
        <span className="row-span-3 flex h-10 w-10 items-center justify-center overflow-hidden rounded bg-gray-100">
          {receipt.readUrl && receipt.mimeType.startsWith('image/') ? (
            <img src={receipt.readUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <FileText aria-hidden="true" className="h-5 w-5 text-gray-700" />
          )}
        </span>
        <span className="truncate font-medium text-gray-900" title={title}>{title}</span>
        <span className="text-right tabular-nums text-gray-900">{read.amountPence === null ? '' : formatPence(read.amountPence)}</span>
        <span className="col-start-2 truncate text-sm text-gray-700">{formatDate(read.date)}</span>
        {read.category ? (
          <span className="col-span-2 col-start-2 flex gap-2 text-sm text-gray-800">
            <span className="shrink-0 rounded bg-gray-100 px-2 text-gray-800">{read.category}</span>
          </span>
        ) : (
          <span className="col-span-2 col-start-2 text-sm text-gray-700">
            {receipt.uploadStatus === 'failed' ? 'Upload failed. Remove it and add it again.' : 'Not read yet'}
          </span>
        )}
      </div>
      {read.needsCheck && (
        <div className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-gray-900">
          <p className="font-medium">Draft: check these details</p>
          <p className="mt-1 text-gray-800">We read them from your receipt. Nothing is saved until you say they are right.</p>
          <Link to={`/money-out/receipts/${receipt.id}`} className={`${buttonClass} mt-2`}>
            Check these details
          </Link>
        </div>
      )}
      <button type="button" aria-label={`Remove ${title}`} onClick={onRemove} className={`${buttonClass} mt-2`}>
        Remove
      </button>
    </li>
  );
}

function ReceiptList({ onAdd }: { onAdd: () => void }) {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<ListedReceipt | null>(null);
  const [filter, setFilter] = useState<Filter>('All');
  const [search, setSearch] = useState('');
  const list = useInfiniteQuery({
    queryKey: receiptsQueryKey,
    queryFn: ({ pageParam }) => fetchReceipts(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeReceipt(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: receiptsQueryKey }),
  });
  const all = list.data?.pages.flatMap((page) => page.receipts) ?? [];
  const rows = all.filter((receipt) => matchesFilter(receipt, filter, search));

  return (
    <>
      {list.isPending && <StateMessage kind="loading">Loading…</StateMessage>}
      {list.isError && <StateMessage kind="error" onRetry={() => void list.refetch()}>Could not load receipts.</StateMessage>}
      {remove.isError && <StateMessage kind="error">{remove.error.message}</StateMessage>}
      {list.isSuccess && all.length === 0 && (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 text-center">
          <h2 className="text-lg font-semibold text-gray-900">No receipts yet</h2>
          <p className="mx-auto mt-2 max-w-prose text-gray-800">
            Keep a photo of every business receipt here. We read the date, who you paid and the amount, and you check them.
          </p>
          <button type="button" className={`${primaryButtonClass} mt-4`} onClick={onAdd}>Add a receipt</button>
        </div>
      )}
      {all.length > 0 && (
        <div className="mt-6">
          <input
            type="search"
            aria-label="Search receipts"
            placeholder="Search by who or category"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={`min-h-11 w-full rounded-md border border-gray-400 bg-white px-3 text-gray-900 md:max-w-sm ${focusClass}`}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {FILTERS.map((choice) => (
              <button
                key={choice}
                type="button"
                aria-pressed={filter === choice}
                onClick={() => setFilter(choice)}
                className={`${buttonClass} ${filter === choice ? 'border-blue-800 bg-blue-50 font-medium' : ''}`}
              >
                {choice}
              </button>
            ))}
          </div>
          {rows.length === 0 && <StateMessage kind="empty">Nothing matches. Try another word or choice.</StateMessage>}
        </div>
      )}
      {rows.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {rows.map((receipt) => (
            <ReceiptRow key={receipt.id} receipt={receipt} onRemove={() => { remove.reset(); setRemoving(receipt); }} />
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <button type="button" className={`${buttonClass} mt-4`} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          Load more
        </button>
      )}
      {removing && (
        <RemoveDialog
          receipt={removing}
          onCancel={() => setRemoving(null)}
          onRemove={() => {
            remove.mutate(removing.id);
            setRemoving(null);
          }}
        />
      )}
    </>
  );
}

export default function ReceiptsPage() {
  const cameraInput = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-6">
      <h2 className="sr-only">Receipts</h2>
      <AddReceipt cameraInput={cameraInput} />
      <ReceiptList onAdd={() => cameraInput.current?.click()} />
    </div>
  );
}
