// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ItsUpdatePage from './ItsUpdatePage';

const open = { business: 'self-employment', kind: 'quarterly', taxYear: '2026-27', periodStart: '2026-04-06', periodEnd: '2026-07-05', dueDate: '2026-08-05', status: 'open', receivedDate: null, overdue: false, nextDue: true };

function renderAt(path: string, obligation: object = open) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    url.includes('its-obligations') ? Response.json({ ok: true, stale: false, obligations: [obligation] }) : Response.json({ ok: false, code: 'NO_NINO', error: 'x' }, { status: 409 })));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/tax/update/:taxYear/:quarter" element={<ItsUpdatePage />} />
          <Route path="/tax/update/property/:taxYear/:quarter" element={<ItsUpdatePage business="uk-property" />} />
          <Route path="/tax/income-tax" element={<p>Tax page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ItsUpdatePage', () => {
  it('shows the guided update for the quarter in the address', async () => {
    renderAt('/tax/update/2026-27/1');
    expect(await screen.findByRole('heading', { name: 'Send your Income Tax update' })).toBeTruthy();
    expect(screen.getByText(/6 Apr 2026 to 5 Jul 2026/)).toBeTruthy();
  });

  it('says so and links back when no open update matches', async () => {
    renderAt('/tax/update/2026-27/3');
    expect((await screen.findByRole('alert')).textContent).toContain('could not find that update');
    expect(screen.getByRole('link', { name: 'Back to Tax' }).getAttribute('href')).toBe('/tax/income-tax');
  });

  it('does not open the update for a quarter that is already sent', async () => {
    renderAt('/tax/update/2026-27/1', { ...open, status: 'fulfilled', receivedDate: '2026-07-20' });
    expect((await screen.findByRole('alert')).textContent).toContain('could not find that update');
  });

  it('opens the rental property update only from the property address', async () => {
    renderAt('/tax/update/property/2026-27/1', { ...open, business: 'uk-property' });
    expect(await screen.findByText('Rental property')).toBeTruthy();
    cleanup();
    renderAt('/tax/update/2026-27/1', { ...open, business: 'uk-property' });
    expect((await screen.findByRole('alert')).textContent).toContain('could not find that update');
  });

  it('wraps the screen in the shared page container', async () => {
    renderAt('/tax/update/2026-27/1');
    await screen.findByRole('heading', { name: 'Send your Income Tax update' });
    expect(screen.getByRole('main').className).toContain('max-w-4xl');
  });

  it('keeps the confirmation on screen when the quarter turns fulfilled after sending', async () => {
    let sent = false;
    const preview = { ok: true, data: { endpoint: { method: 'PUT', url: 'https://test-api.service.hmrc.gov.uk/x', sandbox: true }, body: { periodDates: { periodStartDate: '2026-04-06', periodEndDate: '2026-07-05' }, periodIncome: { turnover: '100.00' }, periodExpenses: { adminCosts: '10.00' } }, headers: {} } };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('its-obligations')) return Response.json({ ok: true, stale: false, obligations: [sent ? { ...open, status: 'fulfilled' } : open] });
      if (url.includes('its-cumulative-preview')) return Response.json(preview);
      if (url.includes('its-cumulative-submit')) { sent = true; }
      return Response.json({ ok: true, data: { sandbox: true } });
    }));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/tax/update/2026-27/1']}>
          <Routes><Route path="/tax/update/:taxYear/:quarter" element={<ItsUpdatePage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Step 1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Send to HMRC' }));
    expect(await screen.findByText('HMRC has your update')).toBeTruthy();
    // The obligations refetch lands after the first paint; the confirmation has to survive it.
    await waitFor(() => expect(sent).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/could not find that update/)).toBeNull();
    expect(screen.getByText('HMRC has your update')).toBeTruthy();
  });
});
