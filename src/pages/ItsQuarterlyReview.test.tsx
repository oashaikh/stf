// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ItsObligationRow } from '../lib/hmrc/itsObligationsApi';
import ItsQuarterlyReview from './ItsQuarterlyReview';

const obligation: ItsObligationRow = {
  business: 'self-employment',
  kind: 'quarterly',
  taxYear: '2026-27',
  periodStart: '2026-04-06',
  periodEnd: '2026-07-05',
  dueDate: '2026-08-05',
  status: 'open',
  receivedDate: null,
  overdue: false,
  nextDue: true,
};

const previewBody = {
  ok: true,
  data: {
    endpoint: { method: 'PUT', url: 'https://test-api.service.hmrc.gov.uk/individuals/business/self-employment/AB******C/XA******1/cumulative/2026-27', sandbox: true },
    body: {
      periodDates: { periodStartDate: '2026-04-06', periodEndDate: '2026-07-05' },
      periodIncome: { turnover: '12000.50', other: '0.00' },
      periodExpenses: { adminCosts: '300.00', travel: '1.00' },
    },
    headers: { Accept: 'application/vnd.hmrc.5.0+json', Authorization: 'Bearer (hidden)' },
  },
};

function renderReview(respond: (url: string) => Response, onClose: () => void = () => {}) {
  const fetchSpy = vi.fn(async (url: string, _init?: RequestInit) => respond(url));
  vi.stubGlobal('fetch', fetchSpy);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ItsQuarterlyReview obligation={obligation} onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchSpy;
}

const happyPath = (url: string) => {
  if (url.endsWith('-preview')) return Response.json(previewBody);
  if (url.endsWith('-confirm')) return Response.json({ ok: true, data: { sandbox: true, body: previewBody.data.body } });
  return Response.json({ ok: true, data: { sandbox: true } });
};

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

async function goToSendStep() {
  await screen.findByText('Step 1 of 3');
  click('Next');
  click('Next');
}

describe('ItsQuarterlyReview', () => {
  it('walks income, then costs, with Back, and shows the HMRC name in small text', async () => {
    renderReview(happyPath);
    expect(await screen.findByText('Step 1 of 3')).toBeTruthy();
    expect(screen.getByText('£12,000.50')).toBeTruthy();
    expect(screen.getByText('Turnover')).toBeTruthy();
    expect(screen.queryByText('turnover')).toBeNull();
    expect(screen.queryByText('Admin costs')).toBeNull();
    click('Next');
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    expect(screen.getByText('Admin costs')).toBeTruthy();
    expect(screen.getByText('Phone, fax, stationery and other office costs')).toBeTruthy();
    expect(screen.getByText('Other amount')).toBeTruthy();
    expect(screen.queryByText('adminCosts')).toBeNull();
    expect(screen.queryByText('travel')).toBeNull();
    click('Back');
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
  });

  it('explains a figure and points to the payments behind it', async () => {
    renderReview(happyPath);
    await screen.findByText('Step 1 of 3');
    click('Why is this £12,000.50?');
    expect(screen.getByRole('link', { name: 'See the payments behind it' }).getAttribute('href')).toBe('/invoices');
  });

  it('saves the step and leaves, then resumes at that step', async () => {
    const onClose = vi.fn();
    renderReview(happyPath, onClose);
    await screen.findByText('Step 1 of 3');
    click('Next');
    click('Save and leave');
    expect(onClose).toHaveBeenCalled();
    cleanup();
    renderReview(happyPath);
    expect(await screen.findByText('Step 2 of 3')).toBeTruthy();
  });

  it('finishes with a plain sentence, a test-mode notice and technical details tucked away', async () => {
    renderReview(happyPath);
    await goToSendStep();
    expect(screen.getByText(/You are telling HMRC your income was £12,000.50 and your costs were £301.00 for /)).toBeTruthy();
    expect(screen.getByText(/Test mode/)).toBeTruthy();
    expect(screen.getByText('Technical details')).toBeTruthy();
  });

  it('keeps Send to HMRC disabled until the declaration is ticked', async () => {
    renderReview(happyPath);
    await goToSendStep();
    const send = screen.getByRole('button', { name: 'Send to HMRC' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(send.disabled).toBe(false);
  });

  it('confirms with the declaration, then sends, then shows the confirmation', async () => {
    const fetchSpy = renderReview(happyPath);
    await goToSendStep();
    fireEvent.click(screen.getByRole('checkbox'));
    click('Send to HMRC');
    expect(await screen.findByText('HMRC has your update')).toBeTruthy();
    const calls = fetchSpy.mock.calls.map(([url]) => url);
    expect(calls).toEqual([
      '/api/hmrc/its-cumulative-preview',
      '/api/hmrc/its-cumulative-confirm',
      '/api/hmrc/its-cumulative-submit',
    ]);
    const confirmInit = fetchSpy.mock.calls[1][1] as unknown as RequestInit;
    expect(JSON.parse(confirmInit.body as string)).toEqual({ taxYear: '2026-27', quarter: 1, declaration: true });
    expect(screen.queryByRole('button', { name: 'Send to HMRC' })).toBeNull();
  });

  it('refreshes the obligations list after a successful send', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => happyPath(url)));
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ItsQuarterlyReview obligation={obligation} onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await goToSendStep();
    fireEvent.click(screen.getByRole('checkbox'));
    click('Send to HMRC');
    await screen.findByText('HMRC has your update');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['its-obligations'] });
  });

  it('explains a refusal in plain words and lets the owner try again', async () => {
    renderReview((url) =>
      url.endsWith('-submit')
        ? Response.json({ ok: false, code: 'STALE_CONFIRMATION', error: 'x' }, { status: 409 })
        : happyPath(url),
    );
    await goToSendStep();
    fireEvent.click(screen.getByRole('checkbox'));
    click('Send to HMRC');
    expect((await screen.findByRole('alert')).textContent).toContain('Your records changed since you confirmed');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Send to HMRC' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('warns not to send again when the outcome is unknown', async () => {
    renderReview((url) =>
      url.endsWith('-submit')
        ? Response.json({ ok: false, code: 'OUTCOME_UNKNOWN', error: 'x' }, { status: 502 })
        : happyPath(url),
    );
    await goToSendStep();
    fireEvent.click(screen.getByRole('checkbox'));
    click('Send to HMRC');
    expect((await screen.findByRole('alert')).textContent).toContain('Do not send it again');
    expect(screen.queryByRole('button', { name: 'Send to HMRC' })).toBeNull();
  });

  it('stops early with the fix beside the problem when the preview cannot load', async () => {
    renderReview(() => Response.json({ ok: false, code: 'NO_NINO', error: 'x' }, { status: 409 }));
    expect((await screen.findByRole('alert')).textContent).toContain('National Insurance number');
    expect(screen.getByRole('link', { name: 'Add it in Settings' }).getAttribute('href')).toBe('/settings');
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  describe('for a rental property', () => {
    const propertyObligation = { ...obligation, business: 'uk-property' as const };
    const propertyPreview = {
      ok: true,
      data: {
        endpoint: { method: 'PUT', url: 'https://test-api.service.hmrc.gov.uk/individuals/business/property/uk/AB******C/XA******1/cumulative/2026-27', sandbox: true },
        body: {
          fromDate: '2026-04-06',
          toDate: '2026-07-05',
          ukProperty: { income: { periodAmount: 4500.5, otherIncome: 10 }, expenses: { repairsAndMaintenance: 120.25, financialCosts: 80 } },
        },
        headers: {},
      },
    };
    const propertyHappy = (url: string) => {
      if (url.endsWith('its-property-preview')) return Response.json(propertyPreview);
      if (url.endsWith('its-property-confirm')) return Response.json({ ok: true, data: { sandbox: true } });
      if (url.endsWith('its-property-submit')) return Response.json({ ok: true, data: { sandbox: true } });
      return Response.json({ ok: false, code: 'X', error: 'wrong route' }, { status: 500 });
    };
    function renderProperty(respond: (url: string) => Response) {
      const fetchSpy = vi.fn(async (url: string, _init?: RequestInit) => respond(url));
      vi.stubGlobal('fetch', fetchSpy);
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter><ItsQuarterlyReview obligation={propertyObligation} onClose={() => {}} /></MemoryRouter>
        </QueryClientProvider>,
      );
      return fetchSpy;
    }
    async function toSend() {
      await screen.findByText('Step 1 of 3');
      click('Next');
      click('Next');
    }

    it('names the rental property, shows rent in plain words and tells the owner it is test mode', async () => {
      renderProperty(propertyHappy);
      expect(await screen.findByText('Rental property')).toBeTruthy();
      expect(await screen.findByText('Rent received')).toBeTruthy();
      expect(screen.getByText('£4,500.50')).toBeTruthy();
      click('Next');
      expect(screen.getByText('Repairs and maintenance')).toBeTruthy();
      click('Next');
      expect(screen.getByText(/You are telling HMRC you received £4,510.50 in rental income and your costs were £200.25 for /)).toBeTruthy();
      expect(screen.getByText(/Test mode/)).toBeTruthy();
    });

    it('cannot send without the declaration, then confirms and sends through the property routes', async () => {
      const fetchSpy = renderProperty(propertyHappy);
      await toSend();
      expect((screen.getByRole('button', { name: 'Send to HMRC' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole('checkbox'));
      click('Send to HMRC');
      expect(await screen.findByText('HMRC has your update')).toBeTruthy();
      expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
        '/api/hmrc/its-property-preview',
        '/api/hmrc/its-property-confirm',
        '/api/hmrc/its-property-submit',
      ]);
    });

    it('explains a rejection and allows another try', async () => {
      renderProperty((url) => url.endsWith('its-property-submit') ? Response.json({ ok: false, code: 'STALE_CONFIRMATION', error: 'x' }, { status: 409 }) : propertyHappy(url));
      await toSend();
      fireEvent.click(screen.getByRole('checkbox'));
      click('Send to HMRC');
      expect((await screen.findByRole('alert')).textContent).toContain('Your records changed since you confirmed');
      await waitFor(() => expect((screen.getByRole('button', { name: 'Send to HMRC' }) as HTMLButtonElement).disabled).toBe(false));
    });

    it('offers no retry when the outcome is unknown', async () => {
      renderProperty((url) => url.endsWith('its-property-submit') ? Response.json({ ok: false, code: 'OUTCOME_UNKNOWN', error: 'x' }, { status: 502 }) : propertyHappy(url));
      await toSend();
      fireEvent.click(screen.getByRole('checkbox'));
      click('Send to HMRC');
      expect((await screen.findByRole('alert')).textContent).toContain('Do not send it again');
      expect(screen.queryByRole('button', { name: 'Send to HMRC' })).toBeNull();
    });
  });
});
