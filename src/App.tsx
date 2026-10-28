import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

// Pages — lazy imports to be added as features are built
import DashboardPage from './pages/DashboardPage.tsx';
import ExpensesPage from './pages/ExpensesPage.tsx';
import InvoicesPage from './pages/InvoicesPage.tsx';
import ReceiptsPage from './pages/ReceiptsPage.tsx';
import VatPage from './pages/VatPage.tsx';
import TaxPage from './pages/TaxPage.tsx';
import ReportsPage from './pages/ReportsPage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';
import AppShell from './components/AppShell.tsx';
import StateMessage from './components/StateMessage.tsx';
import LoginPage from './pages/LoginPage.tsx';
import { PrivacyPage, TermsPage } from './pages/LegalPages.tsx';
import { SESSION_QUERY_KEY, fetchSignedIn } from './lib/session.ts';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function AuthGate() {
  const session = useQuery({ queryKey: SESSION_QUERY_KEY, queryFn: fetchSignedIn, staleTime: Infinity, retry: false });
  if (session.isPending) return <StateMessage kind="loading" className="p-6">Loading…</StateMessage>;
  // A failed check (server down) shows the login page rather than a protected screen: fail closed.
  if (!session.data) return <LoginPage />;

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route element={<AppShell />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/receipts" element={<ReceiptsPage />} />
        <Route path="/vat" element={<VatPage />} />
        <Route path="/tax" element={<TaxPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

// These two pages are given to HMRC, so they load without a session and without asking the server who you are.
function PublicOrAuthGate() {
  const { pathname } = useLocation();
  if (pathname === '/privacy') return <PrivacyPage />;
  if (pathname === '/terms') return <TermsPage />;
  return <AuthGate />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PublicOrAuthGate />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
