// Words from the "Never on screen" column of docs/design/ease-of-use.md section 4.
const BANNED_PHRASES = [
  'ledger',
  'posting',
  'journal',
  'nominal code',
  'chart of accounts',
  'reconcile',
  'reconciliation',
  'obligation',
  'period key',
  'box 1',
  'box 4',
  'box 6',
  'vat due on sales',
  'vat reclaimed on purchases',
  'total value of sales ex vat',
  'submit',
  'payload',
  'endpoint',
  'sync',
  'token',
];

// Raw error codes: SHOUTING_SNAKE_CASE identifiers and "status 500" style messages.
const ERROR_CODE_PATTERNS = [/\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/g, /\bstatus \d{3}\b/gi];

const BANNED_WORDS = new RegExp(`\\b(?:${BANNED_PHRASES.join('|').replace(/ /g, '\\s+')})\\b`, 'gi');

// Text marked with data-official-name is the one place official terms may appear.
function visibleText(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  copy.querySelectorAll('[data-official-name]').forEach((element) => element.remove());
  // A trailing space keeps a heading's last word from fusing with the next element's first word.
  copy.querySelectorAll('*').forEach((element) => element.append(' '));
  return copy.textContent ?? '';
}

// Returns the banned words found in the text a person would read, in order of appearance.
export function findJargon(root: Element): string[] {
  const text = visibleText(root);
  const found = [
    ...[...text.matchAll(BANNED_WORDS)].map((match) => ({
      index: match.index,
      word: match[0].toLowerCase().replace(/\s+/g, ' '),
    })),
    ...ERROR_CODE_PATTERNS.flatMap((pattern) =>
      [...text.matchAll(pattern)].map((match) => ({ index: match.index, word: match[0] })),
    ),
  ];
  return found.sort((a, b) => a.index - b.index).map((match) => match.word);
}
