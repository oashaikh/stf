# Receipt extraction agent procedure

The receipt extraction agent reads an owner's uploaded receipt and suggests date, vendor, amounts, and category. Every suggestion is a draft. Nothing is saved until the owner confirms.

## What the model may read

One receipt file belonging to the owner only.

- A receipt image (JPEG or PNG) or PDF that the owner uploaded and marked as ready.
- Images are sent to the API as image input; PDFs are sent as document input (no PDF-to-image step).
- The agent cannot read other receipts, other users' files, or any data beyond the receipt file itself.
- Receipt content never appears in logs.

## What the model may write

Draft suggestions only. **Nothing is written to transactions.**

- One `receipt_extractions` row per field (date, vendor, total_pence, vat_pence, category), with `suggested_value` and `confidence`.
- Four columns in the `receipts` row: `ai_status` ('extracted', 'failed', or 'skipped'), `ai_model` (e.g. 'claude-haiku-4-5-20251001'), `ai_confidence` (0–1000, integer thousandths), and `ai_raw_output` (the full JSON response from the model).
- One audit event: actor_type `ai_agent`, action `receipt_extraction`, resource_type `receipts`, metadata with model name and status only (no receipt content, values, or file paths).
- Nothing to `transactions` or `transaction_lines`.

## What triggers it

An owner's request to extract one ready receipt.

- The owner calls the extraction route from the UI with a valid session.
- The route verifies the receipt belongs to the owner and has `upload_status = ready`.
- One request extracts one receipt; no batch or scheduled extraction.
- Extraction runs once per receipt and does not replace previous suggestions if called again.

## What the owner sees before anything is saved

Every suggested field is a draft shown in plain words. Nothing is saved to the database until the owner confirms it.

- The UI shows date, vendor, total amount, VAT, and category in plain language (e.g., "Total (including tax): £12.99", not "total_pence: 1299").
- Each field shows the suggested value, confidence as a percentage (0–100%), and an "Edit" or "Confirm" button.
- The flow is one field per screen, with "Back" and "Save and leave" buttons (following `docs/design/ease-of-use.md`).
- Once all fields are confirmed, the owner can create a transaction or discard the suggestions.
- If extraction fails or is not a receipt, the UI shows a plain-language error and the owner enters the receipt by hand.

## The audit event

One audit record per extraction, capturing only the outcome and model name.

- **Actor type:** `ai_agent` (AI operation, not a user action)
- **Action:** `receipt_extraction` (or similar name, implementation-specific)
- **Resource type:** `receipts`
- **Resource ID:** the receipt id
- **Metadata:** `{ "model": "claude-haiku-...", "status": "extracted" | "failed" | "skipped" }` — model name and outcome only
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

