import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFraudHeaders, PACKAGE_VERSION, vendorVersion } from './fraudHeaders';

const now = new Date('2026-10-26T09:30:00.123Z');

function requestWith(headers: Record<string, string>): Request {
  return new Request('https://stf.example/api/vat/obligations', { headers });
}

const populated = requestWith({
  'x-forwarded-for': '203.0.113.7, 10.0.0.1',
  'x-stf-device-id': 'device-123',
  'x-stf-timezone': 'UTC+01:00',
  'x-stf-screens': 'width=1920&height=1080&scaling-factor=1&colour-depth=24',
  'x-stf-window-size': 'width=1440&height=900',
  'x-stf-js-user-agent': 'Mozilla/5.0 (X11; Linux x86_64)',
});

describe('buildFraudHeaders', () => {
  it('builds the full header set for a populated request', () => {
    const headers = buildFraudHeaders({
      request: populated,
      userId: 'user_abc',
      appVersion: '1.2.3',
      vendorPublicIp: '198.51.100.9',
      now,
    });
    expect(headers).toEqual({
      'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER',
      'Gov-Client-User-IDs': 'stf=user_abc',
      'Gov-Client-Public-IP': '203.0.113.7',
      'Gov-Client-Public-IP-Timestamp': '2026-10-26T09:30:00.123Z',
      'Gov-Vendor-Public-IP': '198.51.100.9',
      'Gov-Client-Device-ID': 'device-123',
      'Gov-Client-Timezone': 'UTC%2B01%3A00',
      'Gov-Client-Screens': 'width=1920&height=1080&scaling-factor=1&colour-depth=24',
      'Gov-Client-Window-Size': 'width=1440&height=900',
      'Gov-Client-Browser-JS-User-Agent': 'Mozilla%2F5.0%20%28X11%3B%20Linux%20x86_64%29',
      'Gov-Vendor-Version': 'stf=1.2.3',
      'Gov-Vendor-Product-Name': 'stf',
    });
  });

  it('omits optional headers it cannot source instead of faking them', () => {
    const headers = buildFraudHeaders({ request: requestWith({}), userId: 'user_abc', appVersion: '1.2.3', now });
    expect(Object.keys(headers).sort()).toEqual([
      'Gov-Client-Connection-Method',
      'Gov-Client-User-IDs',
      'Gov-Vendor-Product-Name',
      'Gov-Vendor-Version',
    ]);
  });

  it('percent-encodes spaces, ampersands and equals signs in values', () => {
    const headers = buildFraudHeaders({
      request: requestWith({ 'x-stf-js-user-agent': 'a b&c=d', 'x-stf-device-id': 'x y' }),
      userId: 'id with&odd=chars',
      appVersion: '1 2',
      now,
    });
    expect(headers['Gov-Client-Browser-JS-User-Agent']).toBe('a%20b%26c%3Dd');
    expect(headers['Gov-Client-Device-ID']).toBe('x%20y');
    expect(headers['Gov-Client-User-IDs']).toBe('stf=id%20with%26odd%3Dchars');
    expect(headers['Gov-Vendor-Version']).toBe('stf=1%202');
  });
});

describe('vendorVersion', () => {
  it.each([undefined, '', '   '])('is the package version, never empty, for sha %j', (sha) => {
    expect(vendorVersion(sha)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('appends the short commit when present', () => {
    expect(vendorVersion('0123456789abcdef')).toMatch(/^\d+\.\d+\.\d+\+0123456$/);
  });
});

describe('PACKAGE_VERSION', () => {
  it('matches package.json', () => {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(PACKAGE_VERSION).toBe(version);
  });
});
