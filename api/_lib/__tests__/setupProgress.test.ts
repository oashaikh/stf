import { describe, expect, it } from 'vitest';

import { parseSetupUpdate } from '../setupProgress';

describe('parseSetupUpdate', () => {
  it('accepts each field on its own and a full update', () => {
    expect(parseSetupUpdate({ businessType: 'partnership' })).toEqual({ ok: true, update: { businessType: 'partnership' } });
    expect(parseSetupUpdate({ vatRegistered: false })).toEqual({ ok: true, update: { vatRegistered: false } });
    expect(parseSetupUpdate({ skippedSteps: ['vat', 'bank'], finish: true })).toEqual({
      ok: true,
      update: { skippedSteps: ['vat', 'bank'], finish: true },
    });
    expect(parseSetupUpdate({ skippedSteps: [] })).toEqual({ ok: true, update: { skippedSteps: [] } });
  });

  it.each([
    ['unknown business type', { businessType: 'charity' }],
    ['non-string business type', { businessType: 3 }],
    ['string vatRegistered', { vatRegistered: 'false' }],
    ['null vatRegistered', { vatRegistered: null }],
    ['unknown step id', { skippedSteps: ['vat', 'tax'] }],
    ['duplicate step id', { skippedSteps: ['vat', 'vat'] }],
    ['non-array steps', { skippedSteps: 'vat' }],
    ['non-boolean finish', { finish: 'yes' }],
    ['empty update', {}],
    ['non-object body', null],
  ])('refuses %s', (_label, body) => {
    expect(parseSetupUpdate(body).ok).toBe(false);
  });

  it('drops a client-supplied finishedAt', () => {
    const result = parseSetupUpdate({ vatRegistered: true, finishedAt: '2020-01-01T00:00:00Z' });
    expect(result).toEqual({ ok: true, update: { vatRegistered: true } });
  });
});
