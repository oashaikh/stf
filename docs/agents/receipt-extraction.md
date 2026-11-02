# Receipt extraction agent procedure

The receipt extraction agent reads an owner's uploaded receipt and suggests date, vendor, amounts, and category. Every suggestion is a draft. Nothing is saved until the owner confirms.

## What the model may read

One receipt file belonging to the owner only.

- A receipt image (JPEG, PNG or WebP) or PDF that the owner uploaded and marked as ready.
- Images are sent to the API as image input; PDFs are sent as document input (no PDF-to-image step).
- The agent cannot read other receipts, other users' files, or any data beyond the receipt file itself.
- Receipt content never appears in logs.

## What the model may write

Draft suggestions only. **Nothing is written to transactions.**

- One `receipt_extractions` row per field (date, vendor, total_pence, vat_pence, category), with `suggested_value` and `confidence`.
- Four columns in the `receipts` row: `ai_status` ('extracted', 'failed', or 'skipped'), `ai_model` (e.g. 'claude-haiku-4-5-20251001'), `ai_confidence` (0–1000, integer thousandths), and `ai_raw_output` (the full JSON response from the model).
- One audit event: actor_type `ai_agent`, action `receipt.extract`, resource_type `receipt`, metadata `{ status, fieldCount }` only (no receipt content, values, or file paths).
- Nothing to `transactions` or `transaction_lines`.

## What triggers it

An owner's request to extract one ready receipt.

- The owner calls the extraction route from the UI with a valid session.
- The route verifies the receipt belongs to the owner and has `upload_status = ready`.
- One request extracts one receipt; no batch or scheduled extraction.
- Extraction runs once per receipt. If the receipt already has suggestions (`ai_status = extracted`) or is attached to a transaction, a repeat call makes no model call and writes nothing; it returns the `extracted` status. A receipt that was `failed` or `skipped` can be tried again.
- Each owner can run at most 20 extractions per hour; further calls get a 429 and no model call, and the owner enters the receipt by hand.

## What the owner sees before anything is saved

Every suggested field is a draft shown in plain words. Nothing is saved to the database until the owner confirms it.

- On the Receipts page, a receipt with unchecked suggestions shows "Check these details". It opens the review at `/money-out/receipts/:receiptId`. There is no confirm button on the list, so nothing is confirmed without opening the review.
- The review is one page, not one field per screen as `docs/design/ease-of-use.md` describes. The receipt (photo or PDF) sits on one side and the suggested date, who it was from, total, tax paid and category on the other. On a phone they stack.
- Each field has a marker: "Sure", or "Check this one" with a highlight when the model's confidence is under 700 out of 1000 or missing. Every field is editable. Category is chosen from the owner's active expense accounts.
- "Confirm" sends the values as they stand in the form, edited or not, and creates the expense. A link to the new entry is then shown. "Discard" asks first, then drops the draft.
- After discarding, the owner returns to the Receipts list. The list and the expenses refresh after either action.
- If extraction fails or is not a receipt, the UI shows a plain-language error and the owner enters the receipt by hand.

## The audit event

One audit record per extraction, capturing only the outcome and the number of fields suggested.

- **Actor type:** `ai_agent` (AI operation, not a user action)
- **Action:** `receipt.extract`
- **Resource type:** `receipt`
- **Resource ID:** the receipt id
- **Metadata:** `{ "status": "extracted" | "failed" | "skipped", "fieldCount": n }` — `fieldCount` is present only when extracted; the model name is kept in `receipts.ai_model`
- **Never logged:** receipt content, suggested values, owner's email, error codes, file paths, or API request/response bodies
- **On failure:** `ai_status` is set to `failed` and no extraction rows are created

## The kill switch

Extraction can be disabled in two ways: by not setting the API key, or by setting a feature flag.

**Environment variables:**
- `ANTHROPIC_API_KEY` — the API key from Anthropic. If not set, extraction is skipped. This is the safe default for development.
- `RECEIPT_AI_MODEL` — the Claude model ID (default: `claude-haiku-4-5-20251001`). Documented in `.env.example`.
- `RECEIPT_AI_ENABLED` — feature flag (default: `true`). Set to `false` to disable extraction globally, even with the API key set.

**When extraction is disabled:**
- The route skips the Anthropic API call.
- `receipts.ai_status` is set to `skipped`.
- No extraction rows are created.
- The owner enters the receipt by hand.
- An audit event is logged with status `skipped`.

## Retention and deletion

`receipts.ai_raw_output` and the `receipt_extractions` rows hold what the model read from the receipt (vendor, date, amounts). They are kept for as long as the receipt is kept and follow the receipt's retention. When the receipt is soft-deleted (`deleted_at` set), they stay with it and are removed or anonymised together with the receipt file under the same deletion path. The audit event holds no receipt content.
