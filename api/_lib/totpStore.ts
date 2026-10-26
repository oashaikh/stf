import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { recoveryCodes, users } from '../../server/src/db/schema.js';
import { db } from './db.js';
import { createTotpService, type TotpRows } from './totp.js';

export const databaseTotpRows: TotpRows = {
  async find(userId) {
    const [row] = await db
      .select({
        secretEncrypted: users.totpSecretEncrypted,
        enabledAt: users.totpEnabledAt,
        lastStep: users.totpLastStep,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.secretEncrypted ? { ...row, secretEncrypted: row.secretEncrypted } : null;
  },
  async saveSecret(userId, secretEncrypted) {
    await db
      .update(users)
      .set({ totpSecretEncrypted: secretEncrypted, totpEnabledAt: null, totpLastStep: null })
      .where(eq(users.id, userId));
  },
  async enable(userId, enabledAt, step, recoveryHashes) {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ totpEnabledAt: enabledAt, totpLastStep: step }).where(eq(users.id, userId));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
      await tx.insert(recoveryCodes).values(recoveryHashes.map((codeHash) => ({ userId, codeHash })));
    });
  },
  async advanceStep(userId, step) {
    const moved = await db
      .update(users)
      .set({ totpLastStep: step })
      .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
      .returning({ id: users.id });
    return moved.length === 1;
  },
  async useRecoveryHash(userId, codeHash) {
    const used = await db
      .update(recoveryCodes)
      .set({ usedAt: sql`now()` })
      .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, codeHash), isNull(recoveryCodes.usedAt)))
      .returning({ id: recoveryCodes.id });
    return used.length === 1;
  },
  async disable(userId) {
    await db.transaction(async (tx) => {
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
      await tx
        .update(users)
        .set({ totpSecretEncrypted: null, totpEnabledAt: null, totpLastStep: null })
        .where(eq(users.id, userId));
    });
  },
};

export const totp = createTotpService(databaseTotpRows);
