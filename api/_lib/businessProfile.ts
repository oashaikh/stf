import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { auditEvents, users } from '../../server/src/db/schema.js';
import { db } from './db.js';

// Blank form fields arrive as empty strings; store them as null.
const optionalText = (max: number) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), z.string().trim().max(max).nullable());

export const businessProfileSchema = z.object({
  businessName: optionalText(120),
  businessAddress: optionalText(500),
  paymentBankName: optionalText(80),
  paymentSortCode: z.preprocess((value) => (value === '' ? null : value), z.string().regex(/^\d{6}$/, 'Sort code must be 6 digits').nullable()),
  paymentAccountNumber: z.preprocess((value) => (value === '' ? null : value), z.string().regex(/^\d{8}$/, 'Account number must be 8 digits').nullable()),
  invoicePrefix: z.string().trim().min(1).max(12),
  nextInvoiceNumber: z.number().int().min(1).max(999_999_999),
});

export type BusinessProfile = z.infer<typeof businessProfileSchema>;

/** Keeps the last 4 digits so an audit reader can tell which account without holding the number. */
export const maskAccountNumber = (accountNumber: string | null) =>
  accountNumber === null ? null : `${'•'.repeat(Math.max(accountNumber.length - 4, 0))}${accountNumber.slice(-4)}`;

export const maskProfileForAudit = (profile: BusinessProfile): BusinessProfile => ({
  ...profile,
  paymentAccountNumber: maskAccountNumber(profile.paymentAccountNumber),
});

export interface BusinessProfileStore {
  /** Undefined when the user row does not exist. */
  get(userId: string): Promise<BusinessProfile | undefined>;
  /** Undefined when the user row does not exist. Writes the audit event atomically. */
  update(userId: string, profile: BusinessProfile): Promise<BusinessProfile | undefined>;
}

const profileColumns = {
  businessName: users.businessName,
  businessAddress: users.businessAddress,
  paymentBankName: users.paymentBankName,
  paymentSortCode: users.paymentSortCode,
  paymentAccountNumber: users.paymentAccountNumber,
  invoicePrefix: users.invoicePrefix,
  nextInvoiceNumber: users.nextInvoiceNumber,
};

// Query audit: every query filters on users.id (primary key, from the session) and touches one row.
export const databaseBusinessProfileStore: BusinessProfileStore = {
  async get(userId) {
    const [row] = await db.select(profileColumns).from(users).where(eq(users.id, userId)).limit(1);
    return row;
  },

  async update(userId, profile) {
    return db.transaction(async (tx) => {
      const [before] = await tx.select(profileColumns).from(users).where(eq(users.id, userId)).limit(1).for('update');
      if (!before) return undefined;
      const [after] = await tx.update(users).set({ ...profile, updatedAt: new Date() }).where(eq(users.id, userId)).returning(profileColumns);
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'business_profile.update',
        resourceType: 'user',
        resourceId: userId,
        beforeSnapshot: maskProfileForAudit(before),
        afterSnapshot: maskProfileForAudit(after),
      });
      return after;
    });
  },
};
