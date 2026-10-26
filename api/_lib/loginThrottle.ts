import { desc, gt, lte } from 'drizzle-orm';

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

// The port exists so the throttle logic is testable without a database.
export interface LoginAttemptRows {
  insert(attemptedAt: Date): Promise<void>;
  /** At most `limit` attempts strictly after `since`, newest first. */
  latestSince(since: Date, limit: number): Promise<Date[]>;
  deleteBefore(cutoff: Date): Promise<void>;
  deleteAll(): Promise<void>;
}

export function createLoginThrottle(rows: LoginAttemptRows) {
  return {
    async lockedUntil(now: Date): Promise<Date | null> {
      const since = new Date(now.getTime() - LOCKOUT_MS);
      return lockedUntil(await rows.latestSince(since, MAX_FAILURES), now);
    },
    async recordFailure(now: Date): Promise<void> {
      await rows.insert(now);
      // Retention (DP-6): rows past the window can never count again, so drop them.
      await rows.deleteBefore(new Date(now.getTime() - LOCKOUT_MS));
    },
    async clear(): Promise<void> {
      await rows.deleteAll();
    },
  };
}

// login_attempts is a counter, not a financial record, so rows are really deleted.
// Reads use login_attempts_attempted_at_idx and are capped by `limit`.
export const databaseLoginAttemptRows: LoginAttemptRows = {
  async insert(attemptedAt) {
    await db.insert(loginAttempts).values({ attemptedAt });
  },
  async latestSince(since, limit) {
    const found = await db
      .select({ attemptedAt: loginAttempts.attemptedAt })
      .from(loginAttempts)
      .where(gt(loginAttempts.attemptedAt, since))
      .orderBy(desc(loginAttempts.attemptedAt))
      .limit(limit);
    return found.map((row) => row.attemptedAt);
  },
  async deleteBefore(cutoff) {
    await db.delete(loginAttempts).where(lte(loginAttempts.attemptedAt, cutoff));
  },
  async deleteAll() {
    await db.delete(loginAttempts);
  },
};

export const loginThrottle = createLoginThrottle(databaseLoginAttemptRows);
