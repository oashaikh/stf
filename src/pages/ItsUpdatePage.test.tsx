// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ItsUpdatePage from './ItsUpdatePage';

const open = { kind: 'quarterly', taxYear: '2026-27', periodStart: '2026-04-06', periodEnd: '2026-07-05', dueDate: '2026-08-05', status: 'open', receivedDate: null, overdue: false, nextDue: true };

function renderAt(path: string, obligation: object = open) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    url.includes('its-obligations') ? Response.json({ ok: true, stale: false, obligations: [obligation] }) : Response.json({ ok: false, code: 'NO_NINO', error: 'x' }, { status: 409 })));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/tax/update/:taxYear/:quarter" element={<ItsUpdatePage />} />
          <Route path="/tax" element={<p>Tax page</p>} />
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
    expect(screen.getByRole('link', { name: 'Back to Tax' }).getAttribute('href')).toBe('/tax');
  });

  it('does not open the update for a quarter that is already sent', async () => {
    renderAt('/tax/update/2026-27/1', { ...open, status: 'fulfilled', receivedDate: '2026-07-20' });
    expect((await screen.findByRole('alert')).textContent).toContain('could not find that update');
  });

  it('wraps the screen in the shared page container', async () => {
    renderAt('/tax/update/2026-27/1');
    await screen.findByRole('heading', { name: 'Send your Income Tax update' });
    expect(screen.getByRole('main').className).toContain('max-w-4xl');
  });
});
