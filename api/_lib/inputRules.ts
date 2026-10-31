import { z } from 'zod';

// C0 controls and DEL. Multiline fields keep tab and newline (carriage return stays out so line endings are one shape).
// The control characters are the point of these patterns.
/* eslint-disable no-control-regex */
const CONTROL_ANY = /[\u0000-\u001f\u007f]/;
const CONTROL_EXCEPT_LINE_BREAKS = /[\u0000-\u0008\u000b-\u001f\u007f]/;
/* eslint-enable no-control-regex */

export const hasControlCharacters = (value: string, options: { multiline?: boolean } = {}): boolean =>
  (options.multiline ? CONTROL_EXCEPT_LINE_BREAKS : CONTROL_ANY).test(value);

/** Trimmed free text with a length cap and no control characters; the one text rule every schema reuses. */
export const plainText = (max: number, options: { multiline?: boolean; required?: boolean } = {}) =>
  z
    .string()
    .trim()
    .min(options.required ? 1 : 0, 'Required')
    .max(max, `Must be ${max} characters or fewer`)
    .refine((value) => !hasControlCharacters(value, options), 'Must not contain control characters');
