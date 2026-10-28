import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every page's <main> shares one gutter: 16px on phones, 32px from md up.
describe.each(['SettingsPage', 'ReceiptsPage'])('%s gutters', (page) => {
  it('uses p-4 md:p-8 on <main>', () => {
    const source = readFileSync(`src/pages/${page}.tsx`, 'utf8');
    expect(source).toContain('<main className="p-4 md:p-8">');
  });
});
