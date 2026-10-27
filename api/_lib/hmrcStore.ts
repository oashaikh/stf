import { and, eq, sql } from 'drizzle-orm';

import { users } from '../../server/src/db/schema.js';
import { decryptToken, encryptToken } from '../../server/src/lib/hmrcCrypto.js';
import { db } from './db.js';

export interface HmrcCredentials {
  vatNumber: string | null;
  accessToken: string;
  refreshToken: string;
  /** The refresh token exactly as stored (ciphertext); pass it back to saveRefreshedTokens as the guard. */
  storedRefreshToken: string;
  expiresAt: Date;
}

export interface HmrcStatus {
  connected: boolean;
  expiresAt: string | null;
  itsBusinessId: string | null;
  /** Connected, but the granted scope predates the Income Tax scopes. */
  needsItsReconnect: boolean;
}

export function lacksItsScope(scope: string | null): boolean {
  const granted = (scope ?? '').split(' ');
  return !(granted.includes('read:self-assessment') && granted.includes('write:self-assessment'));
}

export interface HmrcStore {
  /** Undefined when the user row does not exist. */
  sandboxMode(userId: string): Promise<boolean | undefined>;
  /** Writes only the caller's row; the flag is true for sandbox (opt-in off). */
  setSandboxMode(userId: string, sandbox: boolean): Promise<void>;
  /** A scope that differs from the stored one also clears the stored business id, which may belong to another HMRC grant. */
  saveTokens(
    userId: string,
    tokens: { accessToken: string; refreshToken: string; expiresAt: Date; scope?: string },
  ): Promise<void>;
  setItsBusinessId(userId: string, businessId: string): Promise<void>;
  itsBusinessId(userId: string): Promise<string | null>;
  /** Decrypted tokens for route-internal use only; undefined when the user is not connected. */
  credentials(userId: string): Promise<HmrcCredentials | undefined>;
  /** Writes only if the stored refresh token still equals `storedRefreshToken`; returns whether it wrote. */
  saveRefreshedTokens(
    userId: string,
    storedRefreshToken: string,
    tokens: { accessToken: string; refreshToken: string; expiresAt: Date },
  ): Promise<boolean>;
  status(userId: string): Promise<HmrcStatus>;
}

// Each query filters on users.id (primary key) and returns one bounded row.
export const databaseHmrcStore: HmrcStore = {
  async sandboxMode(userId) {
    const [row] = await db.select({ sandbox: users.hmrcSandboxMode }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.sandbox;
  },

  async setSandboxMode(userId, sandbox) {
    await db.update(users).set({ hmrcSandboxMode: sandbox, updatedAt: new Date() }).where(eq(users.id, userId));
  },

  async saveTokens(userId, tokens) {
    const scopeUpdate = tokens.scope === undefined ? {} : { hmrcScope: tokens.scope };
    // SQL evaluates the CASE against the old row, so the id is cleared only when the scope actually changes.
    const businessIdUpdate =
      tokens.scope === undefined
        ? {}
        : { hmrcItsBusinessId: sql`CASE WHEN ${users.hmrcScope} IS NOT DISTINCT FROM ${tokens.scope} THEN ${users.hmrcItsBusinessId} ELSE NULL END` };
    await db
      .update(users)
      .set({
        hmrcAccessToken: tokens.accessToken,
        hmrcRefreshToken: tokens.refreshToken,
        hmrcTokenExpiresAt: tokens.expiresAt,
        ...businessIdUpdate,
        ...scopeUpdate,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  },

  async setItsBusinessId(userId, businessId) {
    await db.update(users).set({ hmrcItsBusinessId: businessId, updatedAt: new Date() }).where(eq(users.id, userId));
  },

  async itsBusinessId(userId) {
    const [row] = await db.select({ id: users.hmrcItsBusinessId }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.id ?? null;
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
      .select({
        refreshToken: users.hmrcRefreshToken,
        expiresAt: users.hmrcTokenExpiresAt,
        itsBusinessId: users.hmrcItsBusinessId,
        scope: users.hmrcScope,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const connected = Boolean(row?.refreshToken);
    return {
      connected,
      expiresAt: row?.expiresAt?.toISOString() ?? null,
      itsBusinessId: row?.itsBusinessId ?? null,
      needsItsReconnect: connected && lacksItsScope(row?.scope ?? null),
    };
  },
};
