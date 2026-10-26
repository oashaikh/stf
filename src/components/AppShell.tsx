import { useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  CalendarCheck,
  Ellipsis,
  Home,
  Landmark,
  Receipt,
  ReceiptText,
  Settings,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { SESSION_QUERY_KEY, signOut } from '../lib/session';

type NavItem = { to: string; label: string; icon: LucideIcon };

// The four most used sections stay in the phone bar; the rest sit behind "More". From md up all eight show inline.
const PRIMARY_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: Home },
  { to: '/vat', label: 'VAT', icon: CalendarCheck },
  { to: '/receipts', label: 'Receipts', icon: Receipt },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
];
const MORE_ITEMS: NavItem[] = [
  { to: '/expenses', label: 'Expenses', icon: Wallet },
  { to: '/invoices', label: 'Invoices', icon: ReceiptText },
  { to: '/tax', label: 'Tax', icon: Landmark },
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

// One nav element serves both layouts: a bottom bar with a More menu on phones, inline links in the header from md up.
export default function AppShell() {
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const moreActive = MORE_ITEMS.some(({ to }) => pathname.startsWith(to));
  useEffect(() => setMoreOpen(false), [pathname]);

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
          {PRIMARY_ITEMS.map(renderLink)}
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls="more-nav"
            onClick={() => setMoreOpen((open) => !open)}
            className={`${LINK_CLASS} md:hidden ${moreActive || moreOpen ? 'bg-blue-50 text-brand' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            <Ellipsis aria-hidden="true" size={20} />
            More
          </button>
          <div
            id="more-nav"
            className={`${moreOpen ? 'grid' : 'hidden'} absolute inset-x-0 bottom-full grid-cols-4 border-t border-gray-200 bg-white md:static md:flex md:border-0`}
          >
            {MORE_ITEMS.map(renderLink)}
          </div>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
