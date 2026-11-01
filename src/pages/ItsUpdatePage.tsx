import { useQuery } from '@tanstack/react-query';
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
  const found = obligations.data && 'obligations' in obligations.data
    ? obligations.data.obligations.find((row) => row.taxYear === taxYear && String(quarterOf(row)) === quarter)
    : undefined;

  return (
    <>
      {obligations.isPending && <StateMessage kind="loading">Loading your update…</StateMessage>}
      {obligations.isError && <StateMessage kind="error">Could not load your Income Tax dates. Reload the page to try again.</StateMessage>}
      {found && <ItsQuarterlyReview key={found.periodStart} obligation={found} onClose={() => navigate('/tax')} />}
      {!obligations.isPending && !obligations.isError && !found && (
        <>
          <StateMessage kind="error">We could not find that update. It may already be sent.</StateMessage>
          <Link to="/tax" className="inline-flex min-h-11 items-center text-blue-800 underline">Back to Tax</Link>
        </>
      )}
    </>
  );
}
