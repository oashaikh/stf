import { and, asc, eq, isNotNull, lte } from 'drizzle-orm';

import { HmrcError, refreshAccessToken, type HmrcTokenSet } from '../../../src/lib/hmrc/client';
import { db } from '../db/client';
import { users } from '../db/schema';
import { decryptToken, encryptToken } from '../lib/hmrcCrypto';
import type { ScheduledJob } from './index';

// Access tokens last about four hours; refresh with plenty of margin so a missed tick is harmless.
export const REFRESH_WINDOW_MS = 30 * 60 * 1000;
export const REFRESH_BATCH_LIMIT = 100;
const TICK_INTERVAL_MS = 5 * 60 * 1000;

export interface DueUser {
  id: string;
  /** Ciphertext, exactly as stored. */
  refreshToken: string;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface RefreshStore {
  findDue(expiringBefore: Date, limit: number): Promise<DueUser[]>;
  /** Writes only if the stored refresh token still equals `previousRefreshToken`. */
  saveTokens(userId: string, previousRefreshToken: string, tokens: StoredTokens): Promise<void>;
  /** Same guard as saveTokens. */
  clearTokens(userId: string, previousRefreshToken: string): Promise<void>;
}

interface RefreshDeps {
  store: RefreshStore;
  refresh: (refreshToken: string) => Promise<HmrcTokenSet>;
  now: () => Date;
  logError?: (message: string, userId: string) => void;
}

// Uses users_hmrc_token_expires_at_idx (partial on refresh token not null); bounded by LIMIT.
const databaseStore: RefreshStore = {
  async findDue(expiringBefore, limit) {
    return db
      .select({ id: users.id, refreshToken: users.hmrcRefreshToken })
      .from(users)
      .where(and(isNotNull(users.hmrcRefreshToken), lte(users.hmrcTokenExpiresAt, expiringBefore)))
      .orderBy(asc(users.hmrcTokenExpiresAt))
      .limit(limit) as Promise<DueUser[]>;
  },

  async saveTokens(userId, previousRefreshToken, tokens) {
    await db
      .update(users)
      .set({
        hmrcAccessToken: tokens.accessToken,
        hmrcRefreshToken: tokens.refreshToken,
        hmrcTokenExpiresAt: tokens.expiresAt,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, userId), eq(users.hmrcRefreshToken, previousRefreshToken)));
  },

  async clearTokens(userId, previousRefreshToken) {
    await db
      .update(users)
      .set({ hmrcAccessToken: null, hmrcRefreshToken: null, hmrcTokenExpiresAt: null, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.hmrcRefreshToken, previousRefreshToken)));
  },
};

// Messages carry the user id and a fixed reason only, never the error text, which could echo a token.
function defaultLogError(message: string, userId: string): void {
  console.error(`[refresh-hmrc-tokens] ${message} user=${userId}`);
}

export async function refreshDueTokens(deps: RefreshDeps): Promise<void> {
  const { store, refresh, now, logError = defaultLogError } = deps;
  const dueUsers = await store.findDue(new Date(now().getTime() + REFRESH_WINDOW_MS), REFRESH_BATCH_LIMIT);

  for (const user of dueUsers) {
    try {
      // The HMRC call runs with no transaction open.
      const fresh = await refresh(decryptToken(user.refreshToken));
      await store.saveTokens(user.id, user.refreshToken, {
        accessToken: encryptToken(fresh.accessToken),
        refreshToken: encryptToken(fresh.refreshToken),
        expiresAt: new Date(fresh.expiresAt),
      });
    } catch (error) {
      if (error instanceof HmrcError && error.apiError.code === 'invalid_grant') {
        // The grant is dead (revoked or expired); the user has to reconnect.
        try {
          await store.clearTokens(user.id, user.refreshToken);
        } catch {
          logError('could not clear revoked tokens', user.id);
        }
        continue;
      }
      logError('token refresh failed', user.id);
    }
  }
}

export const refreshHmrcTokensJob: ScheduledJob = {
  name: 'refresh-hmrc-tokens',
  intervalMs: TICK_INTERVAL_MS,
  run: () => refreshDueTokens({ store: databaseStore, refresh: (token) => refreshAccessToken(token), now: () => new Date() }),
};
