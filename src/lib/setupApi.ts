import { fetchBankStatus } from './bankApi';
import { fetchHmrcStatus, fetchVatNumberMask } from './hmrc/settingsApi';
import type { BusinessType, SetupFacts, SetupState, SetupStepId } from './setupFlow';

/** What the server accepts. There is no finishedAt: the server stamps it when finish is true. */
export interface SetupAnswers {
  businessType?: BusinessType;
  vatRegistered?: boolean;
  skippedSteps?: SetupStepId[];
  finish?: true;
}

async function request(init?: RequestInit): Promise<SetupState> {
  const response = await fetch('/api/settings/setup', { credentials: 'same-origin', ...init }).catch(() => null);
  const body = response ? await response.json().catch(() => null) : null;
  if (!response?.ok || body?.ok !== true) throw new Error('Setup request failed');
  return {
    businessType: body.businessType,
    vatRegistered: body.vatRegistered,
    skippedSteps: body.skippedSteps,
    finishedAt: body.finishedAt,
  };
}

export const fetchSetupState = () => request();

export const saveSetupAnswers = (answers: SetupAnswers) =>
  request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(answers) });

/** Saved answers plus what STF already knows, so known steps can show as done. */
export async function fetchSetupFacts(): Promise<SetupFacts> {
  const [setup, hmrc, bank, vatMask] = await Promise.all([fetchSetupState(), fetchHmrcStatus(), fetchBankStatus(), fetchVatNumberMask()]);
  return { setup, hmrcConnected: hmrc.connected, bankConnected: bank.connected, hasVatNumber: vatMask !== null };
}
