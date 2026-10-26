// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiEntry } from '../lib/entriesApi';
import { MemoryRouter } from 'react-router-dom';
import ExpensesPage from './ExpensesPage';

const account = (id: string, name: string, accountType: string) => ({ id, code: id, name, accountType, taxCategory: null, isSystem: false });
const accounts = [account('a1', 'Sales', 'income'), account('a2', 'Travel', 'expense'), account('a3', 'Bank', 'asset')];
const reply = (body: unknown, status = 200) => ({ ok: status < 400, json: async () => body }) as Response;

describe('ExpensesPage add entry form', () => {
  let masked: string | null;
  let entries: ApiEntry[];
  let posts: Array<Record<string, unknown>>;
  let refusal: { error: string; fields: string[] } | null;

  beforeEach(() => {
    masked = null;
    entries = [];
    posts = [];
    refusal = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (url.startsWith('/api/accounts')) return reply({ ok: true, accounts });
        if (url === '/api/settings/vat-number') return reply({ ok: true, masked });
        if (init.method === 'POST') {
          if (refusal) return reply({ ok: false, ...refusal }, 400);
          const body = JSON.parse(init.body as string);
          posts.push(body);
          entries = [
            { id: 'e1', date: body.date, description: body.description, reference: null, status: 'draft', kind: body.kind, grossPence: body.amountPence, categoryAccountId: body.categoryAccountId, categoryName: '', netPence: body.amountPence, vatPence: 0, hasReceipt: false },
            ...entries,
          ];
          return reply({ ok: true });
        }
        return reply({ ok: true, entries });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function openForm() {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ExpensesPage />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add entry' }));
    await within(screen.getByLabelText('Category')).findByRole('option', { name: 'Travel' });
  }
  const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const fillValid = () => {
    type('Description', 'Train to client');
    type('Amount in pounds', '120');
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'a2' } });
  };

  it('hides the VAT rate without a VAT number and shows it with one', async () => {
    await openForm();
    expect(screen.queryByLabelText('VAT rate')).not.toBeInTheDocument();
    cleanup();
    masked = '••••••789';
    await openForm();
    expect(await screen.findByLabelText('VAT rate')).toBeInTheDocument();
  });

  it('offers only active accounts of the matching type', async () => {
    await openForm();
    const options = within(screen.getByLabelText('Category')).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['Choose a category', 'Travel']);
    fireEvent.click(screen.getByRole('button', { name: 'Money in' }));
    expect(within(screen.getByLabelText('Category')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose a category', 'Sales']);
  });

  it('shows net, VAT and gross for a gross amount and for a net amount', async () => {
    masked = '••••••789';
    await openForm();
    await screen.findByLabelText('VAT rate');
    type('VAT rate', '20');
    type('Amount in pounds', '120');
    expect(screen.getByTestId('figures')).toHaveTextContent('Net£100.00VAT£20.00Gross£120.00');
    fireEvent.click(screen.getByLabelText('Net (before VAT)'));
    expect(screen.getByTestId('figures')).toHaveTextContent('Net£120.00VAT£24.00Gross£144.00');
  });

  it.each([
    ['-5', 'cannot be negative'],
    ['1.234', 'at most two decimal places'],
  ])('refuses the amount %s without calling the server', async (amount, message) => {
    await openForm();
    fillValid();
    type('Amount in pounds', amount);
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it('saves a draft, clears the form and lists the new entry', async () => {
    await openForm();
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ kind: 'expense', categoryAccountId: 'a2', amountPence: 12000, amountIs: 'gross', vatRatePercent: 0, status: 'draft' });
    expect(await screen.findByText('Train to client', { selector: 'li *' })).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toHaveValue('');
    expect(screen.getByLabelText('Amount in pounds')).toHaveValue('');
    expect(screen.getByLabelText('Category')).toHaveValue('');
  });

  it('shows a server refusal beside the field it names', async () => {
    refusal = { error: 'Date cannot be more than 7 days ahead', fields: ['date'] };
    await openForm();
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    const message = await screen.findByText('Date cannot be more than 7 days ahead');
    expect(screen.getByLabelText('Date')).toHaveAccessibleDescription(expect.stringContaining(message.textContent!));
    expect(screen.getByLabelText('Description')).toHaveValue('Train to client');
  });
});

describe('ExpensesPage edit entry', () => {
  let entries: ApiEntry[];
  let puts: Array<{ url: string; body: Record<string, unknown> }>;
  let locked: boolean;

  beforeEach(() => {
    locked = false;
    puts = [];
    entries = [
      { id: 'e9', date: '2026-03-02', description: 'Laptop', reference: 'INV-7', status: 'confirmed', kind: 'expense', grossPence: 120000, categoryAccountId: 'a2', categoryName: 'Travel', netPence: 100000, vatPence: 20000, hasReceipt: false },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (url.startsWith('/api/accounts')) return reply({ ok: true, accounts });
        if (url === '/api/settings/vat-number') return reply({ ok: true, masked: null });
        if (init.method === 'PUT') {
          if (locked) return reply({ ok: false, code: 'PERIOD_LOCKED', error: 'locked' }, 409);
          const body = JSON.parse(init.body as string);
          puts.push({ url, body });
          entries = [{ ...entries[0], description: body.description, grossPence: body.amountPence }];
          return reply({ ok: true });
        }
        return reply({ ok: true, entries });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function openEdit() {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <ExpensesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('heading', { name: /Edit entry/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Date')).toHaveFocus();
    await within(screen.getByLabelText('Category')).findByRole('option', { name: 'Travel' });
  }

  it('pre-fills the form from the row, with the amount in pounds and the VAT rate read back', async () => {
    await openEdit();
    expect(screen.getByLabelText('Description')).toHaveValue('Laptop');
    expect(screen.getByLabelText('Amount in pounds')).toHaveValue('£1,200.00');
    expect(screen.getByLabelText('Date')).toHaveValue('2026-03-02');
    expect(screen.getByLabelText('Reference (optional)')).toHaveValue('INV-7');
    expect(screen.getByLabelText('VAT rate')).toHaveValue('20');
    expect(screen.getByLabelText('Category')).toHaveValue('a2');
  });

  it('sends a PUT with the id, integer pence and the original status, then shows the update', async () => {
    await openEdit();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Laptop and case' } });
    fireEvent.change(screen.getByLabelText('Amount in pounds'), { target: { value: '1300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].url).toBe('/api/entries?id=e9');
    expect(puts[0].body).toMatchObject({ amountPence: 130000, amountIs: 'gross', vatRatePercent: 20, status: 'confirmed' });
    expect(await screen.findByText('Laptop and case', { selector: 'li *' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('returns to the list on Cancel without sending anything', async () => {
    await openEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(puts).toHaveLength(0);
  });

  it('explains a locked period in plain words with a link to the VAT page', async () => {
    locked = true;
    await openEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/VAT period that has been confirmed or filed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to VAT' })).toHaveAttribute('href', '/vat');
    expect(screen.queryByText(/Please try again/)).not.toBeInTheDocument();
  });
});
