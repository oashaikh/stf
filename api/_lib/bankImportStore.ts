import { and, count, eq, gt, gte, isNull, lte, max, or } from 'drizzle-orm';

import { bankConnections, bankTransactions } from '../../server/src/db/schema.js';
import { decryptToken } from '../../server/src/lib/hmrcCrypto.js';
import type { BankImportStore } from './bankImport.js';
import { db } from './db.js';

// Cap on the existing lines read back for duplicate checks; the window is only days wide, so it is never reached in practice.
const STAGED_WINDOW_LIMIT = 5000;

// Backed by bank_connections_user_id_idx's table scan being tiny (one row per linked account), bank_transactions_connection_date_idx
// and the unique connection/provider-id index for the rest.
export const databaseBankImportStore: BankImportStore = {
  async listConnections(limit, now) {
    const rows = await db
      .select({ id: bankConnections.id, providerAccountId: bankConnections.providerAccountId, accessTokenEncrypted: bankConnections.accessTokenEncrypted })
      .from(bankConnections)
      .where(and(isNull(bankConnections.deletedAt), gt(bankConnections.tokenExpiresAt, now), gt(bankConnections.consentExpiresAt, now)))
      .orderBy(bankConnections.id)
      .limit(limit);
    return rows.map((row) => ({ id: row.id, providerAccountId: row.providerAccountId, accessToken: decryptToken(row.accessTokenEncrypted) }));
  },

  async countExpiredConnections(now) {
    const [row] = await db
      .select({ expired: count() })
      .from(bankConnections)
      .where(and(isNull(bankConnections.deletedAt), or(lte(bankConnections.tokenExpiresAt, now), lte(bankConnections.consentExpiresAt, now))));
    return row?.expired ?? 0;
  },

  async stagedSince(connectionId, sinceDate) {
    const rows = await db
      .select({
        providerTransactionId: bankTransactions.providerTransactionId,
        date: bankTransactions.date,
        amountPence: bankTransactions.amountPence,
        description: bankTransactions.description,
        possibleDuplicate: bankTransactions.possibleDuplicate,
      })
      .from(bankTransactions)
      .where(and(eq(bankTransactions.connectionId, connectionId), gte(bankTransactions.date, sinceDate)))
      .limit(STAGED_WINDOW_LIMIT);
    return rows.map((row) => ({ ...row, connectionId, status: 'unmatched' as const }));
  },

  async latestDate(connectionId) {
    const [row] = await db.select({ latest: max(bankTransactions.date) }).from(bankTransactions).where(eq(bankTransactions.connectionId, connectionId));
    return row?.latest ?? null;
  },

  async insertLines(lines) {
    // A concurrent run inserting the same provider id is absorbed by the unique key.
    await db.insert(bankTransactions).values(lines).onConflictDoNothing({ target: [bankTransactions.connectionId, bankTransactions.providerTransactionId] });
  },
};
