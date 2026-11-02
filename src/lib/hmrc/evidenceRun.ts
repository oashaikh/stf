/**
 * Step list and note rendering for the HMRC sandbox evidence run (scripts/hmrcSandboxEvidence.ts).
 * Every HMRC call goes through client.ts; this file only sequences them and records pass or fail.
 * Pure apart from the injected fetch, so unit tests run it against a fake.
 */

import type { AnnualSubmission } from '../itsAnnualSubmission.js';
import {
  getAdjustableSummary,
  getApplicationToken,
  getItsFinalDeclarationObligations,
  getItsIncomeAndExpenditureObligations,
  getTaxCalculation,
  getTaxLiabilityAdjustments,
  getVatObligations,
  getVatReturn,
  HmrcError,
  listItsSelfEmploymentBusinesses,
  submitAnnualSubmission,
  submitCumulativePeriodSummary,
  submitFinalDeclaration,
  submitPropertyAnnualSubmission,
  submitPropertyCumulativeSummary,
  submitVatReturn,
  triggerAdjustableSummary,
  triggerTaxCalculation,
  validateFraudHeaders,
  type VatReturnPayload,
} from './client.js';

const SANDBOX_BASE = 'https://test-api.service.hmrc.gov.uk';

export type EvidenceContext = {
  fetchFn: typeof fetch;
  fraudHeaders: Record<string, string>;
  vat: { vrn: string; accessToken: string };
  its: { nino: string; accessToken: string };
  taxYear: string;
};

export type StepResult = { name: string; endpoint: string; ok: boolean; detail: string };

export type TestUserIds = {
  organisationUserId: string;
  individualUserId: string;
  vrn: string;
  nino: string;
};

/** Sign-in details HMRC returns once; the script keeps them in a local ignored file, never in the note. */
export type CreatedTestUsers = TestUserIds & { passwords: { organisation: string; individual: string } };

export function maskNino(nino: string): string {
  return `${nino.slice(0, 2)}****${nino.slice(-3)}`;
}

async function createTestUser<T>(
  path: 'organisations' | 'individuals',
  serviceNames: string[],
  appToken: string,
  fetchFn: typeof fetch,
): Promise<T> {
  const response = await fetchFn(`${SANDBOX_BASE}/create-test-user/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${appToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceNames }),
  });
  if (!response.ok) throw new Error(`HMRC create test user (${path}) failed (${response.status})`);
  return (await response.json()) as T;
}

/** An organisation with VAT (MTD) and an individual with MTD Income Tax. */
export async function createTestUsers(fetchFn: typeof fetch): Promise<CreatedTestUsers> {
  const appToken = await getApplicationToken(fetchFn);
  const organisation = await createTestUser<{ userId: string; password: string; vrn: string }>(
    'organisations', ['mtd-vat'], appToken, fetchFn,
  );
  const individual = await createTestUser<{ userId: string; password: string; nino: string }>(
    'individuals', ['national-insurance', 'self-assessment', 'mtd-income-tax'], appToken, fetchFn,
  );
  return {
    organisationUserId: organisation.userId,
    individualUserId: individual.userId,
    vrn: organisation.vrn,
    nino: individual.nino,
    passwords: { organisation: organisation.password, individual: individual.password },
  };
}

function describeFailure(error: unknown): string {
  // Only the HMRC code and status: response text and messages could echo request data.
  if (error instanceof HmrcError) return `${error.apiError.code} (${error.apiError.statusCode})`;
  return error instanceof Error ? error.message : 'unknown error';
}

const VAT_RETURN: Omit<VatReturnPayload, 'periodKey'> = {
  vatDueSales: 100, vatDueAcquisitions: 0, totalVatDue: 100, vatReclaimedCurrPeriod: 20, netVatDue: 80,
  totalValueSalesExVAT: 500, totalValuePurchasesExVAT: 100, totalValueGoodsSuppliedExVAT: 0,
  totalAcquisitionsExVAT: 0, finalised: true,
};

const ANNUAL_SUBMISSION: AnnualSubmission = { allowances: { tradingIncomeAllowance: '1000.00' } };

export async function runEvidenceSteps(context: EvidenceContext): Promise<StepResult[]> {
  const { fetchFn, fraudHeaders: headers, vat, its, taxYear } = context;
  const [startYear] = taxYear.split('-');
  const quarter = { start: `${startYear}-04-06`, end: `${startYear}-07-05` };
  const results: StepResult[] = [];
  const state: { periodKey?: string; seId?: string; propertyId?: string; calculationId?: string; bsasId?: string } = {};

  const need = (value: string | undefined, what: string): string => {
    if (!value) throw new Error(`needs ${what} from an earlier step`);
    return value;
  };
  const step = async (name: string, endpoint: string, run: () => Promise<string>) => {
    try {
      results.push({ name, endpoint, ok: true, detail: await run() });
    } catch (error) {
      results.push({ name, endpoint, ok: false, detail: describeFailure(error) });
    }
  };

  await step('Fraud prevention headers validated', 'GET /test/fraud-prevention-headers/validate', async () => {
    const validation = await validateFraudHeaders(headers, fetchFn);
    if (validation.errors.length > 0) throw new Error(`${validation.code}: ${validation.errors.length} header error(s)`);
    return `${validation.code}, ${validation.warnings.length} warning(s)`;
  });

  await step('VAT obligations', `GET /organisations/vat/{vrn}/obligations`, async () => {
    const { obligations } = await getVatObligations(vat.vrn, vat.accessToken, '2017-04-06', '2017-12-31', headers, fetchFn);
    state.periodKey = obligations.find((o) => o.status === 'O')?.periodKey;
    return `${obligations.length} obligation(s)`;
  });
  await step('VAT return submitted', 'POST /organisations/vat/{vrn}/returns', async () => {
    const periodKey = need(state.periodKey, 'an open VAT period');
    await submitVatReturn(vat.vrn, vat.accessToken, { ...VAT_RETURN, periodKey }, headers, fetchFn);
    return `period ${periodKey}`;
  });
  await step('VAT return retrieved', 'GET /organisations/vat/{vrn}/returns/{periodKey}', async () => {
    await getVatReturn(vat.vrn, need(state.periodKey, 'an open VAT period'), vat.accessToken, headers, fetchFn);
    return 'returned';
  });

  await step('Income Tax business details', 'GET /individuals/business/details/{nino}/list', async () => {
    const { businessDetails } = await listItsSelfEmploymentBusinesses(its.nino, its.accessToken, headers, fetchFn);
    state.seId = businessDetails.find((b) => b.typeOfBusiness === 'self-employment')?.businessId;
    state.propertyId = businessDetails.find((b) => b.typeOfBusiness === 'uk-property')?.businessId;
    if (!state.seId || !state.propertyId) throw new Error('test user lacks a self-employment or UK property business');
    return '1 self-employment, 1 UK property';
  });
  await step('Quarterly update obligations', 'GET /obligations/details/{nino}/income-and-expenditure', async () => {
    const { obligations } = await getItsIncomeAndExpenditureObligations(
      its.nino, need(state.seId, 'a business id'), `${startYear}-04-06`, `${Number(startYear) + 1}-04-05`,
      its.accessToken, headers, fetchFn,
    );
    return `${obligations.length} business(es)`;
  });
  await step('Final declaration obligations', 'GET /obligations/details/{nino}/crystallisation', async () => {
    const { obligations } = await getItsFinalDeclarationObligations(
      its.nino, `${startYear}-04-06`, `${Number(startYear) + 1}-04-05`, its.accessToken, headers, fetchFn,
    );
    return `${obligations.length} obligation(s)`;
  });

  await step('Self-employment quarterly update', 'PUT /individuals/business/self-employment/{nino}/{businessId}/cumulative/{taxYear}', async () => {
    await submitCumulativePeriodSummary(
      its.nino, need(state.seId, 'a business id'), taxYear,
      {
        periodDates: { periodStartDate: quarter.start, periodEndDate: quarter.end },
        periodIncome: { turnover: '1000.00', other: '0.00' },
        periodExpenses: { adminCosts: '100.00' },
      },
      its.accessToken, headers, fetchFn,
    );
    return 'accepted';
  });
  await step('Self-employment annual submission', 'PUT /individuals/business/self-employment/{nino}/{businessId}/annual/{taxYear}', async () => {
    await submitAnnualSubmission(
      its.nino, need(state.seId, 'a business id'), taxYear,
      ANNUAL_SUBMISSION,
      its.accessToken, headers, fetchFn,
    );
    return 'accepted';
  });
  await step('UK property quarterly update', 'PUT /individuals/business/property/uk/{nino}/{businessId}/cumulative/{taxYear}', async () => {
    await submitPropertyCumulativeSummary(
      its.nino, need(state.propertyId, 'a property business id'), taxYear,
      { fromDate: quarter.start, toDate: quarter.end, ukProperty: { income: { periodAmount: 1200 }, expenses: { other: 100 } } },
      its.accessToken, headers, fetchFn,
    );
    return 'accepted';
  });
  await step('UK property annual submission', 'PUT /individuals/business/property/uk/{nino}/{businessId}/annual/{taxYear}', async () => {
    await submitPropertyAnnualSubmission(
      its.nino, need(state.propertyId, 'a property business id'), taxYear,
      { ukProperty: { allowances: { propertyIncomeAllowance: 1000 } } },
      its.accessToken, headers, fetchFn,
    );
    return 'accepted';
  });

  await step('Adjustable summary requested', 'POST /individuals/self-assessment/adjustable-summary/{nino}/trigger', async () => {
    const { calculationId } = await triggerAdjustableSummary(
      its.nino,
      { businessId: need(state.seId, 'a business id'), startDate: `${startYear}-04-06`, endDate: `${Number(startYear) + 1}-04-05` },
      its.accessToken, headers, fetchFn,
    );
    state.bsasId = calculationId;
    return 'triggered';
  });
  await step('Adjustable summary retrieved', 'GET /individuals/self-assessment/adjustable-summary/{nino}/self-employment/{calculationId}', async () => {
    await getAdjustableSummary(its.nino, need(state.bsasId, 'a summary id'), its.accessToken, headers, fetchFn);
    return 'returned';
  });
  await step('Tax liability adjustments', 'GET /individuals/tax-liability-adjustments/{nino}/{taxYear}', async () => {
    const adjustments = await getTaxLiabilityAdjustments(its.nino, taxYear, its.accessToken, headers, fetchFn);
    return `${adjustments.length} adjustment(s)`;
  });

  await step('Tax calculation triggered', 'POST /individuals/calculations/{nino}/self-assessment/{taxYear}/trigger/intent-to-finalise', async () => {
    state.calculationId = (await triggerTaxCalculation(its.nino, taxYear, its.accessToken, headers, fetchFn)).calculationId;
    return 'triggered';
  });
  await step('Tax calculation retrieved', 'GET /individuals/calculations/{nino}/self-assessment/{taxYear}/{calculationId}', async () => {
    await getTaxCalculation(its.nino, taxYear, need(state.calculationId, 'a calculation id'), its.accessToken, headers, fetchFn);
    return 'returned';
  });
  await step('Final declaration', 'POST /individuals/calculations/{nino}/self-assessment/{taxYear}/{calculationId}/final-declaration', async () => {
    await submitFinalDeclaration(its.nino, taxYear, need(state.calculationId, 'a calculation id'), its.accessToken, headers, fetchFn);
    return 'accepted';
  });

  return results;
}

export function renderEvidenceNote(input: { date: string; users: TestUserIds; results: StepResult[] }): string {
  const { date, users, results } = input;
  const failed = results.filter((r) => !r.ok).length;
  const rows = results.map((r) => `| ${r.ok ? 'PASS' : 'FAIL'} | ${r.name} | \`${r.endpoint}\` | ${r.detail} |`);
  return [
    `# HMRC sandbox run, ${date}`,
    '',
    `${results.length - failed} of ${results.length} steps passed. Run against the HMRC test API only.`,
    '',
    '## Test users',
    '',
    `- Organisation (VAT): user id ${users.organisationUserId}, VRN ${users.vrn}`,
    `- Individual (Income Tax): user id ${users.individualUserId}, NINO ${maskNino(users.nino)}`,
    '',
    '## Steps',
    '',
    '| Result | Step | Endpoint | Detail |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}
