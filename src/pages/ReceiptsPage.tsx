import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import StateMessage from '../components/StateMessage';
import { formatDate } from '../lib/dates';
import {
  confirmReceiptUpload,
  fetchReceipts,
  receiptsQueryKey,
  removeReceipt,
  startReceiptUpload,
  uploadToSignedUrl,
  validateReceiptFile,
  type ListedReceipt,
  type ReceiptUploadStatus,
} from '../lib/receiptsApi';

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const buttonClass =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-gray-400 bg-white px-4 text-gray-900 hover:bg-gray-100 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

const UPLOAD_LABEL: Record<ReceiptUploadStatus, string> = { pending: 'Uploading', ready: 'Uploaded', failed: 'Upload failed' };
// Extraction is only ever a suggestion; no label here says the figures are confirmed.
const EXTRACTION_LABEL: Record<string, string> = {
  pending: 'Not read yet',
  extracted: 'Read, awaiting your review',
  failed: 'Could not read',
  skipped: 'Not read',
};

interface UploadProgress {
  key: number;
  fileName: string;
  percent: number;
  error: string | null;
  done: boolean;
}

function UploadArea() {
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

  // No `accept` here: the dropzone would drop a wrong type silently, and the owner needs to be told why.
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => files.forEach((file) => void uploadOne(file)),
  });
  const cameraInput = useRef<HTMLInputElement>(null);

  return (
    <section aria-label="Upload receipts" className="mt-4">
      <div
        {...getRootProps()}
        className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-4 text-center text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${isDragActive ? 'border-blue-700 bg-blue-50' : 'border-gray-400 bg-white'}`}
      >
        <input {...getInputProps({ accept: ACCEPT })} aria-label="Choose receipt files" />
        <p className="text-gray-900">Drop receipts here, or tap to choose files</p>
        <p className="text-sm text-gray-700">JPEG, PNG, WEBP or PDF, up to 10 MB each</p>
      </div>
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
      <button type="button" className={`${buttonClass} mt-2`} onClick={() => cameraInput.current?.click()}>
        Take a photo
      </button>
      <ul className="mt-2 space-y-2" aria-live="polite">
        {uploads.map((upload) => (
          <li key={upload.key} className="text-sm">
            {upload.error ? (
              <p role="alert" className="text-red-800">{upload.fileName}: {upload.error}</p>
            ) : upload.done ? (
              <p className="text-gray-800">{upload.fileName}: uploaded</p>
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
    <dialog ref={dialogRef} aria-labelledby="remove-receipt-title" onClose={onCancel} className="w-full max-w-md flex-col rounded p-0 open:flex backdrop:bg-black/50">
      <div className="p-6">
        <h2 id="remove-receipt-title" className="text-lg font-semibold text-gray-900">Remove this receipt?</h2>
        <p className="mt-3 break-words text-gray-900">{receipt.fileName}</p>
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
  return (
    <li className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-x-3 gap-y-1 p-3 md:grid-cols-[2.5rem_1fr_8rem_9rem_14rem_auto]">
      <span className="row-span-3 flex h-10 md:col-start-1 md:row-start-1 w-10 items-center justify-center overflow-hidden rounded bg-gray-100 md:row-span-1">
        {receipt.readUrl && receipt.mimeType.startsWith('image/') ? (
          <img src={receipt.readUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <FileText aria-hidden="true" className="h-5 w-5 text-gray-700" />
        )}
      </span>
      <span className="truncate text-gray-900 md:col-start-2 md:row-start-1" title={receipt.fileName}>{receipt.fileName}</span>
      <button type="button" aria-label={`Remove ${receipt.fileName}`} onClick={onRemove} className={`${buttonClass} row-span-3 md:row-span-1 md:col-start-6 md:row-start-1`}>
        Remove
      </button>
      <span className="col-start-2 truncate text-sm text-gray-700 md:col-start-3 md:row-start-1"><span className="md:hidden">Added </span>{formatDate(receipt.createdAt)}</span>
      <span className="col-start-2 truncate text-sm text-gray-800 md:col-start-4 md:row-start-1"><span className="md:hidden">Upload: </span>{UPLOAD_LABEL[receipt.uploadStatus]}</span>
      <span className="col-start-2 text-sm text-gray-800 md:col-start-5 md:row-start-1 md:truncate"><span className="md:hidden">Details: </span>{EXTRACTION_LABEL[receipt.aiStatus ?? 'pending'] ?? EXTRACTION_LABEL.pending}</span>
    </li>
  );
}

function ReceiptList() {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<ListedReceipt | null>(null);
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
  const rows = list.data?.pages.flatMap((page) => page.receipts) ?? [];

  return (
    <>
      {list.isPending && <StateMessage kind="loading">Loading…</StateMessage>}
      {list.isError && <StateMessage kind="error" onRetry={() => void list.refetch()}>Could not load receipts.</StateMessage>}
      {remove.isError && <StateMessage kind="error">{remove.error.message}</StateMessage>}
      {list.isSuccess && rows.length === 0 && <StateMessage kind="empty">No receipts yet.</StateMessage>}
      {rows.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {rows.map((receipt) => (
            <ReceiptRow key={receipt.id} receipt={receipt} onRemove={() => setRemoving(receipt)} />
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
  return (
    <main className="p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Receipts</h1>
      <UploadArea />
      <ReceiptList />
    </main>
  );
}
