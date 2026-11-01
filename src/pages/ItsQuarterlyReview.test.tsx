// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ItsObligationRow } from '../lib/hmrc/itsObligationsApi';
import ItsQuarterlyReview from './ItsQuarterlyReview';

const obligation: ItsObligationRow = {
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

function renderReview(respond: (url: string) => Response) {
  const fetchSpy = vi.fn(async (url: string, _init?: RequestInit) => respond(url));
  vi.stubGlobal('fetch', fetchSpy);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ItsQuarterlyReview obligation={obligation} onClose={() => {}} />
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
  vi.unstubAllGlobals();
});

describe('ItsQuarterlyReview', () => {
  it('shows the cumulative figures by HMRC category, the payload and a sandbox notice', async () => {
    renderReview(happyPath);
    expect(await screen.findByText('£12,000.50')).toBeTruthy();
    expect(screen.getByText('Admin costs')).toBeTruthy();
    expect(screen.getByText(/"turnover": "12000.50"/)).toBeTruthy();
    expect(screen.getByText(/Sandbox mode/)).toBeTruthy();
  });

  it('keeps Submit disabled until the declaration is ticked', async () => {
    renderReview(happyPath);
    const submit = (await screen.findByRole('button', { name: 'Submit to HMRC' })) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit.disabled).toBe(false);
  });

  it('confirms with the declaration, then submits, then shows the receipt', async () => {
    const fetchSpy = renderReview(happyPath);
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit to HMRC' }));
    expect(await screen.findByText('HMRC accepted this update')).toBeTruthy();
    const calls = fetchSpy.mock.calls.map(([url]) => url);
    expect(calls).toEqual([
      '/api/hmrc/its-cumulative-preview',
      '/api/hmrc/its-cumulative-confirm',
      '/api/hmrc/its-cumulative-submit',
    ]);
    const confirmInit = fetchSpy.mock.calls[1][1] as unknown as RequestInit;
    expect(JSON.parse(confirmInit.body as string)).toEqual({ taxYear: '2026-27', quarter: 1, declaration: true });
    expect(screen.queryByRole('button', { name: 'Submit to HMRC' })).toBeNull();
  });

  it('explains a refusal in plain words and lets the owner try again', async () => {
    renderReview((url) =>
      url.endsWith('-submit')
        ? Response.json({ ok: false, code: 'STALE_CONFIRMATION', error: 'Your records changed since you confirmed. Review and confirm again' }, { status: 409 })
        : happyPath(url),
    );
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit to HMRC' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Your records changed since you confirmed');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Submit to HMRC' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('warns not to resubmit when the outcome is unknown', async () => {
    renderReview((url) =>
      url.endsWith('-submit')
        ? Response.json({ ok: false, code: 'OUTCOME_UNKNOWN', error: 'x' }, { status: 502 })
        : happyPath(url),
    );
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit to HMRC' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Do not submit again');
  });

  it('shows an error when the preview cannot load', async () => {
    renderReview(() => Response.json({ ok: false, code: 'NINO_MISSING', error: 'x' }, { status: 409 }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
