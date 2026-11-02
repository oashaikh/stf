// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('public legal pages', () => {
  it.each([
    ['/privacy', 'Privacy policy'],
    ['/terms', 'Terms of use'],
  ])('%s loads without a session and without calling the server', (path, heading) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', path);
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the other pages behind sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response));
    window.history.pushState({}, '', '/vat');
    render(<App />);
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
  });

  it('keeps the Income Tax year end flow behind sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response));
    window.history.pushState({}, '', '/tax/year-end/2026-27');
    render(<App />);
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
  });
});

describe('old addresses', () => {
  it.each([
    ['/dashboard', '/home'],
    ['/invoices', '/money-in'],
    ['/expenses?status=draft', '/money-out?status=draft'],
    ['/expenses?from=2026-08-15#entry-1', '/money-out?from=2026-08-15#entry-1'],
    ['/receipts', '/money-out/receipts'],
    ['/vat', '/tax/vat'],
    ['/reports', '/tax/reports'],
    ['/', '/home'],
    ['/nowhere', '/home'],
  ])('%s lands on %s', async (from, to) => {
    // Only the session probe succeeds; page data requests fail into each page's error state.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({ ok: url === '/api/me', status: url === '/api/me' ? 200 : 500, json: async () => ({}) }) as Response),
    );
    window.history.pushState({}, '', from);
    // A fresh module gives a fresh query cache, so the session answer from an earlier test is not reused.
    vi.resetModules();
    const { default: FreshApp } = await import('./App');
    render(<FreshApp />);
    await screen.findByRole('navigation', { name: 'Main' });
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(to);
  });
});

describe('guided setup', () => {
  async function openAs(path: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({ ok: url === '/api/me', status: url === '/api/me' ? 200 : 500, json: async () => ({}) }) as Response),
    );
    window.history.pushState({}, '', path);
    vi.resetModules();
    const { default: FreshApp } = await import('./App');
    render(<FreshApp />);
    await screen.findByRole('navigation', { name: 'Main' });
  }

  afterEach(() => sessionStorage.clear());

  it('/setup is a page of its own', async () => {
    await openAs('/setup');
    expect(window.location.pathname).toBe('/setup');
  });

  it('sends the user back to /setup when HMRC returns them to settings', async () => {
    sessionStorage.setItem('stf-setup-return', '1');
    await openAs('/settings?hmrc=connected');
    expect(window.location.pathname).toBe('/setup');
    expect(sessionStorage.getItem('stf-setup-return')).toBeNull();
  });

  it('leaves settings alone when the user did not come from setup', async () => {
    await openAs('/settings?hmrc=connected');
    expect(window.location.pathname).toBe('/settings');
  });
});

describe('first sign-in redirect', () => {
  const stateFor = (setup: object) => ({ ok: true, businessType: 'sole_trader', vatRegistered: null, skippedSteps: [], finishedAt: null, ...setup });

  async function openHomeWith(setup: object | 'broken') {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/me') return Response.json({});
        if (url === '/api/settings/setup') return setup === 'broken' ? new Response('', { status: 500 }) : Response.json(stateFor(setup));
        if (url === '/api/settings/vat-number') return Response.json({ masked: null });
        if (url === '/api/hmrc/its-obligations') return Response.json({ obligations: [] });
        if (url.includes('hmrc')) return Response.json({ connected: false });
        if (url.includes('bank')) return Response.json({ connected: false });
        return new Response('', { status: 500 });
      }),
    );
    window.history.pushState({}, '', '/home');
    vi.resetModules();
    const { default: FreshApp } = await import('./App');
    render(<FreshApp />);
    await screen.findByRole('navigation', { name: 'Main' });
  }

  it('sends a user with nothing finished or skipped to /setup', async () => {
    await openHomeWith({});
    await vi.waitFor(() => expect(window.location.pathname).toBe('/setup'));
  });

  it.each([
    ['finished', { finishedAt: '2026-11-01T09:00:00Z' }],
    ['skipped everything', { skippedSteps: ['business_type', 'vat', 'hmrc', 'bank'] }],
  ])('leaves a user who %s on Home', async (_name, setup) => {
    await openHomeWith(setup);
    await screen.findByRole('heading', { name: 'Home' });
    expect(window.location.pathname).toBe('/home');
  });

  it('keeps Home when the setup state cannot be loaded', async () => {
    await openHomeWith('broken');
    expect(await screen.findByText('We could not load your setup to-dos.')).toBeTruthy();
    expect(window.location.pathname).toBe('/home');
  });
});
