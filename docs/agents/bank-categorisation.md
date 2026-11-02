# Bank-line categorisation agent procedure

The categorisation agent suggests which account a bank payment belongs to. Every suggestion is a draft. Nothing is posted to the ledger, and the owner confirms each one.

## What the model may read

Unmatched bank lines of the signed-in owner, plus the names of their accounts.

- For each line: a temporary request number, the description, the amount in pence and the date.
- The owner's account list: account id, code and name only.
- Not sent: the owner's name, email, bank account number, sort code, bank reference ids, other lines, receipts or any other record.
- Bank descriptions can contain a payee's name. They go to Anthropic, which is the same third party as receipt extraction ([receipt-extraction.md](receipt-extraction.md)). Only lines the owner chose to sort are sent, and the prompt tells the model to ignore any instruction inside a description.
- A request holds at most 25 lines.

## What the model may write

Suggestions on the bank line only. **Nothing is written to transactions or transaction_lines.**

- `bank_transactions.suggested_account_id` and `bank_transactions.suggestion_confidence` (integer 0 to 100, percent).
- The suggested account must be one of the owner's own accounts from the list sent; any other id in the reply is dropped.
- One audit event per request (below).
- Only unmatched lines are sent. Asking again for a line replaces its earlier suggestion.

## What triggers it

The owner taps "Suggest" in Sort bank payments. Nothing runs on a schedule, on import or in the background.

- The route is `POST api/bank/categorise.ts`, behind the signed session cookie.
- The body lists the line ids the owner wants sorted. Each id must belong to the owner and be unmatched, else 404 and no model call.
- Each owner can make at most 20 requests per hour (requests skipped by the kill switch do not count); more get a 429 and no model call.

## What the owner sees

A plain-words suggestion beside each payment, for example "This looks like Travel (about 80% sure)". The confidence is shown as a percentage.

- One tap on "Yes, that is right" creates a draft entry through the STF-38 flow. The owner can still edit it before it is confirmed.
- "No, I'll pick one" opens the normal account picker and hides the suggestion on screen. The stored suggestion columns are written but not yet read back, so a reload asks again.
- Official account names appear in small muted text only, following `docs/design/ease-of-use.md`.
- Accepting never happens automatically, in bulk by default, or without the owner's tap.

## The audit event

- **Actor type:** `ai_agent`
- **Action:** `bank_line.categorise`
- **Resource type:** `bank_transaction`, with the line id when one line was requested
- **Metadata:** `{ "status": "suggested" | "failed" | "skipped", "lineCount": n, "suggestedCount": n }`
- **Never logged:** descriptions, amounts, account names, the prompt, the reply or the API key. Error logs carry the status and the owner id only.
- Accepting a suggestion is a separate, user-actor audit event written by the STF-38 draft-entry path.

## The kill switch

The agent uses the same switches as receipt extraction. The names are set by STF-7 and are in `.env.example`; read them from there, not from this page, if they ever change.

- `ANTHROPIC_API_KEY`: if unset, no call is made.
- `RECEIPT_AI_MODEL`: the Claude model id (currently `claude-haiku-4-5-20251001`).
- `RECEIPT_AI_ENABLED`: set to `false` to turn all AI suggestions off, even with the key set.

When off, the route makes no Anthropic call, stores no suggestion, writes a `skipped` audit event and returns that status. The owner sorts payments by hand.

## When the call fails

A network error, a timeout or a reply that does not match the expected shape stores nothing, writes a `failed` audit event and returns a plain-language error. The owner sorts the payments by hand. A partly valid reply keeps only the valid lines; the rest stay unsuggested. Nothing is retried automatically.

## Retention and deletion

Suggestions live on the bank line and follow its retention. When the line is soft-deleted (`deleted_at` set) they stay with it and are removed under the same deletion path. Anthropic receives descriptions for the request only; the audit event holds no line content.
