import { Route, Routes } from 'react-router-dom';

import SectionTabs from '../components/SectionTabs';
import ExpensesPage from './ExpensesPage';
import InvoicesPage from './InvoicesPage';

const TABS = [
  { to: '/money-in', label: 'Invoices' },
  { to: '/money-in/other?kind=income', label: 'Other income' },
];

export default function MoneyInPage() {
  return (
    <main className="p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Money in</h1>
      <SectionTabs label="Money in" tabs={TABS} />
      <Routes>
        <Route index element={<InvoicesPage />} />
        {/* Other income is the entries list and form, opened on income entries. */}
        <Route path="other" element={<ExpensesPage heading="Other income" />} />
      </Routes>
    </main>
  );
}
