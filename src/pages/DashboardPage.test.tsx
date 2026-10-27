// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DashboardPage from './DashboardPage';

const totals = { incomePence: 150000, expensesPence: 40000, profitPence: 110000, vatCollectedPence: 30000, vatPaidPence: 8000 };
const summary = {
  taxYear: { start: '2026-04-06', end: '2027-04-05', ...totals },
  month: { start: '2026-10-01', end: '2026-10-31', ...totals, incomePence: 20000, expensesPence: 5000, profitPence: 15000 },
  vatQuarter: { start: '2026-10-01', end: '2026-12-31', vatCollectedPence: 30000, vatPaidPence: 8000 },
  draftCount: 3,
  recentEntries: [
    { id: 'e1', date: '2026-10-20', description: 'Invoice 12', status: 'confirmed', kind: 'income', grossPence: 12000 },
    { id: 'e2', date: '2026-10-19', description: 'Train tickets', status: 'draft', kind: 'expense', grossPence: 4500 },
  ],
};
const empty = {
  ...summary,
  taxYear: { ...summary.taxYear, incomePence: 0, expensesPence: 0, profitPence: 0 },
  month: { ...summary.month, incomePence: 0, expensesPence: 0, profitPence: 0 },
  vatQuarter: { ...summary.vatQuarter, vatCollectedPence: 0, vatPaidPence: 0 },
  draftCount: 0,
  recentEntries: [],
};

const estimate = { taxYear: '2026-27', profitPence: 110000, incomeTaxPence: 0, class2NicPence: 0, class4NicPence: 0, totalTaxPence: 12345, setAsidePence: 12345 };

function renderPage(response: Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url.startsWith('/api/tax-estimate') ? Response.json({ ok: true, data: estimate }) : response)),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DashboardPage', () => {
  it('shows formatted totals, drafts link, recent entries and the add entry link', async () => {
    renderPage(Response.json({ ok: true, data: summary }));
    expect(await screen.findByText('£1,500.00')).toBeTruthy();
    expect(screen.getByText('£1,100.00')).toBeTruthy();
    expect(screen.getByText('£300.00')).toBeTruthy();
    expect(screen.getByText('Train tickets')).toBeTruthy();
    expect(screen.getByRole('link', { name: /3 drafts to confirm/i }).getAttribute('href')).toBe('/expenses?status=draft');
    expect(screen.getByRole('link', { name: /add entry/i }).getAttribute('href')).toBe('/expenses');
    expect(screen.getByRole('link', { name: /vat page/i }).getAttribute('href')).toBe('/vat');
    expect(await screen.findByText('£123.45')).toBeTruthy();
    expect(screen.getByRole('link', { name: /tax page/i }).getAttribute('href')).toBe('/tax');
  });

  it('shows the empty state for a new ledger', async () => {
    renderPage(Response.json({ ok: true, data: empty }));
    expect(await screen.findByText(/no entries yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /add entry/i }).getAttribute('href')).toBe('/expenses');
    expect(screen.queryByText(/drafts to confirm/i)).toBeNull();
  });

  it('shows an error when the summary cannot be loaded', async () => {
    renderPage(new Response('nope', { status: 500 }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load the dashboard/i);
  });
});
