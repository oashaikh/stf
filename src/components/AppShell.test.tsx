// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppShell from './AppShell';

const LABELS = ['Dashboard', 'Expenses', 'Invoices', 'Receipts', 'VAT', 'Tax', 'Reports', 'Settings'];

vi.mock('@clerk/clerk-react', () => ({
  SignOutButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/vat" element={<p>vat body</p>} />
          <Route path="/settings" element={<p>settings body</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('AppShell', () => {
  it('links every section and renders the page', () => {
    renderAt('/vat');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const label of LABELS) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText('vat body')).toBeInTheDocument();
  });

  it('marks only the current page', () => {
    renderAt('/settings');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'VAT' })).not.toHaveAttribute('aria-current');
  });

  it('has the app name and a sign-out control', () => {
    renderAt('/vat');
    expect(screen.getByRole('banner')).toHaveTextContent('STF');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('keeps four sections in the phone bar and opens the rest from More', () => {
    renderAt('/vat');
    const more = screen.getByRole('button', { name: 'More' });
    const menu = document.getElementById('more-nav')!;
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveClass('hidden');
    for (const label of ['Expenses', 'Invoices', 'Tax', 'Settings']) {
      expect(within(menu).getByRole('link', { name: label })).toBeInTheDocument();
    }
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(menu).toHaveClass('grid');
  });
});
