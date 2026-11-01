import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, FileText, Home, Landmark, Settings, type LucideIcon } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { SESSION_QUERY_KEY, signOut } from '../lib/session';

type NavItem = { to: string; label: string; icon: LucideIcon };

const NAV_ITEMS: NavItem[] = [
  { to: '/home', label: 'Home', icon: Home },
  { to: '/money-in', label: 'Money in', icon: ArrowDownToLine },
  { to: '/money-out', label: 'Money out', icon: ArrowUpFromLine },
  { to: '/bank', label: 'Bank', icon: Landmark },
  { to: '/tax', label: 'Tax', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const LINK_CLASS =
  'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-2 text-xs font-medium md:min-h-11 md:min-w-11 md:flex-none md:flex-row md:gap-2 md:text-sm';

function renderLink({ to, label, icon: Icon }: NavItem) {
  return (
    <NavLink
      key={to}
      to={to}
      className={({ isActive }) => `${LINK_CLASS} ${isActive ? 'bg-blue-50 text-brand' : 'text-gray-700 hover:bg-gray-100'}`}
    >
      <Icon aria-hidden="true" size={20} />
      {label}
    </NavLink>
  );
}

// One nav element serves both layouts: all six links in a bottom bar on phones, inline in the header from md up.
export default function AppShell() {
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await signOut();
    // Drop cached owner data so the next sign-in starts clean, then flip the gate back to the login page.
    queryClient.clear();
    queryClient.setQueryData(SESSION_QUERY_KEY, false);
  }

  return (
    <div className="min-h-screen pb-16 md:pb-0">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-gray-200 bg-white px-4 md:px-6">
        <span className="py-3 text-lg font-semibold text-brand">STF</span>
        <div className="ml-auto md:order-3">
          <button
            type="button"
            onClick={handleSignOut}
            className="min-h-11 min-w-11 rounded px-3 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Sign out
          </button>
        </div>
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-10 flex border-t border-gray-200 bg-white md:static md:order-2 md:border-0"
        >
          {NAV_ITEMS.map(renderLink)}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
