// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { INERT_TEXT } from '../../../api/_lib/__tests__/maliciousInputs';
import { fetchHasVatNumber } from '../../lib/entriesApi';
import { fetchInvoices } from '../../lib/invoicesApi';
import EntriesList from '../EntriesList';
import InvoicesPage from '../InvoicesPage';

vi.mock('../../lib/invoicesApi', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/invoicesApi')>()), fetchInvoices: vi.fn() }));
vi.mock('../../lib/entriesApi', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/entriesApi')>()), fetchHasVatNumber: vi.fn() }));

const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const hostile = [INERT_TEXT.scriptTag, INERT_TEXT.imageHandler, INERT_TEXT.javascriptLink];

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe.each(hostile)('hostile text %s', (text) => {
  it('shows as text on the entries list, with no element or link made from it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/accounts')) return reply({ ok: true, accounts: [] });
        if (url === '/api/vat/obligations') return reply({ obligations: [] });
        return reply({
          ok: true,
          nextCursor: null,
          entries: [{ id: 'e1', date: '2026-05-01', description: text, reference: text, status: 'confirmed', kind: 'expense', grossPence: 100, categoryAccountId: 'a2', categoryName: 'Travel', netPence: 100, vatPence: 0, hasReceipt: false }],
        });
      }),
    );
    const { container } = render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={['/expenses']}>
          <EntriesList onEdit={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect((await screen.findAllByText(text, { exact: false })).length).toBeGreaterThan(0);
    expect(container.querySelector('script, img')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('shows as text on the invoices list', async () => {
    vi.mocked(fetchHasVatNumber).mockResolvedValue(true);
    vi.mocked(fetchInvoices).mockResolvedValue({
      invoices: [{ id: '11111111-1111-4111-8111-111111111111', publicNumber: 'INV-0001', clientName: text, issueDate: '2026-05-01', dueDate: '2026-05-31', status: 'sent', totalPence: 100 }],
      nextCursor: null,
    });
    const { container } = render(
      <QueryClientProvider client={client()}>
        <InvoicesPage />
      </QueryClientProvider>,
    );
    expect((await screen.findAllByText(text, { exact: false })).length).toBeGreaterThan(0);
    expect(container.querySelector('script, img')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});
