import { Navigate, useNavigate, useParams } from 'react-router-dom';

import { TAX_BANDS } from '../lib/taxBands';
import FinalDeclarationFlow from './FinalDeclarationFlow';

/** The Income Tax final declaration on its own screen; the Tax page links here. */
export default function FinalDeclarationPage() {
  const { taxYear } = useParams();
  const navigate = useNavigate();
  // A made-up year in the address has no bands to compare with, so send the owner back to the Tax page.
  if (!taxYear || !(taxYear in TAX_BANDS)) return <Navigate to="/tax/income-tax" replace />;
  return (
    <main className="max-w-4xl p-4 md:p-8">
      <FinalDeclarationFlow taxYear={taxYear} onLeave={() => navigate('/tax/income-tax')} />
    </main>
  );
}
