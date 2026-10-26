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

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });

/** A fake of the deployed API, so the journey can run against a built preview with no server behind it. */
export async function mockApi(page: Page, ownerPassword: string) {
  let signedIn = false;
  const entries: SavedEntry[] = [];
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    switch (key) {
      case 'GET /api/me':
        return json(route, { ok: signedIn }, signedIn ? 200 : 401);
      case 'POST /api/auth/login':
        signedIn = request.postDataJSON().password === ownerPassword;
        return json(route, { ok: signedIn }, signedIn ? 200 : 401);
      case 'GET /api/vat/obligations':
        return json(route, { obligations: [{ ...period, due: '2026-08-07', status: 'O', overdue: false }] });
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
        return json(route, {
          ok: true,
          data: { ...vatReturn(entries), status: 'confirmed', confirmedAt: '2026-07-01T09:00:00Z', stale: false, submission: null },
        });
      case 'GET /api/vat/history':
        return json(route, { data: [] });
      case 'POST /api/vat/preview': {
        const { boxes } = vatReturn(entries);
        return json(route, {
          ok: true,
          data: {
            endpoint: { method: 'POST', url: 'https://test-api.service.hmrc.gov.uk/organisations/vat/000000000/returns', sandbox: true },
            body: {
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
            },
            headers: { 'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER' },
          },
        });
      }
      case 'GET /api/hmrc/status':
        return json(route, { connected: true });
      case 'GET /api/hmrc/mode':
        return json(route, { live: false, envLive: false });
      case 'GET /api/settings/vat-number':
        return json(route, { masked: '*******000' });
      case 'GET /api/accounts':
        return json(route, { accounts: [incomeAccount] });
      default:
        return json(route, { ok: false, error: `No mock for ${key}` }, 404);
    }
  });
}
