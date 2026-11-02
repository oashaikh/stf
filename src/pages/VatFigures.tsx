import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate } from '../lib/dates';
import { formatPence } from '../lib/money';
import type { VatReturnBoxes } from '../lib/vat';
import { box5ReviewNote, DRILLABLE_BOXES, PLAIN_BOX_LABELS } from './vatReviewState';

export interface DrillLine {
  lineId: string;
  transactionId: string;
  date: string;
  amountPence: number;
  vatPence: number;
  description: string | null;
}

// STF-10's list filters by from, to and search; the hash lets the Expenses list highlight the entry.
function expensesLink(line: DrillLine): string {
  const filters = new URLSearchParams({ from: line.date, to: line.date });
  if (line.description) filters.set('search', line.description);
  return `/money-out?${filters}#entry-${line.transactionId}`;
}

// Boxes 2, 8 and 9 are always zero, so they are a line of small text rather than rows.
const ALWAYS_ZERO_BOXES = [2, 8, 9] as const;

interface VatFiguresProps {
  boxes: VatReturnBoxes;
  drillDown: Record<keyof VatReturnBoxes, DrillLine[]>;
  drillDownTotals: Record<keyof VatReturnBoxes, number>;
}

export default function VatFigures({ boxes, drillDown, drillDownTotals }: VatFiguresProps) {
  const [expandedBox, setExpandedBox] = useState<number | null>(null);
  return (
    <div className="mt-6 max-w-3xl">
      <ul className="divide-y divide-gray-200">
        {DRILLABLE_BOXES.map((box) => {
          const key = `box${box}` as keyof VatReturnBoxes;
          const pence = boxes[key];
          const lines = drillDown[key];
          const expanded = expandedBox === box;
          const detailId = `vat-box-${box}-lines`;
          const label = PLAIN_BOX_LABELS[box];
          return (
            <li key={box} role="group" aria-label={label} className="py-3">
              <div className="flex items-baseline justify-between gap-4">
                <p className="min-w-0 text-sm text-gray-900">
                  {label}
                  <span className="ml-2 text-xs text-gray-700">{`Box ${box}`}</span>
                </p>
                <p className="shrink-0 text-right text-sm tabular-nums text-gray-900">{formatPence(pence)}</p>
              </div>
              {box === 5 && box5ReviewNote(pence) && <p className="text-right text-xs text-gray-700">{box5ReviewNote(pence)}</p>}
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={detailId}
                onClick={() => setExpandedBox(expanded ? null : box)}
                className="min-h-[44px] text-left text-sm text-blue-700 underline"
              >
                Why is this amount?
              </button>
              {expanded && (
                <div id={detailId} className="bg-gray-50 px-4 py-2 text-sm">
                  {lines.length === 0 ? (
                    <p className="text-gray-700">No payments add up to this amount.</p>
                  ) : (
                    <ul className="divide-y divide-gray-200">
                      {lines.map((line) => (
                        <li key={line.lineId}>
                          <Link to={expensesLink(line)} className="flex min-h-[44px] flex-wrap items-center gap-x-4 py-1 text-blue-700 hover:underline sm:flex-nowrap">
                            <span className="shrink-0 tabular-nums">{formatDate(line.date)}</span>
                            <span className="order-last min-w-0 basis-full truncate sm:order-none sm:basis-0 sm:flex-1" title={line.description ?? undefined}>
                              {line.description ?? ''}
                            </span>
                            <span className="shrink-0 text-right tabular-nums">
                              {formatPence(line.amountPence)} + {formatPence(line.vatPence)} VAT
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {lines.length < drillDownTotals[key] && (
                    <p className="mt-2 text-gray-700">
                      Showing the first {lines.length} of {drillDownTotals[key]} payments, so the list does not add up to the amount.
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs text-gray-700">
        Also on the return: {ALWAYS_ZERO_BOXES.map((box) => `${PLAIN_BOX_LABELS[box]} ${formatPence(boxes[`box${box}` as keyof VatReturnBoxes])} (Box ${box})`).join(', ')}.
      </p>
    </div>
  );
}
