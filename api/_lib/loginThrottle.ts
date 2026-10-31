import { createHash } from 'node:crypto';

import { and, desc, eq, gt, lte } from 'drizzle-orm';

import { loginAttempts } from '../../server/src/db/schema.js';
import { db } from './db.js';

export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60_000;

/**
 * Locked when MAX_FAILURES attempts fall within LOCKOUT_MS of the latest one, until LOCKOUT_MS after
 * that latest failure. Anchoring on the latest failure keeps the lock from lifting as old ones age out.
 */
export function lockedUntil(failures: Date[], now: Date): Date | null {
  if (failures.length === 0) return null;
  const latest = Math.max(...failures.map((failure) => failure.getTime()));
  const until = latest + LOCKOUT_MS;
  if (until <= now.getTime()) return null;
  const inWindow = failures.filter((failure) => failure.getTime() > latest - LOCKOUT_MS);
  return inWindow.length >= MAX_FAILURES ? new Date(until) : null;
}

/**
 * Throttle bucket for the caller. Only x-vercel-forwarded-for is read: Vercel overwrites it at the edge,
 * whereas x-forwarded-for can carry whatever the client sent. Without it (local dev) everyone shares one
 * bucket, which fails closed. The address is hashed so the table never holds a raw IP.
 */
export function clientKey(request: Request): string {
  const address = request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim() || 'unknown';
  return createHash('sha256').update(address).digest('hex').slice(0, 32);
}

// The port exists so the throttle logic is testable without a database.
export interface LoginAttemptRows {
  insert(clientKey: string, attemptedAt: Date): Promise<void>;
  /** At most `limit` of this client's attempts strictly after `since`, newest first. */
  latestSince(clientKey: string, since: Date, limit: number): Promise<Date[]>;
  deleteBefore(cutoff: Date): Promise<void>;
  deleteForClient(clientKey: string): Promise<void>;
}

export function createLoginThrottle(rows: LoginAttemptRows) {
  return {
    async lockedUntil(key: string, now: Date): Promise<Date | null> {
      const since = new Date(now.getTime() - LOCKOUT_MS);
      return lockedUntil(await rows.latestSince(key, since, MAX_FAILURES), now);
    },
    async recordFailure(key: string, now: Date): Promise<void> {
      await rows.insert(key, now);
      // Retention (DP-6): rows past the window can never count again, so drop them.
      await rows.deleteBefore(new Date(now.getTime() - LOCKOUT_MS));
    },
    async clear(key: string): Promise<void> {
      await rows.deleteForClient(key);
    },
  };
}

// login_attempts is a counter, not a financial record, so rows are really deleted.
// Reads use login_attempts_client_key_attempted_at_idx and are capped by `limit`; the prune uses
// login_attempts_attempted_at_idx.
export const databaseLoginAttemptRows: LoginAttemptRows = {
  async insert(key, attemptedAt) {
    await db.insert(loginAttempts).values({ clientKey: key, attemptedAt });
  },
  async latestSince(key, since, limit) {
    const found = await db
      .select({ attemptedAt: loginAttempts.attemptedAt })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.clientKey, key), gt(loginAttempts.attemptedAt, since)))
      .orderBy(desc(loginAttempts.attemptedAt))
      .limit(limit);
    return found.map((row) => row.attemptedAt);
  },
  async deleteBefore(cutoff) {
    await db.delete(loginAttempts).where(lte(loginAttempts.attemptedAt, cutoff));
  },
  async deleteForClient(key) {
    await db.delete(loginAttempts).where(eq(loginAttempts.clientKey, key));
  },
};

export const loginThrottle = createLoginThrottle(databaseLoginAttemptRows);
