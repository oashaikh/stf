export interface BankLine {
  id: string;
  date: string; // ISO yyyy-mm-dd
  amountPence: number; // signed: money in positive, money out negative
  description: string;
}

export interface MatchableEntry {
  id: string;
  date: string; // ISO yyyy-mm-dd
  grossPence: number; // signed the same way as bank lines
}

export interface MatchProposal {
  lineId: string;
  entryId: string;
  kind: 'exact' | 'close';
}

export interface MatchResult {
  proposals: MatchProposal[];
  unmatchedLineIds: string[];
}

const CLOSE_WINDOW_DAYS = 3;
const MS_PER_DAY = 86_400_000;

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Both dates are plain calendar dates, so UTC parsing keeps the day count exact.
function daysApart(dateA: string, dateB: string): number {
  return Math.abs(Date.parse(dateA) - Date.parse(dateB)) / MS_PER_DAY;
}

/**
 * Propose which confirmed entry each bank line belongs to. Same amount and date is 'exact';
 * same amount within 3 days is 'close', nearest date first. An entry is proposed for at most
 * one line, exact matches claim entries before close ones, and ties fall to the lower id so
 * the output does not depend on input order.
 */
export function proposeMatches(lines: BankLine[], entries: MatchableEntry[]): MatchResult {
  const sortedLines = [...lines].sort(byId);
  const freeEntries = [...entries].sort(byId);
  const proposals: MatchProposal[] = [];
  let remainingLines = sortedLines;

  for (const kind of ['exact', 'close'] as const) {
    const maxDays = kind === 'exact' ? 0 : CLOSE_WINDOW_DAYS;
    const stillUnmatched: BankLine[] = [];
    for (const bankLine of remainingLines) {
      let bestIndex = -1;
      let bestDays = Infinity;
      freeEntries.forEach((candidate, index) => {
        if (candidate.grossPence !== bankLine.amountPence) return;
        const days = daysApart(candidate.date, bankLine.date);
        // Strict < keeps the lowest id on ties because freeEntries is sorted by id.
        if (days <= maxDays && days < bestDays) {
          bestDays = days;
          bestIndex = index;
        }
      });
      if (bestIndex === -1) {
        stillUnmatched.push(bankLine);
        continue;
      }
      const [claimed] = freeEntries.splice(bestIndex, 1);
      proposals.push({ lineId: bankLine.id, entryId: claimed.id, kind });
    }
    remainingLines = stillUnmatched;
  }

  proposals.sort((a, b) => (a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0));
  return { proposals, unmatchedLineIds: remainingLines.map((bankLine) => bankLine.id) };
}
