import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildFraudHeaders, PACKAGE_VERSION, vendorVersion } from './fraudHeaders';

const now = new Date('2026-10-26T09:30:00.123Z');

function requestWith(headers: Record<string, string>): Request {
  return new Request('https://stf.example/api/vat/obligations', { headers });
}

const populated = requestWith({
  'x-vercel-forwarded-for': '203.0.113.7',
  'x-forwarded-for': '10.9.9.9, 10.0.0.1',
  'x-stf-device-id': 'beec798b-b366-47fa-b1f8-92cede14a1ce',
  'x-stf-timezone': 'UTC+01:00',
  'x-stf-screens': 'width=1920&height=1080&scaling-factor=1&colour-depth=24',
  'x-stf-window-size': 'width=1440&height=900',
  'x-stf-js-user-agent': 'Mozilla/5.0 (X11; Linux x86_64)',
  'x-stf-do-not-track': 'false',
});

const baseInput = { userId: 'user_abc', appVersion: '1.2.3', now };
const fullInput = { ...baseInput, request: populated, vendorPublicIp: '198.51.100.9', vendorLicenseId: 'licence-123' };

describe('buildFraudHeaders', () => {
  it('builds the full WEB_APP_VIA_SERVER header set for a populated request', () => {
    expect(buildFraudHeaders(fullInput)).toEqual({
      'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER',
      'Gov-Client-Browser-JS-User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)',
      'Gov-Client-Browser-Do-Not-Track': 'false',
      'Gov-Client-Device-ID': 'beec798b-b366-47fa-b1f8-92cede14a1ce',
      'Gov-Client-Screens': 'width=1920&height=1080&scaling-factor=1&colour-depth=24',
      'Gov-Client-Timezone': 'UTC+01:00',
      'Gov-Client-User-IDs': 'stf=user_abc',
      'Gov-Client-Window-Size': 'width=1440&height=900',
      'Gov-Client-Public-IP': '203.0.113.7',
      'Gov-Client-Public-IP-Timestamp': '2026-10-26T09:30:00.123Z',
      'Gov-Vendor-Public-IP': '198.51.100.9',
      'Gov-Vendor-Forwarded': 'by=198.51.100.9&for=203.0.113.7',
      'Gov-Vendor-License-IDs': `stf=${createHash('sha256').update('licence-123').digest('hex').toUpperCase()}`,
      'Gov-Vendor-Product-Name': 'stf',
      'Gov-Vendor-Version': 'stf=1.2.3',
    });
  });

  it('never sends Gov-Client-Multi-Factor: HMRC says to send it only when MFA is used, and sign-in is password only', () => {
    expect(buildFraudHeaders(fullInput)).not.toHaveProperty('Gov-Client-Multi-Factor');
  });

  it('takes the client IP from x-forwarded-for when x-vercel-forwarded-for is absent, first entry only', () => {
    const request = requestWith({ 'x-forwarded-for': '203.0.113.8, 10.0.0.1' });
    expect(buildFraudHeaders({ ...baseInput, request })['Gov-Client-Public-IP']).toBe('203.0.113.8');
  });

  it('accepts an IPv6 client address', () => {
    const request = requestWith({ 'x-vercel-forwarded-for': '2001:db8::1' });
    expect(buildFraudHeaders({ ...baseInput, request })['Gov-Client-Public-IP']).toBe('2001:db8::1');
  });

  it.each([
    ['203.0.113.7:51234', '203.0.113.7', '51234'],
    ['[2001:db8::1]:443', '2001:db8::1', '443'],
    ['203.0.113.7:0', '203.0.113.7', '0'],
    ['203.0.113.7:65535', '203.0.113.7', '65535'],
  ])('takes the client IP and port from a forwarded value of %s', (forwarded, ip, port) => {
    const headers = buildFraudHeaders({ ...baseInput, request: requestWith({ 'x-vercel-forwarded-for': forwarded }) });
    expect(headers['Gov-Client-Public-IP']).toBe(ip);
    expect(headers['Gov-Client-Public-Port']).toBe(port);
  });

  it.each(['203.0.113.7:65536', '203.0.113.7:abc', '203.0.113.7:-1', '203.0.113.7:12.5'])(
    'drops Gov-Client-Public-Port when the forwarded port is malformed (%s)',
    (forwarded) => {
      const headers = buildFraudHeaders({ ...baseInput, request: requestWith({ 'x-forwarded-for': forwarded }) });
      expect(headers).not.toHaveProperty('Gov-Client-Public-Port');
    },
  );

  it('omits Gov-Client-Public-Port when the platform forwards only an IP (Vercel sends no client port)', () => {
    expect(buildFraudHeaders({ ...baseInput, request: populated })).not.toHaveProperty('Gov-Client-Public-Port');
  });

  it('omits headers it cannot source instead of faking them', () => {
    const headers = buildFraudHeaders({ ...baseInput, request: requestWith({}) });
    expect(Object.keys(headers).sort()).toEqual([
      'Gov-Client-Connection-Method',
      'Gov-Client-User-IDs',
      'Gov-Vendor-License-IDs',
      'Gov-Vendor-Product-Name',
      'Gov-Vendor-Version',
    ]);
  });

  it('sends the user agent exactly as the browser reported it, with no percent-encoding', () => {
    const headers = buildFraudHeaders({ ...baseInput, request: populated });
    expect(headers['Gov-Client-Browser-JS-User-Agent']).toBe('Mozilla/5.0 (X11; Linux x86_64)');
  });

  it('hashes the user id as the licence id when no licence is configured', () => {
    const headers = buildFraudHeaders({ ...baseInput, request: requestWith({}) });
    expect(headers['Gov-Vendor-License-IDs']).toBe(
      `stf=${createHash('sha256').update('user_abc').digest('hex').toUpperCase()}`,
    );
  });

  it('omits Gov-Vendor-Forwarded unless both the vendor and client IP are known', () => {
    const noVendor = buildFraudHeaders({ ...baseInput, request: populated });
    const noClient = buildFraudHeaders({ ...baseInput, request: requestWith({}), vendorPublicIp: '198.51.100.9' });
    expect(noVendor).not.toHaveProperty('Gov-Vendor-Forwarded');
    expect(noClient).not.toHaveProperty('Gov-Vendor-Forwarded');
  });

  it.each([
    ['Gov-Client-Public-IP', { 'x-vercel-forwarded-for': 'not-an-ip' }],
    ['Gov-Client-Timezone', { 'x-stf-timezone': 'Europe/London' }],
    ['Gov-Client-Device-ID', { 'x-stf-device-id': 'not a uuid' }],
    ['Gov-Client-Browser-Do-Not-Track', { 'x-stf-do-not-track': 'maybe' }],
    ['Gov-Client-Window-Size', { 'x-stf-window-size': 'width=wide&height=tall' }],
    ['Gov-Client-Screens', { 'x-stf-screens': 'width=1920' }],
  ])('drops %s when the browser value is malformed', (name, headers) => {
    expect(buildFraudHeaders({ ...baseInput, request: requestWith(headers) })).not.toHaveProperty(name);
  });

  it('formats multiple screens as a comma-separated list', () => {
    const screens = 'width=1920&height=1080&scaling-factor=1&colour-depth=24,width=1280&height=720&scaling-factor=2&colour-depth=24';
    const headers = buildFraudHeaders({ ...baseInput, request: requestWith({ 'x-stf-screens': screens }) });
    expect(headers['Gov-Client-Screens']).toBe(screens);
  });

  it('formats the timestamp with milliseconds and a Z, even when the milliseconds are zero', () => {
    const headers = buildFraudHeaders({ ...baseInput, request: populated, now: new Date('2026-10-26T09:30:00.000Z') });
    expect(headers['Gov-Client-Public-IP-Timestamp']).toBe('2026-10-26T09:30:00.000Z');
  });

  it('percent-encodes spaces, ampersands and equals signs in values', () => {
    const headers = buildFraudHeaders({
      request: requestWith({}),
      userId: 'id with&odd=chars',
      appVersion: '1 2',
      now,
    });
    expect(headers['Gov-Client-User-IDs']).toBe('stf=id%20with%26odd%3Dchars');
    expect(headers['Gov-Vendor-Version']).toBe('stf=1%202');
  });

  it('carries no authorisation header or bearer token', () => {
    const request = requestWith({ authorization: 'Bearer secret-token', cookie: 'session=secret-token' });
    const sent = JSON.stringify(buildFraudHeaders({ ...fullInput, request }));
    expect(sent).not.toContain('secret-token');
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
