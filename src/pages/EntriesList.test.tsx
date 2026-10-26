// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiEntry } from '../lib/entriesApi';
import EntriesList from './EntriesList';

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
    pages = { '': { entries: [entry('e1')], nextCursor: null } };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
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

  const lastParams = () => new URL(entryUrls[entryUrls.length - 1], 'http://x').searchParams;
  async function renderList() {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <EntriesList />
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
        <EntriesList />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Choose Add entry/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zzz' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText(/Choose Add entry/)).toBeInTheDocument();
    expect(lastParams().get('search')).toBeNull();
  });
});
