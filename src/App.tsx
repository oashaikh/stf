import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

// Pages — lazy imports to be added as features are built
import DashboardPage from './pages/DashboardPage.tsx';
import MoneyInPage from './pages/MoneyInPage.tsx';
import MoneyOutPage from './pages/MoneyOutPage.tsx';
import BankPage from './pages/BankPage.tsx';
import TaxHubPage from './pages/TaxHubPage.tsx';
import ItsUpdatePage from './pages/ItsUpdatePage.tsx';
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

// Bookmarks and in-app deep links from before the six-item menu still work.
const OLD_ADDRESSES = [
  ['/dashboard', '/home'],
  ['/invoices', '/money-in'],
  ['/expenses', '/money-out'],
  ['/receipts', '/money-out/receipts'],
  ['/vat', '/tax/vat'],
  ['/reports', '/tax/reports'],
] as const;

// Filters (?status=draft) and entry anchors (#entry-1) must survive the move.
function RedirectKeepingSearch({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}

function AuthGate() {
  const session = useQuery({ queryKey: SESSION_QUERY_KEY, queryFn: fetchSignedIn, staleTime: Infinity, retry: false });
  if (session.isPending) return <StateMessage kind="loading" className="p-6">Loading…</StateMessage>;
  // A failed check (server down) shows the login page rather than a protected screen: fail closed.
  if (!session.data) return <LoginPage />;

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route element={<AppShell />}>
        <Route path="/home" element={<DashboardPage />} />
        <Route path="/money-in/*" element={<MoneyInPage />} />
        <Route path="/money-out/*" element={<MoneyOutPage />} />
        <Route path="/bank" element={<BankPage />} />
        <Route path="/tax/*" element={<TaxHubPage />} />
        <Route path="/tax/update/:taxYear/:quarter" element={<ItsUpdatePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      {OLD_ADDRESSES.map(([from, to]) => (
        <Route key={from} path={from} element={<RedirectKeepingSearch to={to} />} />
      ))}
      <Route path="*" element={<Navigate to="/home" replace />} />
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
