// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { addTrip, fetchMileage, voidTrip } from '../lib/mileageApi';
import MileageSection from './MileageSection';

vi.mock('../lib/mileageApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/mileageApi')>()),
  fetchMileage: vi.fn(),
  addTrip: vi.fn(),
  voidTrip: vi.fn(),
}));

const trip = {
  id: '11111111-1111-4111-8111-111111111111',
  date: '2026-05-01',
  from: 'Office',
  to: 'Client',
  purpose: 'Site visit',
  distanceTenths: 124,
  vehicleType: 'car' as const,
  deletedAt: null,
};
const voided = { ...trip, id: '22222222-2222-4222-8222-222222222222', to: 'Depot', deletedAt: '2026-05-02T00:00:00Z' };
const loaded = { trips: [trip, voided], claim: { totalPence: 558, tripClaims: [{ id: trip.id, claimPence: 558 }] } };

beforeAll(() => {
  // jsdom has no modal dialog support.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderSection() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MileageSection />
    </QueryClientProvider>,
  );
}

describe('MileageSection', () => {
  it('shows the server claim, miles, per-trip claim and a Voided badge', async () => {
    vi.mocked(fetchMileage).mockResolvedValue(loaded);
    renderSection();
    expect(await screen.findByText('£5.58', { selector: 'dd' })).toBeTruthy();
    expect(screen.getAllByText('12.4', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Voided').length).toBeGreaterThan(0);
    expect(screen.getByText(/cannot also claim fuel/)).toBeTruthy();
  });

  it('posts the trip with miles as integer tenths', async () => {
    vi.mocked(fetchMileage).mockResolvedValue(loaded);
    vi.mocked(addTrip).mockResolvedValue();
    renderSection();
    await screen.findByText('£5.58', { selector: 'dd' });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: 'Home' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'Shop' } });
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'Supplies' } });
    fireEvent.change(screen.getByLabelText('Miles'), { target: { value: '12.4' } });
    fireEvent.change(screen.getByLabelText('Vehicle type'), { target: { value: 'motorcycle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add trip' }));
    await waitFor(() =>
      expect(vi.mocked(addTrip).mock.calls[0][0]).toEqual({
        date: '2026-06-01',
        from: 'Home',
        to: 'Shop',
        purpose: 'Supplies',
        distanceTenths: 124,
        vehicleType: 'motorcycle',
      }),
    );
  });

  it('refuses a bad form inline without calling the API', async () => {
    vi.mocked(fetchMileage).mockResolvedValue(loaded);
    renderSection();
    await screen.findByText('£5.58', { selector: 'dd' });
    fireEvent.change(screen.getByLabelText('Miles'), { target: { value: '1.25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add trip' }));
    expect(await screen.findByText(/at most one decimal/)).toBeTruthy();
    expect(screen.getByText('Enter the date of the trip')).toBeTruthy();
    expect(addTrip).not.toHaveBeenCalled();
  });

  it('asks before voiding, names the trip and the claim effect, then voids', async () => {
    vi.mocked(fetchMileage).mockResolvedValue(loaded);
    vi.mocked(voidTrip).mockResolvedValue();
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /Void trip Office to Client/ }));
    const dialog = await screen.findByRole('dialog');
    expect(voidTrip).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/Office to Client/)).toBeTruthy();
    expect(within(dialog).getByText(/claim drops by £5\.58/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Void trip' }));
    await waitFor(() => expect(voidTrip).toHaveBeenCalledWith(trip.id));
  });

  it('shows an error when mileage cannot be loaded', async () => {
    vi.mocked(fetchMileage).mockRejectedValue(new Error('boom'));
    renderSection();
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load mileage');
  });
});
