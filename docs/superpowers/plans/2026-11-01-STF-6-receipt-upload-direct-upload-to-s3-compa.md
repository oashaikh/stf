# STF-6: Receipt upload: direct upload to S3-compatible storage

> Machine-generated plan (model `claude-sonnet-5-5`, effort `medium`) for
> the ticket. Progress below is written by the orchestrator; the
> database copy is authoritative — editing this file does not change execution.
> A task's [x] is the orchestrator's record that the task finished; the
> criteria beneath it are what the planner asked for, not individually
> verified — no per-criterion outcome is recorded anywhere.
> Prose written under a task entry is kept across progress ticks and is
> the place to record analysis. So are edits to the entry's Intent, Files,
> criteria and Risk bullets once the file exists; only its heading's mark and
> the Commit bullet are re-rendered from the database.

## Assumptions

- Upload is POST (create + signed URL), PATCH (mark ready or failed), DELETE (soft delete) on one route, api/receipts.ts, matching the repo's one-file-per-resource pattern.
- The receipts table and the pending/ready/failed enum already exist in server/src/db/schema.ts, so no migration is needed.
- STORAGE_* variables are already in .env.example and the runbook, so no new env vars are added.
- Type and size are enforced by signing ContentType and ContentLength into the presigned PUT, plus the HEAD check at confirm time. No virus scan is built.
- The AWS SDK v3 S3 client is the S3-compatible dependency; no installed dependency covers S3 signing.

## Out of scope

- Receipt upload UI and listing receipts
- AI extraction of uploaded receipts and linking a receipt to a transaction
- Reading or downloading stored objects (signed GET URLs)
- Virus scanning of uploads and cleanup of orphaned pending objects
- Rate limiting the new route (), which no existing route has either
- Provisioning the production bucket and Vercel env vars (owner action)

## Tasks

- [x] **Task 1: Add S3 client dependency and storage helper under api/_lib**
  - Intent: Install the AWS SDK S3 client and its request presigner (works with R2 and MinIO; path-style addressing needed for MinIO). Add api/_lib/receiptStorage.ts. It reads STORAGE_ENDPOINT, STORAGE_REGION, STORAGE_BUCKET, STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY and fails closed with an error naming the missing variable (never its value). It exports a small ReceiptStorage interface: presignUpload(key, mimeType, sizeBytes, expiresInSeconds) returns a PUT URL that signs content type and content length, and statObject(key) does a HEAD and returns { sizeBytes, mimeType } or null if missing. The default implementation uses the real S3 client, built lazily so imports and tests never connect. The interface lets tests inject a fake, as the mileage store does. Nothing logs URLs, keys or secrets. A short test covers the missing-env error and that no secret value appears in the message.
  - Files: `package.json`, `package-lock.json`, `api/_lib/receiptStorage.ts`, `api/_lib/__tests__/receiptStorage.test.ts`
  - Acceptance criteria the planner set:
    - @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner are in dependencies, package-lock.json is updated and npm ci works
    - receiptStorage.ts exports a ReceiptStorage interface (presignUpload, statObject) and a default factory reading the five STORAGE_* variables with forcePathStyle
    - A missing STORAGE_* variable raises an error that names the variable but never prints any env value
    - No console call in the helper logs a URL, key or secret
    - A unit test covers the missing-config path
    - npm run lint, typecheck and test pass
  - Risk: Adds a dependency (: check for open advisories on chosen versions and name any in the PR) and handles secrets, so opus at high.
  - Commit: `b796950a49ec`

- [x] **Task 2: Receipts route: signed upload URL, confirm-ready check, soft delete** (after 1)
  - Intent: Add api/_lib/receipts.ts and api/receipts.ts following the mileage pattern: withAuth, injected ReceiptStore and ReceiptStorage, default-exported { fetch }, userId only from the session. POST validates fileName with the inputRules.ts helpers, allows only image/jpeg, image/png, image/webp or application/pdf, and requires an integer size from 1 up to a 10 MB constant. It inserts a receipts row with uploadStatus pending and fileKey '<userId>/<crypto.randomUUID()>' (no client-supplied name in the key), and returns the receipt id plus a signed PUT URL valid 5 minutes. A refused type or size returns 400 and inserts nothing. PATCH with {id} loads the row by (id, userId, deletedAt null), calls statObject, sets ready when size and type match what was declared, and sets failed on a mismatch or missing object. No storage call happens inside a DB transaction (). DELETE with {id} soft-deletes by setting deletedAt and keeps the object. Another owner's id returns 404. Responses use explicit columns and never include userId or fileKey. Every query is scoped to the session owner and is either a single-row (id, userId) lookup or has an explicit limit. No migration is needed (table exists). Add the route to docs/security/input-inventory.md, since inputInventory.test.ts fails without it. Tests use a fake store and fake storage: unsupported type refused, oversize refused, mismatch marks failed, ready path works, second owner cannot PATCH or DELETE, client-supplied userId ignored, no signed URL or key in console output.
  - Files: `api/receipts.ts`, `api/_lib/receipts.ts`, `api/_lib/__tests__/receiptsRoute.test.ts`, `docs/security/input-inventory.md`
  - Acceptance criteria the planner set:
    - POST with a disallowed type returns 400 and inserts nothing
    - POST with size over 10 MB or not a positive integer returns 400 and inserts nothing
    - POST creates a pending row with key prefixed by the session userId and a random uuid, and returns a URL expiring in 5 minutes
    - PATCH sets ready on matching size and type, and failed on mismatch or missing object
    - DELETE sets deletedAt, never deletes the object, and no DELETE FROM is used
    - Every store method takes userId from auth and every query has a limit or a single-row (id, userId) predicate
    - A second user sending the first user's receipt id to PATCH and DELETE gets 404 and the row is unchanged
    - No console output in tests contains a signed URL, key or secret
    - apiRoutes.test.ts and inputInventory.test.ts pass with the new route
    - npm run lint, typecheck, test and build pass
  - Risk: Upload authorization, tenant isolation and signed-URL handling, so opus at high.
  - Commit: `67fc99b0dc3d`

- [ ] **Task 3: Document bucket CORS rule and local MinIO check in the Vercel runbook** (after 2)
  - Intent: Update the Receipt storage section of docs/runbooks/vercel-deploy.md with the bucket CORS rule browsers need for direct upload: allowed origin is the APP_ORIGIN value, method PUT, headers including Content-Type, short max age. Note signed URLs last 5 minutes and the bucket stays private. Add short steps for the local MinIO manual check (docker compose up -d, create a receipt, PUT a file to the returned URL with curl, call the confirm action). The implementer has no Docker, so the PR must say the MinIO check was not run by the agent and is left to the orchestrator or owner.
  - Files: `docs/runbooks/vercel-deploy.md`
  - Acceptance criteria the planner set:
    - The runbook has a copy-pasteable CORS rule limited to the app origin and PUT
    - The runbook states the bucket stays private and signed URLs last a few minutes
    - The local MinIO check steps contain no real secrets, tokens or machine paths
    - npm run lint, typecheck, test and build still pass
