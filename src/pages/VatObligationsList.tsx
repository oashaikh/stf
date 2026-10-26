import { formatDate } from '../lib/dates';
import { Link } from 'react-router-dom';
import { NotConnectedError, VatNumberMissingError, type VatObligationRow } from '../lib/hmrc/vatApi';
import { useVatObligations } from './useVatObligations';

function statusLabel(obligation: VatObligationRow): string {
  if (obligation.status === 'F') return 'Fulfilled';
  return obligation.overdue ? 'Overdue' : 'Due';
}

export default function VatObligationsList() {
  const obligations = useVatObligations();

  return (
    <section className="mt-8" aria-labelledby="vat-obligations-heading">
      <h2 id="vat-obligations-heading" className="text-lg font-semibold text-gray-900">VAT obligations</h2>

      {obligations.isPending && <p role="status" className="mt-4 text-gray-500">Loading your VAT obligations…</p>}
      {obligations.error instanceof NotConnectedError && (
        <p className="mt-4 text-gray-700">
          HMRC is not connected yet.{' '}
          <Link to="/settings" className="inline-flex min-h-[44px] items-center text-blue-700 underline">
            Connect HMRC in Settings
          </Link>
        </p>
      )}
      {obligations.error instanceof VatNumberMissingError && (
        <p className="mt-4 text-gray-700">
          Add your VAT number to see your obligations.{' '}
          <Link to="/settings" className="inline-flex min-h-[44px] items-center text-blue-700 underline">
            Open Settings
          </Link>
        </p>
      )}
      {obligations.isError && !(obligations.error instanceof NotConnectedError) && !(obligations.error instanceof VatNumberMissingError) && (
        <p role="alert" className="mt-4 text-red-700">
          Could not load your VAT obligations. Reload the page to try again.
        </p>
      )}
      {obligations.data?.length === 0 && <p className="mt-4 text-gray-500">No VAT obligations found.</p>}

      {obligations.data && obligations.data.length > 0 && (
        <table className="mt-4 w-full max-w-3xl border-collapse text-sm">
          <caption className="sr-only">VAT return obligations</caption>
          <thead className="hidden sm:table-header-group">
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th scope="col" className="py-2 pr-4 font-medium">Period key</th>
              <th scope="col" className="py-2 pr-4 font-medium">Period</th>
              <th scope="col" className="py-2 pr-4 font-medium">Due date</th>
              <th scope="col" className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {obligations.data.map((obligation) => (
              <tr key={obligation.periodKey} className="block border-b border-gray-100 py-2 sm:table-row sm:py-0">
                <td className="flex justify-between gap-4 py-1 sm:table-cell sm:py-2 sm:pr-4 text-gray-900">
                  <span className="text-gray-500 sm:hidden">Period key</span>
                  <span>{obligation.periodKey}</span>
                </td>
                <td className="flex justify-between gap-4 py-1 sm:table-cell sm:py-2 sm:pr-4 text-gray-700">
                  <span className="text-gray-500 sm:hidden">Period</span>
                  <span className="text-right sm:text-left">{formatDate(obligation.start)} to {formatDate(obligation.end)}</span>
                </td>
                <td className="flex justify-between gap-4 py-1 sm:table-cell sm:py-2 sm:pr-4 text-gray-700">
                  <span className="text-gray-500 sm:hidden">Due date</span>
                  <span>{formatDate(obligation.due)}</span>
                </td>
                <td className={`flex justify-between gap-4 py-1 sm:table-cell sm:py-2 font-medium ${obligation.overdue ? 'text-red-800' : 'text-gray-900'}`}>
                  <span className="font-normal text-gray-500 sm:hidden">Status</span>
                  <span>{statusLabel(obligation)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
