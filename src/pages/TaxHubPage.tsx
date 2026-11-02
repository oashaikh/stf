import { Navigate, Route, Routes } from 'react-router-dom';

import SectionTabs from '../components/SectionTabs';
import ReportsPage from './ReportsPage';
import TaxPage from './TaxPage';
import VatHistoryList from './VatHistoryList';
import VatPage from './VatPage';

const TABS = [
  { to: '/tax/vat', label: 'VAT' },
  { to: '/tax/income-tax', label: 'Income Tax' },
  { to: '/tax/past-returns', label: 'Past returns' },
  { to: '/tax/reports', label: 'Reports' },
];

export default function TaxHubPage() {
  return (
    <main className="p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Tax</h1>
      <SectionTabs label="Tax" tabs={TABS} />
      <Routes>
        <Route index element={<Navigate to="/tax/income-tax" replace />} />
        <Route path="vat" element={<VatPage />} />
        <Route path="income-tax" element={<TaxPage />} />
        <Route
          path="past-returns"
          element={
            <div className="mt-6">
              <VatHistoryList />
            </div>
          }
        />
        <Route path="reports" element={<ReportsPage />} />
      </Routes>
    </main>
  );
}
