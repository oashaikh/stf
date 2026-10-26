import { and, eq } from 'drizzle-orm';

import { users, vatSubmissions } from '../../server/src/db/schema.js';
import { db } from './db.js';

/** Returns the 9 digits, or null. Spaces and one leading GB are ignored. */
export function normaliseVatNumber(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/\s+/g, '').replace(/^gb/i, '');
  return /^\d{9}$/.test(digits) ? digits : null;
}

export const maskVatNumber = (vatNumber: string) => `${'•'.repeat(vatNumber.length - 3)}${vatNumber.slice(-3)}`;

export interface VatNumberStore {
  /** Undefined when the user row does not exist; null when no number is saved. */
  get(userId: string): Promise<string | null | undefined>;
  set(userId: string, vatNumber: string): Promise<void>;
  hasPendingLiveSubmission(userId: string): Promise<boolean>;
}

// Each query filters on users.id (primary key) or the (user_id, period_key, sandbox) unique index, and returns at most one row.
export const databaseVatNumberStore: VatNumberStore = {
  async get(userId) {
    const [row] = await db.select({ vatNumber: users.vatNumber }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.vatNumber;
  },

  async set(userId, vatNumber) {
    await db.update(users).set({ vatNumber, updatedAt: new Date() }).where(eq(users.id, userId));
  },

  async hasPendingLiveSubmission(userId) {
    const [row] = await db
      .select({ id: vatSubmissions.id })
      .from(vatSubmissions)
      .where(and(eq(vatSubmissions.userId, userId), eq(vatSubmissions.sandbox, false), eq(vatSubmissions.status, 'pending')))
      .limit(1);
    return row !== undefined;
  },
};
