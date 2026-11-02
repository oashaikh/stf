// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DashboardPage from './DashboardPage';

function daysFromToday(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

const summary = {
  taxYear: { start: '2026-04-06', end: '2027-04-05', incomePence: 150000, expensesPence: 40000, profitPence: 110000 },
  month: { start: '2026-11-01', end: '2026-11-30', incomePence: 20000, expensesPence: 5000, profitPence: 15000 },
  vatQuarter: { start: '2026-10-01', end: '2026-12-31', vatCollectedPence: 30000, vatPaidPence: 8000 },
  draftCount: 3,
  unsortedBankCount: 0,
  receiptsToCheckCount: 0,
  recentEntries: [],
};
const estimate = { taxYear: '2026-27', profitPence: 110000, incomeTaxPence: 0, class2NicPence: 0, class4NicPence: 0, totalTaxPence: 12345, setAsidePence: 12345 };
const overdueVat = { periodKey: '26C1', start: '2026-04-01', end: '2026-06-30', due: daysFromToday(-5), status: 'O', overdue: true };
const itsSoon = {
  kind: 'quarterly', taxYear: '2026-27', periodStart: '2026-04-06', periodEnd: '2026-07-05',
  dueDate: daysFromToday(6), status: 'open', receivedDate: null, overdue: false, nextDue: true,
};
const expiringBank = { connected: true, displayName: 'Test Bank', maskedAccountNumber: '****1234', consentExpiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString() };

type Routes = Record<string, () => Response>;

function renderPage(overrides: Routes = {}) {
  const routes: Routes = {
    '/api/dashboard': () => Response.json({ ok: true, data: summary }),
    '/api/tax-estimate': () => Response.json({ ok: true, data: estimate }),
    '/api/vat/obligations': () => Response.json({ obligations: [] }),
    '/api/hmrc/its-obligations': () => Response.json({ ok: true, stale: false, obligations: [] }),
    '/api/bank/status': () => Response.json({ connected: false }),
    ...overrides,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const route = Object.keys(routes).find((prefix) => url.startsWith(prefix));
      return route ? routes[route]() : new Response('{}', { status: 404 });
    }),
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

describe('DashboardPage (Home)', () => {
  it('lists to-dos overdue first, each with one button to its flow', async () => {
    renderPage({
      '/api/dashboard': () => Response.json({ ok: true, data: { ...summary, unsortedBankCount: 9 } }),
      '/api/vat/obligations': () => Response.json({ obligations: [overdueVat] }),
      '/api/hmrc/its-obligations': () => Response.json({ ok: true, stale: false, obligations: [itsSoon] }),
      '/api/bank/status': () => Response.json(expiringBank),
    });
    const list = await screen.findByRole('list', { name: /to-do/i });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toMatch(/File your VAT return, 5 days late/);
    expect(items[1].textContent).toMatch(/bank connection runs out in 3 days/);
    expect(items[2].textContent).toMatch(/Send your Income Tax update/);
    expect(items[3].textContent).toMatch(/Sort 9 bank payments/);
    expect(within(items[0]).getByText(/overdue/i)).toBeTruthy();
    expect(within(items[0]).getAllByRole('link')).toHaveLength(1);
    expect(within(items[0]).getByRole('link', { name: /file return/i }).getAttribute('href')).toBe('/tax/vat');
    expect(within(items[3]).getByRole('link', { name: /sort payments/i }).getAttribute('href')).toBe('/bank');
  });

  it('says you are up to date, with the next date, when nothing is due', async () => {
    renderPage({
      '/api/vat/obligations': () => Response.json({ obligations: [{ ...overdueVat, due: '2027-02-07', overdue: false }] }),
    });
    expect(await screen.findByText(/you're up to date\. your next vat return is due 7 february/i)).toBeTruthy();
    expect(screen.queryByRole('list', { name: /to-do/i })).toBeNull();
  });

  it('shows money in, money out and tax to set aside, each a link', async () => {
    renderPage();
    const moneyIn = await screen.findByRole('link', { name: /money in/i });
    expect(moneyIn.textContent).toContain('£200.00');
    expect(moneyIn.getAttribute('href')).toBe('/money-in');
    const moneyOut = screen.getByRole('link', { name: /money out/i });
    expect(moneyOut.textContent).toContain('£50.00');
    expect(moneyOut.getAttribute('href')).toBe('/money-out');
    const tax = await screen.findByRole('link', { name: /tax to set aside/i });
    expect(tax.textContent).toContain('£123.45');
    expect(tax.getAttribute('href')).toBe('/tax/income-tax');
  });

  it('keeps the other to-dos and the summary when one source fails, and says which', async () => {
    renderPage({
      '/api/vat/obligations': () => new Response('{}', { status: 500 }),
      '/api/dashboard': () => Response.json({ ok: true, data: { ...summary, receiptsToCheckCount: 2 } }),
      '/api/hmrc/its-obligations': () => Response.json({ ok: true, stale: false, obligations: [itsSoon] }),
    });
    expect(await screen.findByText(/Check 2 receipts/)).toBeTruthy();
    expect(screen.getByText(/Send your Income Tax update/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/could not check your VAT returns/i);
    expect(await screen.findByRole('link', { name: /tax to set aside/i })).toBeTruthy();
  });

  it('still shows the to-dos when the money summary cannot load', async () => {
    renderPage({
      '/api/dashboard': () => new Response('nope', { status: 500 }),
      '/api/vat/obligations': () => Response.json({ obligations: [overdueVat] }),
    });
    expect(await screen.findByText(/File your VAT return, 5 days late/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/could not load your money summary/i);
  });

  it('keeps accounting jargon off the screen', async () => {
    renderPage({ '/api/vat/obligations': () => Response.json({ obligations: [overdueVat] }) });
    await screen.findByText(/File your VAT return/);
    expect(document.body.textContent).not.toMatch(/ledger|obligation|reconcile|box 5/i);
  });
});
