import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import StateMessage from '../components/StateMessage';
import { fetchItsObligations } from '../lib/hmrc/itsObligationsApi';
import { quarterOf } from '../lib/hmrc/itsUpdateApi';
import ItsQuarterlyReview from './ItsQuarterlyReview';

/** The guided quarterly update on its own screen; the Tax page only links here. */
export default function ItsUpdatePage() {
  const { taxYear, quarter } = useParams();
  const navigate = useNavigate();
  const obligations = useQuery({ queryKey: ['its-obligations'], queryFn: () => fetchItsObligations(), retry: false });
  const openRow = obligations.data && 'obligations' in obligations.data
    ? obligations.data.obligations.find((row) => row.taxYear === taxYear && String(quarterOf(row)) === quarter && row.status === 'open')
    : undefined;
  // Once the update is open on screen, keep it mounted: a send turns the quarter fulfilled, and the confirmation must outlive that refetch.
  const shown = useRef(openRow);
  if (openRow) shown.current = openRow;
  const found = shown.current;

  return (
    <main className="max-w-4xl p-4 md:p-8">
      {obligations.isPending && <StateMessage kind="loading">Loading your update…</StateMessage>}
      {obligations.isError && <StateMessage kind="error">Could not load your Income Tax dates. Reload the page to try again.</StateMessage>}
      {found && <ItsQuarterlyReview key={found.periodStart} obligation={found} onClose={() => navigate('/tax')} />}
      {!obligations.isPending && !obligations.isError && !found && (
        <>
          <StateMessage kind="error">We could not find that update. It may already be sent.</StateMessage>
          <Link to="/tax" className="inline-flex min-h-11 items-center text-blue-800 underline">Back to Tax</Link>
        </>
      )}
    </main>
  );
}
