/**
 * HMRC fraud prevention headers for server-made calls (WEB_APP_VIA_SERVER).
 * Pure and free of browser globals so API routes can import it. Browser-only
 * values arrive from the SPA as x-stf-* request headers.
 * See: https://developer.service.hmrc.gov.uk/guides/fraud-prevention/
 */

export type FraudHeaderInput = {
  request: Request;
  /** Internal STF user id. Never an email address. */
  userId: string;
  appVersion: string;
  /** Egress IP of this server; Vercel does not expose it on the request. */
  vendorPublicIp?: string;
  now: Date;
};

const PRODUCT_NAME = 'stf';

// HMRC wants every value percent-encoded; encodeURIComponent leaves !'()* alone.
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

// Structured headers such as "width=1920&height=1080" keep their separators;
// only each key and value is encoded.
function encodePairs(pairs: string): string {
  return pairs
    .split('&')
    .map((pair) => {
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex === -1) return encodeValue(pair);
      return `${encodeValue(pair.slice(0, separatorIndex))}=${encodeValue(pair.slice(separatorIndex + 1))}`;
    })
    .join('&');
}

export function buildFraudHeaders(input: FraudHeaderInput): Record<string, string> {
  const { request, userId, appVersion, vendorPublicIp, now } = input;
  const incoming = (name: string) => request.headers.get(name)?.trim() || undefined;

  const headers: Record<string, string> = {
    'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER',
    'Gov-Client-User-IDs': `stf=${encodeValue(userId)}`,
    'Gov-Vendor-Version': `${PRODUCT_NAME}=${encodeValue(appVersion)}`,
    'Gov-Vendor-Product-Name': encodeValue(PRODUCT_NAME),
  };

  const optional: Array<[string, string | undefined, (value: string) => string]> = [
    // The first x-forwarded-for entry is the client; later ones are proxies.
    ['Gov-Client-Public-IP', incoming('x-forwarded-for')?.split(',')[0].trim() || undefined, encodeValue],
    ['Gov-Vendor-Public-IP', vendorPublicIp, encodeValue],
    ['Gov-Client-Device-ID', incoming('x-stf-device-id'), encodeValue],
    ['Gov-Client-Timezone', incoming('x-stf-timezone'), encodeValue],
    ['Gov-Client-Screens', incoming('x-stf-screens'), encodePairs],
    ['Gov-Client-Window-Size', incoming('x-stf-window-size'), encodePairs],
    ['Gov-Client-Browser-JS-User-Agent', incoming('x-stf-js-user-agent'), encodeValue],
  ];
  for (const [name, value, encode] of optional) {
    if (value) headers[name] = encode(value);
  }

  if (headers['Gov-Client-Public-IP']) {
    headers['Gov-Client-Public-IP-Timestamp'] = now.toISOString();
  }
  return headers;
}
