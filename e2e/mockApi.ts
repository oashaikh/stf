import type { Page, Route } from '@playwright/test';

// Pence, as the app holds them. The return is built from the entries saved through the form, on top of a fixed
// purchases-only base, so the figures move the way the real ledger does.
const period = { periodKey: '26A1', start: '2026-04-01', end: '2026-06-30' };
const baseBox4 = 4500;
const baseBox7 = 22500;
// Invented Income Tax dates for the Tax page: one fulfilled and one next-due quarterly update, plus the final declaration.
export const mockItsObligations = [
  { kind: 'quarterly', taxYear: '2026-27', periodStart: '2026-04-06', periodEnd: '2026-07-05', dueDate: '2026-08-05', status: 'fulfilled', receivedDate: '2026-07-20', overdue: false, nextDue: false },
  { kind: 'quarterly', taxYear: '2026-27', periodStart: '2026-07-06', periodEnd: '2026-10-05', dueDate: '2026-11-05', status: 'open', receivedDate: null, overdue: false, nextDue: true },
  { kind: 'finalDeclaration', taxYear: '2025-26', periodStart: '2025-04-06', periodEnd: '2026-04-05', dueDate: '2027-01-31', status: 'open', receivedDate: null, overdue: false, nextDue: false },
];

// Home shows an open quarterly update only inside 30 days; a new user has none yet, and "nothing due" has the next one far off.
function itsRowsFor(homeState: MockHomeState) {
  if (homeState === 'new-user') return [];
  if (homeState === 'nothing-due') return mockItsObligations.map((row) => (row.nextDue ? { ...row, dueDate: '2027-02-05' } : row));
  return mockItsObligations;
}

const expenseAccount = { id: 'acc-expense-1', code: '7000', name: 'Office costs', accountType: 'expense', taxCategory: 'allowable', isSystem: true };
const incomeAccount = { id: 'acc-income-1', code: '4000', name: 'Sales', accountType: 'income', taxCategory: 'turnover', isSystem: true };

interface SavedEntry {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  status: 'draft' | 'confirmed';
  kind: 'income' | 'expense';
  grossPence: number;
  netPence: number;
  vatPence: number;
}

interface NewEntryBody {
  date: string;
  description: string;
  reference?: string;
  kind: 'income' | 'expense';
  amountPence: number;
  amountIs: 'gross' | 'net';
  vatRatePercent: number;
}

function saveEntry(body: NewEntryBody, id: string): SavedEntry {
  const netPence = body.amountIs === 'net' ? body.amountPence : Math.round((body.amountPence * 100) / (100 + body.vatRatePercent));
  const vatPence = body.amountIs === 'net' ? Math.round((body.amountPence * body.vatRatePercent) / 100) : body.amountPence - netPence;
  return { id, date: body.date, description: body.description, reference: body.reference ?? null, status: 'draft', kind: body.kind, grossPence: netPence + vatPence, netPence, vatPence };
}

function vatReturn(entries: SavedEntry[]) {
  // Like the real ledger loader, only confirmed entries count; a draft does not reach the return.
  const sales = entries.filter((entry) => entry.status === 'confirmed' && entry.kind === 'income' && entry.date >= period.start && entry.date <= period.end);
  const box1 = sales.reduce((sum, entry) => sum + entry.vatPence, 0);
  const box6 = sales.reduce((sum, entry) => sum + entry.netPence, 0);
  const boxes = { box1, box2: 0, box3: box1, box4: baseBox4, box5: box1 - baseBox4, box6, box7: baseBox7, box8: 0, box9: 0 };
  const lines = sales.map((entry) => ({
    lineId: `line-${entry.id}`,
    transactionId: entry.id,
    date: entry.date,
    amountPence: entry.netPence,
    vatPence: entry.vatPence,
    description: entry.description,
  }));
  const drillDown = { box1: lines, box2: [], box3: [], box4: [], box5: [], box6: lines, box7: [], box8: [], box9: [] };
  const drillDownTotals = { ...boxes, box1: lines.length, box6: lines.length };
  return { boxes, drillDown, drillDownTotals, // The fixed base figures stand for two ledger entries, so the count agrees with the boxes.
  entryCount: entries.length + 2 };
}

// The server sends the preview in pounds.
const pounds = (pence: number) => pence / 100;

function previewBody(entries: SavedEntry[]) {
  const { boxes } = vatReturn(entries);
  return {
    periodKey: period.periodKey,
    vatDueSales: pounds(boxes.box1),
    vatDueAcquisitions: 0,
    totalVatDue: pounds(boxes.box3),
    vatReclaimedCurrPeriod: pounds(boxes.box4),
    netVatDue: pounds(Math.abs(boxes.box5)),
    totalValueSalesExVAT: pounds(boxes.box6),
    totalValuePurchasesExVAT: pounds(boxes.box7),
    totalValueGoodsSuppliedExVAT: 0,
    totalAcquisitionsExVAT: 0,
    finalised: true,
  };
}

// Invented values; the QR is a plain placeholder square, not a scannable code.
export const mockMfaCode = '123456';
const mockRecoveryCodes = ['aaaa-1111', 'bbbb-2222', 'cccc-3333', 'dddd-4444', 'eeee-5555', 'ffff-6666', 'gggg-7777', 'hhhh-8888'];
const mockQr = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="#fff"/><rect x="16" y="16" width="160" height="160" fill="#111"/><rect x="48" y="48" width="96" height="96" fill="#fff"/></svg>')}`;

const sampleInvoiceRow = {
  id: 'inv-1',
  publicNumber: 'INV-0042',
  clientName: 'Example Client Ltd',
  issueDate: '2026-10-01',
  dueDate: '2026-10-31',
  status: 'sent',
  totalPence: 170_000,
};

const sampleInvoice = {
  ...sampleInvoiceRow,
  clientEmail: 'accounts@example.test',
  clientAddress: '1 Example Road\nSampletown',
  subtotalPence: 150_000,
  vatPence: 20_000,
  notes: 'Thanks for your business',
  lines: [
    { id: 'l1', description: 'Consulting', quantity: 15_000, unitPricePence: 100_000, vatRatePercent: 20, subtotalPence: 100_000, vatPence: 20_000, totalPence: 120_000 },
    { id: 'l2', description: 'Printed manual', quantity: 10_000, unitPricePence: 50_000, vatRatePercent: 0, subtotalPence: 50_000, vatPence: 0, totalPence: 50_000 },
  ],
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });

/** The VAT page states the journey must cope with on live data: no open obligation, an unreviewed return, a confirmed one, a filed one. */
export type MockVatState = 'none' | 'draft' | 'confirmed' | 'filed';
export const mockVatStates: MockVatState[] = ['none', 'draft', 'confirmed', 'filed'];

/** What Home has to say: a new user with nothing connected, jobs due (one overdue), or nothing due soon. */
export type MockHomeState = 'new-user' | 'items-due' | 'nothing-due';

const DAY_MS = 86_400_000;

const filedReceipt = { formBundleNumber: '000000000000', processingDate: '2026-07-02T09:00:00Z', sandbox: true };

function mockReturn(vatState: MockVatState, entries: SavedEntry[]) {
  const confirmed = vatState === 'confirmed' || vatState === 'filed';
  return {
    ...vatReturn(entries),
    status: confirmed ? 'confirmed' : 'draft',
    confirmedAt: confirmed ? '2026-07-01T09:00:00Z' : null,
    stale: false,
    submission: vatState === 'filed' ? filedReceipt : null,
  };
}

/** A fake of the deployed API, so the journey can run against a built preview with no server behind it. */
export async function mockApi(page: Page, ownerPassword: string, vatState: MockVatState = 'confirmed', homeState: MockHomeState = 'items-due') {
  const newUser = homeState === 'new-user';
  let signedIn = false;
  // A new user has answered nothing and connected nothing; everyone else is past setup, so the other journeys land on Home.
  let setup = newUser
    ? { businessType: 'sole_trader', vatRegistered: null as boolean | null, skippedSteps: [] as string[], finishedAt: null as string | null }
    : { businessType: 'sole_trader', vatRegistered: true as boolean | null, skippedSteps: [] as string[], finishedAt: '2026-10-01T09:00:00.000Z' as string | null };
  let hmrcConnected = !newUser;
  let bankConnected = false;
  // Invented bank lines for the Bank page's "Sort your bank payments"; a sorted line leaves the list.
  let unsortedBankLines = [
    { id: 'line-1', date: '2026-10-12', amountPence: 12000, description: 'Example Client Ltd' },
    { id: 'line-2', date: '2026-10-15', amountPence: -4599, description: 'Example Stationery' },
    { id: 'line-3', date: '2026-10-20', amountPence: -1250, description: 'Example Train Co' },
  ];
  let vatNumberSaved = !newUser;
  const entries: SavedEntry[] = [];
  const templates: Array<Record<string, unknown>> = [];
  let authenticatorEnabled = false;
  let codePending = false;
  let itsSent = false;
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    switch (key) {
      case 'GET /api/me':
        return json(route, { ok: signedIn }, signedIn ? 200 : 401);
      case 'POST /api/auth/login':
        {
          const passwordOk = request.postDataJSON().password === ownerPassword;
          codePending = passwordOk && authenticatorEnabled;
          signedIn = passwordOk && !authenticatorEnabled;
          if (codePending) return json(route, { ok: true, mfaRequired: true });
          return json(route, { ok: signedIn }, signedIn ? 200 : 401);
        }
      case 'POST /api/auth/mfa':
        if (!codePending || request.postDataJSON().code !== mockMfaCode) return json(route, { ok: false, error: 'Invalid code' }, 401);
        codePending = false;
        signedIn = true;
        return json(route, { ok: true });
      case 'POST /api/auth/logout':
        signedIn = false;
        return json(route, { ok: true });
      case 'GET /api/settings/authenticator':
        return json(route, { ok: true, enabled: authenticatorEnabled });
      case 'POST /api/settings/authenticator': {
        const action = new URL(request.url()).searchParams.get('action');
        if (action === 'start') {
          return json(route, { ok: true, otpauthUri: 'otpauth://totp/STF?secret=MOCKSECRETMOCK234', qrDataUrl: mockQr, secret: 'MOCKSECRETMOCK234' });
        }
        if (request.postDataJSON().code !== mockMfaCode) return json(route, { ok: false, error: 'Invalid code' }, 401);
        authenticatorEnabled = action === 'confirm';
        return json(route, authenticatorEnabled ? { ok: true, enabled: true, recoveryCodes: mockRecoveryCodes } : { ok: true, enabled: false });
      }
      case 'GET /api/settings/business-profile':
        return json(route, {
          profile: { businessName: null, businessAddress: null, paymentBankName: null, paymentSortCode: null, paymentAccountNumber: null, invoicePrefix: 'INV-', nextInvoiceNumber: 1 },
        });
      case 'GET /api/settings/setup':
        return json(route, { ok: true, ...setup });
      case 'POST /api/settings/setup': {
        const answers = request.postDataJSON();
        const { finish, ...saved } = answers;
        setup = { ...setup, ...saved, ...(finish && { finishedAt: '2026-11-02T09:00:00.000Z' }) };
        return json(route, { ok: true, ...setup });
      }
      case 'POST /api/settings/vat-number':
        vatNumberSaved = true;
        return json(route, { ok: true, masked: '*******000' });
      // The real connect calls return HMRC's or the bank's address; here the user is "sent" straight back to setup, connected.
      case 'GET /api/hmrc/connect':
        hmrcConnected = true;
        return json(route, { url: '/setup' });
      case 'GET /api/bank/connect':
        bankConnected = true;
        return json(route, { url: '/setup' });
      case 'GET /api/bank/reconcile':
        return json(route, { lines: unsortedBankLines, proposals: unsortedBankLines.some((line) => line.id === 'line-1') ? [{ lineId: 'line-1', entryId: 'entry-1', kind: 'exact', entryDescription: 'Client invoice 114', entryDate: '2026-10-12' }] : [] });
      case 'POST /api/bank/reconcile': {
        const { action, lineId } = request.postDataJSON();
        if (action === 'match' || action === 'dismiss' || action === 'createEntry') unsortedBankLines = unsortedBankLines.filter((line) => line.id !== lineId);
        return json(route, { ok: true, entryId: action === 'createEntry' ? 'entry-new' : undefined });
      }
      case 'POST /api/bank/categorise':
        return json(route, { ok: true, status: 'suggested', suggestions: [{ lineId: 'line-2', accountId: 'acc-expense-1', confidence: 85 }] });
      case 'GET /api/bank/status':
        return json(route, homeState === 'items-due'
          ? { ok: true, connected: true, displayName: 'Example Bank', maskedAccountNumber: '****1234', consentExpiresAt: new Date(Date.now() + 10 * DAY_MS).toISOString(), expired: false }
          : { ok: true, connected: bankConnected, displayName: null, maskedAccountNumber: null, consentExpiresAt: null, expired: false });
      case 'GET /api/settings/tax-identifiers':
        return json(route, { ok: true, nino: null, utr: null });
      case 'GET /api/dashboard':
        return json(route, {
          data: {
            taxYear: { start: '2026-04-06', end: '2027-04-05', incomePence: 50000, expensesPence: 12000, profitPence: 38000 },
            month: { start: '2026-10-01', end: '2026-10-31', incomePence: homeState === 'new-user' ? 0 : 125_000, expensesPence: homeState === 'new-user' ? 0 : 38_400, profitPence: homeState === 'new-user' ? 0 : 86_600 },
            vatQuarter: { start: '2026-10-01', end: '2026-12-31', vatCollectedPence: 0, vatPaidPence: 0 },
            draftCount: 0,
            unsortedBankCount: homeState === 'items-due' ? 4 : 0,
            receiptsToCheckCount: homeState === 'items-due' ? 2 : 0,
            recentEntries: [],
          },
        });
      case 'GET /api/tax-estimate':
        return json(route, {
          data: {
            taxYear: '2026-27',
            profitPence: 38000,
            incomeTaxPence: 0,
            class2NicPence: 0,
            class4NicPence: 0,
            totalTaxPence: 0,
            setAsidePence: homeState === 'new-user' ? 0 : 17_320,
            expenseMethod: 'actual',
            tradingAllowancePence: 100000,
            profitWithActualExpensesPence: 38000,
            profitWithAllowancePence: 0,
            lowerProfitMethod: 'allowance',
          },
        });
      case 'GET /api/vat/obligations':
        return json(route, { obligations: vatState === 'none' || homeState !== 'items-due' ? [] : [{ ...period, due: '2026-08-07', status: 'O', overdue: false }] });
      case 'GET /api/entries':
        return json(route, { entries });
      case 'POST /api/entries': {
        entries.push(saveEntry(request.postDataJSON(), `entry-${entries.length + 1}`));
        return json(route, { ok: true }, 201);
      }
      case 'PATCH /api/entries': {
        const entry = entries.find((candidate) => candidate.id === new URL(request.url()).searchParams.get('id'));
        if (!entry) return json(route, { ok: false }, 404);
        entry.status = 'confirmed';
        return json(route, { ok: true, entry });
      }
      case 'GET /api/recurring-entries':
        return json(route, { ok: true, templates });
      case 'POST /api/recurring-entries': {
        const template = { ...request.postDataJSON(), id: `00000000-0000-4000-8000-00000000000${templates.length + 1}`, paused: false };
        templates.push(template);
        return json(route, { ok: true, template });
      }
      case 'PATCH /api/recurring-entries':
      case 'DELETE /api/recurring-entries': {
        const index = templates.findIndex((candidate) => candidate.id === new URL(request.url()).searchParams.get('id'));
        if (index < 0) return json(route, { ok: false, error: 'Template not found' }, 404);
        if (request.method() === 'DELETE') templates.splice(index, 1);
        else Object.assign(templates[index], request.postDataJSON());
        return json(route, { ok: true });
      }
      case 'GET /api/vat/return':
        return json(route, { ok: true, data: mockReturn(vatState, entries) });
      case 'GET /api/vat/history':
        return json(route, { data: [] });
      case 'POST /api/vat/preview':
        return json(route, {
          ok: true,
          data: {
            endpoint: { method: 'POST', url: 'https://test-api.service.hmrc.gov.uk/organisations/vat/000000000/returns', sandbox: true },
            body: previewBody(entries),
            headers: { 'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER' },
          },
        });
      case 'GET /api/hmrc/status':
        return json(route, { connected: hmrcConnected, needsItsReconnect: false, itsBusinessId: null });
      case 'GET /api/hmrc/its-obligations':
        return json(route, { ok: true, stale: false, obligations: itsRowsFor(homeState).map((row) => (itsSent && row.status === 'open' ? { ...row, status: 'fulfilled' as const } : row)) });
      case 'GET /api/hmrc/its-businesses':
        return json(route, { ok: true, businesses: [], selectedBusinessId: null });
      case 'GET /api/mileage':
        return json(route, { trips: [], claim: { totalPence: 0, tripClaims: [] } });
      case 'POST /api/hmrc/its-final-preview':
        return json(route, {
          ok: true,
          data: {
            sandbox: true,
            calculationId: 'calc-e2e',
            hmrc: { incomeTaxPence: 250000, class2NicPence: 0, class4NicPence: 50000, totalPence: 300000 },
            stfEstimate: { incomeTaxPence: 150000, class2NicPence: 0, class4NicPence: 50000, totalPence: 200000 },
            comparison: { incomeTaxDifferencePence: 100000, nicDifferencePence: 0, totalDifferencePence: 100000, differs: true },
            declarationWording: 'I declare that the information I have given on this return is correct and complete to the best of my knowledge.',
          },
        });
      case 'POST /api/hmrc/its-final-confirm':
        return json(route, { ok: true, data: { sandbox: true } });
      case 'POST /api/hmrc/its-final-submit':
        return json(route, { ok: true, data: { sandbox: true } });
      case 'POST /api/hmrc/its-cumulative-preview':
        return json(route, {
          ok: true,
          data: {
            endpoint: { method: 'PUT', url: 'https://test-api.service.hmrc.gov.uk/individuals/business/self-employment/AB******C/XA******1/cumulative/2026-27', sandbox: true },
            body: {
              periodDates: { periodStartDate: '2026-04-06', periodEndDate: '2026-10-05' },
              periodIncome: { turnover: '18250.00', other: '120.00' },
              periodExpenses: { adminCosts: '410.00', carVanTravelExpenses: '865.50', professionalFees: '300.00' },
            },
            headers: { Accept: 'application/vnd.hmrc.5.0+json' },
          },
        });
      case 'POST /api/hmrc/its-cumulative-submit':
        itsSent = true;
        return json(route, { ok: true, data: { sandbox: true } });
      case 'POST /api/hmrc/its-cumulative-confirm':
        return json(route, { ok: true, data: { sandbox: true } });
      case 'GET /api/hmrc/mode':
        return json(route, { live: false, envLive: false });
      case 'GET /api/settings/vat-number':
        return json(route, { masked: vatNumberSaved ? '*******000' : null });
      case 'GET /api/vat/filed':
        return json(route, { ok: true, data: previewBody(entries) });
      case 'GET /api/accounts':
        return json(route, { accounts: [incomeAccount, expenseAccount] });
      case 'GET /api/profit-and-loss': {
        const params = new URL(request.url()).searchParams;
        return json(route, {
          data: {
            start: params.get('start'),
            end: params.get('end'),
            income: [{ accountId: incomeAccount.id, accountName: incomeAccount.name, totalPence: 50000 }],
            expenses: [{ accountId: 'acc-expense', accountName: 'Office costs', totalPence: 12000 }],
            incomePence: 50000,
            expensesPence: 12000,
            profitPence: 38000,
          },
        });
      }
      case 'GET /api/entries-export': {
        const params = new URL(route.request().url()).searchParams;
        const days = (Date.parse(params.get('to') ?? '') - Date.parse(params.get('from') ?? '')) / 86_400_000 + 1;
        if (days > 366) {
          return json(route, { ok: false, error: 'That is too much to export at once. Choose a range of 366 days or fewer.', code: 'RANGE_TOO_LARGE' }, 400);
        }
        return route.fulfill({ status: 200, contentType: 'text/csv', body: 'Date,Description,Net,VAT,Gross,Status\n2026-05-01,Invoice 1,100.00,20.00,120.00,Confirmed\n' });
      }
      case 'GET /api/invoices': {
        const id = new URL(route.request().url()).searchParams.get('id');
        return id ? json(route, { invoice: sampleInvoice }) : json(route, { invoices: [sampleInvoiceRow], nextCursor: null });
      }
      case 'GET /api/invoice-pdf':
        return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF\n' });
      default:
        return json(route, { ok: false, error: `No mock for ${key}` }, 404);
    }
  });
}
