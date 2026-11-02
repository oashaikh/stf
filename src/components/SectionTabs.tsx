import { NavLink } from 'react-router-dom';

export type SectionTab = { to: string; label: string };

// Tab state lives in the address, so a refresh or an old bookmark lands on the same tab. Wraps instead of scrolling at 390 px.
export default function SectionTabs({ label, tabs }: { label: string; tabs: SectionTab[] }) {
  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap gap-2 border-b border-gray-200 pb-2">
      {tabs.map(({ to, label: tabLabel }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            `inline-flex min-h-11 min-w-11 items-center rounded px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
              isActive ? 'bg-blue-50 text-brand' : 'text-gray-700 hover:bg-gray-100'
            }`
          }
        >
          {tabLabel}
        </NavLink>
      ))}
    </nav>
  );
}
