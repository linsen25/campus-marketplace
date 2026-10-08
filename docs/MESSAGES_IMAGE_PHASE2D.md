# Messages Phase 2D — final staging acceptance and production pre-flight

2026-10-07 local date; production read-only catalog verification at
2026-10-08T01:02:55.593644Z. **PASS: STAGING acceptance; READY for Phase 2E
production rollout preparation. Production IMAGE is NOT DEPLOYED.**

This phase changed test harnesses and documentation only. No application behavior,
SQL, dependencies, environment files, hosting or Realtime changes. The Phase 2A
[design](MESSAGES_IMAGE_BACKEND_DESIGN.md), Phase 2B
[backend evidence](MESSAGES_IMAGE_STAGING_VERIFICATION.md), Phase 2C
[frontend evidence](MESSAGES_PHASE2C.md), status, migrations and final runtime
were reviewed. Their historical checkpoint statements retain their original scope.

## Staging identity and real browser acceptance

Before mutation, CLI identity and credential claims confirmed
**western-marketplace-staging / pcaqxezdfxofysghssyo**. IMAGE migration was
already applied; no migration application, reset, repair or policy change occurred.
Local Next.js port 3103 used staging public configuration and an ephemeral
server-only staging key. Seller, Buyer and Outsider used three independent real
Auth cookie contexts. Passwords, keys and sessions existed only in memory.

Seller published disposable listings through the normal UI. Buyer opened the
primary conversation through the real listing Contact Seller flow. Generated
decodable JPEG, PNG and WebP files entered the existing browser attachment UI:
File -> prepare -> private upload -> independent verified receipt -> finalize ->
canonical IMAGE rendering. No primary acceptance IMAGE was inserted directly.

Successful run `daa454c5`: **39 PASS groups**, including cleanup. The final
primary history contained **24 mixed messages with contiguous sequences**.

| Requested area | Actual result |
| --- | --- |
| Seller/Buyer workflow | Buyer TEXT + one IMAGE; Seller refresh/unread/read, TEXT + four IMAGEs; Buyer refresh/read/order and `4 photos` preview passed. |
| Persistence | Hard refresh, sign-out/sign-in, leave/return and switching conversations retain durable images; sign-out clears previous history. New activity moves the correct conversation first. |
| Signed display renewal | Invalid signed display URL exercised the actual authorized renewal endpoint. One failed renewal, explicit retry, then repeated image-error events resulted in two renewal requests total. Buyer/Seller succeed; Outsider is denied; gallery state survives. |
| Failure/retry | Prepare, first upload, partial multi-upload, finalize, lost committed finalize response and renewal failures recover. Files survive appropriate errors; retries reuse nonce/submission identity and reconcile exactly one canonical message without duplicate upload or sequence. |
| Cancel A–E | Before prepare: local-only. Reserved, partially uploaded and all-uploaded/pre-finalize: abandonment and orphan removal. Already committed finalize: cancel is rejected, panel does not falsely close, retry resolves the existing durable message. |
| Cleanup failure | Test-only server transport injected Storage DELETE failures in the exact disposable namespace. DB abandonment and queue survive; supported Storage removal and guarded acknowledgment recover. No raw Storage metadata DELETE. |
| TEXT regression | Enter, Shift+Enter, IME suppression, trimming, refresh, unread/read, activity ordering and lost-response idempotent retry pass. Mixed IMAGE/TEXT history remains sequence-correct. |
| Listing lifecycle | Sold and separately deleted listings retain snapshots, participant signed IMAGE reads and subsequent IMAGE sends. Deleted View Listing degrades gracefully. Existing listing RLS reports sold to Seller and unavailable to Buyer; conversation access remains valid. |
| Outsider/tampering | Conversation/history, prepare, binary upload, finalize, cancel and signing/renewal deny access; malformed UUID and forged sender fields are rejected. No unauthorized payload or Storage access. |
| Storage isolation | chat-images remains private, JPEG/PNG/WebP-only, 3,145,728-byte cap. Public chat URL does not work. Chat upload paths use chat-images; listing-images remains public with its existing cap/MIME configuration. Listing fixture uploads are removed. |
| Boundaries | Real decodable exactly-3-MiB JPEG sends; 3-MiB-plus-one-byte, unsupported type and five files are rejected. One/four-image finalization and two/three/four-image galleries pass. |
| Responsive | 390, 430, 1280 and 1536: no horizontal overflow; attachment panel, cancel scroll preservation, mixed history, incoming/outgoing alignment, gallery open/close, composer and chat scroll pass. Mobile list/chat and Go Back, desktop recent rail/expanded list, unread/read and zero-conversation empty state pass. |

No browser runtime errors were recorded. Failure injection is representative
browser HTTP fault/lost-response interception over real backend state; cleanup
failure uses an explicit test-only Node preload. It is not deployed application
instrumentation or a claim of a naturally occurring service outage. Renewal used
an invalid display token and inspected real 300-second token lifetime; no full
five-minute wall-clock expiry wait is claimed. IME coverage dispatches composition
events; it is not manual testing of every OS keyboard. Cleanup queue acknowledgment
uses a scoped eleven-minute fixture-clock adjustment rather than real waiting.

Two interrupted runs were harness issues, not product defects: a switch selector
targeted an item outside the three-item recent rail, and a sold-listing assertion
ignored Buyer listing RLS. Both runs cleaned their fixtures with zero residue;
the corrected complete run passed. No runtime fix was needed.

## Performance observation

Local development server, hosted staging, one sample each; not a production SLA.
The test-only preload counts outbound server requests by category, including
authentication and UI refresh/read activity. Counts are observations, not minimum
pipeline counts; they exclude browser image GETs and are not a load test.

| Operation | Elapsed | Outbound server categories |
| --- | --- | --- |
| One bounded IMAGE history HTTP request | 434 ms | Auth 2; conversation query 1; messages query 1; image metadata query 1; signing batch 1. |
| Real one-image UI send through durable render | 4,146 ms | Auth 7; RPC 3; other DB 9; Storage 3; image metadata 1; signing batch 1; messages 2. |
| Real four-image UI send through durable render | 7,541 ms | Auth 15; RPC 8; other DB 23; Storage 12; image metadata 1; signing batch 1; messages 2. |

History resolves image metadata and signed URLs in a single batch per page.
Sequential uploads, verification and repeated auth/read/refresh work account for
more round trips on four-image sends. No acceptance blocker appeared. Existing
conversation-list N+1 behavior is unchanged; no optimization was folded in.

## Cleanup and unchanged baseline

Final read-only staging counts are zero: Phase2D Auth users, all profiles,
listings, conversations, TEXT/IMAGE messages, message_images, submissions/receipts,
cleanup queue, chat-images objects and listing-images objects. The private bucket
and all six applied migrations remain. Staging database lint reports **No schema
errors found**, results=[]; no disabled trigger or policy weakening was introduced.
Generated images/SQL/control files and sanitized temporary run evidence were
removed after recording this report. Browser contexts and isolated server close;
no credential/session files were created.

Unchanged SHA256 values:

| File | SHA256 |
| --- | --- |
| TEXT migration | `2ee6cb35370c05cbc76d57fa78efd319cda24c1987cb8a5cbf5593121a3d4b7f` |
| IMAGE migration | `e9257f0b3121660a7db574c92cc23a557575910513e7220ae6fe60b4bc10ea18` |
| Ignored production .env.local | `476751f10507725f4f24852621c856badf467f85a2c27f923072069a6267b504` |

No sensitive/local-only paths are staged or tracked. Tracked .env.sample contains
blank Supabase placeholders and the inherited public demo search configuration.
Credential-pattern scanning found no service-role JWT, secret Supabase key,
access token or password-bearing database URI in tracked/unignored files.

## Production inspection and dry-run — read only

Only after successful staging acceptance/cleanup, inspected **campus-marketplace /
yzvchumzyonegujucyqs** through native psql using local pgpass. Connection startup
set default_transaction_read_only=on; catalog query used BEGIN READ ONLY and
ROLLBACK, and reported transaction_read_only=on. No user message contents or
credentials were queried. Production public configuration matches this project;
staging remains the permanent linked CLI project.

| Version | Production |
| --- | --- |
| 202609290001 | Applied |
| 202610030001 | Applied |
| 202610040001 | Applied |
| 202610050001 | Applied |
| 202610070001 | Applied |
| 202610070002 | Pending |

Both TEXT tables have RLS; authenticated grants are SELECT only; all five custom
TEXT triggers are enabled. All eight TEXT migration function bodies match the
authored baseline by MD5; empty search paths and RPC/private execution grants
match. Messages content remains non-null and TEXT-phase/idempotency constraints
remain. **No IMAGE relation, new function, chat Storage policy, image_count column
or chat-images bucket collision exists.** IMAGE SQL SHA256 still matches staging.

Executed only this supported dry-run:

```powershell
npx.cmd --no-install supabase db push --linked --project-ref yzvchumzyonegujucyqs --dry-run --skip-vault
```

Result: dryRun=true; migrations=[202610070002_messages_images.sql]; seeds=[];
roles=[]. No real push, history repair, seed, Vault update or production test data.

## Backup readiness and future runtime requirements

Native pg_dump, pg_restore and psql at C:/pgsql/bin report **17.11**. The local
pgpass file exists and authenticated read-only production connection succeeds.
Its contents were not printed. The older external backup directory still exists:
C:/Users/MLTZ/ProductionBackups/campus-marketplace/20261007T191844Z-39c743ba/.
That backup predates TEXT and is insufficient as the sole IMAGE rollout backup.
**No new backup or restore was performed in Phase 2D.**

Phase 2E must take and verify a NEW logical backup immediately before applying
002, outside Git at
C:/Users/MLTZ/ProductionBackups/campus-marketplace/&lt;freshUTC&gt;-phase2e/.
Proposed commands below are documentation only; create that directory first,
set BACKUP_DIR to its absolute path and use the existing local pgpass:

```powershell
$env:PGSSLMODE = 'require'
& C:\pgsql\bin\pg_dump.exe --host=aws-0-ca-central-1.pooler.supabase.com --port=5432 --username=postgres.yzvchumzyonegujucyqs --dbname=postgres --no-password --format=custom --schema=public --schema=marketplace_private --schema=auth --schema=storage --schema=supabase_migrations --file="$env:BACKUP_DIR\database.dump"
& C:\pgsql\bin\pg_restore.exe --list "$env:BACKUP_DIR\database.dump"
& C:\pgsql\bin\pg_restore.exe --file=NUL "$env:BACKUP_DIR\database.dump"
```

Require successful exits, nonzero size, UTC start/end, byte sizes, SHA256 and a
nonempty table-data/schema TOC. Decoding to NUL executes no restore SQL. Preserve
grants/owners in the archive; if a separate roles export is needed, exclude role
passwords. Logical backup does not include physical Storage bytes. No Docker or
local PostgreSQL server is required or installed by this phase.

Future production runtime configuration:

| Name | Scope / value |
| --- | --- |
| APP_ENV | Server designation: production. |
| NEXT_PUBLIC_SUPABASE_URL | Public: https://yzvchumzyonegujucyqs.supabase.co. |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Public production anon/publishable key; never a privileged key. |
| SUPABASE_SERVICE_ROLE_KEY | Server-only Storage/receipt capability; no NEXT_PUBLIC alias, no browser import. Not added or exposed here. |

Current IMAGE storage code deliberately accepts only staging APP_ENV and the
staging service-role JWT/ref. **Setting production credentials alone will not
enable it.** Phase 2E preparation needs a separately reviewed production guard
change preserving exact project/role validation, then secure server-only key
configuration for any local production IMAGE smoke. Opaque secret-key support
is not implemented by the current JWT gate. Public env variables are expected
in the browser; the privileged credential must never be public. It is used only
after normal Auth/RLS access checks for Storage/receipt operations.

Remaining execution prerequisites: fresh verified backup, reviewed production
environment enablement, secure server credential configuration and explicit
authorization to apply/deploy/smoke-test. This is readiness for **preparation**,
not permission or immediate readiness to apply the migration. No hosted frontend
deployment exists; no hosting provider was introduced.

## Final safe checks and legacy lint debt

TypeScript, focused ESLint across all 24 changed source/test files, local Messages
API/environment tests, IMAGE API/credential/stream/duplicate-receipt tests, image
selection/presentation/conversation tests and both migration static suites pass.
These static tests do not independently execute SQL; hosted behavior is covered
by the staging suite above. Production-configured local Next.js build passed
(exit 0, optimized client/server compilation and static generation complete),
using validated production public configuration and an explicitly empty server
key. It did not deploy. The build logged the legacy lint error below and existing
outdated Browserslist data notices; those are recorded separately from build success.

All 45 generated client scripts were scanned: zero privileged Storage/receipt
capability markers, service-role JWTs or secret-key patterns. Generated private
chat media routes retain NetworkOnly behavior. The staging server on port 3103
is stopped. Final TypeScript and all seven local test suites pass; focused ESLint
passes. README/docs link validation passes **143 local links across 19 Markdown
files**, including anchors, with zero missing targets. git diff --check passes.

Unchanged components/ui/GlideSelect.jsx reproduces:
`@typescript-eslint/naming-convention` requires parserServices and
parserOptions.project. Effective JSX parser is Next/Babel; it supplies no
TypeScript parser services to the inherited Algolia rule. File equals HEAD;
SHA256=78969489420992f13e312a98a27a195ada31c9abec5f842507b16d5a33eda054.
No broad refactor or lint config change. This is pre-existing whole-repository
lint debt; focused changed-file lint passes. It is not a clean global lint claim.

Phase 2D files added:
[browser acceptance runner](../tests/messages-images-phase2d-staging.cjs),
[extended acceptance helper](../tests/messages-phase2d-acceptance.cjs),
[explicit test-only transport preload](../tests/messages-phase2d-transport.cjs),
this report. Updated [PROJECT_STATUS](PROJECT_STATUS.md). Prior Phase 2A/B/C
source/test/documentation changes remain uncommitted. No dependency changes.

**STAGING TESTS ONLY. PRODUCTION NOT MODIFIED. 202610070002 NOT APPLIED TO
PRODUCTION. PHASE 1 TEXT PRESERVED. NO REALTIME. NO COMMIT. NO PUSH.**

READY FOR PHASE 2E PRODUCTION ROLLOUT PREPARATION
