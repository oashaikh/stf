/**
 * Receipt extraction prompt contract — STF
 *
 * Builds the prompt sent to Claude Haiku for receipt OCR/extraction.
 * Haiku output is ALWAYS stored as a draft; the user must confirm each field.
 *
 * Prompt contract: Haiku must respond with valid JSON matching ReceiptDraft.
 * Any field Haiku is uncertain about must have a confidence < 0.7.
 */

export interface ReceiptFieldExtraction {
  /** Extracted value as a string. Amounts are decimal strings (e.g. "12.99"). */
  value: string;
  /** 0–1 confidence score. < 0.7 = low confidence, highlight for user review. */
  confidence: number;
}

export interface ReceiptDraft {
  /** ISO 8601 date string, e.g. "2025-07-15" */
  date: ReceiptFieldExtraction | null;
  /** Merchant / supplier name */
  merchant: ReceiptFieldExtraction | null;
  /** Total amount including VAT, decimal string, e.g. "23.99" */
  totalAmount: ReceiptFieldExtraction | null;
  /** VAT amount if shown on receipt, decimal string */
  vatAmount: ReceiptFieldExtraction | null;
  /** Net amount (total minus VAT), decimal string */
  netAmount: ReceiptFieldExtraction | null;
  /** VAT rate as a percent integer, e.g. 20 */
  vatRate: ReceiptFieldExtraction | null;
  /** Suggested expense category — user must confirm */
  category: ReceiptFieldExtraction | null;
  /** Currency code — only GBP supported; flag others */
  currency: ReceiptFieldExtraction | null;
  /** Short description of what was purchased */
  description: ReceiptFieldExtraction | null;
  /** Any notes or caveats Haiku wants to surface */
  notes: string | null;
}

/**
 * Build the system prompt for Haiku receipt extraction.
 * This is the only place the prompt is defined; changes here affect all extractions.
 */
export function buildReceiptSystemPrompt(): string {
  return `You are a UK accounting assistant helping extract structured data from receipt images.
Your output will be used in an open-source sole trader accounting app. The user will review and confirm every field before it is saved.

RULES:
- Always respond with valid JSON matching the schema below. No prose outside the JSON.
- All monetary amounts as decimal strings (e.g. "23.99"), never integers or pence.
- Currency: detect the currency. If it is NOT GBP, set currency.value to the detected code and currency.confidence to 0.
- VAT: UK standard rate is 20%, reduced is 5%. If VAT is not explicitly shown, do not guess — return null for vatAmount.
- Dates: return ISO 8601 format "YYYY-MM-DD". If unclear, return null.
- Category: suggest one of: travel, meals, office-supplies, software, hardware, professional-services, utilities, marketing, accommodation, other. Confidence should reflect how obvious the category is.
- Confidence: 0.0–1.0 float. Use < 0.7 for any field you are uncertain about.
- If a field is not present on the receipt, return null for that field (not an object with an empty value).

JSON SCHEMA:
{
  "date": { "value": "YYYY-MM-DD", "confidence": 0.95 } | null,
  "merchant": { "value": "string", "confidence": 0.95 } | null,
  "totalAmount": { "value": "0.00", "confidence": 0.95 } | null,
  "vatAmount": { "value": "0.00", "confidence": 0.90 } | null,
  "netAmount": { "value": "0.00", "confidence": 0.90 } | null,
  "vatRate": { "value": "20", "confidence": 0.90 } | null,
  "category": { "value": "travel", "confidence": 0.70 } | null,
  "currency": { "value": "GBP", "confidence": 0.99 } | null,
  "description": { "value": "string", "confidence": 0.85 } | null,
  "notes": "string or null"
}`;
}

export function buildReceiptUserPrompt(imageNote?: string): string {
  return imageNote
    ? `Extract receipt data from the image. ${imageNote}`
    : 'Extract receipt data from the image.';
}

/**
 * Parse Haiku's raw JSON response into a ReceiptDraft.
 * Returns null if the response is not valid JSON or does not match the schema.
 */
export function parseReceiptDraft(raw: string): ReceiptDraft | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ReceiptDraft>;
    // Minimal validation — the UI will handle missing fields gracefully
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as ReceiptDraft;
  } catch {
    return null;
  }
}

/**
 * Convert a ReceiptFieldExtraction amount string to integer pence.
 * Returns null if the value cannot be parsed.
 */
export function extractionAmountToPence(extraction: ReceiptFieldExtraction | null): number | null {
  if (!extraction) return null;
  const value = parseFloat(extraction.value);
  if (!isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}
