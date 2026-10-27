// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { DASHBOARD_QUERY_KEY } from '../lib/dashboardApi';
import type { ApiEntry } from '../lib/entriesApi';
import EntriesList from './EntriesList';

function LocationProbe() {
  return <p data-testid="location">{useLocation().search}</p>;
}

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const account = (id: string, name: string, accountType: string) => ({ id, code: id, name, accountType, taxCategory: null, isSystem: false });
const entry = (id: string, overrides: Partial<ApiEntry> = {}): ApiEntry => ({
  id, date: '2026-05-01', description: `Entry ${id}`, reference: null, status: 'confirmed', kind: 'expense', grossPence: 12345,
  categoryAccountId: 'a2', categoryName: 'Travel', netPence: 12345, vatPence: 0, hasReceipt: false, ...overrides,
});

describe('EntriesList', () => {
  let entryUrls: string[];
  let pages: Record<string, { entries: ApiEntry[]; nextCursor: string | null }>;

  beforeEach(() => {
    entryUrls = [];
    writes = [];
    writeReply = null;
    HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
    pages = { '': { entries: [entry('e1')], nextCursor: null } };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method) {
          writes.push({ method: init.method, url });
          return writeReply ?? reply({ ok: true });
        }
        if (url.startsWith('/api/accounts')) return reply({ ok: true, accounts: [account('a1', 'Sales', 'income'), account('a2', 'Travel', 'expense')] });
        if (url === '/api/vat/obligations') return reply({ obligations: [{ start: '2000-01-01', end: '2999-12-31', due: '2999-12-31', status: 'O' }] });
        entryUrls.push(url);
        const cursor = new URL(url, 'http://x').searchParams.get('cursor') ?? '';
        return reply({ ok: true, ...(pages[cursor] ?? { entries: [], nextCursor: null }) });
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  let writes: { method: string; url: string }[];
  let writeReply: Response | null;
  const lastParams = () => new URL(entryUrls[entryUrls.length - 1], 'http://x').searchParams;
  async function renderList(url = '/expenses') {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[url]}>
          <EntriesList onEdit={() => {}} />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Entry e1');
  }

  it('shows date, description, category, amount, and the receipt icon only when attached', async () => {
    pages[''] = { entries: [entry('e1', { hasReceipt: true, status: 'draft' }), entry('e2')], nextCursor: null };
    await renderList();
    expect(screen.getAllByText('Out £123.45')).toHaveLength(2);
    expect(screen.getAllByText('Travel').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Draft')).toHaveLength(2); // the badge and the status option
    expect(screen.getAllByRole('img', { name: 'Receipt attached' })).toHaveLength(1);
  });

  it.each([
    ['From', '2026-04-06', 'from'],
    ['To', '2026-04-05', 'to'],
    ['Money', 'income', 'kind'],
    ['Filter by category', 'a2', 'categoryAccountId'],
    ['Status', 'draft', 'status'],
    ['Search', 'train', 'search'],
  ])('sends %s as a request parameter', async (label, value, param) => {
    await renderList();
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    await waitFor(() => expect(lastParams().get(param)).toBe(value));
  });

  it('reads the filters from the URL and writes changes back to it', async () => {
    await renderList('/expenses?from=2026-08-15&to=2026-08-15&search=Consulting+%26+design');
    expect(lastParams().get('from')).toBe('2026-08-15');
    expect(lastParams().get('search')).toBe('Consulting & design');
    expect(screen.getByLabelText('Search')).toHaveValue('Consulting & design');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'draft' } });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('status=draft'));
    expect(screen.getByTestId('location')).toHaveTextContent('from=2026-08-15');
  });

  describe('on a phone', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    });

    it('shows only search and a Filters button until the sheet is opened, then applies it to the URL', async () => {
      await renderList();
      expect(screen.getByLabelText('Search')).toBeInTheDocument();
      expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'This VAT quarter' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'This VAT quarter' }));
      expect(lastParams().get('from')).toBeNull(); // nothing applies until Apply
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

      await waitFor(() => expect(lastParams().get('from')).toBe('2000-01-01'));
      expect(screen.getByTestId('location')).toHaveTextContent('from=2000-01-01');
      expect(screen.getByRole('button', { name: /Filters.*1 active/ })).toBeInTheDocument();
    });

    it('Clear in the sheet removes the sheet filters but keeps the search', async () => {
      await renderList('/expenses?status=draft&search=train');
      fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(lastParams().get('status')).toBeNull());
      expect(lastParams().get('search')).toBe('train');
    });
  });

  it('presets fill the date range', async () => {
    await renderList();
    fireEvent.click(screen.getByRole('button', { name: 'This tax year' }));
    await waitFor(() => expect(lastParams().get('from')).toMatch(/-04-06$/));
    fireEvent.click(await screen.findByRole('button', { name: 'This VAT quarter' }));
    await waitFor(() => expect(lastParams().get('from')).toBe('2000-01-01'));
  });

  it('loads more with the cursor, appends rows, and hides the button at the end', async () => {
    pages[''] = { entries: [entry('e1')], nextCursor: 'c1' };
    pages.c1 = { entries: [entry('e2')], nextCursor: null };
    await renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Entry e2');
    expect(lastParams().get('cursor')).toBe('c1');
    expect(screen.getByText('Entry e1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('explains how to add the first entry, and offers Clear filters when filtered', async () => {
    pages[''] = { entries: [], nextCursor: null };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <EntriesList onEdit={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Choose Add entry/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zzz' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText(/Choose Add entry/)).toBeInTheDocument();
    expect(lastParams().get('search')).toBeNull();
  });

  it('explains a From date after the To date instead of asking the API', async () => {
    await renderList();
    const requests = entryUrls.length;
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-05-01' } });
    expect(await screen.findByText(/From date is after the To date/)).toBeInTheDocument();
    expect(entryUrls.length).toBe(requests + 1);
  });

  describe('row actions', () => {
    const voidButton = () => screen.getByRole('button', { name: 'Void' });

    it('names the entry in the void dialog and sends nothing on cancel', async () => {
      await renderList();
      fireEvent.click(voidButton());
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent('Entry e1');
      expect(dialog).toHaveTextContent('£123.45');
      expect(dialog).toHaveTextContent('stays on record');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(writes).toEqual([]);
    });

    it('closes the dialog on Escape without sending anything', async () => {
      await renderList();
      fireEvent.click(voidButton());
      fireEvent(screen.getByRole('dialog'), new Event('close'));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(writes).toEqual([]);
    });

    it('sends DELETE with the id and then shows the row as Voided with no actions', async () => {
      await renderList();
      fireEvent.click(voidButton());
      fireEvent.click(screen.getByRole('button', { name: 'Void entry' }));
      expect(await screen.findByText('Voided')).toBeInTheDocument();
      expect(writes).toEqual([{ method: 'DELETE', url: '/api/entries?id=e1' }]);
      expect(screen.queryByRole('button', { name: 'Void' })).toBeNull();
    });

    it('offers Confirm on drafts only and sends PATCH', async () => {
      pages[''] = { entries: [entry('e1', { status: 'draft' }), entry('e2')], nextCursor: null };
      await renderList();
      expect(screen.getAllByRole('button', { name: 'Confirm' })).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(writes).toEqual([{ method: 'PATCH', url: '/api/entries?id=e1' }]));
    });

    it('marks the dashboard stale after a confirm and after a void', async () => {
      pages[''] = { entries: [entry('e1', { status: 'draft' }), entry('e2')], nextCursor: null };
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <EntriesList onEdit={() => {}} />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await screen.findByText('Entry e1');
      client.setQueryData(DASHBOARD_QUERY_KEY, { stale: true });
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(client.getQueryState(DASHBOARD_QUERY_KEY)?.isInvalidated).toBe(true));
      client.setQueryData(DASHBOARD_QUERY_KEY, { stale: true });
      fireEvent.click(screen.getAllByRole('button', { name: 'Void' })[1]);
      fireEvent.click(screen.getByRole('button', { name: 'Void entry' }));
      await screen.findByText('Voided');
      expect(client.getQueryState(DASHBOARD_QUERY_KEY)?.isInvalidated).toBe(true);
    });

    it('retries the void, not an earlier failed confirm', async () => {
      pages[''] = { entries: [entry('e1', { status: 'draft' })], nextCursor: null };
      writeReply = reply({ error: 'boom' }, 500);
      await renderList();
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await screen.findByRole('button', { name: 'Try again' });
      fireEvent.click(voidButton());
      fireEvent.click(screen.getByRole('button', { name: 'Void entry' }));
      await waitFor(() => expect(writes.map((write) => write.method)).toEqual(['PATCH', 'DELETE']));
      await screen.findByRole('button', { name: 'Try again' });
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(writes.map((write) => write.method)).toEqual(['PATCH', 'DELETE', 'DELETE']));
    });

    it('explains a locked period in plain words with a link to the VAT page', async () => {
      writeReply = reply({ error: 'locked', code: 'PERIOD_LOCKED' }, 409);
      await renderList();
      fireEvent.click(voidButton());
      fireEvent.click(screen.getByRole('button', { name: 'Void entry' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('in a VAT period that has been confirmed or filed');
      expect(screen.getByRole('link', { name: 'Go to VAT' })).toHaveAttribute('href', '/vat');
      expect(screen.queryByText('Voided')).toBeNull();
    });

    it('shows a retryable error for other failures', async () => {
      writeReply = reply({ error: 'boom' }, 500);
      await renderList();
      fireEvent.click(voidButton());
      fireEvent.click(screen.getByRole('button', { name: 'Void entry' }));
      await screen.findByRole('button', { name: 'Try again' });
      writeReply = null;
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Voided')).toBeInTheDocument();
    });
  });
});
