import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { confirmItsFinalForUser, itsFinalConfirmSchema, itsFinalSubmitSchema } from '../itsFinalDeclaration';

describe('final declaration input schemas', () => {
  const valid = { taxYear: '2026-27', calculationId: 'abc-123', declaration: true };

  it('accepts the tick with a calculation id', () => {
    expect(itsFinalConfirmSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['no tick', { ...valid, declaration: undefined }],
    ['an unticked box', { ...valid, declaration: false }],
    ['a calculation id with path characters', { ...valid, calculationId: '../x' }],
    ['an empty calculation id', { ...valid, calculationId: '' }],
  ])('refuses %s', (_label, body) => {
    expect(itsFinalConfirmSchema.safeParse(body).success).toBe(false);
  });

  it('submit needs confirm true and nothing else', () => {
    expect(itsFinalSubmitSchema.safeParse({ taxYear: '2026-27', confirm: true }).success).toBe(true);
    expect(itsFinalSubmitSchema.safeParse({ taxYear: '2026-27', confirm: true, calculationId: 'x' }).success).toBe(false);
  });
});

describe('confirmItsFinalForUser', () => {
  it('refuses without the declaration before reading anything', async () => {
    await expect(
      confirmItsFinalForUser({ userId: 'u1', taxYear: '2026-27', calculationId: 'c', declaration: false, request: new Request('https://app.test') }),
    ).rejects.toMatchObject({ status: 400, code: 'DECLARATION_REQUIRED' });
  });
});
