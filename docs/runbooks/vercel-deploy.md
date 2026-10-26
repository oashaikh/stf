# Vercel deployment

STF runs on Vercel as a static SPA (React) with serverless API routes and scheduled cron jobs, backed by Neon serverless Postgres.

## Environment variables

Set these in your Vercel project settings. Never commit them to the repository.

### Database

- `DATABASE_URL` — the pooled Neon URL from the Vercel Marketplace (host contains `-pooler`) with `?sslmode=require`. The client uses TLS, limits to 1 active connection, and disables prepared statements to work with Neon's transaction-mode pooler.

### Authentication

- `OWNER_PASSWORD` — the owner login password. To reset it, change this variable and redeploy
- `SESSION_SECRET` — signs the session cookie (generate with `openssl rand -base64 32`)

### HMRC Making Tax Digital

- `HMRC_CLIENT_ID` — from [developer.service.hmrc.gov.uk](https://developer.service.hmrc.gov.uk)
- `HMRC_CLIENT_SECRET` — from developer.service.hmrc.gov.uk
- `HMRC_SANDBOX_MODE` — set to `true` (default). Only set `false` to file live returns; requires user opt-in in Settings.
- `HMRC_REDIRECT_URI` — the callback URL registered in your HMRC developer application: `https://<your-domain>/api/hmrc/callback`
- `HMRC_TOKEN_ENCRYPTION_KEY` — Base64 of 32 random bytes (AES-256-GCM key for storing HMRC tokens); generate with `openssl rand -base64 32`
- `HMRC_STATE_SECRET` — Base64 of 32 random bytes (signs OAuth state); generate with `openssl rand -base64 32`
- `HMRC_VENDOR_PUBLIC_IP` — (optional) your server's public IPv4 or IPv6 egress address for HMRC fraud prevention. On Vercel, set this if your account has a fixed outbound IP (a paid feature). Vercel does not expose the outbound IP on the request object, so you must provide it. The header is omitted if not set, which is fine; it is optional and not required for submissions. Example: `203.0.113.5` or `2001:db8::1`.
- `HMRC_VENDOR_LICENSE_ID` — (optional) a unique licence id for this deployment. Only the SHA-256 hash is sent to HMRC, never the id itself. Set this if you license this deployment to customers or organizations and need to track which instance made which submission. Example values: an internal serial number, customer account id, deployment UUID, or ticket id. Sent as the `Gov-Vendor-License-IDs` header: `stf=<SHA256-hex>`.

### Receipt storage

- `STORAGE_ENDPOINT` — S3-compatible endpoint (AWS S3, Cloudflare R2, Backblaze B2, etc.)
- `STORAGE_REGION` — region or zone identifier for your storage provider
- `STORAGE_BUCKET` — bucket name
- `STORAGE_ACCESS_KEY` — read/write access key
- `STORAGE_SECRET_KEY` — read/write secret key

### Application

- `APP_ORIGIN` — the deployed URL: `https://<your-domain>`
- `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com) for receipt scanning
- `CRON_SECRET` — any random string (32+ bytes recommended; generate with `openssl rand -base64 32`). Vercel sends this as `Authorization: Bearer <value>` to cron routes; requests without it are refused.

## HMRC redirect URI

Register this in your HMRC developer application (home page → manage subscriptions → credentials):

```
https://<your-domain>/api/hmrc/callback
```

This must match `HMRC_REDIRECT_URI` exactly (case-sensitive, no trailing slash).

## Running migrations

Migrations **never run automatically on deploy**. The database schema is immutable in production until you apply a migration manually. To apply migrations to your hosted database:

```bash
DATABASE_URL=<direct-unpooled-neon-url> npm run db:migrate
```

Where `<direct-unpooled-neon-url>` is the **direct** Neon connection URL (host does **not** contain `-pooler`); migrations cannot run against the pooled connection.

Always apply migrations manually **before** deploying a version that requires them. Doing so in production after the deploy allows an out-of-sync intermediate state; do it beforehand.

## Cron jobs

The HMRC token refresh runs as a Vercel Cron job (scheduled serverless function) at `/api/cron/refresh-hmrc-tokens` every 5 minutes. Vercel sends an `Authorization: Bearer $CRON_SECRET` header. Any request without this header is refused with a 401.

**Cron frequency note**: Vercel's free Hobby plan allows only once-daily crons. The 5-minute schedule requires a Pro plan. If you are on Hobby, either upgrade to Pro or adjust the cron schedule in `vercel.json`.

## Fraud prevention headers

All HMRC calls require fraud prevention headers that identify the connection method, application, user, and browser. STF uses the `WEB_APP_VIA_SERVER` connection method. The headers are built server-side by `src/lib/hmrc/fraudHeaders.ts::buildFraudHeaders()` using application config, the request object, and browser values sent as `x-stf-*` headers from the SPA.

**Complete reference:** See `docs/fraud-prevention-headers.md` for the full header table with sources and formats, HMRC's official specification link, and percent-encoding rules.

### Configuration

**`HMRC_VENDOR_PUBLIC_IP`** (optional)

Your server's public egress IP address (IPv4 or IPv6) for the `Gov-Vendor-Public-IP` header.

- **On Vercel:** Set this only if your account has a fixed outbound IP (a paid feature). Vercel does not expose the outbound IP on the request, so you must provide it explicitly. Unset: the header is omitted (acceptable, as it is optional).
- **On self-hosted:** Set to your server's public IP if it is static.
- **Format:** IPv4 (e.g., `203.0.113.5`) or IPv6 (e.g., `2001:db8::1`).
- **Impact:** Helps HMRC detect spoofed submissions by verifying the origin server is consistently reachable at that address.

**`HMRC_VENDOR_LICENSE_ID`** (optional)

A unique licence id for this deployment. Only its SHA-256 hash is sent to HMRC in the `Gov-Vendor-License-IDs` header; the id itself never leaves your deployment.

- **When to set:** Required if you license this deployment to customers or organizations and need to track which instance made which submission.
- **Example values:** Internal serial number, customer account id, deployment UUID, ticket id, or any unique identifier.
- **Sent as:** `stf=<SHA256-HEX>`, where the hash is the uppercase hex of the SHA-256 of your id.
- **Impact:** Allows HMRC support to correlate your submissions with your account and lets you track submissions from each deployment if you run multiple instances.

### Validating the headers

Before filing VAT returns to HMRC, use the built-in validation check:

1. Sign in to Settings.
2. Scroll to the HMRC section.
3. Click "Check HMRC fraud headers".
4. The check calls HMRC's sandbox Test Fraud Prevention Headers validator (not a real submission).
5. Result: a clear pass, or a list of each error and warning with the affected header name and HMRC's message.

This check uses the same header-building code path as a real submission, ensuring consistency. Fix any errors and recheck. A passing check means the headers conform to HMRC's spec and are ready for VAT submissions.

**Audit trail:** Each validation run is recorded in `audit_events` with action `hmrc.fraud_headers.validated`. The snapshot includes the outcome, HMRC's response code, and the names of all headers sent (values are not logged, per DP-8).

## Local development

Locally, the HMRC token refresh runs from a Fastify control plane (the `npm run dev:server` process), not from the cron route. The `api/cron/refresh-hmrc-tokens` route exists only for Vercel. The local Fastify server:

- Does not serve user-facing routes (no web UI); the web app runs separately on `npm run dev`
- Runs on `CONTROL_PLANE_HOST:CONTROL_PLANE_PORT` (default `127.0.0.1:8787`)
- Is not deployed to Vercel; it is development-only

Set `CONTROL_PLANE_PORT` and `CONTROL_PLANE_HOST` only in your `.env.local` for local use.
