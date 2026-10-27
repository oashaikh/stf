import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { TAX_BANDS } from '../../src/lib/taxBands.js';
import { taxYearPeriod } from '../../src/lib/taxYearSummary.js';
import { auditEvents, tradingAllowanceChoices } from '../../server/src/db/schema.js';
import { db } from './db.js';

export const tradingAllowanceMethods = ['actual', 'allowance'] as const;
export type TradingAllowanceMethod = (typeof tradingAllowanceMethods)[number];

const taxYearField = z
  .string()
  .refine((taxYear) => Object.keys(TAX_BANDS).includes(taxYear) && taxYearPeriod(taxYear) !== null, 'Unknown tax year');

export const taxYearQuerySchema = z.object({ taxYear: taxYearField });
export const tradingAllowanceChoiceSchema = z.object({ taxYear: taxYearField, method: z.enum(tradingAllowanceMethods) });

export interface TradingAllowanceStore {
  /** Undefined when the owner has not chosen for that year (the default is actual expenses). */
  get(userId: string, taxYear: string): Promise<TradingAllowanceMethod | undefined>;
  /** Upserts the choice. Writes an audit event in the same transaction only when the method changes. */
  set(userId: string, taxYear: string, method: TradingAllowanceMethod): Promise<TradingAllowanceMethod>;
}

// Query audit: every query filters on (user_id, tax_year), covered by the unique index, and touches one row.
export const databaseTradingAllowanceStore: TradingAllowanceStore = {
  async get(userId, taxYear) {
    const [row] = await db
      .select({ method: tradingAllowanceChoices.method })
      .from(tradingAllowanceChoices)
      .where(and(eq(tradingAllowanceChoices.userId, userId), eq(tradingAllowanceChoices.taxYear, taxYear)))
      .limit(1);
    return row?.method;
  },

  async set(userId, taxYear, method) {
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: tradingAllowanceChoices.id, method: tradingAllowanceChoices.method })
        .from(tradingAllowanceChoices)
        .where(and(eq(tradingAllowanceChoices.userId, userId), eq(tradingAllowanceChoices.taxYear, taxYear)))
        .limit(1)
        .for('update');
      if (existing?.method === method) return method;
      // The unique index makes a concurrent first insert for the same year conflict into an update.
      const [saved] = await tx
        .insert(tradingAllowanceChoices)
        .values({ userId, taxYear, method })
        .onConflictDoUpdate({
          target: [tradingAllowanceChoices.userId, tradingAllowanceChoices.taxYear],
          set: { method, updatedAt: new Date() },
        })
        .returning({ id: tradingAllowanceChoices.id });
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'trading_allowance.update',
        resourceType: 'trading_allowance_choice',
        resourceId: saved.id,
        beforeSnapshot: { taxYear, method: existing?.method ?? null },
        afterSnapshot: { taxYear, method },
      });
      return method;
    });
  },
};
