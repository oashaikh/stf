import { Fragment, useState } from 'react';
import type { VatPreview } from '../lib/hmrc/vatApi';
import type { VatReturnPayload } from '../lib/hmrc/client';
import { formatPence } from '../lib/money';
import { box5SentNote, boxLabel } from './vatReviewState';

// Box number to the HMRC body field it is sent as.
const BOX_FIELDS: Record<number, keyof VatReturnPayload> = {
  1: 'vatDueSales',
  2: 'vatDueAcquisitions',
  3: 'totalVatDue',
  4: 'vatReclaimedCurrPeriod',
  5: 'netVatDue',
  6: 'totalValueSalesExVAT',
  7: 'totalValuePurchasesExVAT',
  8: 'totalValueGoodsSuppliedExVAT',
  9: 'totalAcquisitionsExVAT',
};

// The server sends pounds with at most two decimals; rounding back to pence is exact and keeps one currency format with the rest of the page.
function poundsToPence(pounds: number): number {
  return Math.round(pounds * 100);
}

function formatPounds(pounds: number): string {
  return formatPence(poundsToPence(pounds));
}

export default function VatPreviewPanel({ preview }: { preview: VatPreview }) {
  const { endpoint, body, headers } = preview;
  // Phones start with the table closed because it repeats the review table above; from md up it is always shown.
  const [boxesOpen, setBoxesOpen] = useState(false);
  return (
    <div className="mt-4 text-sm text-gray-900">
      <h3 className="text-base font-semibold">What will be sent to HMRC</h3>
      <p className="mt-2">
        <span className="font-medium">{endpoint.sandbox ? 'Sent to the HMRC test service' : 'Sent to HMRC'}</span>{' '}
        <span className="break-words">
          {endpoint.url.split('/').map((part, index) => (
            <Fragment key={index}>
              {index > 0 && <>/<wbr /></>}
              {part}
            </Fragment>
          ))}
        </span>
      </p>

      <button
        type="button"
        className="mt-2 min-h-[44px] text-blue-700 underline md:hidden"
        aria-expanded={boxesOpen}
        aria-controls="vat-preview-boxes"
        onClick={() => setBoxesOpen((open) => !open)}
      >
        {boxesOpen ? 'Hide the nine boxes' : 'Show all nine boxes'}
      </button>
      <div id="vat-preview-boxes" className={`${boxesOpen ? '' : 'hidden '}md:block`}>
      <table className="mt-4 w-full border-collapse">
        <caption className="sr-only">Boxes exactly as they will be sent</caption>
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-700">
            <th scope="col" className="py-2 pr-4 font-medium">Box</th>
            <th scope="col" className="py-2 pr-4 font-medium">Description</th>
            <th scope="col" className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(BOX_FIELDS).map(([box, field]) => {
            const pounds = body[field] as number;
            const label = boxLabel(Number(box), pounds);
            // Box 5 is unsigned on the wire; reclaiming more than is due is the refund case.
            const note = box === '5' ? box5SentNote(poundsToPence(pounds), poundsToPence(body.vatReclaimedCurrPeriod) > poundsToPence(body.totalVatDue)) : null;
            return (
              <tr key={box} className="border-b border-gray-100">
                <td className="py-1 pr-4">{box}</td>
                <td className="break-words py-1 pr-4">{label}</td>
                <td className="py-1 text-right tabular-nums">{formatPounds(pounds)}
                  {note && <span className="block text-xs text-gray-700">{note}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <p className="mt-2 text-gray-700">Period {body.periodKey}, {body.finalised ? 'confirmed' : 'not yet confirmed'}</p>

      <h4 className="mt-4 font-medium">Request headers</h4>
      <dl className="mt-2 space-y-1">
        {Object.entries(headers).map(([name, value]) => (
          <div key={name} className="flex flex-col gap-1 sm:flex-row sm:gap-4">
            <dt className="shrink-0 font-medium sm:w-64">{name}</dt>
            <dd className="min-w-0 truncate text-gray-700" title={value}>{value}</dd>
          </div>
        ))}
      </dl>

      <details className="mt-4">
        <summary className="min-h-[44px] cursor-pointer py-3 text-blue-700 underline">Raw JSON</summary>
        <pre className="overflow-x-auto rounded bg-gray-50 p-3 text-xs">{JSON.stringify(body, null, 2)}</pre>
      </details>
    </div>
  );
}
