// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VatPage from './VatPage';

const fetchVatObligations = vi.fn();
const fetchVatHistory = vi.fn();
const previewVatReturn = vi.fn();
const submitVatReturn = vi.fn();
vi.mock('../lib/hmrc/vatApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/hmrc/vatApi')>()),
  fetchVatObligations: (...args: unknown[]) => fetchVatObligations(...args),
  fetchVatHistory: (...args: unknown[]) => fetchVatHistory(...args),
  previewVatReturn: (...args: unknown[]) => previewVatReturn(...args),
  submitVatReturn: (...args: unknown[]) => submitVatReturn(...args),
}));
vi.mock('../lib/hmrc/settingsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/hmrc/settingsApi')>()),
  fetchHmrcMode: async () => ({ sandbox: true, liveOptIn: false }),
  isEffectivelyLive: () => false,
}));

const zeroBoxes = { box1: 0, box2: 0, box3: 0, box4: 0, box5: 0, box6: 0, box7: 0, box8: 0, box9: 0 };
const review = {
  boxes: zeroBoxes,
  drillDown: Object.fromEntries(Object.keys(zeroBoxes).map((box) => [box, []])),
  drillDownTotals: zeroBoxes,
  status: 'draft',
  confirmedAt: null,
  stale: false,
  submission: null,
};
const fetchMock = vi.fn();

function obligation(periodKey: string, start: string, end: string, status: 'O' | 'F' = 'O') {
  return { periodKey, start, end, due: '2026-11-07', status, overdue: false };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VatPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function returnRequests() {
  return fetchMock.mock.calls.filter(([path]) => String(path).startsWith('/api/vat/return'));
}

describe('VatPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-26T10:00:00Z') });
    fetchVatObligations.mockReset();
    fetchVatHistory.mockReset();
    fetchVatHistory.mockResolvedValue([]);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true, data: review })));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reviews exactly the open obligation, not the calendar quarter', async () => {
    fetchVatObligations.mockResolvedValue([obligation('26C3', '2026-07-01', '2026-09-30')]);
    renderPage();
    await screen.findByText(/Status:/);
    const [path] = returnRequests()[0];
    const params = new URL(String(path), 'http://localhost').searchParams;
    expect(Object.fromEntries(params)).toEqual({ periodKey: '26C3', start: '2026-07-01', end: '2026-09-30' });
    expect(screen.getByText('Period 1 Jul 2026 to 30 Sep 2026')).toBeInTheDocument();
  });

  it('sends the selected obligation with the draft save and the confirmation', async () => {
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      const data = path.startsWith('/api/vat/return?') && !init?.method ? { ...review, status: null } : review;
      return new Response(JSON.stringify({ ok: true, data }));
    });
    fetchVatObligations.mockResolvedValue([obligation('26C3', '2026-07-01', '2026-09-30')]);
    renderPage();
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1].body)).toEqual({ periodKey: '26C3', start: '2026-07-01', end: '2026-09-30' });

    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm return' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path === '/api/vat/return-confirm')).toBe(true));
    const confirm = fetchMock.mock.calls.find(([path]) => path === '/api/vat/return-confirm')!;
    expect(JSON.parse(confirm[1].body)).toEqual({
      periodKey: '26C3', start: '2026-07-01', end: '2026-09-30', declaration: true,
    });
  });

  it('requires a choice between several open obligations and ignores fulfilled ones', async () => {
    fetchVatObligations.mockResolvedValue([
      obligation('26C3', '2026-07-01', '2026-09-30'),
      obligation('26C2', '2026-04-01', '2026-06-30'),
      obligation('26C1', '2026-01-01', '2026-03-31', 'F'),
    ]);
    renderPage();
    const choices = await screen.findAllByRole('radio');
    expect(choices).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Confirm return' })).not.toBeInTheDocument();
    expect(returnRequests()).toHaveLength(0);

    fireEvent.click(choices[1]);
    await screen.findByText(/Status:/);
    const params = new URL(String(returnRequests()[0][0]), 'http://localhost').searchParams;
    expect(params.get('periodKey')).toBe('26C2');
  });

  it('offers no review or submit when no obligation is open', async () => {
    fetchVatObligations.mockResolvedValue([obligation('26C1', '2026-01-01', '2026-03-31', 'F')]);
    renderPage();
    expect(await screen.findByText('No open VAT obligations to file.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm return' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit to HMRC/ })).not.toBeInTheDocument();
    expect(returnRequests()).toHaveLength(0);
  });

  describe('preview of what will be sent', () => {
    const confirmed = { ...review, status: 'confirmed', confirmedAt: '2026-10-25T09:00:00Z' };
    const preview = {
      endpoint: { method: 'POST', url: 'https://test-api.service.hmrc.gov.uk/organisations/vat/XXXXXX789/returns', sandbox: true },
      body: {
        periodKey: '26C3', vatDueSales: 0, vatDueAcquisitions: 0, totalVatDue: 0, vatReclaimedCurrPeriod: 0,
        netVatDue: 0, totalValueSalesExVAT: 0, totalValuePurchasesExVAT: 0, totalValueGoodsSuppliedExVAT: 0,
        totalAcquisitionsExVAT: 0, finalised: true,
      },
      headers: { Authorization: 'Bearer (hidden)' },
    };

    function showReview(data: object) {
      // jsdom has no modal dialog support.
      HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
      HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
      fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true, data })));
      fetchVatObligations.mockResolvedValue([obligation('26C3', '2026-07-01', '2026-09-30')]);
      previewVatReturn.mockReset();
      previewVatReturn.mockResolvedValue(preview);
      submitVatReturn.mockReset();
      submitVatReturn.mockResolvedValue({ formBundleNumber: '1', processingDate: '2026-10-26T10:00:00Z' });
      renderPage();
    }

    it('offers no preview button before the return is confirmed', async () => {
      showReview(review);
      await screen.findByText(/Status:/);
      expect(screen.queryByRole('button', { name: 'Preview what will be sent' })).not.toBeInTheDocument();
    });

    it('replaces the declaration and Confirm return button with the confirmed date', async () => {
      showReview(confirmed);
      expect(await screen.findByText('Confirmed on 25 Oct 2026')).toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Confirm return' })).not.toBeInTheDocument();
    });

    it('shows the boxes, headers and raw JSON of a nil return once confirmed, without submitting', async () => {
      showReview(confirmed);
      fireEvent.click(await screen.findByRole('button', { name: 'Preview what will be sent' }));
      expect(await screen.findByText('Bearer (hidden)')).toBeInTheDocument();
      const sentBoxes = screen.getByRole('table', { name: 'Boxes exactly as they will be sent' });
      expect(within(sentBoxes).getAllByText('£0.00')).toHaveLength(9);
      expect(screen.getByText('Raw JSON')).toBeInTheDocument();
      expect(previewVatReturn).toHaveBeenCalledWith({ periodKey: '26C3', start: '2026-07-01', end: '2026-09-30' });
      expect(submitVatReturn).not.toHaveBeenCalled();
    });

    it('shows the same preview in the submit dialog and still submits from it', async () => {
      showReview(confirmed);
      fireEvent.click(await screen.findByRole('button', { name: 'Submit to HMRC sandbox' }));
      expect(await screen.findByText('Bearer (hidden)')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Submit to sandbox' }));
      await waitFor(() => expect(submitVatReturn).toHaveBeenCalled());
    });

    it('says so when the preview cannot be built', async () => {
      showReview(confirmed);
      previewVatReturn.mockRejectedValue(new Error('boom'));
      fireEvent.click(await screen.findByRole('button', { name: 'Preview what will be sent' }));
      expect(await screen.findByText(/Could not build the preview/)).toBeInTheDocument();
    });
  });
});
