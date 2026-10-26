import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import type { AuthDeps } from '../auth';
import { HmrcError, type FraudHeaderValidation } from '../../../src/lib/hmrc/client';
import { createFraudHeadersCheckHandler } from '../../vat/fraud-headers-check';
import { requestFraudHeaders } from '../hmrcCall';

const NOW = new Date('2026-10-26T10:00:00Z');
const TOKEN = 'application-token-secret';

const authDeps: AuthDeps = {
  issuer: { verifyToken: async (token) => (token === 'a' ? 'owner_a' : null), getEmail: async () => 'x@example.com' },
  users: { findId: async (id) => id.replace('owner_', 'user_'), createIfAbsent: async () => 'unused' },
};

const warned: FraudHeaderValidation = {
  code: 'POTENTIALLY_INVALID_HEADERS',
  message: 'Headers need attention',
  errors: [],
  warnings: [{ headers: ['Gov-Client-Multi-Factor'], message: 'is missing' }],
};

function call({ token = 'a', method = 'POST', validation = warned, recordAudit = vi.fn(async () => undefined) } = {}) {
  const validate = vi.fn(async (_headers: Record<string, string>) => validation);
  const handler = createFraudHeadersCheckHandler({ validate, recordAudit, now: () => NOW }, authDeps);
  const request = new Request('https://app.test/api/vat/fraud-headers-check', {
    method,
    headers: token ? { cookie: `stf_session=${token}` } : {},
  });
  return { response: handler(request), validate, recordAudit, request };
}

describe('POST /api/vat/fraud-headers-check', () => {
  it('refuses an unauthenticated request without calling HMRC', async () => {
    const run = call({ token: '' });
    expect((await run.response).status).toBe(401);
    expect(run.validate).not.toHaveBeenCalled();
  });

  it('rejects other methods with 405', async () => {
    expect((await call({ method: 'GET' }).response).status).toBe(405);
  });

  it('returns the validation with an outcome, sending the shared submit header set', async () => {
    const run = call();
    const res = await run.response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { ...warned, outcome: 'fail' } });
    expect(run.validate).toHaveBeenCalledWith(requestFraudHeaders(run.request, 'user_a', NOW));
  });

  it('reports a pass when HMRC finds nothing', async () => {
    const clean = { ...warned, code: 'VALID_HEADERS', warnings: [] };
    const body = await (await call({ validation: clean }).response).json();
    expect(body.data.outcome).toBe('pass');
  });

  it('writes one audit row with names and findings but no header values or token', async () => {
    const run = call();
    await run.response;
    expect(run.recordAudit).toHaveBeenCalledTimes(1);
    const [userId, snapshot] = run.recordAudit.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(userId).toBe('user_a');
    expect(snapshot).toMatchObject({ outcome: 'fail', warnings: warned.warnings, errors: [] });
    const sent = requestFraudHeaders(run.request, 'user_a', NOW);
    expect(snapshot.sentHeaderNames).toEqual(Object.keys(sent));
    const text = JSON.stringify(snapshot);
    for (const value of Object.values(sent)) if (value.length > 6) expect(text).not.toContain(value);
    expect(text).not.toContain(TOKEN);
  });

  it('surfaces an audit insert failure as a 500 instead of swallowing it', async () => {
    const run = call({ recordAudit: vi.fn(async () => Promise.reject(new Error(`db down ${TOKEN}`))) });
    const res = await run.response;
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ ok: false, code: 'AUDIT_FAILED' });
    expect(text).not.toContain(TOKEN);
  });

  it('maps an HMRC failure to 502 without echoing its body or token', async () => {
    const validate = vi.fn(async () => {
      throw new HmrcError({ code: 'X', message: TOKEN, statusCode: 503 });
    });
    const handler = createFraudHeadersCheckHandler({ validate, recordAudit: vi.fn(), now: () => NOW }, authDeps);
    const res = await handler(new Request('https://app.test/x', { method: 'POST', headers: { cookie: 'stf_session=a' } }));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain(TOKEN);
  });
});
