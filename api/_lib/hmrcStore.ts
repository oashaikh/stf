import { eq } from 'drizzle-orm';

import { users } from '../../server/src/db/schema.js';
import { db } from './db';

export interface HmrcStore {
  /** Undefined when the user row does not exist. */
  sandboxMode(userId: string): Promise<boolean | undefined>;
  saveTokens(userId: string, tokens: { accessToken: string; refreshToken: string; expiresAt: Date }): Promise<void>;
  status(userId: string): Promise<{ connected: boolean; expiresAt: string | null }>;
}

// Each query filters on users.id (primary key) and returns one bounded row.
export const databaseHmrcStore: HmrcStore = {
  async sandboxMode(userId) {
    const [row] = await db.select({ sandbox: users.hmrcSandboxMode }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.sandbox;
  },

  async saveTokens(userId, tokens) {
    await db
      .update(users)
      .set({
        hmrcAccessToken: tokens.accessToken,
        hmrcRefreshToken: tokens.refreshToken,
        hmrcTokenExpiresAt: tokens.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  },

  async status(userId) {
    const [row] = await db
      .select({ refreshToken: users.hmrcRefreshToken, expiresAt: users.hmrcTokenExpiresAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return { connected: Boolean(row?.refreshToken), expiresAt: row?.expiresAt?.toISOString() ?? null };
  },
};
