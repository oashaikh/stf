// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VatObligationsList from './VatObligationsList';
import { NotConnectedError } from '../lib/hmrc/vatApi';

const fetchVatObligations = vi.fn();
vi.mock('../lib/hmrc/vatApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/hmrc/vatApi')>()),
  fetchVatObligations: (...args: unknown[]) => fetchVatObligations(...args),
}));
vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ getToken: async () => 'tok' }) }));

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VatObligationsList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const base = { start: '2026-01-01', end: '2026-03-31', received: undefined };

describe('VatObligationsList', () => {
  afterEach(cleanup);
  beforeEach(() => {
    fetchVatObligations.mockReset();
  });

  it('renders due, overdue and fulfilled rows with period key, due date and text status', async () => {
    fetchVatObligations.mockResolvedValue([
      { ...base, periodKey: '26A1', due: '2099-05-07', status: 'O', overdue: false },
      { ...base, periodKey: '25A4', due: '2025-02-07', status: 'O', overdue: true },
      { ...base, periodKey: '25A3', due: '2024-11-07', status: 'F', overdue: false },
    ]);
    renderList();
    expect(await screen.findByText('26A1')).toBeInTheDocument();
    expect(screen.getByText('25A4')).toBeInTheDocument();
    expect(screen.getByText('25A3')).toBeInTheDocument();
    expect(screen.getByText('Due')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Fulfilled')).toBeInTheDocument();
    expect(screen.getByText('2025-02-07')).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    fetchVatObligations.mockResolvedValue([]);
    renderList();
    expect(await screen.findByText(/no vat obligations/i)).toBeInTheDocument();
  });

  it('links to Settings when HMRC is not connected', async () => {
    fetchVatObligations.mockImplementation(async () => {
      throw new NotConnectedError();
    });
    renderList();
    const link = await screen.findByRole('link', { name: /settings/i });
    expect(link).toHaveAttribute('href', '/settings');
  });

  it('shows an error state for other failures', async () => {
    fetchVatObligations.mockImplementation(async () => {
      throw new Error('boom');
    });
    renderList();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not load/i));
  });
});
