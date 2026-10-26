import { useAuth } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchVatObligations, NotConnectedError, type VatObligationRow } from '../lib/hmrc/vatApi';

function statusLabel(obligation: VatObligationRow): string {
  if (obligation.status === 'F') return 'Fulfilled';
  return obligation.overdue ? 'Overdue' : 'Due';
}

export default function VatObligationsList() {
  const { getToken } = useAuth();
  const obligations = useQuery({
    queryKey: ['vat-obligations'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('No session token');
      return fetchVatObligations(token);
    },
    retry: false,
  });

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
      {obligations.isError && !(obligations.error instanceof NotConnectedError) && (
        <p role="alert" className="mt-4 text-red-700">
          Could not load your VAT obligations. Reload the page to try again.
        </p>
      )}
      {obligations.data?.length === 0 && <p className="mt-4 text-gray-500">No VAT obligations found.</p>}

      {obligations.data && obligations.data.length > 0 && (
        <table className="mt-4 w-full max-w-3xl border-collapse text-sm">
          <caption className="sr-only">VAT return obligations</caption>
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th scope="col" className="py-2 pr-4 font-medium">Period key</th>
              <th scope="col" className="py-2 pr-4 font-medium">Period</th>
              <th scope="col" className="py-2 pr-4 font-medium">Due date</th>
              <th scope="col" className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {obligations.data.map((obligation) => (
              <tr key={obligation.periodKey} className="border-b border-gray-100">
                <td className="py-2 pr-4 text-gray-900">{obligation.periodKey}</td>
                <td className="py-2 pr-4 text-gray-700">{obligation.start} to {obligation.end}</td>
                <td className="py-2 pr-4 text-gray-700">{obligation.due}</td>
                <td className={`py-2 font-medium ${obligation.overdue ? 'text-red-800' : 'text-gray-900'}`}>
                  {statusLabel(obligation)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
