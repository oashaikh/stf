import { describe, expect, it } from 'vitest';

import { bodySchema, entryWindow } from '../bankReconcile';

describe('entryWindow', () => {
  it('widens the line dates by the matching window of three days', () => {
    const window = entryWindow([
      { id: 'a', date: '2026-02-10', amountPence: 1, description: 'x' },
      { id: 'b', date: '2026-01-31', amountPence: 1, description: 'y' },
    ]);
    expect(window).toEqual({ from: '2026-01-28', to: '2026-02-13' });
  });

  it('is undefined when there are no lines', () => {
    expect(entryWindow([])).toBeUndefined();
  });
});

describe('bodySchema', () => {
  it('trims the dismiss reason', () => {
    const parsed = bodySchema.parse({ action: 'dismiss', lineId: '00000000-0000-4000-8000-000000000001', reason: '  Personal  ' });
    expect(parsed).toMatchObject({ reason: 'Personal' });
  });

  it('defaults the VAT rate to none', () => {
    const parsed = bodySchema.parse({ action: 'createEntry', lineId: '00000000-0000-4000-8000-000000000001', categoryAccountId: '00000000-0000-4000-8000-000000000002' });
    expect(parsed).toMatchObject({ vatRatePercent: 0 });
  });
});
