import { and, desc, eq, isNull } from 'drizzle-orm';

import { bankConnections } from '../../server/src/db/schema.js';
import { encryptToken } from '../../server/src/lib/hmrcCrypto.js';
import { db } from './db.js';

const PROVIDER = 'truelayer';

export interface BankConnectionInput {
  providerAccountId: string;
  displayName: string;
  maskedAccountNumber: string | null;
  consentExpiresAt: Date;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
}

/** Never carries a token: this is the shape the status route returns. */
export interface BankStatus {
  connected: boolean;
  displayName: string | null;
  maskedAccountNumber: string | null;
  consentExpiresAt: string | null;
  expired: boolean;
}

export interface BankStore {
  /** Tokens are encrypted here; reconnecting the same account replaces its tokens and consent expiry. */
  save(userId: string, connection: BankConnectionInput): Promise<void>;
  status(userId: string): Promise<BankStatus>;
  /** Soft delete of the caller's active connections; repeating it changes nothing. */
  disconnect(userId: string): Promise<void>;
}

const activeFor = (userId: string) => and(eq(bankConnections.userId, userId), isNull(bankConnections.deletedAt));

// Every query filters on the session user id; bank_connections_user_id_idx backs the filter.
export const databaseBankStore: BankStore = {
  async save(userId, connection) {
    const values = {
      userId,
      provider: PROVIDER,
      providerAccountId: connection.providerAccountId,
      displayName: connection.displayName,
      maskedAccountNumber: connection.maskedAccountNumber,
      consentExpiresAt: connection.consentExpiresAt,
      accessTokenEncrypted: encryptToken(connection.accessToken),
      refreshTokenEncrypted: encryptToken(connection.refreshToken),
      tokenExpiresAt: connection.tokenExpiresAt,
    };
    // Single statement, so no transaction is open while the provider is called.
    await db
      .insert(bankConnections)
      .values(values)
      .onConflictDoUpdate({
        target: [bankConnections.userId, bankConnections.provider, bankConnections.providerAccountId],
        targetWhere: isNull(bankConnections.deletedAt),
        set: { ...values, updatedAt: new Date() },
      });
  },

  async status(userId) {
    const [row] = await db
      .select({
        displayName: bankConnections.displayName,
        maskedAccountNumber: bankConnections.maskedAccountNumber,
        consentExpiresAt: bankConnections.consentExpiresAt,
      })
      .from(bankConnections)
      .where(activeFor(userId))
      .orderBy(desc(bankConnections.updatedAt))
      .limit(1);
    if (!row) return { connected: false, displayName: null, maskedAccountNumber: null, consentExpiresAt: null, expired: false };
    return {
      connected: true,
      displayName: row.displayName,
      maskedAccountNumber: row.maskedAccountNumber,
      consentExpiresAt: row.consentExpiresAt.toISOString(),
      expired: row.consentExpiresAt.getTime() <= Date.now(),
    };
  },

  async disconnect(userId) {
    // The column is not null, so the ciphertext is blanked rather than removed.
    await db
      .update(bankConnections)
      .set({ deletedAt: new Date(), updatedAt: new Date(), accessTokenEncrypted: '', refreshTokenEncrypted: '' })
      .where(activeFor(userId));
  },
};
