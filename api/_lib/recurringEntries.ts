import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';

import { accounts, recurringEntryRuns, recurringEntryTemplates } from '../../server/src/db/schema.js';
import { dueDates, nextOccurrence, type RecurringSchedule } from '../../src/lib/recurringSchedule.js';
import { MAX_AMOUNT_PENCE } from '../../src/lib/entryForm.js';
import { db } from './db.js';
import { createEntry, EntryRuleError, isoDate, type EntryStore } from './entries.js';
import { plainText } from './inputRules.js';

export const RECURRING_LIST_LIMIT = 100;
/** Templates scanned per cron run; a larger backlog is picked up by the next run. */
export const RECURRING_RUN_LIMIT = 200;
/** Dates created per template per run, so a template left unattended for years cannot flood the drafts. */
export const RECURRING_DATES_PER_RUN = 12;

const vatRate = z.union([z.literal(0), z.literal(5), z.literal(20)]);

export const newTemplateSchema = z.object({
  kind: z.enum(['income', 'expense']),
  categoryAccountId: z.string().uuid(),
  amountPence: z.number().int().positive().max(MAX_AMOUNT_PENCE),
  amountIs: z.enum(['gross', 'net']),
  vatRatePercent: vatRate.default(0),
  description: plainText(200, { required: true }),
  schedule: z.enum(['monthly', 'yearly']),
  nextDate: isoDate,
});
export type NewTemplate = z.infer<typeof newTemplateSchema>;

// Category, kind and schedule are fixed once created: change them by deleting and re-creating.
export const templatePatchSchema = z
  .object({
    amountPence: z.number().int().positive().max(MAX_AMOUNT_PENCE),
    amountIs: z.enum(['gross', 'net']),
    vatRatePercent: vatRate,
    description: plainText(200, { required: true }),
    nextDate: isoDate,
    paused: z.boolean(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to change');
export type TemplatePatch = z.infer<typeof templatePatchSchema>;

/** Explicit columns only (SEC-12): no user_id in responses. */
export interface Template {
  id: string;
  kind: 'income' | 'expense';
  categoryAccountId: string;
  amountPence: number;
  amountIs: 'gross' | 'net';
  vatRatePercent: number;
  description: string;
  schedule: RecurringSchedule;
  anchorDay: number;
  nextDate: string;
  paused: boolean;
}

export interface DueTemplate extends Omit<Template, 'paused'> {
  userId: string;
}

// Injected like EntryStore so tests never touch a database. Everything except due() is scoped by userId.
export interface RecurringStore {
  list(userId: string, limit: number): Promise<Template[]>;
  create(userId: string, input: NewTemplate, anchorDay: number): Promise<Template>;
  /** Undefined when it is not the owner's live template. */
  update(userId: string, templateId: string, patch: TemplatePatch & { anchorDay?: number }): Promise<Template | undefined>;
  /** The owner's live template, or undefined. */
  find(userId: string, templateId: string): Promise<Template | undefined>;
  softDelete(userId: string, templateId: string): Promise<boolean>;
  ownsCategory(userId: string, categoryAccountId: string): Promise<boolean>;
  /** Cron scan across owners: live, unpaused templates with next_date on or before today, at most `limit`. */
  due(today: string, limit: number): Promise<DueTemplate[]>;
  hasRun(templateId: string, runDate: string): Promise<boolean>;
  /** Moves next_date for a date that already ran, so an owner edit onto a run date cannot leave the template stuck. */
  advance(template: DueTemplate, nextDate: string): Promise<void>;
  /** In one database transaction: records the run and moves next_date. False, and nothing changed, when the date already ran. */
  recordRun(template: DueTemplate, runDate: string, transactionId: string, nextDate: string): Promise<boolean>;
}

const dayOf = (date: string) => Number(date.slice(8, 10));

export const listTemplates = (store: RecurringStore, userId: string) => store.list(userId, RECURRING_LIST_LIMIT);

export async function createTemplate(store: RecurringStore, userId: string, input: NewTemplate): Promise<Template> {
  if (!(await store.ownsCategory(userId, input.categoryAccountId))) {
    throw new EntryRuleError(422, 'INVALID_ACCOUNT', 'Category must be one of your active accounts matching the kind', 'categoryAccountId');
  }
  return store.create(userId, input, dayOf(input.nextDate));
}

export async function updateTemplate(store: RecurringStore, userId: string, templateId: string, patch: TemplatePatch): Promise<Template> {
  // The anchor only moves when the owner picks a different date: a clamped date (28 Feb for a 31st template) must not become the new anchor.
  const current = patch.nextDate ? await store.find(userId, templateId) : undefined;
  const moved = patch.nextDate !== undefined && current !== undefined && patch.nextDate !== current.nextDate;
  const template = await store.update(userId, templateId, moved ? { ...patch, anchorDay: dayOf(patch.nextDate as string) } : patch);
  if (!template) throw new EntryRuleError(404, 'NOT_FOUND', 'Template not found');
  return template;
}

export async function deleteTemplate(store: RecurringStore, userId: string, templateId: string): Promise<void> {
  if (!(await store.softDelete(userId, templateId))) throw new EntryRuleError(404, 'NOT_FOUND', 'Template not found');
}

export interface GenerateResult {
  created: number;
  skipped: number;
}

/**
 * Turns every due template date into a draft through createEntry, the one posting function.
 * Nothing is confirmed here: the owner confirms drafts from the Expenses list. A date that cannot
 * be posted (closed VAT period, too far ahead, archived category) leaves the template's next_date
 * unchanged and is logged by template id only; the other templates still run.
 */
export async function generateDueEntries(store: RecurringStore, entryStore: EntryStore, now: Date): Promise<GenerateResult> {
  const today = now.toISOString().slice(0, 10);
  const result: GenerateResult = { created: 0, skipped: 0 };
  for (const template of await store.due(today, RECURRING_RUN_LIMIT)) {
    // ponytail: a template stuck on a closed period sorts first in due() and is retried every run; with 200 stuck templates the rest starve. Upgrade: pause or surface stuck templates to the owner.
    const { dates } = dueDates(template.nextDate, template.schedule, template.anchorDay, today, RECURRING_DATES_PER_RUN);
    for (const date of dates) {
      const following = nextOccurrence(date, template.schedule, template.anchorDay);
      try {
        // The draft is written by createEntry in its own transaction, so no run is claimed over a network call.
        // The date already ran (a race, or the owner moved next_date back onto it): move past it without a second draft.
        if (await store.hasRun(template.id, date)) {
          await store.advance(template, following);
          continue;
        }
        const entry = await createEntry(
          entryStore,
          template.userId,
          {
            date,
            description: template.description,
            kind: template.kind,
            categoryAccountId: template.categoryAccountId,
            amountPence: template.amountPence,
            amountIs: template.amountIs,
            vatRatePercent: template.vatRatePercent as 0 | 5 | 20,
            status: 'draft',
          },
          now,
        );
        let recorded = false;
        try {
          recorded = await store.recordRun(template, date, entry.id, following);
        } finally {
          // Lost the race, or the claim failed: no run row points at this draft, so void it or the next run duplicates the date.
          if (!recorded) await entryStore.void(template.userId, entry.id);
        }
        if (!recorded) continue;
        result.created += 1;
      } catch (error) {
        result.skipped += 1;
        console.warn(`recurring template ${template.id} skipped: ${error instanceof EntryRuleError ? error.code : (error as Error).name}`);
        break;
      }
    }
  }
  return result;
}

const templateColumns = {
  id: recurringEntryTemplates.id,
  kind: recurringEntryTemplates.kind,
  categoryAccountId: recurringEntryTemplates.categoryAccountId,
  amountPence: recurringEntryTemplates.amountPence,
  amountIs: recurringEntryTemplates.amountIs,
  vatRatePercent: recurringEntryTemplates.vatRatePercent,
  description: recurringEntryTemplates.description,
  schedule: recurringEntryTemplates.schedule,
  anchorDay: recurringEntryTemplates.anchorDay,
  nextDate: recurringEntryTemplates.nextDate,
  paused: recurringEntryTemplates.paused,
};

const toTemplate = (row: { vatRatePercent: number | null } & Omit<Template, 'vatRatePercent'>): Template => ({ ...row, vatRatePercent: row.vatRatePercent ?? 0 });

const ownedLive = (userId: string, templateId: string) =>
  and(eq(recurringEntryTemplates.id, templateId), eq(recurringEntryTemplates.userId, userId), isNull(recurringEntryTemplates.deletedAt));

// Query audit: list uses recurring_entry_templates_user_list_idx (user_id, deleted_at, next_date) with LIMIT;
// the cron scan uses recurring_entry_templates_next_date_idx with LIMIT; id lookups use the primary key and
// always carry user_id; the run check and insert use the (template_id, run_date) unique index.
export const databaseRecurringStore: RecurringStore = {
  async list(userId, limit) {
    const rows = await db
      .select(templateColumns)
      .from(recurringEntryTemplates)
      .where(and(eq(recurringEntryTemplates.userId, userId), isNull(recurringEntryTemplates.deletedAt)))
      .orderBy(asc(recurringEntryTemplates.nextDate), asc(recurringEntryTemplates.id))
      .limit(limit);
    return rows.map(toTemplate);
  },

  async create(userId, input, anchorDay) {
    const [row] = await db.insert(recurringEntryTemplates).values({ ...input, userId, anchorDay }).returning(templateColumns);
    return toTemplate(row);
  },

  async update(userId, templateId, patch) {
    const [row] = await db
      .update(recurringEntryTemplates)
      .set({ ...patch, updatedAt: new Date() })
      .where(ownedLive(userId, templateId))
      .returning(templateColumns);
    return row ? toTemplate(row) : undefined;
  },

  async find(userId, templateId) {
    const [row] = await db.select(templateColumns).from(recurringEntryTemplates).where(ownedLive(userId, templateId)).limit(1);
    return row ? toTemplate(row) : undefined;
  },

  async softDelete(userId, templateId) {
    const rows = await db
      .update(recurringEntryTemplates)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(ownedLive(userId, templateId))
      .returning({ id: recurringEntryTemplates.id });
    return rows.length > 0;
  },

  async ownsCategory(userId, categoryAccountId) {
    const [row] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, categoryAccountId), eq(accounts.userId, userId), isNull(accounts.archivedAt)))
      .limit(1);
    return Boolean(row);
  },

  async due(today, limit) {
    const rows = await db
      .select({ ...templateColumns, userId: recurringEntryTemplates.userId })
      .from(recurringEntryTemplates)
      .where(and(eq(recurringEntryTemplates.paused, false), isNull(recurringEntryTemplates.deletedAt), lte(recurringEntryTemplates.nextDate, today)))
      .orderBy(asc(recurringEntryTemplates.nextDate))
      .limit(limit);
    return rows.map(({ paused: _paused, ...row }) => ({ ...toTemplate({ ...row, paused: _paused }), userId: row.userId }));
  },

  async hasRun(templateId, runDate) {
    const [row] = await db
      .select({ templateId: recurringEntryRuns.templateId })
      .from(recurringEntryRuns)
      .where(and(eq(recurringEntryRuns.templateId, templateId), eq(recurringEntryRuns.runDate, runDate)))
      .limit(1);
    return Boolean(row);
  },

  async advance(template, nextDate) {
    await db
      .update(recurringEntryTemplates)
      .set({ nextDate, updatedAt: new Date() })
      .where(and(eq(recurringEntryTemplates.id, template.id), eq(recurringEntryTemplates.userId, template.userId)));
  },

  async recordRun(template, runDate, transactionId, nextDate) {
    return db.transaction(async (tx) => {
      const claimed = await tx
        .insert(recurringEntryRuns)
        .values({ templateId: template.id, runDate, transactionId })
        .onConflictDoNothing({ target: [recurringEntryRuns.templateId, recurringEntryRuns.runDate] })
        .returning({ templateId: recurringEntryRuns.templateId });
      if (claimed.length === 0) return false;
      await tx
        .update(recurringEntryTemplates)
        .set({ nextDate, updatedAt: new Date() })
        .where(and(eq(recurringEntryTemplates.id, template.id), eq(recurringEntryTemplates.userId, template.userId)));
      return true;
    });
  },
};
