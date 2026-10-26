import { formatDate } from '../lib/dates';
import { useState } from 'react';
import type { VatHistoryItem, VatHistoryStatus } from '../lib/hmrc/vatApi';
import { formatPence } from '../lib/money';
import { useVatHistory } from './useVatHistory';
import { BOX_LABELS, boxLabel } from './vatReviewState';

const STATUS_LABELS: Record<VatHistoryStatus, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  submitted: 'Submitted',
  accepted: 'Accepted',
};

// Only filed returns have a stored receipt worth showing; drafts and confirmed ones are edited on the review above.
function isFiled(item: VatHistoryItem): boolean {
  return item.status === 'submitted' || item.status === 'accepted';
}

export default function VatHistoryList() {
  const history = useVatHistory();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const opened = history.data?.find((item) => item.periodKey === openKey && isFiled(item));

  return (
    <section className="mt-8" aria-labelledby="vat-history-heading">
      <h2 id="vat-history-heading" className="text-lg font-semibold text-gray-900">VAT return history</h2>

      {history.isPending && <p role="status" className="mt-4 text-gray-500">Loading your past VAT returns…</p>}
      {history.isError && (
        <p role="alert" className="mt-4 text-red-700">
          Could not load your past VAT returns. Reload the page to try again.
        </p>
      )}
      {history.data?.length === 0 && <p className="mt-4 text-gray-500">No past VAT returns yet.</p>}

      {history.data && history.data.length > 0 && (
        <table className="mt-4 w-full max-w-3xl table-fixed border-collapse text-sm">
          <caption className="sr-only">Past VAT returns</caption>
          <thead className="hidden sm:table-header-group">
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th scope="col" className="w-28 py-2 pr-4 font-medium">Return</th>
              <th scope="col" className="py-2 pr-4 font-medium">Period</th>
              <th scope="col" className="w-40 py-2 pr-4 font-medium">Status</th>
              <th scope="col" className="w-32 py-2 text-right font-medium">Net VAT due</th>
            </tr>
          </thead>
          <tbody>
            {history.data.map((item) => {
              const period = `${formatDate(item.start)} to ${formatDate(item.end)}`;
              return (
                <tr key={item.periodKey} className="block border-b border-gray-100 py-2 sm:table-row sm:py-0">
                  <td className="flex justify-between gap-4 py-1 sm:table-cell sm:py-2 sm:pr-4 text-gray-900">
                    <span className="text-gray-500 sm:hidden">Return</span>
                    {isFiled(item) ? (
                      <button
                        type="button"
                        aria-expanded={openKey === item.periodKey}
                        onClick={() => setOpenKey(openKey === item.periodKey ? null : item.periodKey)}
                        className="min-h-[44px] text-blue-700 underline"
                      >
                        {item.periodKey}
                      </button>
                    ) : (
                      <span>{item.periodKey}</span>
                    )}
                  </td>
                  <td className="flex justify-between gap-4 py-1 sm:table-cell sm:max-w-0 sm:truncate sm:py-2 sm:pr-4 text-gray-700" title={period}>
                    <span className="text-gray-500 sm:hidden">Period</span>
                    <span>{period}</span>
                  </td>
                  <td className="flex justify-between gap-4 py-1 sm:table-cell sm:py-2 sm:pr-4 font-medium text-gray-900">
                    <span className="font-normal text-gray-500 sm:hidden">Status</span>
                    <span>
                      {STATUS_LABELS[item.status]}
                      {item.receipt?.sandbox && <span className="ml-2 rounded border border-gray-400 px-1 font-normal text-gray-700">Sandbox</span>}
                    </span>
                  </td>
                  <td className="flex justify-between gap-4 py-1 sm:table-cell sm:py-2 text-right tabular-nums text-gray-900">
                    <span className="text-gray-500 sm:hidden">Net VAT due</span>
                    <span>{formatPence(item.boxes.box5)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {opened && (
        <section className="mt-6 max-w-3xl rounded border border-gray-200 p-4" aria-labelledby="vat-history-detail-heading">
          <h3 id="vat-history-detail-heading" className="font-semibold text-gray-900">
            Return {opened.periodKey}, {STATUS_LABELS[opened.status]} (view only)
          </h3>
          <dl className="mt-3 text-sm text-gray-700">
            {Object.keys(BOX_LABELS).map((key) => {
              const box = Number(key);
              const pence = opened.boxes[`box${box}` as keyof typeof opened.boxes];
              return (
                <div key={box} className="flex justify-between gap-4 py-1">
                  <dt>Box {box}: {boxLabel(box, pence)}</dt>
                  <dd className="text-right tabular-nums">{formatPence(pence)}</dd>
                </div>
              );
            })}
          </dl>
          {opened.receipt ? (
            <dl className="mt-4 border-t border-gray-200 pt-3 text-sm text-gray-700">
              <div className="flex justify-between gap-4 py-1">
                <dt>{opened.receipt.sandbox ? 'Sandbox receipt, form bundle number' : 'HMRC form bundle number'}</dt>
                <dd className="text-right tabular-nums">{opened.receipt.formBundleNumber}</dd>
              </div>
              <div className="flex justify-between gap-4 py-1">
                <dt>Processing date</dt>
                <dd className="text-right tabular-nums">{formatDate(opened.receipt.processingDate)}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-4 border-t border-gray-200 pt-3 text-sm text-gray-700">Awaiting HMRC confirmation.</p>
          )}
        </section>
      )}
    </section>
  );
}
