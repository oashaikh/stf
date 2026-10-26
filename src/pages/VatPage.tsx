import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatPence } from '../lib/money';
import type { VatReturnBoxes } from '../lib/vat';
import type { ApiResponse } from '../model/types';
import { boxLabel, currentQuarter, DRILLABLE_BOXES, reviewState, type ReviewStatus } from './vatReviewState';

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
  status: ReviewStatus;
  confirmedAt: string | null;
}

class ApiRequestError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

const boxNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export default function VatPage() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [period] = useState(() => currentQuarter(new Date()));
  const [declarationTicked, setDeclarationTicked] = useState(false);
  const [expandedBox, setExpandedBox] = useState<number | null>(null);
  const [errorCode, setErrorCode] = useState<string>();
  const queryKey = ['vat-return', period.periodKey];

  async function callApi(path: string, init?: RequestInit): Promise<ReturnReview> {
    const token = await getToken();
    const response = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const body = (await response.json().catch(() => null)) as ApiResponse<ReturnReview> | null;
    if (!body?.ok) throw new ApiRequestError(body?.error ?? 'Request failed', body?.code);
    return body.data;
  }

  const review = useQuery({
    queryKey,
    queryFn: () => callApi(`/api/vat/return?${new URLSearchParams(period)}`),
  });

  const saveDraft = useMutation({
    mutationFn: () => callApi('/api/vat/return', { method: 'PUT', body: JSON.stringify(period) }),
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
      callApi('/api/vat/return-confirm', { method: 'POST', body: JSON.stringify({ ...period, declaration: true }) }),
    onMutate: () => setErrorCode(undefined),
    onError: (error) => setErrorCode(error instanceof ApiRequestError ? error.code : undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const state = reviewState({
    status: review.data?.status ?? null,
    declarationTicked,
    confirmPending: confirm.isPending,
    errorCode,
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold text-gray-900">VAT Returns</h1>
      <p className="mt-1 text-sm text-gray-500">
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
              No VAT-relevant transactions in this period. This is a nil return and still needs confirming.
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
              {errorCode === 'STALE_CONFIRMATION' ? state.statusLabel : 'Could not confirm the return. Try again.'}
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
        </>
      )}
    </main>
  );
}

interface BoxRowsProps {
  box: number;
  label: string;
  pence: number;
  lines?: DrillLine[];
  expanded: boolean;
  onToggle: () => void;
}

function BoxRows({ box, label, pence, lines, expanded, onToggle }: BoxRowsProps) {
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
          </td>
        </tr>
      )}
    </>
  );
}
