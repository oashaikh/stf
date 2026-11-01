import type { BankFeedProvider } from './bankFeed.js';

export interface StagedBankLine {
  connectionId: string;
  providerTransactionId: string;
  /** ISO calendar date, YYYY-MM-DD. */
  date: string;
  /** Integer pence; negative for money out. */
  amountPence: number;
  description: string;
  status: 'unmatched';
  possibleDuplicate: boolean;
}

export interface BankImportConnection {
  id: string;
  providerAccountId: string;
  accessToken: string;
}

export interface BankImportStore {
  /** Active connections whose token has not expired, at most `limit`. */
  listConnections(limit: number, now: Date): Promise<BankImportConnection[]>;
  /** Staged lines dated `sinceDate` or later, bounded. */
  stagedSince(connectionId: string, sinceDate: string): Promise<StagedBankLine[]>;
  latestDate(connectionId: string): Promise<string | null>;
  /** Inserts and ignores any line whose connection and provider id already exist. */
  insertLines(lines: StagedBankLine[]): Promise<void>;
}

export interface BankImportSummary {
  connections: number;
  imported: number;
  flagged: number;
  failed: number;
}

const FIRST_IMPORT_DAYS = 90;
const MAX_CONNECTIONS_PER_RUN = 25;
const MAX_LINES_PER_CONNECTION = 500;

const sameLine = (line: Pick<StagedBankLine, 'date' | 'amountPence' | 'description'>) =>
  `${line.date}|${line.amountPence}|${line.description.trim().toLowerCase()}`;

/**
 * Stages new bank lines for review; nothing here touches the ledger. Resumes from the latest staged date
 * (inclusive, since a day's lines can arrive late) and relies on the provider id to drop repeats.
 */
export async function importBankTransactions(
  store: BankImportStore,
  provider: BankFeedProvider,
  now: Date,
  options: { maxLinesPerConnection?: number } = {},
): Promise<BankImportSummary> {
  const maxLines = options.maxLinesPerConnection ?? MAX_LINES_PER_CONNECTION;
  // ponytail: first N connections by id each run; beyond MAX_CONNECTIONS_PER_RUN, rotate by last-imported time.
  const connections = await store.listConnections(MAX_CONNECTIONS_PER_RUN, now);
  const summary: BankImportSummary = { connections: connections.length, imported: 0, flagged: 0, failed: 0 };

  for (const connection of connections) {
    try {
      const firstDate = new Date(now.getTime() - FIRST_IMPORT_DAYS * 86_400_000).toISOString().slice(0, 10);
      const sinceDate = (await store.latestDate(connection.id)) ?? firstDate;
      const fetched = await provider.listTransactions(connection.accessToken, connection.providerAccountId, sinceDate);
      const staged = await store.stagedSince(connection.id, sinceDate);
      const knownIds = new Set(staged.map((line) => line.providerTransactionId));
      const seenLines = new Set(staged.map(sameLine));

      const fresh = fetched
        .filter((transaction) => !knownIds.has(transaction.id))
        .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
        .slice(0, maxLines);
      const lines: StagedBankLine[] = fresh.map((transaction) => {
        const key = sameLine(transaction);
        const possibleDuplicate = seenLines.has(key);
        seenLines.add(key);
        return {
          connectionId: connection.id,
          providerTransactionId: transaction.id,
          date: transaction.date,
          amountPence: transaction.amountPence,
          description: transaction.description,
          status: 'unmatched',
          possibleDuplicate,
        };
      });
      if (lines.length > 0) await store.insertLines(lines);
      summary.imported += lines.length;
      summary.flagged += lines.filter((line) => line.possibleDuplicate).length;
    } catch (error) {
      // The class only: the message could echo provider response text.
      console.error(`[import-bank-transactions] connection failed: ${error instanceof Error ? error.name : typeof error}`);
      summary.failed += 1;
    }
  }
  return summary;
}
