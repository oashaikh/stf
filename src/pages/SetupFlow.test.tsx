// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupFacts } from '../lib/setupFlow';
import SetupFlow, { ReturnToSetup, SETUP_RETURN_KEY } from './SetupFlow';

const setupApi = vi.hoisted(() => ({ fetchSetupFacts: vi.fn(), saveSetupAnswers: vi.fn() }));
const hmrcApi = vi.hoisted(() => ({ saveVatNumber: vi.fn(), fetchHmrcConnectUrl: vi.fn() }));
const bankApi = vi.hoisted(() => ({ fetchBankConnectUrl: vi.fn() }));
vi.mock('../lib/setupApi', () => setupApi);
vi.mock('../lib/bankApi', () => bankApi);
vi.mock('../lib/hmrc/settingsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/hmrc/settingsApi')>()),
  ...hmrcApi,
}));

const newUser: SetupFacts = {
  setup: { businessType: 'sole_trader', vatRegistered: null, skippedSteps: [], finishedAt: null },
  hmrcConnected: false,
  bankConnected: false,
  hasVatNumber: false,
};
const withSetup = (overrides: Partial<SetupFacts['setup']>, rest: Partial<SetupFacts> = {}): SetupFacts => ({
  ...newUser,
  ...rest,
  setup: { ...newUser.setup, ...overrides },
});

function renderFlow() {
  return render(
    <MemoryRouter initialEntries={['/setup']}>
      <Routes>
        <Route path="/setup" element={<SetupFlow />} />
        <Route path="/home" element={<p>Home page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const userEvent = {
  click: async (element: HTMLElement) => void fireEvent.click(element),
  type: async (element: HTMLElement, text: string) => void fireEvent.change(element, { target: { value: text } }),
  clear: async (element: HTMLElement) => void fireEvent.change(element, { target: { value: '' } }),
};

const assign = vi.fn();
beforeEach(() => {
  vi.stubGlobal('location', { ...window.location, assign });
  setupApi.saveSetupAnswers.mockImplementation(async (answers) => ({ ...newUser.setup, ...answers }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('each step on its own', () => {
  it.each([
    [newUser, 'Step 1 of 4', 'What kind of business do you run?'],
    [withSetup({ vatRegistered: false }, { hasVatNumber: false }), 'Step 3 of 4', 'Connect to HMRC'],
    [withSetup({ vatRegistered: false }, { hmrcConnected: true }), 'Step 4 of 4', 'Connect your bank'],
  ])('opens at the first unfinished step (%#)', async (facts, progress, title) => {
    setupApi.fetchSetupFacts.mockResolvedValue(facts);
    renderFlow();
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(progress)).toBeInTheDocument();
    for (const name of ['Back', 'Save and leave', 'Skip for now']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('shows the VAT question as step 2 after the business type', async () => {
    setupApi.fetchSetupFacts.mockResolvedValue(newUser);
    renderFlow();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Are you registered for VAT?' })).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
    expect(setupApi.saveSetupAnswers).toHaveBeenCalledWith({ businessType: 'sole_trader' });
  });

  it('shows a confirm state for a step that is already filled in', async () => {
    setupApi.fetchSetupFacts.mockResolvedValue(withSetup({ vatRegistered: false }));
    renderFlow();
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByText(/You told us you are not registered for VAT/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});

describe('VAT step', () => {
  const atVatStep = withSetup({ vatRegistered: null }, {});
  async function openVat() {
    setupApi.fetchSetupFacts.mockResolvedValue(atVatStep);
    renderFlow();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await screen.findByText('Step 2 of 4');
  }

  it('records "not registered" through the setup API', async () => {
    await openVat();
    await userEvent.click(screen.getByRole('radio', { name: 'No' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(setupApi.saveSetupAnswers).toHaveBeenCalledWith({ vatRegistered: false });
    expect(await screen.findByText('Step 3 of 4')).toBeInTheDocument();
  });

  it('saves a valid VAT number and refuses a bad one with plain words', async () => {
    const { VatNumberRefusedError } = await import('../lib/hmrc/settingsApi');
    await openVat();
    await userEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    hmrcApi.saveVatNumber.mockRejectedValueOnce(new VatNumberRefusedError('BAD_REQUEST'));
    await userEvent.type(screen.getByLabelText('Your VAT number'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Enter 9 digits. A leading GB and spaces are fine.')).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();

    hmrcApi.saveVatNumber.mockResolvedValueOnce('•••••6789');
    await userEvent.clear(screen.getByLabelText('Your VAT number'));
    await userEvent.type(screen.getByLabelText('Your VAT number'), 'GB 123 456 789');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(hmrcApi.saveVatNumber).toHaveBeenLastCalledWith('GB 123 456 789');
    await waitFor(() => expect(setupApi.saveSetupAnswers).toHaveBeenCalledWith({ vatRegistered: true }));
    expect(await screen.findByText('Step 3 of 4')).toBeInTheDocument();
  });
});

describe('skip and leave', () => {
  it('Skip for now saves the step as skipped and moves on', async () => {
    setupApi.fetchSetupFacts.mockResolvedValue(withSetup({ vatRegistered: false }));
    renderFlow();
    await userEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(setupApi.saveSetupAnswers).toHaveBeenCalledWith({ skippedSteps: ['hmrc'] });
    expect(await screen.findByText('Step 4 of 4')).toBeInTheDocument();
  });

  it('Save and leave saves progress and goes to Home', async () => {
    setupApi.fetchSetupFacts.mockResolvedValue(newUser);
    renderFlow();
    await userEvent.click(await screen.findByRole('radio', { name: /I run a limited company/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save and leave' }));
    expect(setupApi.saveSetupAnswers).toHaveBeenCalledWith({ businessType: 'limited_company', skippedSteps: [] });
    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });

  it('finishes the setup from the closing screen after the last step is skipped', async () => {
    setupApi.fetchSetupFacts.mockResolvedValue(withSetup({ vatRegistered: false }, { hmrcConnected: true }));
    renderFlow();
    await userEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'You are all set' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Go to Home' }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(setupApi.saveSetupAnswers).toHaveBeenLastCalledWith({ finish: true });
  });

  it('moves focus to the new step heading and only mentions skipped steps when there are some', async () => {
    setupApi.fetchSetupFacts.mockResolvedValue(withSetup({ vatRegistered: false }, { hmrcConnected: true, bankConnected: true }));
    renderFlow();
    const heading = await screen.findByRole('heading', { level: 1, name: 'You are all set' });
    expect(heading).toHaveFocus();
    expect(screen.queryByText(/Anything you skipped/)).not.toBeInTheDocument();
  });

  it('tells the user when saving failed and stays on the step', async () => {
    setupApi.fetchSetupFacts.mockResolvedValue(newUser);
    setupApi.saveSetupAnswers.mockRejectedValue(new Error('down'));
    renderFlow();
    await userEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i);
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
  });
});

describe('connect steps', () => {
  it('HMRC: shows test mode, no live control, and sets the return marker before leaving', async () => {
    setupApi.fetchSetupFacts.mockResolvedValue(withSetup({ vatRegistered: false }));
    hmrcApi.fetchHmrcConnectUrl.mockResolvedValue('https://hmrc.example/authorise');
    renderFlow();
    expect(await screen.findByText(/Test mode/)).toBeInTheDocument();
    expect(screen.queryByText(/live/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://hmrc.example/authorise'));
    expect(sessionStorage.getItem(SETUP_RETURN_KEY)).toBe('1');
  });

  it('bank: connects through the existing helper and sets the return marker', async () => {
    setupApi.fetchSetupFacts.mockResolvedValue(withSetup({ vatRegistered: false }, { hmrcConnected: true }));
    bankApi.fetchBankConnectUrl.mockResolvedValue('https://bank.example/consent');
    renderFlow();
    await userEvent.click(await screen.findByRole('button', { name: 'Connect your bank' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://bank.example/consent'));
    expect(sessionStorage.getItem(SETUP_RETURN_KEY)).toBe('1');
  });

  it('sets no marker when the connect address cannot be fetched', async () => {
    setupApi.fetchSetupFacts.mockResolvedValue(withSetup({ vatRegistered: false }, { hmrcConnected: true }));
    bankApi.fetchBankConnectUrl.mockRejectedValue(new Error('down'));
    renderFlow();
    await userEvent.click(await screen.findByRole('button', { name: 'Connect your bank' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(sessionStorage.getItem(SETUP_RETURN_KEY)).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('plain words', () => {
  it('uses no banned word outside small official-name text on any step', async () => {
    const banned = /ledger|posting|journal|nominal|chart of accounts|reconcil|obligation|period key|submit|payload|endpoint|sync|token|Box \d/i;
    const facts = [newUser, withSetup({ vatRegistered: false }), withSetup({ vatRegistered: false }, { hmrcConnected: true })];
    for (const state of facts) {
      setupApi.fetchSetupFacts.mockResolvedValue(state);
      const { container, unmount } = renderFlow();
      await screen.findByText(/Step \d of 4/);
      container.querySelectorAll('small').forEach((element) => element.remove());
      expect(container.textContent).not.toMatch(banned);
      unmount();
    }
  });
});

describe('load failure', () => {
  it('shows a retry message', async () => {
    setupApi.fetchSetupFacts.mockRejectedValueOnce(new Error('down'));
    renderFlow();
    const message = await screen.findByRole('alert');
    expect(within(message).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('ReturnToSetup', () => {
  afterEach(() => sessionStorage.clear());

  it('clears the marker when the callback lands on /setup itself, so a later visit to Home is not bounced back', () => {
    sessionStorage.setItem(SETUP_RETURN_KEY, '1');
    render(<MemoryRouter initialEntries={['/setup']}><ReturnToSetup /></MemoryRouter>);
    expect(sessionStorage.getItem(SETUP_RETURN_KEY)).toBeNull();
  });
});
