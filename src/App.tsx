import { SignedIn, SignedOut } from '@clerk/clerk-react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Pages — lazy imports to be added as features are built
import DashboardPage from './pages/DashboardPage.tsx';
import ExpensesPage from './pages/ExpensesPage.tsx';
import InvoicesPage from './pages/InvoicesPage.tsx';
import ReceiptsPage from './pages/ReceiptsPage.tsx';
import VatPage from './pages/VatPage.tsx';
import TaxPage from './pages/TaxPage.tsx';
import ReportsPage from './pages/ReportsPage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';
import SignInPage from './pages/SignInPage.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/sign-in"
            element={
              <SignedOut>
                <SignInPage />
              </SignedOut>
            }
          />
          <SignedIn>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/invoices" element={<InvoicesPage />} />
            <Route path="/receipts" element={<ReceiptsPage />} />
            <Route path="/vat" element={<VatPage />} />
            <Route path="/tax" element={<TaxPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </SignedIn>
          <SignedOut>
            <Route path="*" element={<Navigate to="/sign-in" replace />} />
          </SignedOut>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
