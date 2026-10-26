import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchHmrcMode, isEffectivelyLive } from '../lib/hmrc/settingsApi';
import {
  NotConnectedError,
  previewVatReturn,
  SubmitVatError,
  submitVatReturn,
  VatNumberMissingError,
  type VatPreview,
} from '../lib/hmrc/vatApi';
import { formatPence } from '../lib/money';
import type { VatReturnBoxes } from '../lib/vat';
import type { ApiResponse } from '../model/types';
import VatHistoryList from './VatHistoryList';
import VatObligationsList from './VatObligationsList';
import VatPreviewPanel from './VatPreviewPanel';
import { useVatObligations } from './useVatObligations';
import { boxLabel, DRILLABLE_BOXES, reviewState, type ReviewStatus, type SubmissionReceipt } from './vatReviewState';

interface DrillLine {
  lineId: string;
  date: string;
  amountPence: number;
  vatPence: number;
  description: string | null;
}

interface ReturnReview {
  boxes: VatReturnBoxes;
  drillDown: Record<keyof VatReturnBoxes, DrillLine[]>;
  drillDownTotals: Record<keyof VatReturnBoxes, number>;
  status: ReviewStatus;
  confirmedAt: string | null;
  stale: boolean;
  submission: SubmissionReceipt | null;
}

interface VatPeriod {
  periodKey: string;
  start: string;
  end: string;
}

const boxNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export default function VatPage() {
  const obligations = useVatObligations();
  const [chosenPeriodKey, setChosenPeriodKey] = useState<string | null>(null);
  const open = (obligations.data ?? []).filter((obligation) => obligation.status === 'O');
  // A lone open obligation is the only thing the user can file, so it needs no click.
  const selected = open.length === 1 ? open[0] : open.find((obligation) => obligation.periodKey === chosenPeriodKey);
  const notConnected = obligations.error instanceof NotConnectedError;
  const vatNumberMissing = obligations.error instanceof VatNumberMissingError;

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold text-gray-900">VAT Returns</h1>

      {obligations.isPending && <p role="status" className="mt-4 text-gray-500">Loading your VAT obligations…</p>}
      {notConnected && (
        <p className="mt-4 text-gray-700">
          HMRC is not connected yet.{' '}
          <Link to="/settings" className="inline-flex min-h-[44px] items-center text-blue-700 underline">
            Connect HMRC in Settings
          </Link>
        </p>
      )}
      {vatNumberMissing && (
        <p className="mt-4 text-gray-700">
          Add your VAT number to review a return.{' '}
          <Link to="/settings" className="inline-flex min-h-[44px] items-center text-blue-700 underline">
            Open Settings
          </Link>
        </p>
      )}
      {obligations.isError && !notConnected && !vatNumberMissing && (
        <p role="alert" className="mt-4 text-red-700">
          Could not load your VAT obligations. Reload the page to try again.
        </p>
      )}
      {obligations.data && open.length === 0 && (
        <p className="mt-4 text-gray-500">No open VAT obligations to file.</p>
      )}
      {open.length > 1 && (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-gray-900">Choose the obligation to file</legend>
          {open.map((obligation) => (
            <label key={obligation.periodKey} className="flex min-h-[44px] items-center gap-3 text-sm text-gray-900">
              <input
                type="radio"
                name="vat-obligation"
                className="h-5 w-5 shrink-0"
                checked={obligation.periodKey === selected?.periodKey}
                onChange={() => setChosenPeriodKey(obligation.periodKey)}
              />
              <span>
                {obligation.periodKey}: {obligation.start} to {obligation.end}, due {obligation.due}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {/* Keyed by period so switching obligations drops the ticked declaration, mutation state and open dialog. */}
      {selected && <VatReturnReview key={selected.periodKey} period={selected} />}

      <VatHistoryList />
      <VatObligationsList />
    </main>
  );
}

function VatReturnReview({ period }: { period: VatPeriod }) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [declarationTicked, setDeclarationTicked] = useState(false);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [expandedBox, setExpandedBox] = useState<number | null>(null);
  // The obligation row also carries due date and status, which the server neither needs nor should be sent.
  const periodFields = { periodKey: period.periodKey, start: period.start, end: period.end };
  const queryKey = ['vat-return', period.periodKey];

  async function callApi(path: string, init?: RequestInit): Promise<ReturnReview> {
    const token = await getToken();
    const response = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const body = (await response.json().catch(() => null)) as ApiResponse<ReturnReview> | null;
    if (!body?.ok) throw new Error(body?.error ?? 'Request failed');
    return body.data;
  }

  const review = useQuery({
    queryKey,
    queryFn: () => callApi(`/api/vat/return?${new URLSearchParams(periodFields)}`),
  });

  const saveDraft = useMutation({
    mutationFn: () => callApi('/api/vat/return', { method: 'PUT', body: JSON.stringify(periodFields) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  // The server only holds a draft once one has been saved, so save it the first time the user sees the return.
  const needsDraft = review.data?.status === null;
  const { mutate: saveDraftOnce, isIdle: draftNotSaved } = saveDraft;
  useEffect(() => {
    if (needsDraft && draftNotSaved) saveDraftOnce();
  }, [needsDraft, draftNotSaved, saveDraftOnce]);

  const confirm = useMutation({
    mutationFn: () =>
      callApi('/api/vat/return-confirm', { method: 'POST', body: JSON.stringify({ ...periodFields, declaration: true }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const mode = useQuery({
    queryKey: ['hmrc-mode'],
    queryFn: async () => fetchHmrcMode((await getToken()) ?? ''),
  });
  const live = mode.data ? isEffectivelyLive(mode.data) : false;

  const submit = useMutation({
    mutationFn: async () => submitVatReturn((await getToken()) ?? '', periodFields),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  // The page preview and the dialog preview are separate so opening one never changes what the other shows.
  const previewMutation = () => ({ mutationFn: async () => previewVatReturn((await getToken()) ?? '', periodFields) });
  const pagePreview = useMutation(previewMutation());
  const dialogPreview = useMutation(previewMutation());
  // A pending claim means HMRC may already hold the return, so a refused retry reads the same as an unknown outcome.
  const outcomeUnknown =
    submit.error instanceof SubmitVatError && ['OUTCOME_UNKNOWN', 'ALREADY_SUBMITTED'].includes(submit.error.code);

  const state = reviewState({
    status: review.data?.status ?? null,
    declarationTicked,
    confirmPending: confirm.isPending,
    stale: review.data?.stale,
    submission: review.data?.submission,
    submitPending: submit.isPending,
    outcomeUnknown,
    live,
  });

  return (
    <>
      <p className="mt-4 text-sm text-gray-500">
        Period {period.start} to {period.end}
      </p>

      {review.isPending && <p role="status" className="mt-6 text-gray-500">Loading your VAT return…</p>}
      {review.isError && (
        <p role="alert" className="mt-6 text-red-700">
          Could not load your VAT return. Reload the page to try again.
        </p>
      )}

      {review.data && (
        <>
          <p role="status" className="mt-4 text-sm font-medium text-gray-900">
            Status: {state.statusLabel}
          </p>
          {review.data.boxes.box5 === 0 && review.data.boxes.box6 === 0 && review.data.boxes.box7 === 0 && (
            <p className="mt-2 text-sm text-gray-500">
              No VAT-relevant transactions in this period.{state.needsConfirming && ' This is a nil return and still needs confirming.'}
            </p>
          )}

          <table className="mt-6 w-full max-w-3xl border-collapse text-sm">
            <caption className="sr-only">VAT return boxes for the period</caption>
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th scope="col" className="py-2 pr-4 font-medium">Box</th>
                <th scope="col" className="py-2 pr-4 font-medium">Description</th>
                <th scope="col" className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {boxNumbers.map((box) => {
                const pence = review.data.boxes[`box${box}` as keyof VatReturnBoxes];
                const drillable = (DRILLABLE_BOXES as readonly number[]).includes(box);
                const lines = review.data.drillDown[`box${box}` as keyof VatReturnBoxes];
                const expanded = expandedBox === box;
                const label = boxLabel(box, pence);
                return (
                  <BoxRows
                    key={box}
                    box={box}
                    label={label}
                    pence={pence}
                    lines={drillable ? lines : undefined}
                    totalLines={review.data.drillDownTotals[`box${box}` as keyof VatReturnBoxes]}
                    expanded={expanded}
                    onToggle={() => setExpandedBox(expanded ? null : box)}
                  />
                );
              })}
            </tbody>
          </table>

          <fieldset className="mt-8 max-w-3xl">
            <legend className="sr-only">Declaration</legend>
            <label className="flex min-h-[44px] items-start gap-3 text-sm text-gray-900">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0"
                checked={declarationTicked}
                onChange={(event) => setDeclarationTicked(event.target.checked)}
              />
              <span>
                I declare that the information given in this VAT return is true and complete to the best of my
                knowledge and belief.
              </span>
            </label>
          </fieldset>

          {confirm.isError && (
            <p role="alert" className="mt-4 text-red-700">
              Could not confirm the return. Try again.
            </p>
          )}

          <button
            type="button"
            disabled={!state.canConfirm}
            onClick={() => confirm.mutate()}
            className="mt-4 min-h-[44px] rounded bg-blue-700 px-6 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
          >
            {confirm.isPending ? 'Confirming…' : 'Confirm return'}
          </button>

          <section className="mt-8 max-w-3xl" aria-labelledby="vat-submit-heading">
            <h2 id="vat-submit-heading" className="text-lg font-semibold text-gray-900">Submit to HMRC</h2>
            {state.receipt && (
              <div role="status" className="mt-2 text-sm text-gray-900">
                <p className="font-medium">{state.receipt.heading}</p>
                <p>Form bundle number: {state.receipt.formBundleNumber}</p>
                <p>Processing date: {new Date(state.receipt.processingDate).toLocaleDateString('en-GB')}</p>
              </div>
            )}
            {state.warning && (
              <p role="alert" className="mt-2 text-sm text-red-700">{state.warning}</p>
            )}
            {submit.isError && !outcomeUnknown && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                Could not submit the return: {submit.error.message}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!state.canSubmit}
              onClick={() => {
                setSubmitDialogOpen(true);
                dialogPreview.mutate();
              }}
              className="min-h-[44px] rounded bg-blue-700 px-6 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
            >
              {state.submitLabel}
            </button>
            {state.canSubmit && (
              <button
                type="button"
                disabled={pagePreview.isPending}
                onClick={() => pagePreview.mutate()}
                className="min-h-[44px] rounded border border-gray-300 px-6 text-sm font-medium text-gray-900 disabled:cursor-not-allowed disabled:text-gray-600"
              >
                Preview what will be sent
              </button>
            )}
            </div>
            {state.canSubmit && <PreviewResult mutation={pagePreview} />}
          </section>

          <SubmitDialog
            open={submitDialogOpen}
            periodLabel={`${period.start} to ${period.end}`}
            netVatPence={review.data.boxes.box5}
            live={live}
            preview={dialogPreview}
            onCancel={() => setSubmitDialogOpen(false)}
            onSubmit={() => {
              setSubmitDialogOpen(false);
              submit.mutate();
            }}
          />
        </>
      )}
    </>
  );
}

interface PreviewResultProps {
  mutation: { isPending: boolean; isError: boolean; data: VatPreview | undefined };
}

function PreviewResult({ mutation }: PreviewResultProps) {
  if (mutation.isPending) return <p role="status" className="mt-4 text-sm text-gray-500">Building the preview…</p>;
  if (mutation.isError) {
    return <p role="alert" className="mt-4 text-sm text-red-700">Could not build the preview. Try again.</p>;
  }
  return mutation.data ? <VatPreviewPanel preview={mutation.data} /> : null;
}

interface BoxRowsProps {
  box: number;
  label: string;
  pence: number;
  lines?: DrillLine[];
  totalLines: number;
  expanded: boolean;
  onToggle: () => void;
}

function BoxRows({ box, label, pence, lines, totalLines, expanded, onToggle }: BoxRowsProps) {
  const detailId = `vat-box-${box}-lines`;
  return (
    <>
      <tr className="border-b border-gray-100">
        <td className="py-1 pr-4 text-gray-900">{box}</td>
        <td className="max-w-0 truncate py-1 pr-4 text-gray-900" title={label}>
          {lines ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={detailId}
              onClick={onToggle}
              className="min-h-[44px] max-w-full truncate text-left text-blue-700 underline"
            >
              {label}
            </button>
          ) : (
            label
          )}
        </td>
        <td className="py-1 text-right tabular-nums text-gray-900">{formatPence(pence)}</td>
      </tr>
      {lines && expanded && (
        <tr id={detailId}>
          <td colSpan={3} className="bg-gray-50 px-4 py-2">
            {lines.length === 0 ? (
              <p className="text-gray-500">No transactions contribute to this box.</p>
            ) : (
              <ul className="divide-y divide-gray-200">
                {lines.map((line) => (
                  <li key={line.lineId} className="flex items-center justify-between gap-4 py-1">
                    <span className="min-w-0 truncate" title={line.description ?? undefined}>
                      {line.date} {line.description ?? ''}
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      {formatPence(line.amountPence)} + {formatPence(line.vatPence)} VAT
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {lines.length < totalLines && (
              <p className="mt-2 text-gray-500">
                Showing the first {lines.length} of {totalLines} transactions, so the list does not add up to the box.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

interface SubmitDialogProps {
  open: boolean;
  periodLabel: string;
  netVatPence: number;
  live: boolean;
  preview: PreviewResultProps['mutation'];
  onCancel: () => void;
  onSubmit: () => void;
}

// A native modal dialog gives the focus trap and Escape-to-close; nothing reaches HMRC until the footer button is pressed.
function SubmitDialog({ open, periodLabel, netVatPence, live, preview, onCancel, onSubmit }: SubmitDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="vat-submit-dialog-title"
      onClose={onCancel}
      className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded p-0 backdrop:bg-black/50"
    >
      <div className="p-6">
        <h2 id="vat-submit-dialog-title" className="text-lg font-semibold text-gray-900">
          {live ? 'Submit this VAT return to HMRC?' : 'Submit this VAT return to the HMRC sandbox?'}
        </h2>
        <dl className="mt-4 space-y-2 text-sm text-gray-900">
          <div className="flex justify-between gap-4">
            <dt>Period</dt>
            <dd className="text-right tabular-nums">{periodLabel}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Net VAT to pay or reclaim</dt>
            <dd className="text-right tabular-nums">{formatPence(netVatPence)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Destination</dt>
            <dd className="text-right">{live ? 'HMRC live (a real filing)' : 'HMRC sandbox (a test, nothing is filed)'}</dd>
          </div>
        </dl>
        {live && <p className="mt-4 text-sm text-gray-900">A live submission cannot be undone.</p>}
        <PreviewResult mutation={preview} />
      </div>
      <div className="flex justify-end gap-3 border-t border-gray-200 p-4">
        <button type="button" onClick={onCancel} className="min-h-[44px] rounded border border-gray-300 px-6 text-sm font-medium text-gray-900">
          Cancel
        </button>
        <button type="button" onClick={onSubmit} className="min-h-[44px] rounded bg-blue-700 px-6 text-sm font-medium text-white hover:bg-blue-800">
          {live ? 'Submit to HMRC' : 'Submit to sandbox'}
        </button>
      </div>
    </dialog>
  );
}
