// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { confirmItsFinal, previewItsFinal, submitItsFinal } from './itsFinalApi';

const stubFetch = (body: unknown) => {
  const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(body));
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
};

const sentBody = (fetchSpy: ReturnType<typeof stubFetch>) => JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('itsFinalApi', () => {
  it('previews by naming only the tax year', async () => {
    const fetchSpy = stubFetch({ ok: true, data: { calculationId: 'calc-1', sandbox: true } });
    const preview = await previewItsFinal('2026-27');
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/hmrc/its-final-preview');
    expect(sentBody(fetchSpy)).toEqual({ taxYear: '2026-27' });
    expect(preview.calculationId).toBe('calc-1');
  });

  it('confirms with the calculation id and the ticked declaration', async () => {
    const fetchSpy = stubFetch({ ok: true, data: { sandbox: true } });
    await confirmItsFinal('2026-27', 'calc-1');
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/hmrc/its-final-confirm');
    expect(sentBody(fetchSpy)).toEqual({ taxYear: '2026-27', calculationId: 'calc-1', declaration: true });
  });

  it('submits with confirm set and returns the sandbox flag', async () => {
    const fetchSpy = stubFetch({ ok: true, data: { sandbox: false } });
    expect(await submitItsFinal('2026-27')).toEqual({ sandbox: false });
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/hmrc/its-final-submit');
    expect(sentBody(fetchSpy)).toEqual({ taxYear: '2026-27', confirm: true });
  });
});
