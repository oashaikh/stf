// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disconnectBank, fetchBankConnectUrl, fetchBankStatus, type BankStatus } from '../lib/bankApi';
import BankSection from './BankSection';

vi.mock('../lib/bankApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/bankApi')>()),
  fetchBankStatus: vi.fn(),
  fetchBankConnectUrl: vi.fn(),
  disconnectBank: vi.fn(),
}));

const day = 86_400_000;
const linked = (daysLeft: number): BankStatus => ({
  connected: true,
  displayName: 'Business Current',
  maskedAccountNumber: '****1234',
  consentExpiresAt: new Date(Date.now() + daysLeft * day).toISOString(),
});

function renderSection(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/settings${search}`]}>
      <BankSection />
    </MemoryRouter>,
  );
}

describe('BankSection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(cleanup);

  it('offers Connect when no account is linked', async () => {
    vi.mocked(fetchBankStatus).mockResolvedValue({ connected: false, displayName: null, maskedAccountNumber: null, consentExpiresAt: null });
    renderSection();
    expect(await screen.findByRole('button', { name: 'Connect bank account' })).toBeInTheDocument();
  });

  it('shows name, masked number and expiry date for an active connection', async () => {
    vi.mocked(fetchBankStatus).mockResolvedValue(linked(60));
    renderSection();
    expect(await screen.findByText('Business Current')).toBeInTheDocument();
    expect(screen.getByText('****1234')).toBeInTheDocument();
    expect(screen.getByText(/Consent expires/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
  });

  it('warns and offers Reconnect when consent expires within 14 days', async () => {
    vi.mocked(fetchBankStatus).mockResolvedValue(linked(5));
    renderSection();
    expect(await screen.findByText(/expires soon/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  });

  it('shows an expired notice and Reconnect when consent has lapsed', async () => {
    vi.mocked(fetchBankStatus).mockResolvedValue(linked(-2));
    renderSection();
    expect(await screen.findByText(/consent has expired/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  });

  it('shows an error when the status cannot load', async () => {
    vi.mocked(fetchBankStatus).mockRejectedValue(new Error('down'));
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
  });

  it('shows the outcome when returning from the bank', async () => {
    vi.mocked(fetchBankStatus).mockResolvedValue(linked(60));
    renderSection('?bank=error');
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not complete/i);
  });

  it('confirms before disconnecting, then refreshes', async () => {
    vi.mocked(fetchBankStatus)
      .mockResolvedValueOnce(linked(60))
      .mockResolvedValueOnce({ connected: false, displayName: null, maskedAccountNumber: null, consentExpiresAt: null });
    vi.mocked(disconnectBank).mockResolvedValue(undefined);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(disconnectBank).not.toHaveBeenCalled();
    expect(screen.getByText(/stops syncing transactions/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, disconnect' }));
    await waitFor(() => expect(disconnectBank).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Connect bank account' })).toBeInTheDocument();
  });

  it('keeps the connection when disconnect is cancelled', async () => {
    vi.mocked(fetchBankStatus).mockResolvedValue(linked(60));
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep connected' }));
    expect(disconnectBank).not.toHaveBeenCalled();
    expect(screen.getByText('Business Current')).toBeInTheDocument();
  });

  it('sends the owner to the provider consent screen on Connect', async () => {
    vi.mocked(fetchBankStatus).mockResolvedValue({ connected: false, displayName: null, maskedAccountNumber: null, consentExpiresAt: null });
    vi.mocked(fetchBankConnectUrl).mockResolvedValue('https://bank.test/consent');
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect bank account' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://bank.test/consent'));
    vi.unstubAllGlobals();
  });
});
