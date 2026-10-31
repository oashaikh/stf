// Invented hostile strings shared by the input-class tests. No real data.

/** Text no free-text field may accept: too long, or carrying control characters. */
export const REJECTED_TEXT: Record<string, string> = {
  tenThousandChars: 'a'.repeat(10_000),
  nullByte: 'before\u0000after',
  escapeCharacter: 'before\u001bafter',
  deleteCharacter: 'before\u007fafter',
  bell: 'before\u0007after',
};

/** Text that is harmless once stored and shown as text; a free-text field keeps it unchanged. */
export const INERT_TEXT: Record<string, string> = {
  scriptTag: '<script>alert(1)</script>',
  imageHandler: '<img src=x onerror=alert(1)>',
  sqlFragment: "'; DROP TABLE entries; --",
  sqlTautology: "1' OR '1'='1",
  pathTraversal: '../../etc/passwd',
  windowsPath: '..\\..\\windows\\system32',
  formulaPrefix: '=HYPERLINK("http://evil.test","x")',
  javascriptLink: 'javascript:alert(1)',
};

/** Everything a format-bound field (date, number, uuid, choice, digits) must refuse. */
export const NOT_A_FORMAT: string[] = [...Object.values(REJECTED_TEXT), ...Object.values(INERT_TEXT)];
