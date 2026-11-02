# Receipt extraction agent procedure

The receipt extraction agent reads an owner's uploaded receipt file and suggests values for date, vendor, amount, VAT, and category. Every suggestion is a draft; nothing is written to the ledger until the owner confirms each field.

## What the model may read

Only the owner's own ready receipt file.

- A single receipt file uploaded by the owner through the app, stored in the object storage bucket, identified by its receipt `id` and file key.
- The image or PDF is read raw: images are sent as image input to the API, PDFs are sent as document input (no conversion to image).
- The extraction route has no access to other receipts, other users' files, or any other personal data.
- Receipt content never appears in logs or audit trails.

## What the model may write

Draft suggestions only. No ledger transactions are ever created.

- One `receipt_extractions` row per field, with `suggested_value` and `confidence`. Four fields are extracted: date, vendor, total (in integer pence), and VAT (in integer pence). A fifth field, category, may be added later; the procedure already reserves it.
- Five columns on the `receipts` row: `ai_status` (set to `extracted` on success, `failed` on error, or `skipped` if extraction is disabled), `ai_model` (the Claude model ID used), `ai_confidence` (the overall confidence as an integer from 0 to 1000, where 1000 = 100%), and `ai_raw_output` (the full JSON response from Claude, for audit and replay). `ai_status` is set to `skipped` if the kill switch is off or no API key is configured.
- One audit event recording the extraction, with actor type `ai_agent`, never `user`. The action name is `receipt.extracted`, `receipt.extraction_failed`, or `receipt.extraction_skipped`. The resource type is `receipt` and the resource_id is the receipt `id`. The metadata holds only the model name and status, never the receipt content, file path, or extracted values.
- Nothing is written to `transactions` or `transaction_lines`.

## What triggers it

An owner-session request for one ready receipt.

- The owner calls `POST /api/receipts/:id/extract` with a valid session.
- The route verifies the receipt belongs to the owner and has `upload_status = ready`.
- No batch or scheduled extraction: one request, one receipt.
- If the request is made again for the same receipt, the previous suggestions remain and are not replaced.

## What the owner sees before anything is saved

Every field is a draft in plain words. Nothing becomes a record until they confirm.

- The UI shows one field at a time, with the suggested value, confidence as a percentage (0 to 100), and the toggle-able raw model response if needed for transparency.
- Date, vendor, amount, and VAT are shown in plain language with their full values (e.g., "Total (including tax): £12.99" not "total_pence: 1299").
- Every extracted field has a "Confirm" button for each one, or "Edit" to change the value.
- The UI follows the guidance in `docs/design/ease-of-use.md`: plain words, one thing per screen, a Back button, and "Save and leave" to pause.
- Once all fields are confirmed, the owner may create a transaction from them or discard the suggestions.
- If extraction fails or returns an error (not a receipt, malformed JSON, missing required fields), the UI shows the error in plain words and falls back to manual entry.

## The audit event

One record per extraction attempt, capturing only outcome and model details.

- **Actor type:** `ai_agent` — this is an AI operation, not a user action.
- **Action:** `receipt.extracted` on success, `receipt.extraction_failed` on failure, `receipt.extraction_skipped` if disabled.
- **Resource type:** `receipt`
- **Resource ID:** the receipt `id`
- **Metadata:** `{ "model": "claude-haiku-...", "status": "extracted" | "failed" | "skipped" }` — model name and outcome only.
- **Never in metadata:** the receipt file path, extracted values, owner's email, error codes, or request body.
- **On failure:** `ai_status` on the receipt row is set to `failed` and no extraction rows are created.

## The kill switch

Extraction is controlled by two mechanisms: the API key and the enabled flag.

- **Environment variables:**
  - `ANTHROPIC_API_KEY` — the owner's Anthropic API key (from console.anthropic.com). If not set, extraction is skipped.
  - `RECEIPT_AI_MODEL` — the Claude model ID (default: `claude-haiku-4-5-20251001`). Must match the documented default in `.env.example`.
  - `RECEIPT_AI_ENABLED` — boolean flag (default: `true`). Set to `false` to disable extraction globally, even if the API key is set.
- **No-key behaviour:** If `ANTHROPIC_API_KEY` is not set or `RECEIPT_AI_ENABLED` is `false`:
  - The extraction route skips the API call.
  - The `receipts` row has `ai_status = skipped`.
  - No extraction rows are created.
  - The owner is prompted to enter the receipt details by hand (the same form they would use if extraction failed).
  - An audit event `receipt.extraction_skipped` is logged with `{ "model": "claude-haiku-...", "status": "skipped" }`.

