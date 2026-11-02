import { Route, Routes } from 'react-router-dom';

import SectionTabs from '../components/SectionTabs';
import ExpensesPage from './ExpensesPage';
import MileageSection from './MileageSection';
import { ReceiptReviewPage } from './ReceiptReview';
import ReceiptsPage from './ReceiptsPage';

const TABS = [
  { to: '/money-out', label: 'Expenses' },
  { to: '/money-out/receipts', label: 'Receipts' },
  { to: '/money-out/mileage', label: 'Mileage' },
];

export default function MoneyOutPage() {
  return (
    <main className="p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Money out</h1>
      <SectionTabs label="Money out" tabs={TABS} />
      <Routes>
        <Route index element={<ExpensesPage heading="Expenses" />} />
        <Route path="receipts" element={<ReceiptsPage />} />
        <Route path="receipts/:receiptId" element={<ReceiptReviewPage />} />
        <Route path="mileage" element={<MileageSection />} />
      </Routes>
    </main>
  );
}
