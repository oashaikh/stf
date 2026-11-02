// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { findJargon } from './jargon';

function html(markup: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = markup;
  return root;
}

describe('findJargon', () => {
  it.each([
    'ledger',
    'posting',
    'journal',
    'nominal code',
    'chart of accounts',
    'reconcile',
    'reconciliation',
    'obligation',
    'period key',
    'payload',
    'endpoint',
    'token',
    'sync',
    'submit',
    'Box 1',
    'Box 4',
    'Box 6',
    'VAT due on sales',
    'VAT reclaimed on purchases',
    'total value of sales ex VAT',
  ])('flags "%s" in plain text', (word) => {
    expect(findJargon(html(`<p>Your ${word} is ready</p>`))).toEqual([word.toLowerCase()]);
  });

  it('flags raw error codes', () => {
    expect(findJargon(html('<p>Failed: INVALID_PERIOD_KEY</p>'))).toContain('INVALID_PERIOD_KEY');
    expect(findJargon(html('<p>Request failed with status 500</p>'))).toContain('status 500');
  });

  it('matches case-insensitively as whole words only', () => {
    expect(findJargon(html('<p>SUBMIT now</p>'))).toEqual(['submit']);
    expect(findJargon(html('<p>Tokenise and resync are fine</p>'))).toEqual([]);
    expect(findJargon(html('<p>Tokens, obligations, submitted, syncing and postings are not</p>'))).toEqual(['tokens', 'obligations', 'submitted', 'syncing', 'postings']);
  });

  it('ignores text inside an official-name element', () => {
    expect(
      findJargon(html('<p>VAT you charged customers <small data-official-name>Box 1</small></p>')),
    ).toEqual([]);
  });

  it('still flags jargon next to an official name', () => {
    expect(findJargon(html('<p>Submit <small data-official-name>Box 1</small></p>'))).toEqual([
      'submit',
    ]);
  });

  it('flags jargon in an element that sits directly against the next one', () => {
    expect(findJargon(html('<h2>Chart of accounts</h2><p>Your categories</p>'))).toEqual(['chart of accounts']);
  });
});
