# HMRC fraud prevention headers

HMRC requires all MTD (Making Tax Digital) submissions to include fraud prevention headers that identify the connection method, application, user, and device. These headers help HMRC detect spoofed or unauthorized submissions.

STF uses the `WEB_APP_VIA_SERVER` connection method, where a web application (the SPA) calls a backend server (Vercel API routes), which in turn calls HMRC.

## Complete header set for WEB_APP_VIA_SERVER

| Header | Value | Source | Mandatory | Notes |
|--------|-------|--------|-----------|-------|
| `Gov-Client-Connection-Method` | `WEB_APP_VIA_SERVER` | Server constant | Yes | Identifies the connection method. |
| `Gov-Client-User-IDs` | `stf=<user-id>` | User database | Yes | The user's internal STF id; percent-encoded. Never an email address. |
| `Gov-Vendor-Product-Name` | `stf` | Server constant | Yes | The application name. |
| `Gov-Vendor-Version` | `0.1.0` or `0.1.0+abc1234` | package.json + git | Yes | Package version; short commit SHA appended when available (e.g., on Vercel via `VERCEL_GIT_COMMIT_SHA`). |
| `Gov-Client-Public-IP` | Client IPv4 or IPv6 | Request headers | No | The client's real IP address, extracted from `x-vercel-forwarded-for` (Vercel) or `x-forwarded-for`. First entry only. Validated with `isIP()`. |
| `Gov-Client-Public-Port` | Integer 0 to 65535 | Request headers | No | The client's source port. Vercel documents no client-port header (`x-forwarded-port` is the port the client connected to, not its source port), so it is sent only when the forwarded entry carries one as `ip:port` or `[ip]:port`. Otherwise it is omitted and HMRC's validator reports it as missing. |
| `Gov-Client-Public-IP-Timestamp` | ISO 8601 timestamp | Server time | No | Set whenever `Gov-Client-Public-IP` is present. Format: `2026-10-26T09:30:00.123Z` (with milliseconds). |
| `Gov-Vendor-Public-IP` | Server egress IPv4 or IPv6 | `HMRC_VENDOR_PUBLIC_IP` env var | No | The server's public egress IP address. On Vercel, set if your account has a fixed outbound IP. If not set, this header and `Gov-Vendor-Forwarded` are omitted, and HMRC's validator reports both as missing; Vercel does not expose the edge IP the request arrived on, so set the env var in production. |
| `Gov-Vendor-Forwarded` | `by=<vendor-ip>&for=<client-ip>` | Combined from above | No | Set only when both the vendor and client IPs are known. Both values are percent-encoded. |
| `Gov-Vendor-License-IDs` | `stf=<SHA256-hex>` | `HMRC_VENDOR_LICENSE_ID` env var, else the user id | Yes | SHA-256 hash (uppercase hex) of the licence id. STF has no licence keys, so when the env var is unset the hash of the owner's user id (a per-installation id) is sent. |
| `Gov-Client-Device-ID` | UUID v4 | Browser (x-stf-device-id) | No | Unique identifier for the user's device. Dropped if malformed. |
| `Gov-Client-Timezone` | `UTC±HH:MM` | Browser (x-stf-timezone) | No | User's timezone. Example: `UTC+01:00`, `UTC-05:00`. Dropped if malformed. |
| `Gov-Client-Screens` | Comma-separated list | Browser (x-stf-screens) | No | Each display's dimensions and color depth. Format per entry: `width=1920&height=1080&scaling-factor=1&colour-depth=24`. Dropped if any entry is malformed. |
| `Gov-Client-Window-Size` | `width=N&height=N` | Browser (x-stf-window-size) | No | The SPA window size. Example: `width=1440&height=900`. Dropped if malformed. |
| `Gov-Client-Browser-Do-Not-Track` | `true` or `false` | Browser (x-stf-do-not-track) | No | The browser's DNT preference. Dropped if neither value is set. |
| `Gov-Client-Browser-JS-User-Agent` | User-Agent string | Browser (x-stf-js-user-agent) | No | `navigator.userAgent` exactly as reported. Not percent-encoded: HMRC's validator rejects an encoded value. |

**Wording for the HMRC production application:** STF runs on Vercel serverless functions, which expose the client's IP in `x-vercel-forwarded-for` but not its source port. `x-forwarded-port` is the server port (443) and HMRC says it must not be sent. We therefore cannot send `Gov-Client-Public-Port`.

**NOT sent:** `Gov-Client-Multi-Factor` — HMRC specifies this header only when multi-factor authentication is used. STF uses password-only authentication, so this header is omitted.

## Vendor IP and licence id configuration

### HMRC_VENDOR_PUBLIC_IP

Your server's public egress IP address for the `Gov-Vendor-Public-IP` header.

**When to set it:**
- On Vercel: set this if your account has a fixed outbound IP (a paid feature). Vercel does not expose the outbound IP on the request object, so you must provide it.
- On self-hosted: set this to your server's public IP if it is static.
- **Required for HMRC production credentials.** If omitted, `Gov-Vendor-Public-IP` and `Gov-Vendor-Forwarded` are not sent and HMRC's validator reports both as missing. Vercel does not expose the edge IP the request arrived on, so set this to the public IP of the Vercel deployment's servers (the address the deployment's domain resolves to).

**Format:** IPv4 (e.g., `203.0.113.5`) or IPv6 (e.g., `2001:db8::1`). Validated with Node's `isIP()`.

**Impact:** Helps HMRC detect spoofed submissions by verifying the origin server is consistently reachable at that address.

### HMRC_VENDOR_LICENSE_ID

A unique licence id for this deployment. Only its SHA-256 hash is sent to HMRC; the id itself never leaves your deployment.

**When to set it:**
- Required if you license this deployment to customers or organizations and need to track which instance made which submission.
- Example values: an internal serial number, a customer account id, a deployment UUID, or a ticket id.
- Optional for development and single-user deployments.

**What gets sent:** The header value is `stf=<SHA256-hex>`, where the hash is the SHA-256 of your id in uppercase hexadecimal. Example:
- Id: `licence-abc-123`
- Hash: `2048f9b...` (64-char hex)
- Header: `Gov-Vendor-License-IDs: stf=2048F9B...`

**Impact:** Allows HMRC support to correlate your submissions with your account and helps you track submissions from each deployment if you run multiple instances.

## Building the headers

All headers are built server-side by `src/lib/hmrc/fraudHeaders.ts::buildFraudHeaders()` using:
- Server config: `HMRC_VENDOR_PUBLIC_IP`, `HMRC_VENDOR_LICENSE_ID`, app version
- Request object: incoming `x-vercel-forwarded-for` or `x-forwarded-for` headers for client IP
- Browser values: `x-stf-*` headers sent by the SPA

The function validates all browser-supplied values; malformed entries are dropped rather than forwarded.

**Same code path for every call:** The fraud headers are built identically for:
- VAT obligations fetch
- VAT preview
- VAT submission
- Fraud headers check (the validation test)

This ensures consistency and makes it easy to verify that all calls include the complete set.

## Validating the headers

Before submitting to HMRC, use the built-in fraud headers check to validate that all headers conform to HMRC's spec.

**To run the check:**
1. Sign in to Settings.
2. Go to the HMRC section.
3. Click "Check HMRC fraud headers".
4. The check calls HMRC's sandbox validator (not a real submission).
5. Results appear immediately:
   - **Pass:** All headers valid. Ready for VAT submissions.
   - **Fail:** Lists each error and warning with the header name and HMRC's message.

**Audit trail:** Each check is recorded as an audit event (`hmrc.fraud_headers.validated`) with the outcome, HMRC's response code, and the names of all headers sent. Header values are not logged.

**Sandbox only:** The validator is available only in the HMRC sandbox (`https://test-api.service.hmrc.gov.uk`). It is called by `POST /api/vat/fraud-headers-check`.

## Percent-encoding

All user-supplied header values are percent-encoded per HMRC's spec (application/x-www-form-urlencoded):
- Spaces → `%20`
- Ampersands (`&`) → `%26`
- Equals (`=`) → `%3D`
- Special characters → their byte values in hex

Example:
- Input: `name with spaces & equals=signs`
- Encoded: `name%20with%20spaces%20%26%20equals%3Dsigns`

This ensures that IPv6 addresses (which contain colons and brackets) and user ids with special characters are transmitted correctly.

## Reference

- HMRC's official fraud prevention guide: [https://developer.service.hmrc.gov.uk/guides/fraud-prevention/](https://developer.service.hmrc.gov.uk/guides/fraud-prevention/)
- Implementation: `src/lib/hmrc/fraudHeaders.ts`
- Tests: `src/lib/hmrc/fraudHeaders.test.ts`
- Validation client: `src/lib/hmrc/client.ts::validateFraudHeaders()`
- Check endpoint: `api/vat/fraud-headers-check.ts`
