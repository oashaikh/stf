// Provider-neutral bank feed boundary. A second open banking provider only has to implement this.
export interface BankAccount {
  id: string;
  name: string;
}

export interface BankTransaction {
  id: string;
  /** ISO calendar date, YYYY-MM-DD. */
  date: string;
  description: string;
  /** Integer pence; negative for money out. */
  amountPence: number;
}

export interface BankConsentTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface BankFeedProvider {
  /** Returns the URL the owner visits to grant read access. */
  startConsent(state: string): string;
  finishConsent(code: string, now?: Date): Promise<BankConsentTokens>;
  /** GBP accounts only; accounts in other currencies are dropped. */
  listAccounts(accessToken: string): Promise<BankAccount[]>;
  /** Transactions from `sinceDate` (YYYY-MM-DD) onwards. Throws on non-GBP or sub-penny amounts. */
  listTransactions(accessToken: string, accountId: string, sinceDate: string): Promise<BankTransaction[]>;
}

/** Converts a provider's decimal pounds to integer pence without floating-point arithmetic. */
export function poundsToPence(pounds: number): number {
  const text = String(pounds);
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error('Bank amount is not a whole number of pence');
  const pence = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -pence : pence;
}
