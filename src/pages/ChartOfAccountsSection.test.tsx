// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiAccount } from '../lib/accountsApi';
import ChartOfAccountsSection from './ChartOfAccountsSection';

const account = (id: string, code: string, name: string, accountType: ApiAccount['accountType'], isSystem = false): ApiAccount => ({
  id,
  code,
  name,
  accountType,
  taxCategory: null,
  isSystem,
});

describe('ChartOfAccountsSection', () => {
  let active: ApiAccount[];
  let archived: ApiAccount[];
  const requests: Array<{ method: string; body: unknown }> = [];

  const reply = (body: unknown, status = 200) => ({ ok: status < 400, json: async () => body }) as Response;

  // Fake backend: a stateful stand-in for /api/accounts.
  beforeEach(() => {
    active = [
      account('i1', '1000', 'Business bank account', 'asset', true),
      account('i2', '4000', 'Sales', 'income'),
      account('i3', '6000', 'Travel', 'expense'),
    ];
    archived = [account('i4', '6300', 'Advertising', 'expense')];
    requests.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET';
        const body = init.body ? JSON.parse(init.body as string) : undefined;
        if (method === 'GET') return reply({ ok: true, accounts: url.includes('archived=true') ? archived : active });
        requests.push({ method, body });
        if (method === 'POST') {
          if (active.some((a) => a.code === body.code)) return reply({ ok: false, code: 'DUPLICATE_CODE' }, 409);
          active.push(account('new', body.code, body.name, body.accountType));
        } else if (body.name) {
          active = active.map((a) => (a.id === body.id ? { ...a, name: body.name } : a));
        } else if (body.archived) {
          archived.push(active.find((a) => a.id === body.id)!);
          active = active.filter((a) => a.id !== body.id);
        } else {
          active.push(archived.find((a) => a.id === body.id)!);
          archived = archived.filter((a) => a.id !== body.id);
        }
        return reply({ ok: true });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('groups accounts by type and labels system accounts without an archive button', async () => {
    render(<ChartOfAccountsSection />);
    expect(await screen.findByRole('heading', { name: 'Income' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Expenses' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByText('4000')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive Business bank account' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive Travel' })).toBeInTheDocument();
  });

  it('adds an account with a tax category from the list', async () => {
    render(<ChartOfAccountsSection />);
    await screen.findByText('Travel');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '6700' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Parking' } });
    fireEvent.change(screen.getByLabelText('Tax category'), { target: { value: 'travel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    expect(await screen.findByText('Parking')).toBeInTheDocument();
    expect(requests[0].body).toEqual({ code: '6700', name: 'Parking', accountType: 'expense', taxCategory: 'travel' });
  });

  it('offers only income tax categories for an income account', async () => {
    render(<ChartOfAccountsSection />);
    await screen.findByText('Travel');
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'income' } });
    const options = Array.from(screen.getByLabelText('Tax category').querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['turnover', 'other-income']);
  });

  it('shows the duplicate-code error next to the code field', async () => {
    render(<ChartOfAccountsSection />);
    await screen.findByText('Travel');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '6000' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Trips' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That code is already used');
    expect(screen.getByLabelText('Code')).toHaveAccessibleDescription(alert.textContent!);
  });

  it('renames an account', async () => {
    render(<ChartOfAccountsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Travel' }));
    fireEvent.change(screen.getByLabelText('New name for 6000'), { target: { value: 'Travel and fuel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByText('Travel and fuel')).toBeInTheDocument();
    expect(requests[0].body).toEqual({ id: 'i3', name: 'Travel and fuel' });
  });

  it('asks before archiving and sends nothing until confirmed', async () => {
    render(<ChartOfAccountsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Archive Travel' }));
    expect(screen.getByRole('group', { name: 'Confirm archive of Travel' })).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Archive Travel' })).not.toBeInTheDocument());
    expect(requests[0].body).toEqual({ id: 'i3', archived: true });
  });

  it('unarchives from the archived view', async () => {
    render(<ChartOfAccountsSection />);
    await screen.findByText('Travel');
    fireEvent.click(screen.getByLabelText('Show archived accounts'));
    fireEvent.click(await screen.findByRole('button', { name: 'Unarchive Advertising' }));
    await waitFor(() => expect(requests[0].body).toEqual({ id: 'i4', archived: false }));
  });

  it('says so when there are no accounts to show', async () => {
    active = [];
    render(<ChartOfAccountsSection />);
    expect(await screen.findByText('No accounts to show.')).toBeInTheDocument();
  });

  it('does not claim there are no accounts while they are loading', () => {
    render(<ChartOfAccountsSection />);
    expect(screen.queryByText('No accounts to show.')).toBeNull();
  });
});
