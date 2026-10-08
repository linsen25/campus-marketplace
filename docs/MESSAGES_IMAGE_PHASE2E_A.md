# Messages Phase 2E-A — production IMAGE preparation

2026-10-07 America/New_York; 2026-10-08 UTC.
**Production IMAGE: NOT DEPLOYED. 202610070002: PENDING PRODUCTION.
Fresh backup: VERIFIED. Production server credential: READY.
Phase 2E-A: READY FOR PHASE 2E-B IMAGE PRODUCTION ROLLOUT.**

The initial attempt stopped at the mandatory missing-credential checkpoint.
The user then configured the ignored local environment and explicitly authorized
continuation and production guard enablement. The completed continuation below
supersedes that initial blocker. No migration or production smoke was executed.

## Completed continuation — credential, guard, dry-run and build

The local production server credential now exists. Its decoded JWT claims match
service_role and campus-marketplace / yzvchumzyonegujucyqs. APP_ENV=production,
the public URL and production anon JWT identity also match. .env.local is ignored
and untracked; no NEXT_PUBLIC service-role/secret alias or public value equal to
the private key is present. No key value was printed, persisted to test files,
logged, serialized in an API response or included in this report.

Updated [messages-environment](../lib/server/messages-environment.ts) to return
the exact project ref only after its existing public environment checks pass.
[chat-image-storage](../lib/server/chat-image-storage.ts) uses that verified ref
both for the service-role JWT claim check and Storage client destination:

| APP_ENV | Required public URL / private JWT project |
| --- | --- |
| staging | western-marketplace-staging / pcaqxezdfxofysghssyo |
| production | campus-marketplace / yzvchumzyonegujucyqs |

No separate fallback/default project, cross-project key use, new Storage operation
or authorization bypass. Unknown designations, cross-project URLs, wrong-role/
wrong-project credentials and missing keys fail closed. Actual configured-key
guard invocation and client construction succeeded locally with all network
access blocked; no production Storage request or data mutation was needed.
JWT claims establish the local configured identity; actual hosted IMAGE operations
remain for the separately authorized post-migration smoke.

Extended [IMAGE API tests](../tests/messages-images-api.cjs) verify acceptance
and exact client destination for both projects; both URL/designation mismatches;
wrong-project/wrong-role/missing keys; unknown designation; and safe missing-key
API 503 before network access. Existing unauthenticated/Outsider pre-body checks,
CSRF/method/no-store checks, byte/hash/stream failure and immutable duplicate
receipt tests still pass. Normal participant/author authorization is unchanged.

Fresh production dry-run succeeded:

```powershell
npx.cmd --no-install supabase db push --linked --project-ref yzvchumzyonegujucyqs --dry-run --skip-vault
```

dryRun=true; migrations=[202610070002_messages_images.sql]; seeds=[]; roles=[].
No actual push or Vault update. Native psql post-dry-run read-only verification
at 2026-10-08T01:50:22.093034Z still reports exactly the first five versions,
absent message_images/submissions/cleanup and zero chat-images buckets.
The IMAGE migration SHA256 and external backup sizes/hashes are unchanged.

TypeScript, focused ESLint across all 24 changed source/test files, TEXT/API and
IMAGE/API/environment tests, image presentation/conversation tests and both
migration static suites pass. Local production-configured Next.js build used the
real server credential and exited 0 after optimized compilation/static generation.
The known unchanged GlideSelect.jsx global lint parserServices error and outdated
Browserslist notices are recorded separately; no global lint fix was attempted.
All 45 browser scripts were scanned for the exact configured secret, privileged
capability markers and service-role JWTs: zero findings. The exact private key is
also absent from all tracked/unignored source files; index remains empty.

No production operational fixture, manual bucket creation, hosted frontend
deployment, Realtime, commit or push. Guard/test/documentation changes only;
the agent did not edit .env.local. Final documentation validation passed 148 local
links across 20 Markdown files, with zero missing paths/anchors. git diff --check
passes; both migration hashes are unchanged and no files are staged.

## Production identity and read-only baseline

Native psql verified campus-marketplace / yzvchumzyonegujucyqs at
2026-10-08T01:09:48.219303Z, database postgres, current_user postgres.
Explicitly targeted the previously verified production session pooler on port
5432 with SSL required and local pgpass authentication. Connection startup set
default_transaction_read_only=on; query used BEGIN READ ONLY/ROLLBACK and
reported transaction_read_only=on. Password contents were never inspected or
printed; no message/user contents were queried.

Applied history is exactly 202609290001, 202610030001, 202610040001,
202610050001 and 202610070001. 202610070002 remains pending. TEXT conversations
and messages exist; both currently contain zero rows. No public.message_images,
public.image_message_submissions, marketplace_private.chat_image_cleanup,
Phase 2 public RPCs, messages.image_count column or chat-images bucket exists.

IMAGE migration SHA256 remains identical to the Phase 2B/C/D tested version:
`e9257f0b3121660a7db574c92cc23a557575910513e7220ae6fe60b4bc10ea18`.
See [Phase 2D evidence](MESSAGES_IMAGE_PHASE2D.md) for its prior catalog,
dry-run, build, guard and browser-bundle verification. That prior dry-run proposed
only 002; it is not reported as a fresh Phase 2E-A dry-run.

## Fresh backup — verified outside Git

Directory:
`C:/Users/MLTZ/ProductionBackups/campus-marketplace/20261008T011038Z-pre-images/`.
Directory ACL inheritance was removed and full access restricted to the local
user, SYSTEM and Administrators. It is outside D:/Desktop/pwa and not tracked.

Start UTC: 2026-10-08T01:10:38.077Z; completion UTC:
2026-10-08T01:10:46.468Z. Local: 2026-10-07 21:10:38–21:10:46 America/New_York.
Native pg_dump, pg_restore, psql and pg_dumpall report PostgreSQL **17.11**.

| File | Bytes | SHA256 |
| --- | --- | --- |
| database.dump | 345,849 | `6fd746207c3093c173b1adb96e8d53387a5b203578910ce19d10956f5c54ef75` |
| archive-toc.txt | 42,960 | `1c7694ec4de564ce0291c7af4de4594602d03ddf87efa92a4329da8d28505258` |
| roles.sql | 6,327 | `1b0543d581989b88be8ee6a2e11a4897f789057d9446f496758d315c208374cf` |
| backup-manifest.json | 1,707 | `f2ab0776d0d87dba7604429084264c856b0f226d5d0a64fdc3b97b247f6611ec` |
| SHA256SUMS.txt | 325 | `6051f8b9ae0485b8be0d5e97d2178b3b6edafd888bb83ded10bc216d80e84ccf` |

pg_dump custom-format export exited 0. Scope: public, marketplace_private, auth,
storage and supabase_migrations. pg_restore --list exited 0, yielding **556 TOC
entries and 43 table-data entries**. Full pg_restore decoding to NUL exited 0;
no SQL was executed or restored. A temporary schema-only decoding verified TEXT
tables, TEXT-phase/idempotency constraints, send/read RPCs and RLS, then was
deleted. Both TEXT table-data entries exist; their empty state matches the live
read-only row counts. Application schema and migration history are represented;
Phase 2 tables are absent, as expected. Separate roles export used --roles-only
--no-role-passwords, exited 0, and contains no PASSWORD value clauses.

The credential-free manifest records identity, versions, UTC/local timestamps,
scope, sizes, SHA256 and verification results. No password, service-role key,
access token or connection secret was written to backup metadata. Database
archives may contain sensitive Auth/application data and must remain private.
Physical Storage bytes and managed platform schemas outside the listed scope
are not part of this logical recovery point. The older pre-TEXT backup remains
unchanged. No Docker/local database server was installed or used.

The new backup is a verified current-state recovery point. Because preparation
is now paused, recheck freshness immediately before actual rollout and take a
replacement if production state changes or the rollout is delayed. Restoration
always requires separate explicit approval; no automatic restore is planned.

## Historical initial stop: server-only capability and missing configuration

Inspected chat-image-storage, message-image-service and API handlers. The
privileged server client performs only the existing IMAGE capability operations:
private chat-images upload with upsert=false, duplicate-object info/download
reconciliation, byte/hash-bound verified-receipt RPC, participant-authorized
five-minute signed reads, and removal of abandoned unreferenced upload paths.
Normal authenticated clients/RPCs still establish user identity, conversation
participation, author-owned reservations, finalize and abandon. Signing paths
come from participant-RLS image metadata, never a browser-supplied arbitrary path.
The service client itself has elevated privilege; authorization must remain in
these user/session checks before it is used. It is not used for general client
table access or browser RLS bypass.

The initial attempt's Next.js production dotenv resolution reported:

| Check | Result |
| --- | --- |
| SUPABASE_SERVICE_ROLE_KEY exists | NO — mandatory STOP |
| Credential production/ref/role verification | Not possible; no key configured |
| APP_ENV | Missing |
| NEXT_PUBLIC_SUPABASE_URL | Matches campus-marketplace |
| Production .env.local | Git-ignored and not tracked |
| Public service-role/secret environment alias | None found |

During that initial attempt, no key was fetched from Supabase, copied into a file, logged, printed, serialized
or added to documentation. No production server credential was configured by
the agent. At that initial checkpoint, code deliberately required APP_ENV=staging and the
staging service-role JWT/project, so a production key alone will not enable IMAGE.
That guard was left unchanged at the initial stop checkpoint. The subsequently
authorized guard enablement and mismatch tests are now complete as recorded above.

## Historical local setup instructions — now completed by the user

1. Open campus-marketplace's
   [Settings > API Keys](https://supabase.com/dashboard/project/yzvchumzyonegujucyqs/settings/api-keys).
   Confirm the project ref is yzvchumzyonegujucyqs. Select the existing legacy
   service_role JWT key in the legacy keys section. The currently verified code
   validates JWT role/ref claims and does not support opaque sb_secret keys.
   Do not change signing keys or disable/re-enable keys as part of this setup.
   See [official API key documentation](https://supabase.com/docs/guides/getting-started/api-keys).
2. Using a local editor, put the key value directly into the already ignored
   D:/Desktop/pwa/.env.local as SUPABASE_SERVICE_ROLE_KEY. Set APP_ENV=production.
   Keep NEXT_PUBLIC_SUPABASE_URL set to the production URL and
   NEXT_PUBLIC_SUPABASE_ANON_KEY set to the existing production public key.
   No NEXT_PUBLIC prefix for the privileged key; do not put it in next.config.js,
   source files, .env.sample, shell commands/history, screenshots or chat.
3. Save locally and report only that configuration is complete. The next agent
   check must report existence/production identity/Git exclusion only, never the
   value. Restart the local server only when continuation is authorized and the
   production guard has been reviewed. If the legacy key is unavailable, report
   that fact without sharing a key; do not bypass identity checks.

## Historical deferred checks and exact future smoke plan

In the initial stopped attempt, fresh production dry-run, TypeScript/focused ESLint, TEXT/IMAGE API tests,
production mismatch/missing-key guard tests, both migration static tests and
production build **with the configured server credential** were not run after
the mandatory stop. The continuation completed these checks as recorded above.
Prior Phase 2D checks were not used as a substitute for the new configured-runtime
checkpoint. GlideSelect.jsx and global lint configuration
remain unchanged. The known parserServices error remains documented debt.
Documentation-only finishing checks pass: 145 local links across 20 Markdown
files, zero missing targets/anchors, git diff --check and no staged or tracked
local credential/artifact files. External backup sizes/hashes were rechecked
without printing its contents. These checks do not resume the blocked runtime work.

After configuration and reviewed guard enablement, before any migration:
verify staging URL + production designation and the reverse fail closed; missing,
wrong-role and wrong-project privileged keys fail closed; no browser alias/import
or bundle value is exposed. Run fresh explicit production dry-run with
--dry-run --skip-vault; require only 202610070002 and no seeds/roles. Reconfirm
unchanged IMAGE SQL hash and fresh backup. Migration execution requires separate
Phase 2E-B authorization; the bucket must be created by the migration, not manually.

Post-migration local smoke plan only — **NOT EXECUTED**:

1. Verify migration history, private chat bucket/MIME/size settings, IMAGE table
   RLS/grants and service-only receipt/cleanup RPC permissions read-only.
2. Start the local production-mode app with reviewed production config. User
   signs in locally with the existing safe account; no passwords in chat.
3. Open /home?section=messages&destination=buying and the corresponding selling
   destination. GET /api/messages/conversations?role=buying and role=selling
   must return 200 with private/no-store and valid empty/existing results.
   Existing authorized detail/history must load without Storage/RPC/schema errors.
4. Confirm the server credential/environment gate succeeds without printing its
   return value. For the empty database, authenticated GET
   /api/messages/images/00000000-0000-4000-8000-000000000000 must return 404,
   not 500/503; it is a non-mutating missing-message probe. If an authorized real
   IMAGE already exists, its GET/signature response and image rendering should
   succeed. Empty-state smoke alone does not prove actual IMAGE sending/signing.
5. Inspect client bundles and response/logs without recording credential values.
   Confirm TEXT UI availability and no service-role exposure. Do not create fake
   users or write messages/read watermarks just to satisfy the first-tier smoke.
6. Only with a later safe second account and separate fixture authorization:
   one participant publishes one clearly temporary listing; the other uses
   Message Seller, uploads one small generated image through the normal UI,
   verifies refresh persistence and the other participant's signed read. Record
   exact fixture IDs/paths and clean the listing/conversation/message/metadata/
   reservation/queue/object fixtures through reviewed administrative and Storage
   APIs. Never delete either existing production account. Full two-user acceptance
   is already proven on staging; this later optional tier is not executed now.

## Rollout stop/recovery conditions

Stop rollout on any unexpected migration/seed/role, changed SQL hash, failed or
stale backup, migration failure or unexpected partially applied state; public
chat bucket, missing restrictive Storage policies, missing RLS/grants or weakened
participant/author authorization; systemic API 5xx, wrong-project/missing server
capability, exposed privileged key, failed signed-read authorization, TEXT
regression, duplicate durable messages or unexpected data loss.

Disable further IMAGE writes and keep TEXT available where safely possible;
preserve evidence without secrets and inspect the actual state read-only. Do not
automatically rerun/repair migrations, manually create a bucket, drop durable
messages or restore the backup. A leaked privileged key requires a separately
coordinated revocation/rotation and secret removal, not continued rollout. Any
restore or destructive recovery needs explicit user approval and a reviewed plan
that accounts for new durable messages and physical Storage objects.

**202610070002 NOT APPLIED. PRODUCTION IMAGE NOT DEPLOYED. NO PRODUCTION TEST
DATA. NO REALTIME. NO COMMIT. NO PUSH. PRODUCTION SCHEMA/DATA NOT MODIFIED.**

READY FOR PHASE 2E-B IMAGE PRODUCTION ROLLOUT
