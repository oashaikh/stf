import type { Page, Route } from '@playwright/test';

// Pence, as the app holds them; the preview body below carries the same figures in pounds, as the server sends them.
const boxes = { box1: 12000, box2: 0, box3: 12000, box4: 4500, box5: 7500, box6: 60000, box7: 22500, box8: 0, box9: 0 };
const noLines = { box1: [], box2: [], box3: [], box4: [], box5: [], box6: [], box7: [], box8: [], box9: [] };
const period = { periodKey: '26A1', start: '2026-04-01', end: '2026-06-30' };

const previewBody = {
  periodKey: period.periodKey,
  vatDueSales: 120,
  vatDueAcquisitions: 0,
  totalVatDue: 120,
  vatReclaimedCurrPeriod: 45,
  netVatDue: 75,
  totalValueSalesExVAT: 600,
  totalValuePurchasesExVAT: 225,
  totalValueGoodsSuppliedExVAT: 0,
  totalAcquisitionsExVAT: 0,
  finalised: true,
};

// Invented values; the QR is a plain placeholder square, not a scannable code.
export const mockMfaCode = '123456';
const mockRecoveryCodes = ['aaaa-1111', 'bbbb-2222', 'cccc-3333', 'dddd-4444', 'eeee-5555', 'ffff-6666', 'gggg-7777', 'hhhh-8888'];
const mockQr = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="#fff"/><rect x="16" y="16" width="160" height="160" fill="#111"/><rect x="48" y="48" width="96" height="96" fill="#fff"/></svg>')}`;

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });

/** The VAT page states the journey must cope with on live data: no open obligation, an unreviewed return, a confirmed one, a filed one. */
export type MockVatState = 'none' | 'draft' | 'confirmed' | 'filed';
export const mockVatStates: MockVatState[] = ['none', 'draft', 'confirmed', 'filed'];

const filedReceipt = { formBundleNumber: '000000000000', processingDate: '2026-07-02T09:00:00Z', sandbox: true };

function mockReturn(vatState: MockVatState) {
  const confirmed = vatState === 'confirmed' || vatState === 'filed';
  return {
    boxes,
    drillDown: noLines,
    drillDownTotals: boxes,
    status: confirmed ? 'confirmed' : 'draft',
    confirmedAt: confirmed ? '2026-07-01T09:00:00Z' : null,
    stale: false,
    submission: vatState === 'filed' ? filedReceipt : null,
  };
}

/** A fake of the deployed API, so the journey can run against a built preview with no server behind it. */
export async function mockApi(page: Page, ownerPassword: string, vatState: MockVatState = 'confirmed') {
  let signedIn = false;
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
      case 'GET /api/vat/return':
        return json(route, { ok: true, data: mockReturn(vatState) });
      case 'GET /api/vat/history':
        return json(route, { data: [] });
      case 'POST /api/vat/preview':
        return json(route, {
          ok: true,
          data: {
            endpoint: { method: 'POST', url: 'https://test-api.service.hmrc.gov.uk/organisations/vat/000000000/returns', sandbox: true },
            body: previewBody,
            headers: { 'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER' },
          },
        });
      case 'GET /api/hmrc/status':
        return json(route, { connected: true });
      case 'GET /api/hmrc/mode':
        return json(route, { live: false, envLive: false });
      case 'GET /api/settings/vat-number':
        return json(route, { masked: '*******000' });
      case 'GET /api/entries':
        return json(route, { entries: [] });
      case 'GET /api/vat/filed':
        return json(route, { ok: true, data: { ...previewBody } });
      case 'GET /api/accounts':
        return json(route, { accounts: [] });
      default:
        return json(route, { ok: false, error: `No mock for ${key}` }, 404);
    }
  });
}
