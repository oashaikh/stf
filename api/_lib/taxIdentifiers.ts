import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { auditEvents, users } from '../../server/src/db/schema.js';
import { decryptToken, encryptToken } from '../../server/src/lib/hmrcCrypto.js';
import { db } from './db.js';

// Spaces and case are presentation; blank clears; omitted leaves the stored value alone.
const identifier = (pattern: RegExp, message: string, fold: (value: string) => string) =>
  z
    .preprocess(
      (value) => (typeof value === 'string' ? fold(value.replace(/\s+/g, '')) || null : value),
      z.string().regex(pattern, message).nullable(),
    )
    .optional();

// HMRC rule: no D/F/I/Q/U/V in the prefix letters, no O in the second, and not BG, GB, KN, NK, NT, TN or ZZ.
const NINO_PATTERN = /^(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/;

export const taxIdentifiersSchema = z.object({
  nino: identifier(NINO_PATTERN, 'National Insurance number must look like QQ123456C', (value) => value.toUpperCase()),
  utr: identifier(/^\d{10}$/, 'UTR must be 10 digits', (value) => value),
});

export type TaxIdentifiersInput = z.infer<typeof taxIdentifiersSchema>;

/** What the users row holds: encrypt/decrypt output, never plaintext. */
export interface StoredTaxIdentifiers {
  ninoEncrypted: string | null;
  utrEncrypted: string | null;
}

export type StoredTaxIdentifiersPatch = Partial<StoredTaxIdentifiers>;

const maskTail = (value: string, visible: number) => `${'•'.repeat(Math.max(value.length - visible, 0))}${value.slice(-visible)}`;

export const maskNino = (nino: string) => maskTail(nino, 3);
export const maskUtr = (utr: string) => maskTail(utr, 4);

export interface MaskedTaxIdentifiers {
  nino: string | null;
  utr: string | null;
}

/** The only shape that leaves the server, and the only one the audit log sees. */
export const maskStored = (stored: StoredTaxIdentifiers): MaskedTaxIdentifiers => ({
  nino: stored.ninoEncrypted === null ? null : maskNino(decryptToken(stored.ninoEncrypted)),
  utr: stored.utrEncrypted === null ? null : maskUtr(decryptToken(stored.utrEncrypted)),
});

/** Encrypts only the fields the caller sent; an omitted field is absent so the store leaves it alone. */
export function toStoredPatch(input: TaxIdentifiersInput): StoredTaxIdentifiersPatch {
  const patch: StoredTaxIdentifiersPatch = {};
  if (input.nino !== undefined) patch.ninoEncrypted = input.nino === null ? null : encryptToken(input.nino);
  if (input.utr !== undefined) patch.utrEncrypted = input.utr === null ? null : encryptToken(input.utr);
  return patch;
}

export interface TaxIdentifiersStore {
  /** Undefined when the user row does not exist. */
  get(userId: string): Promise<StoredTaxIdentifiers | undefined>;
  /** Undefined when the user row does not exist. Writes the audit event atomically. */
  update(userId: string, patch: StoredTaxIdentifiersPatch): Promise<StoredTaxIdentifiers | undefined>;
}

const identifierColumns = {
  ninoEncrypted: users.ninoEncrypted,
  utrEncrypted: users.utrEncrypted,
  legacyUtr: users.utr,
};

type IdentifierRow = StoredTaxIdentifiers & { legacyUtr: string | null };
type Executor = Pick<typeof db, 'update'>;

/** Moves a pre-encryption plain UTR into the encrypted column; the key lives in app env, so SQL cannot do it. */
async function encryptLegacyUtr(executor: Executor, userId: string, row: IdentifierRow): Promise<StoredTaxIdentifiers> {
  if (row.legacyUtr === null) return { ninoEncrypted: row.ninoEncrypted, utrEncrypted: row.utrEncrypted };
  const utrEncrypted = row.utrEncrypted ?? encryptToken(row.legacyUtr);
  await executor.update(users).set({ utrEncrypted, utr: null }).where(eq(users.id, userId));
  return { ninoEncrypted: row.ninoEncrypted, utrEncrypted };
}

// Query audit: every query filters on users.id (primary key, from the session) and touches one row.
export const databaseTaxIdentifiersStore: TaxIdentifiersStore = {
  async get(userId) {
    const [row] = await db.select(identifierColumns).from(users).where(eq(users.id, userId)).limit(1);
    return row && encryptLegacyUtr(db, userId, row);
  },

  async update(userId, patch) {
    return db.transaction(async (tx) => {
      const [row] = await tx.select(identifierColumns).from(users).where(eq(users.id, userId)).limit(1).for('update');
      if (!row) return undefined;
      const before = await encryptLegacyUtr(tx, userId, row);
      const after = { ...before, ...patch };
      await tx.update(users).set({ ...patch, updatedAt: new Date() }).where(eq(users.id, userId));
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'tax_identifiers.update',
        resourceType: 'user',
        resourceId: userId,
        beforeSnapshot: maskStored(before),
        afterSnapshot: maskStored(after),
      });
      return after;
    });
  },
};
