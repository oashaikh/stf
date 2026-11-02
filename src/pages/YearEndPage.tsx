import { Navigate, useNavigate, useParams } from 'react-router-dom';

import { TAX_BANDS } from '../lib/taxBands';
import YearEndFlow from './YearEndFlow';

/** The Income Tax year end flow on its own screen; the Tax page links here. */
export default function YearEndPage() {
  const { taxYear } = useParams();
  const navigate = useNavigate();
  // A made-up year in the address has no bands to calculate with, so send the owner back to the Tax page.
  if (!taxYear || !(taxYear in TAX_BANDS)) return <Navigate to="/tax/income-tax" replace />;
  return (
    <main className="max-w-4xl p-4 md:p-8">
      <YearEndFlow taxYear={taxYear} onLeave={() => navigate('/tax/income-tax')} />
    </main>
  );
}
