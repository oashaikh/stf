import type { Page, Route } from '@playwright/test';

// Pence, as the app holds them. The return is built from the entries saved through the form, on top of a fixed
// purchases-only base, so the figures move the way the real ledger does.
const period = { periodKey: '26A1', start: '2026-04-01', end: '2026-06-30' };
const baseBox4 = 4500;
const baseBox7 = 22500;
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
  return { boxes, drillDown, drillDownTotals, entryCount: entries.length };
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

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });

/** The VAT page states the journey must cope with on live data: no open obligation, an unreviewed return, a confirmed one, a filed one. */
export type MockVatState = 'none' | 'draft' | 'confirmed' | 'filed';
export const mockVatStates: MockVatState[] = ['none', 'draft', 'confirmed', 'filed'];

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
export async function mockApi(page: Page, ownerPassword: string, vatState: MockVatState = 'confirmed') {
  let signedIn = false;
  const entries: SavedEntry[] = [];
  let authenticatorEnabled = false;
  let codePending = false;
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
      case 'GET /api/vat/obligations':
        return json(route, { obligations: vatState === 'none' ? [] : [{ ...period, due: '2026-08-07', status: 'O', overdue: false }] });
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
        return json(route, { connected: true });
      case 'GET /api/hmrc/mode':
        return json(route, { live: false, envLive: false });
      case 'GET /api/settings/vat-number':
        return json(route, { masked: '*******000' });
      case 'GET /api/vat/filed':
        return json(route, { ok: true, data: previewBody(entries) });
      case 'GET /api/accounts':
        return json(route, { accounts: [incomeAccount] });
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
      default:
        return json(route, { ok: false, error: `No mock for ${key}` }, 404);
    }
  });
}
