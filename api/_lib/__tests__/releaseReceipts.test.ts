import { describe, expect, it } from 'vitest';

import { releaseReceipts, type Executor } from '../entries';

function fakeExecutor(releasedIds: string[]) {
  const audits: unknown[] = [];
  const executor = {
    update: () => ({ set: () => ({ where: () => ({ returning: async () => releasedIds.map((id) => ({ id })) }) }) }),
    insert: () => ({ values: async (rows: unknown) => void audits.push(rows) }),
  } as unknown as Executor;
  return { executor, audits };
}

describe('releaseReceipts', () => {
  it('audits each receipt unlinked so it can be confirmed again when its expense is voided', async () => {
    const { executor, audits } = fakeExecutor(['receipt-1']);
    await releaseReceipts(executor, 'user-1', 'entry-1');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject([{ userId: 'user-1', action: 'receipt.release', resourceId: 'receipt-1' }]);
  });

  it('writes no audit event when no receipt pointed at the entry', async () => {
    const { executor, audits } = fakeExecutor([]);
    await releaseReceipts(executor, 'user-1', 'entry-1');
    expect(audits).toHaveLength(0);
  });
});
