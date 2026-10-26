import { SignOutButton } from '@clerk/clerk-react';
import {
  BarChart3,
  CalendarCheck,
  Home,
  Landmark,
  Receipt,
  ReceiptText,
  Settings,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

const NAV_ITEMS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: Home },
  { to: '/expenses', label: 'Expenses', icon: Wallet },
  { to: '/invoices', label: 'Invoices', icon: ReceiptText },
  { to: '/receipts', label: 'Receipts', icon: Receipt },
  { to: '/vat', label: 'VAT', icon: CalendarCheck },
  { to: '/tax', label: 'Tax', icon: Landmark },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

// One nav element serves both layouts: a scrollable bottom bar on phones, inline links in the header from md up.
export default function AppShell() {
  const navRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  // Eight items are wider than a phone, so the bar scrolls; keep the current page in view.
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  }, [pathname]);

  return (
    <div className="min-h-screen pb-16 md:pb-0">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-gray-200 bg-white px-4 md:px-6">
        <span className="py-3 text-lg font-semibold text-brand">STF</span>
        <div className="ml-auto md:order-3">
          <SignOutButton>
            <button type="button" className="min-h-11 min-w-11 rounded px-3 text-sm font-medium text-gray-700 hover:bg-gray-100">
              Sign out
            </button>
          </SignOutButton>
        </div>
        <nav
          ref={navRef}
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-10 flex overflow-x-auto border-t border-gray-200 bg-white md:static md:order-2 md:border-0"
        >
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex min-h-14 min-w-[4.5rem] flex-1 flex-col items-center justify-center gap-1 px-2 text-xs font-medium md:min-h-11 md:min-w-11 md:flex-none md:flex-row md:gap-2 md:text-sm ${
                  isActive ? 'bg-blue-50 text-brand' : 'text-gray-700 hover:bg-gray-100'
                }`
              }
            >
              <Icon aria-hidden="true" size={20} />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
