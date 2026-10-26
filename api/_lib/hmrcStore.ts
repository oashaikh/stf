import { and, eq } from 'drizzle-orm';

import { users } from '../../server/src/db/schema.js';
import { decryptToken, encryptToken } from '../../server/src/lib/hmrcCrypto.js';
import { db } from './db';

export interface HmrcCredentials {
  vatNumber: string | null;
  accessToken: string;
  refreshToken: string;
  /** The refresh token exactly as stored (ciphertext); pass it back to saveRefreshedTokens as the guard. */
  storedRefreshToken: string;
  expiresAt: Date;
}

export interface HmrcStore {
  /** Undefined when the user row does not exist. */
  sandboxMode(userId: string): Promise<boolean | undefined>;
  saveTokens(userId: string, tokens: { accessToken: string; refreshToken: string; expiresAt: Date }): Promise<void>;
  /** Decrypted tokens for route-internal use only; undefined when the user is not connected. */
  credentials(userId: string): Promise<HmrcCredentials | undefined>;
  /** Writes only if the stored refresh token still equals `storedRefreshToken`; returns whether it wrote. */
  saveRefreshedTokens(
    userId: string,
    storedRefreshToken: string,
    tokens: { accessToken: string; refreshToken: string; expiresAt: Date },
  ): Promise<boolean>;
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

  async credentials(userId) {
    const [row] = await db
      .select({
        vatNumber: users.vatNumber,
        accessToken: users.hmrcAccessToken,
        refreshToken: users.hmrcRefreshToken,
        expiresAt: users.hmrcTokenExpiresAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row?.accessToken || !row.refreshToken || !row.expiresAt) return undefined;
    return {
      vatNumber: row.vatNumber,
      accessToken: decryptToken(row.accessToken),
      refreshToken: decryptToken(row.refreshToken),
      storedRefreshToken: row.refreshToken,
      expiresAt: row.expiresAt,
    };
  },

  // Same guard as the scheduled refresh job: a rotated refresh token must not be overwritten by a stale one.
  async saveRefreshedTokens(userId, storedRefreshToken, tokens) {
    const written = await db
      .update(users)
      .set({
        hmrcAccessToken: encryptToken(tokens.accessToken),
        hmrcRefreshToken: encryptToken(tokens.refreshToken),
        hmrcTokenExpiresAt: tokens.expiresAt,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, userId), eq(users.hmrcRefreshToken, storedRefreshToken)))
      .returning({ id: users.id });
    return written.length > 0;
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
