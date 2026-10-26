// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeHmrcStatus,
  fetchHmrcConnectUrl,
  fetchHmrcConnected,
  saveHmrcLiveOptIn,
} from '../lib/hmrc/settingsApi';
import SettingsPage, { LIVE_CONFIRMATION_TEXT } from './SettingsPage';


function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe('describeHmrcStatus', () => {
  it('says connected when HMRC is linked', () => {
    expect(describeHmrcStatus(true, null)).toEqual({ label: 'Connected to HMRC', tone: 'connected' });
  });

  it('says not connected when it is not', () => {
    expect(describeHmrcStatus(false, null).label).toBe('Not connected');
  });

  it('reports a failed callback', () => {
    expect(describeHmrcStatus(false, 'error').label).toBe('HMRC connection failed. Please try again.');
  });
});

describe('HMRC api calls', () => {
  it('sends the session cookie to the status route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, connected: true }));
    expect(await fetchHmrcConnected(fetchMock)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/hmrc/status', { credentials: 'same-origin' });
  });

  it('returns the authorize url from the connect route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, url: 'https://hmrc.test/auth' }));
    expect(await fetchHmrcConnectUrl(fetchMock)).toBe('https://hmrc.test/auth');
    expect(fetchMock).toHaveBeenCalledWith('/api/hmrc/connect', { credentials: 'same-origin' });
  });

  it('throws when the connect route refuses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: false }, false));
    await expect(fetchHmrcConnectUrl(fetchMock)).rejects.toThrow();
  });
});

describe('live filing opt-in', () => {
  const posts: unknown[] = [];
  let liveOptIn = false;

  // Fake backend: the page only talks to these three routes.
  beforeEach(() => {
    posts.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        if (path === '/api/hmrc/mode' && init?.method === 'POST') {
          const body = JSON.parse(init.body as string);
          posts.push(body);
          return jsonResponse({ ok: true, live: body.live, envLive: true });
        }
        if (path === '/api/hmrc/mode') return jsonResponse({ ok: true, live: liveOptIn, envLive: true });
        return jsonResponse({ ok: true, connected: true });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    liveOptIn = false;
  });

  const renderPage = () =>
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

  it('starts off and shows sandbox as the effective mode', async () => {
    renderPage();
    expect(await screen.findByRole('checkbox', { name: /allow live filing/i })).not.toBeChecked();
    expect(screen.getByText('Sandbox (test)')).toBeInTheDocument();
  });

  it('needs the confirmation text before switching on', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: /allow live filing/i }));
    const confirm = screen.getByRole('button', { name: 'Turn on live filing' });
    expect(confirm).toBeDisabled();
    expect(posts).toEqual([]);

    fireEvent.change(screen.getByLabelText('Confirmation text'), { target: { value: LIVE_CONFIRMATION_TEXT } });
    fireEvent.click(confirm);
    await waitFor(() => expect(posts).toEqual([{ live: true }]));
    expect(await screen.findByText('Live')).toBeInTheDocument();
  });

  it('switches off without confirmation', async () => {
    liveOptIn = true;
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: /allow live filing/i }));
    await waitFor(() => expect(posts).toEqual([{ live: false }]));
  });
});

describe('HMRC mode api calls', () => {
  it('posts a boolean to the mode route with the session cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, live: true, envLive: false }));
    expect(await saveHmrcLiveOptIn(true, fetchMock)).toEqual({ live: true, envLive: false });
    expect(fetchMock).toHaveBeenCalledWith('/api/hmrc/mode', expect.objectContaining({ method: 'POST', body: '{"live":true}' }));
  });
});
