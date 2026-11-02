import { daysApart } from './bankMatching';

export interface DuplicateCandidate {
  id: string;
  date: string; // ISO yyyy-mm-dd
  grossPence: number;
  reference: string;
  description: string;
}

export interface DuplicateFlag {
  /** Stable across reloads and input order, so a dismissal can be remembered. */
  key: string;
  entryIds: [string, string];
}

const DUPLICATE_WINDOW_DAYS = 3;

// The reference is the supplier when the owner typed one; the description is the next best name.
const supplierName = (entry: DuplicateCandidate) =>
  (entry.reference.trim() || entry.description).trim().replace(/\s+/g, ' ').toLowerCase();

/** Pairs of entries with the same gross pence and supplier, dated within 3 days. Advisory only. */
export function findDuplicateEntries(entries: DuplicateCandidate[]): DuplicateFlag[] {
  const flags: DuplicateFlag[] = [];
  for (let first = 0; first < entries.length; first++) {
    for (let second = first + 1; second < entries.length; second++) {
      const a = entries[first];
      const b = entries[second];
      if (
        a.grossPence === b.grossPence &&
        supplierName(a) === supplierName(b) &&
        daysApart(a.date, b.date) <= DUPLICATE_WINDOW_DAYS
      ) {
        const entryIds = (a.id < b.id ? [a.id, b.id] : [b.id, a.id]) as [string, string];
        flags.push({ key: entryIds.join('|'), entryIds });
      }
    }
  }
  return flags;
}
