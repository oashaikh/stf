// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ItsObligationRow } from '../lib/hmrc/itsObligationsApi';
import ItsObligationsSection from './ItsObligationsSection';

const row = (overrides: Partial<ItsObligationRow>): ItsObligationRow => ({
  kind: 'quarterly',
  taxYear: '2026-27',
  periodStart: '2026-04-06',
  periodEnd: '2026-07-05',
  dueDate: '2026-08-05',
  status: 'open',
  receivedDate: null,
  overdue: false,
  nextDue: false,
  ...overrides,
});

function renderSection(respond: () => Promise<Response>) {
  const fetchSpy = vi.fn(respond);
  vi.stubGlobal('fetch', fetchSpy);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ItsObligationsSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchSpy;
}

const ok = (body: object) => Response.json({ ok: true, stale: false, ...body });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ItsObligationsSection', () => {
  it('renders nothing when the route says Income Tax is off', async () => {
    const fetchSpy = renderSection(async () => Response.json({ ok: false, code: 'ITSA_DISABLED' }, { status: 404 }));
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('labels the next due obligation in text and groups rows by tax year', async () => {
    renderSection(async () =>
      ok({
        obligations: [
          row({ taxYear: '2025-26', kind: 'finalDeclaration', periodStart: '2025-04-06', periodEnd: '2026-04-05', dueDate: '2027-01-31', status: 'fulfilled', receivedDate: '2026-05-01' }),
          row({ nextDue: true }),
          row({ periodStart: '2026-07-06', periodEnd: '2026-10-05', dueDate: '2026-11-05' }),
        ],
      }),
    );
    expect(await screen.findByRole('heading', { name: '2026-27' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '2025-26' })).toBeTruthy();
    const nextRow = screen.getByText('Next due').closest('tr')!;
    expect(within(nextRow).getByText('5 Aug 2026')).toBeTruthy();
    expect(screen.getAllByText('Next due')).toHaveLength(1);
    expect(screen.getByText('Final declaration')).toBeTruthy();
    expect(screen.getByText('Fulfilled')).toBeTruthy();
  });

  it('marks an overdue obligation with the word Overdue', async () => {
    renderSection(async () => ok({ obligations: [row({ overdue: true, nextDue: true, dueDate: '2026-08-05' })] }));
    expect(await screen.findByText('Overdue')).toBeTruthy();
  });

  it('shows last known dates with the date and the plain-words error when stale', async () => {
    renderSection(async () =>
      Response.json({ ok: true, stale: true, fetchedAt: '2026-10-20T09:00:00.000Z', error: 'HMRC could not be reached just now, so these dates may be out of date.', obligations: [row({ nextDue: true })] }),
    );
    expect(await screen.findByText(/Showing last known dates from 20 Oct 2026/)).toBeTruthy();
    expect(screen.getByText(/HMRC could not be reached just now/)).toBeTruthy();
    expect(screen.getByText('5 Aug 2026')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/Showing last known dates/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ends the stale notice with a full stop when the server text has none', async () => {
    renderSection(async () =>
      Response.json({ ok: true, stale: true, fetchedAt: '2026-10-20T09:00:00.000Z', error: 'HMRC did not answer', obligations: [row({ nextDue: true })] }),
    );
    expect((await screen.findByRole('status')).textContent).toMatch(/HMRC did not answer\.$/);
  });

  it('shows an error in plain words when the route fails and there is nothing stored', async () => {
    renderSection(async () => Response.json({ ok: false, code: 'HMRC_FAILED' }, { status: 502 }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load your income tax dates/i);
  });

  it('says so when HMRC lists no obligations', async () => {
    renderSection(async () => ok({ obligations: [] }));
    expect(await screen.findByText(/no income tax obligations/i)).toBeTruthy();
  });

  it.each([
    ['HMRC_NOT_CONNECTED', /connect hmrc in settings/i],
    ['ITS_SCOPE_MISSING', /reconnect hmrc/i],
    ['NO_BUSINESS_SELECTED', /choose your business/i],
    ['NO_NINO', /national insurance number/i],
  ])('links to Settings when the route reports %s', async (code, text) => {
    renderSection(async () => Response.json({ ok: false, code }, { status: 409 }));
    const link = await screen.findByRole('link', { name: text });
    expect(link.getAttribute('href')).toBe('/settings');
  });
});
