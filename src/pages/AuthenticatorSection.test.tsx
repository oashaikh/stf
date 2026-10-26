// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuthenticatorSection, { TURN_OFF_WARNING } from './AuthenticatorSection';

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const RECOVERY = ['aaaa-1111', 'bbbb-2222'];

/** Fake server: tracks whether the factor is on and which codes it accepts. */
function mockServer(enabled: boolean) {
  let on = enabled;
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push(`${init.method ?? 'GET'} ${url}`);
    if (!init.method) return reply({ ok: true, enabled: on });
    if (url.endsWith('action=start')) return reply({ ok: true, qrDataUrl: 'data:image/png;base64,AAAA', secret: 'JBSWY3DPEHPK3PXP' });
    const { code } = JSON.parse(init.body as string);
    if (code !== '123456') return reply({ ok: false, code: 'INVALID_CODE' }, 401);
    on = url.endsWith('action=confirm');
    return reply(on ? { ok: true, enabled: true, recoveryCodes: RECOVERY } : { ok: true, enabled: false });
  }));
  return calls;
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AuthenticatorSection', () => {
  it('sets up, confirms, shows recovery codes once and keeps them out of browser storage', async () => {
    mockServer(false);
    render(<AuthenticatorSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up authenticator' }));
    expect(await screen.findByAltText(/QR code/)).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(screen.getByTestId('authenticator-secret')).toHaveTextContent('JBSWY3DPEHPK3PXP');

    type('Code from the app', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on authenticator' }));
    expect(await screen.findByText('aaaa-1111')).toBeInTheDocument();
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toMatch(/aaaa-1111|JBSWY3DPEHPK3PXP/);

    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toBeDisabled();
    fireEvent.click(screen.getByLabelText('I have saved these recovery codes'));
    fireEvent.click(done);
    expect(screen.queryByText('aaaa-1111')).not.toBeInTheDocument();
    expect(screen.getByText('Authenticator is on')).toBeInTheDocument();
  });

  it('copies the recovery codes', async () => {
    mockServer(false);
    render(<AuthenticatorSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up authenticator' }));
    await screen.findByAltText(/QR code/);
    type('Code from the app', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on authenticator' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy codes' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(RECOVERY.join('\n')));
  });

  it('shows an error and stays on the scan step for a wrong code', async () => {
    mockServer(false);
    render(<AuthenticatorSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up authenticator' }));
    await screen.findByAltText(/QR code/);
    type('Code from the app', '000000');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on authenticator' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code was not accepted');
    expect(screen.queryByText('aaaa-1111')).not.toBeInTheDocument();
  });

  it('needs a code to turn off, names the effect, and refuses a wrong code', async () => {
    const calls = mockServer(true);
    render(<AuthenticatorSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off authenticator' }));
    expect(screen.getByText(TURN_OFF_WARNING)).toBeInTheDocument();
    const confirmButton = screen.getAllByRole('button', { name: 'Turn off authenticator' })[0];
    expect(confirmButton).toBeDisabled();

    type('Current code', '000000');
    fireEvent.click(confirmButton);
    expect(await screen.findByRole('alert')).toHaveTextContent('That code was not accepted');
    expect(screen.queryByText('Authenticator is off')).not.toBeInTheDocument();

    type('Current code', '123456');
    fireEvent.click(confirmButton);
    expect(await screen.findByText('Authenticator is off')).toBeInTheDocument();
    expect(calls.filter((call) => call.endsWith('action=disable'))).toHaveLength(2);
  });
});
