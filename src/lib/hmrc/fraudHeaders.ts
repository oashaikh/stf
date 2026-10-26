/**
 * HMRC fraud prevention headers for server-made calls (WEB_APP_VIA_SERVER).
 * Pure and free of browser globals so API routes can import it. Browser-only
 * values arrive from the SPA as x-stf-* request headers.
 * See: https://developer.service.hmrc.gov.uk/guides/fraud-prevention/
 */

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export type FraudHeaderInput = {
  request: Request;
  /** Internal STF user id. Never an email address. */
  userId: string;
  appVersion: string;
  /** Egress IP of this server; Vercel does not expose it on the request. */
  vendorPublicIp?: string;
  /** Raw licence id of this deployment; only its SHA-256 is sent. */
  vendorLicenseId?: string;
  now: Date;
};

const PRODUCT_NAME = 'stf';

// A bare JSON import throws ERR_IMPORT_ASSERTION_TYPE_MISSING under native Node ESM, which the API
// functions may run as, so the version is a constant. A test fails if it drifts from package.json.
export const PACKAGE_VERSION = '0.1.0';

/**
 * The version sent as Gov-Vendor-Version: the package.json version, plus the short commit when known.
 * A CLI deploy sets VERCEL_GIT_COMMIT_SHA to an empty string, which `??` keeps, and HMRC rejects an
 * empty value; so the version always comes from package.json and the SHA only when non-empty.
 */
export function vendorVersion(commitSha: string | undefined = process.env.VERCEL_GIT_COMMIT_SHA): string {
  const shortSha = commitSha?.trim().slice(0, 7);
  return shortSha ? `${PACKAGE_VERSION}+${shortSha}` : PACKAGE_VERSION;
}

// HMRC wants every value percent-encoded; encodeURIComponent leaves !'()* alone.
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

const sha256Upper = (value: string) => createHash('sha256').update(value).digest('hex').toUpperCase();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEZONE = /^UTC[+-]\d{2}:\d{2}$/;
const WINDOW_SIZE = /^width=\d+&height=\d+$/;
const SCREEN = /^width=\d+&height=\d+&scaling-factor=\d+(\.\d+)?&colour-depth=\d+$/;
const DO_NOT_TRACK = /^(true|false)$/;

// Browser values are untrusted input: one that does not match HMRC's format is dropped, not forwarded.
function matching(value: string | undefined, pattern: RegExp): string | undefined {
  return value && pattern.test(value) ? value : undefined;
}

export function buildFraudHeaders(input: FraudHeaderInput): Record<string, string> {
  const { request, userId, appVersion, vendorPublicIp, vendorLicenseId, now } = input;
  const incoming = (name: string) => request.headers.get(name)?.trim() || undefined;

  // Vercel sets x-vercel-forwarded-for even behind a proxy; the first x-forwarded-for entry is the client.
  // Vercel documents no client-port header (x-forwarded-port is the port the client connected to), so the
  // port is only sent when the forwarded entry carries one as "ip:port" or "[ip]:port". Otherwise it is omitted.
  const forwardedEntry = (incoming('x-vercel-forwarded-for') ?? incoming('x-forwarded-for'))?.split(',')[0].trim();
  const [, bracketedIp, bracketedPort] = forwardedEntry?.match(/^\[([^\]]+)\]:(.*)$/) ?? [];
  const [, ipv4, ipv4Port] = forwardedEntry?.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(.*)$/) ?? [];
  const clientIp = bracketedIp ?? ipv4 ?? forwardedEntry;
  const forwardedPort = bracketedPort ?? ipv4Port;
  const publicClientIp = clientIp && isIP(clientIp) ? clientIp : undefined;
  const publicClientPort =
    publicClientIp && forwardedPort && /^\d{1,5}$/.test(forwardedPort) && Number(forwardedPort) <= 65535
      ? String(Number(forwardedPort))
      : undefined;
  const vendorIp = vendorPublicIp && isIP(vendorPublicIp) ? vendorPublicIp : undefined;
  const screens = incoming('x-stf-screens');
  const jsUserAgent = incoming('x-stf-js-user-agent');

  // Gov-Client-Multi-Factor is deliberately never sent: HMRC says to send it only when multi-factor
  // authentication is used, and "if you authenticate with username and password only, you will not be
  // able to collect a value" (guides/fraud-prevention, WEB_APP_VIA_SERVER).
  const headers: Record<string, string> = {
    'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER',
    'Gov-Client-User-IDs': `stf=${encodeValue(userId)}`,
    'Gov-Vendor-Version': `${PRODUCT_NAME}=${encodeValue(appVersion)}`,
    'Gov-Vendor-Product-Name': encodeValue(PRODUCT_NAME),
  };

  const optional: Array<[string, string | undefined]> = [
    ['Gov-Client-Public-IP', publicClientIp],
    ['Gov-Client-Public-Port', publicClientPort],
    ['Gov-Vendor-Public-IP', vendorIp],
    // Each IP is percent-encoded so an IPv6 address cannot be mistaken for a separator.
    [
      'Gov-Vendor-Forwarded',
      vendorIp && publicClientIp ? `by=${encodeValue(vendorIp)}&for=${encodeValue(publicClientIp)}` : undefined,
    ],
    // STF has no licence keys, so without a configured id the per-installation id (the single owner's user id) is hashed.
    ['Gov-Vendor-License-IDs', `${encodeValue(PRODUCT_NAME)}=${sha256Upper(vendorLicenseId || userId)}`],
    ['Gov-Client-Device-ID', matching(incoming('x-stf-device-id'), UUID)],
    ['Gov-Client-Timezone', matching(incoming('x-stf-timezone'), TIMEZONE)],
    ['Gov-Client-Screens', screens?.split(',').every((screen) => SCREEN.test(screen)) ? screens : undefined],
    ['Gov-Client-Window-Size', matching(incoming('x-stf-window-size'), WINDOW_SIZE)],
    ['Gov-Client-Browser-Do-Not-Track', matching(incoming('x-stf-do-not-track'), DO_NOT_TRACK)],
    // HMRC rejects a percent-encoded value here: the user agent goes out exactly as the browser reported it.
    ['Gov-Client-Browser-JS-User-Agent', jsUserAgent],
  ];
  for (const [name, value] of optional) {
    if (value) headers[name] = value;
  }

  if (publicClientIp) headers['Gov-Client-Public-IP-Timestamp'] = now.toISOString();
  return headers;
}
