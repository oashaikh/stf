import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { formatDate } from '../lib/dates';
import { fetchItsObligations, type ItsObligationRow, type ItsSetupGap } from '../lib/hmrc/itsObligationsApi';

const SETUP_STEPS: Record<ItsSetupGap, { text: string; link: string }> = {
  'not-connected': { text: 'Connect HMRC to see your Income Tax dates.', link: 'Connect HMRC in Settings' },
  reconnect: { text: 'HMRC needs you to allow Income Tax access.', link: 'Reconnect HMRC in Settings' },
  'no-business': { text: 'Pick which business to show dates for.', link: 'Choose your business in Settings' },
  'no-nino': { text: 'We need your National Insurance number to ask HMRC for your dates.', link: 'Add your National Insurance number in Settings' },
};

function statusLabel(obligation: ItsObligationRow): string {
  if (obligation.status === 'fulfilled') return 'Fulfilled';
  return obligation.overdue ? 'Overdue' : 'Open';
}

function groupByTaxYear(obligations: ItsObligationRow[]): [string, ItsObligationRow[]][] {
  const groups = new Map<string, ItsObligationRow[]>();
  for (const obligation of obligations) groups.set(obligation.taxYear, [...(groups.get(obligation.taxYear) ?? []), obligation]);
  return [...groups].sort(([a], [b]) => b.localeCompare(a));
}

function Cell({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <td className={`flex min-h-11 items-center justify-between gap-4 py-1 sm:table-cell sm:py-2 sm:pr-4 ${className}`}>
      <span className="text-gray-700 sm:hidden">{label}</span>
      <span className="block min-w-0 truncate text-right sm:text-left">{children}</span>
    </td>
  );
}

function ObligationsTable({ taxYear, obligations }: { taxYear: string; obligations: ItsObligationRow[] }) {
  return (
    <div className="mt-4">
      <h3 className="text-base font-semibold text-gray-900">{taxYear}</h3>
      <table className="mt-2 w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">Income Tax obligations for {taxYear}</caption>
        <thead className="hidden sm:table-header-group">
          <tr className="border-b border-gray-200 text-left text-gray-700">
            <th scope="col" className="py-2 pr-4 font-medium">Update</th>
            <th scope="col" className="py-2 pr-4 font-medium">Period</th>
            <th scope="col" className="py-2 pr-4 font-medium">Due date</th>
            <th scope="col" className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {obligations.map((obligation) => {
            const period = `${formatDate(obligation.periodStart)} to ${formatDate(obligation.periodEnd)}`;
            return (
              <tr
                key={`${obligation.kind}-${obligation.periodStart}`}
                className={`block border-b border-gray-100 py-2 sm:table-row sm:py-0 ${obligation.nextDue ? 'bg-blue-50' : ''}`}
              >
                <Cell label="Update" className="text-gray-900">
                  {obligation.kind === 'finalDeclaration' ? 'Final declaration' : 'Quarterly update'}
                </Cell>
                <Cell label="Period" className="text-gray-700">
                  <span title={period}>{period}</span>
                </Cell>
                <Cell label="Due date" className="text-gray-700">
                  {formatDate(obligation.dueDate)}
                </Cell>
                <Cell label="Status" className={`font-medium ${obligation.overdue ? 'text-red-800' : 'text-gray-900'}`}>
                  {statusLabel(obligation)}
                  {obligation.nextDue && <strong className="ml-2 rounded bg-blue-800 px-2 py-0.5 text-xs text-white">Next due</strong>}
                </Cell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Shows nothing at all while the server says Income Tax is off, so a user without the flag sees no change. */
export default function ItsObligationsSection() {
  const obligations = useQuery({ queryKey: ['its-obligations'], queryFn: () => fetchItsObligations(), retry: false });
  const result = obligations.data;
  if (result === null || obligations.isPending) return null;

  return (
    <section aria-labelledby="its-obligations-heading" className="mt-8">
      <h2 id="its-obligations-heading" className="text-lg font-semibold text-gray-900">Income Tax obligations</h2>

      {obligations.isError && (
        <p role="alert" className="mt-4 text-red-800">
          Could not load your Income Tax dates. Reload the page to try again.
        </p>
      )}

      {result && 'gap' in result && (
        <div className="mt-4 text-gray-700">
          <p>{SETUP_STEPS[result.gap].text}</p>
          <Link to="/settings" className="inline-flex min-h-11 items-center text-blue-800 underline">
            {SETUP_STEPS[result.gap].link}
          </Link>
        </div>
      )}

      {result && 'obligations' in result && (
        <>
          {result.stale && (
            <p role="status" className="mt-4 text-gray-900">
              {result.fetchedAt && `Showing last known dates from ${formatDate(result.fetchedAt)}. `}
              {result.error}
            </p>
          )}
          {result.obligations.length === 0 && <p className="mt-4 text-gray-700">No Income Tax obligations found.</p>}
          {groupByTaxYear(result.obligations).map(([taxYear, rows]) => (
            <ObligationsTable key={taxYear} taxYear={taxYear} obligations={rows} />
          ))}
        </>
      )}
    </section>
  );
}
