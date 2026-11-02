import { describe, expect, it } from 'vitest';

import { releaseBankLines, type Executor } from '../entries';

function fakeExecutor(releasedIds: string[]) {
  const audits: unknown[] = [];
  const executor = {
    update: () => ({ set: () => ({ where: () => ({ returning: async () => releasedIds.map((id) => ({ id })) }) }) }),
    insert: () => ({ values: async (rows: unknown) => void audits.push(rows) }),
  } as unknown as Executor;
  return { executor, audits };
}

describe('releaseBankLines', () => {
  it('audits each bank line put back in the open list when its entry is voided', async () => {
    const { executor, audits } = fakeExecutor(['line-1']);
    await releaseBankLines(executor, 'user-1', 'entry-1');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject([{ userId: 'user-1', action: 'bank.release', resourceId: 'line-1' }]);
  });

  it('writes no audit event when no line pointed at the entry', async () => {
    const { executor, audits } = fakeExecutor([]);
    await releaseBankLines(executor, 'user-1', 'entry-1');
    expect(audits).toHaveLength(0);
  });
});
