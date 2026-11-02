import { eq } from 'drizzle-orm';

import { users } from '../../server/src/db/schema.js';
import { db } from './db.js';

export const SETUP_STEPS = ['business_type', 'vat', 'hmrc', 'bank'] as const;
export const BUSINESS_TYPES = ['sole_trader', 'partnership', 'limited_company'] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export interface SetupProgress {
  businessType: BusinessType;
  /** Null until the user has answered. */
  vatRegistered: boolean | null;
  skippedSteps: SetupStep[];
  finishedAt: Date | null;
}

/** What a client may send. There is no finishedAt: the server stamps it when finish is true. */
export interface SetupUpdate {
  businessType?: BusinessType;
  vatRegistered?: boolean;
  skippedSteps?: SetupStep[];
  finish?: true;
}

export type ParsedSetupUpdate = { ok: true; update: SetupUpdate } | { ok: false };

const isOneOf = <T extends string>(allowed: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value);

/** Unknown keys are ignored; known keys must be valid. At least one known key is required. */
export function parseSetupUpdate(body: unknown): ParsedSetupUpdate {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false };
  const input = body as Record<string, unknown>;
  const update: SetupUpdate = {};

  if ('businessType' in input) {
    if (!isOneOf(BUSINESS_TYPES, input.businessType)) return { ok: false };
    update.businessType = input.businessType;
  }
  if ('vatRegistered' in input) {
    if (typeof input.vatRegistered !== 'boolean') return { ok: false };
    update.vatRegistered = input.vatRegistered;
  }
  if ('skippedSteps' in input) {
    const steps = input.skippedSteps;
    if (!Array.isArray(steps) || !steps.every((step) => isOneOf(SETUP_STEPS, step)) || new Set(steps).size !== steps.length) {
      return { ok: false };
    }
    update.skippedSteps = steps;
  }
  if ('finish' in input) {
    if (input.finish !== true) return { ok: false };
    update.finish = true;
  }
  return Object.keys(update).length === 0 ? { ok: false } : { ok: true, update };
}

export interface SetupProgressStore {
  /** Undefined when the user row does not exist. */
  get(userId: string): Promise<SetupProgress | undefined>;
  update(userId: string, update: SetupUpdate, finishedAt: Date): Promise<void>;
}

// Each query filters on users.id (primary key) and touches one row.
export const databaseSetupProgressStore: SetupProgressStore = {
  async get(userId) {
    const [row] = await db
      .select({
        businessType: users.businessType,
        vatRegistered: users.vatRegistered,
        skippedSteps: users.setupSkippedSteps,
        finishedAt: users.setupFinishedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row && { ...row, skippedSteps: row.skippedSteps as SetupStep[] };
  },

  async update(userId, update, finishedAt) {
    await db
      .update(users)
      .set({
        ...(update.businessType && { businessType: update.businessType }),
        ...(update.vatRegistered !== undefined && { vatRegistered: update.vatRegistered }),
        ...(update.skippedSteps && { setupSkippedSteps: update.skippedSteps }),
        ...(update.finish && { setupFinishedAt: finishedAt }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  },
};
