# Vercel deployment

STF runs on Vercel as a static SPA (React) with serverless API routes and scheduled cron jobs, backed by Neon serverless Postgres.

## Environment variables

Set these in your Vercel project settings. Never commit them to the repository.

### Database

- `DATABASE_URL` — the pooled Neon URL from the Vercel Marketplace (host contains `-pooler`) with `?sslmode=require`. The client uses TLS, limits to 1 active connection, and disables prepared statements to work with Neon's transaction-mode pooler.

### Authentication

- `VITE_CLERK_PUBLISHABLE_KEY` — from [clerk.com](https://clerk.com)
- `CLERK_SECRET_KEY` — from clerk.com
- `CLERK_AUTHORIZED_PARTIES` — comma-separated origins that may mint session tokens (must match your deployed domain exactly). Example: `https://app.example.com`

### HMRC Making Tax Digital

- `HMRC_CLIENT_ID` — from [developer.service.hmrc.gov.uk](https://developer.service.hmrc.gov.uk)
- `HMRC_CLIENT_SECRET` — from developer.service.hmrc.gov.uk
- `HMRC_SANDBOX_MODE` — set to `true` (default). Only set `false` to file live returns; requires user opt-in in Settings.
- `HMRC_REDIRECT_URI` — the callback URL registered in your HMRC developer application: `https://<your-domain>/api/hmrc/callback`
- `HMRC_TOKEN_ENCRYPTION_KEY` — Base64 of 32 random bytes (AES-256-GCM key for storing HMRC tokens); generate with `openssl rand -base64 32`
- `HMRC_STATE_SECRET` — Base64 of 32 random bytes (signs OAuth state); generate with `openssl rand -base64 32`
- `HMRC_VENDOR_PUBLIC_IP` — (optional) your server's egress IP for the Gov-Vendor-Public-IP fraud prevention header

### Receipt storage

- `STORAGE_ENDPOINT` — S3-compatible endpoint (AWS S3, Cloudflare R2, Backblaze B2, etc.)
- `STORAGE_REGION` — region or zone identifier for your storage provider
- `STORAGE_BUCKET` — bucket name
- `STORAGE_ACCESS_KEY` — read/write access key
- `STORAGE_SECRET_KEY` — read/write secret key

### Application

- `APP_ORIGIN` — the deployed URL: `https://<your-domain>` (matches `CLERK_AUTHORIZED_PARTIES`)
- `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com) for receipt scanning
- `CRON_SECRET` — any random string (32+ bytes recommended; generate with `openssl rand -base64 32`). Vercel sends this as `Authorization: Bearer <value>` to cron routes; requests without it are refused.

## Clerk allowed origins

Clerk enforces that session tokens carry an `azp` (authorized party) claim matching the origin that requested them. Set `CLERK_AUTHORIZED_PARTIES` to your deployed domain:

```
https://app.example.com
```

And set `APP_ORIGIN` to the same value. Use the full origin, including `https://` and with no trailing slash, for both.

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

## Local development

Locally, the HMRC token refresh runs from a Fastify control plane (the `npm run dev:server` process), not from the cron route. The `api/cron/refresh-hmrc-tokens` route exists only for Vercel. The local Fastify server:

- Does not serve user-facing routes (no web UI); the web app runs separately on `npm run dev`
- Runs on `CONTROL_PLANE_HOST:CONTROL_PLANE_PORT` (default `127.0.0.1:8787`)
- Is not deployed to Vercel; it is development-only

Set `CONTROL_PLANE_PORT` and `CONTROL_PLANE_HOST` only in your `.env.local` for local use.
