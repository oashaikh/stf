// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import AppShell from '../../components/AppShell';
import { findJargon } from '../../lib/jargon';
import FinalDeclarationPage from '../FinalDeclarationPage';
import DashboardPage from '../DashboardPage';
import ItsUpdatePage from '../ItsUpdatePage';
import LoginPage from '../LoginPage';
import { PrivacyPage, TermsPage } from '../LegalPages';
import MoneyInPage from '../MoneyInPage';
import MoneyOutPage from '../MoneyOutPage';
import BankPage from '../BankPage';
import SettingsPage from '../SettingsPage';
import TaxHubPage from '../TaxHubPage';

// ponytail: STF-121 rewrites the VAT review and send screens (VatPage, VatObligationsList,
// VatPreviewPanel, VatHistoryList). Their addresses are skipped here until then; delete this list
// when STF-121 lands so those screens are scanned too.
const VAT_SCREENS_UNTIL_STF_121 = ['/tax/vat', '/tax/past-returns'];

const PAGE_ADDRESSES = [
  '/home',
  '/money-in',
  '/money-in/other?kind=income',
  '/money-out',
  '/money-out/receipts',
  '/bank',
  '/tax/income-tax',
  '/tax/reports',
  '/tax/update/2026-27/Q1',
  '/tax/final-declaration/2026-27',
  '/settings',
  '/privacy',
  '/terms',
  '/login',
].filter((address) => !VAT_SCREENS_UNTIL_STF_121.includes(address));

const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

const period = { start: '2026-04-06', end: '2027-04-05' };
const totals = { ...period, incomePence: 120000, expensesPence: 30000, profitPence: 90000 };
const row = { id: 'e1', date: '2026-05-01', description: 'Print cartridges', status: 'draft', kind: 'expense', grossPence: 1200 };

// Invented figures. Every call gets a defined answer, so no query resolves to undefined (TanStack rejects that).
const loadedBody = (url: string): unknown => {
  // An open return due soon, so the Home reminder card is rendered and scanned.
  if (url.includes('obligations')) return { obligations: [{ periodKey: '26A1', start: '2026-10-01', end: '2026-12-31', due: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), status: 'O', overdue: false }] };
  if (url.includes('its-final-preview')) {
    const figures = { incomeTaxPence: 150000, class2NicPence: 0, class4NicPence: 50000, totalPence: 200000 };
    return { ok: true, data: { sandbox: true, calculationId: 'calc-1', hmrc: { ...figures, incomeTaxPence: 250000, totalPence: 300000 }, stfEstimate: figures, comparison: { incomeTaxDifferencePence: 100000, nicDifferencePence: 0, totalDifferencePence: 100000, differs: true }, declarationWording: 'I declare that the information I have given on this return is correct and complete to the best of my knowledge.' } };
  }
  if (url.startsWith('/api/vat/return')) return { ok: true, data: { boxes: { box5: 4500 }, status: null } };
  if (url.startsWith('/api/dashboard')) return { data: { taxYear: totals, month: totals, vatQuarter: { ...period, vatCollectedPence: 2000, vatPaidPence: 500 }, draftCount: 1, recentEntries: [row] } };
  if (url.startsWith('/api/tax-estimate')) {
    return { data: { taxYear: '2026-27', profitPence: 90000, incomeTaxPence: 0, class2NicPence: 0, class4NicPence: 0, totalTaxPence: 0, setAsidePence: 0, expenseMethod: 'actual', tradingAllowancePence: 100000, profitWithActualExpensesPence: 90000, profitWithAllowancePence: 20000, lowerProfitMethod: 'allowance' } };
  }
  if (url.startsWith('/api/profit-and-loss')) {
    return { data: { ...period, income: [{ accountId: 'a1', accountName: 'Sales', totalPence: 120000 }], expenses: [{ accountId: 'a2', accountName: 'Travel', totalPence: 30000 }], incomePence: 120000, expensesPence: 30000, profitPence: 90000 } };
  }
  if (url.startsWith('/api/bank/reconcile')) return { ok: true, lines: [{ id: 'l1', date: '2026-10-03', amountPence: -1250, description: 'Coffee supplies' }], proposals: [{ lineId: 'l1', entryId: 'e1', kind: 'exact' }] };
  if (url.startsWith('/api/settings/vat-number')) return { masked: null };
  return { ok: true, entries: [row], invoices: [], accounts: [], templates: [], nextCursor: null };
};

const STATES = {
  loaded: () => vi.fn(async (url: string) => reply(200, loadedBody(url))),
  error: () => vi.fn(async () => reply(500, { error: 'INTERNAL_ERROR' })),
  loading: () => vi.fn(() => new Promise<Response>(() => {})),
};

function renderAt(address: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[address]}>
        <Routes>
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AppShell />}>
            <Route path="/home" element={<DashboardPage />} />
            <Route path="/money-in/*" element={<MoneyInPage />} />
            <Route path="/money-out/*" element={<MoneyOutPage />} />
            <Route path="/bank" element={<BankPage />} />
            <Route path="/tax/update/:taxYear/:quarter" element={<ItsUpdatePage />} />
            <Route path="/tax/final-declaration/:taxYear" element={<FinalDeclarationPage />} />
            <Route path="/tax/*" element={<TaxHubPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each(Object.entries(STATES))('no accounting jargon while %s', (_state, makeFetch) => {
  it.each(PAGE_ADDRESSES)('%s', async (address) => {
    vi.stubGlobal('fetch', makeFetch());
    const { container } = renderAt(address);
    await settle();
    expect(findJargon(container), `jargon on ${address}`).toEqual([]);
  });
});

describe('invoice editor', () => {
  it('has no jargon once opened', async () => {
    vi.stubGlobal('fetch', STATES.loaded());
    const { container } = renderAt('/money-in');
    await settle();
    fireEvent.click(await screen.findByRole('button', { name: /new invoice/i }));
    await settle();
    expect(screen.getAllByRole('heading', { name: /invoice/i }).length).toBeGreaterThan(0);
    expect(findJargon(container)).toEqual([]);
  });
});

describe('the scan itself', () => {
  it('fails when a banned word is added to a rendered page', async () => {
    vi.stubGlobal('fetch', STATES.loaded());
    const { container } = renderAt('/home');
    await settle();
    const stray = document.createElement('p');
    stray.textContent = 'Check your ledger';
    container.appendChild(stray);
    expect(findJargon(container)).toEqual(['ledger']);
  });
});
