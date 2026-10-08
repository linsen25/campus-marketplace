# Messages Phase 2E-B — controlled IMAGE production rollout

2026-10-07 America/New_York; 2026-10-08 UTC.
**PRODUCTION IMAGE MIGRATION APPLIED: YES. Production chat-images: PRIVATE.**
Authenticated single-account local UI/API smoke on localhost:3000 **PASSED**
using the existing production session. Full two-account IMAGE mutation testing
remains deferred. No hosted frontend or Realtime deployment.

## Final target and authorized application

Confirmed **campus-marketplace / yzvchumzyonegujucyqs** before any mutation.
western-marketplace-staging / pcaqxezdfxofysghssyo remained the default linked
project; every production CLI command supplied the explicit production ref.
At 2026-10-08T02:06:55.518304Z, native psql read-only pre-flight confirmed exactly
the first five applied migrations, pending 002, no IMAGE tables/bucket and empty
TEXT conversation/message tables. Production designation, public configuration,
server key project/role and the reviewed IMAGE guard all passed without exposing
credential values.

Existing verified external backup:
C:/Users/MLTZ/ProductionBackups/campus-marketplace/20261008T011038Z-pre-images/.
File sizes/SHA256 were rechecked and the archive was fully decoded to NUL again
before application, exit 0. The 345,849-byte archive contains current TEXT schema
and empty table-data entries. No restore was executed. See
[Phase 2E-A backup and guard evidence](MESSAGES_IMAGE_PHASE2E_A.md).

IMAGE SQL SHA256 remains
`e9257f0b3121660a7db574c92cc23a557575910513e7220ae6fe60b4bc10ea18`,
identical to Phase 2B/C/D and preparation. TEXT SQL is unchanged as well.

Final dry-run:

```powershell
npx.cmd --no-install supabase db push --linked --project-ref yzvchumzyonegujucyqs --dry-run --skip-vault
```

Result: migrations=[202610070002_messages_images.sql], dryRun=true, seeds=[],
roles=[]. Only after this result, executed the explicitly authorized normal
migration workflow:

```powershell
npx.cmd --no-install supabase db push --linked --project-ref yzvchumzyonegujucyqs --skip-vault
```

Exit 0; CLI applied **only 202610070002_messages_images.sql**. No manual SQL Editor
fragments, migration edits, reset, history repair, seeds, roles or Vault update.
The migration itself created the private bucket; no manual bucket configuration.

## Production catalog, Storage and TEXT preservation

Local/remote migration history now matches all six versions:

| Version | Local / production |
| --- | --- |
| 202609290001 | Match / applied |
| 202610030001 | Match / applied |
| 202610040001 | Match / applied |
| 202610050001 | Match / applied |
| 202610070001 | Match / applied |
| 202610070002 | Match / applied |

Read-only post-application checks confirm:

- public.conversations, public.messages, public.message_images,
  public.image_message_submissions and marketplace_private.chat_image_cleanup
  exist with RLS enabled on all five.
- Reservation manifest/expiry/state and JSONB verified_objects receipts are
  present. Ordered image metadata, MIME/size/hash fields, FKs and cleanup worklist
  match the authored contract.
- All **20 function bodies** from the combined migrations match their source
  MD5 values, including the deliberate Phase 2 replacement of prepare_text_message.
  Empty search paths and security-definer settings match; anon cannot execute
  the checked functions. Authenticated prepare/finalize/abandon and TEXT RPC
  grants pass; verified-receipt/expire/cleanup-ack are service-role only.
- **40 constraints**, **16 valid/ready indexes**, **10 enabled custom triggers**,
  and both initially deferred manifest-completeness triggers are present.
  TEXT idempotency, identity and sequence constraints remain. The deliberate
  messages_payload union constraint replaces the TEXT-only restriction while
  retaining TEXT trimming/length/non-null content and IMAGE count rules.
- Application authenticated grants are SELECT only for the four public tables;
  no anon/PUBLIC application table grants. Private cleanup SELECT is service-only.
  Author/participant policies remain; four restrictive chat-images Storage
  policies deny direct client read/insert/update/delete for this bucket.

One initial catalog assertion included the platform's existing realtime.messages
grants because it filtered table names without schema. Read-only diagnosis and
the schema-qualified rerun passed. This was a verification-query scope correction,
not a production defect or policy patch; no Realtime configuration was added.

At 2026-10-08T02:09:33.299928Z, chat-images was PRIVATE, MIME restrictions exactly
image/jpeg, image/png, image/webp and limit **3,145,728 bytes**. listing-images
retains its original public setting, MIME list and 3-MiB limit. No bucket settings
were altered manually. Hosted production DB lint reports **No schema errors
found**, results=[], with no relevant warning or auto-fix.

## Local production app and non-mutating security smoke

The production-configured optimized build exited 0 and the local Next.js app
ran on port 3104, using the ignored production environment. Server credentials
remain private. All **45 generated client scripts** were checked for the exact
configured key, service-role JWTs and privileged Storage/receipt markers: zero
findings. No NEXT_PUBLIC privileged alias was introduced.

Unauthenticated local TEXT conversation and IMAGE signing endpoints initialize
and return 401, with private/no-store, rather than 500/503. Read-only direct
Supabase probes return public chat object=400, anonymous private chat object=400
and anonymous message_images metadata=401. These probes use a nonexistent path:
there are no production chat objects, so they do not claim to test retrieval of
an actual participant image. Private bucket settings/restrictive policies and
the already-complete staging acceptance support the Storage contract.

Signed URLs are generated only after participant-RLS metadata reads and are not
database fields or durable message payloads; canonical chat paths are separate
from listing-images. No signing token or key was printed or recorded. There were
no production fixture images, uploads or generated account/session files.

The initial temporary headed Chrome context was for the user's existing safe account.
No password entry is automated or recorded. The first temporary server readiness
check used native fetch's status as a method; that harness typo was corrected
before browser sign-in, and the isolated server was stopped/restarted. No app
source or production fix was required. That port 3104 attempt timed out without
sign-in and closed its own browser/server, recording no browser/API errors.
The user subsequently confirmed successful sign-in on their existing port 3000
app; no new login or server restart is requested.

Port 3000 anonymous TEXT Buying/Selling and IMAGE signing probes return 401 with
private/no-store, confirming route/credential initialization rather than 500/503.
The browser connector exposes no tabs; native computer-use reports an unavailable
pipe, and no existing Chrome debugging endpoint is configured. The agent cannot
copy or use the existing authenticated cookie session directly. A temporary
localhost:3000 smoke page therefore uses that browser's same-origin session to
load Buying/Selling APIs and real framed empty-state views, then a missing-message
signing GET and guaranteed-rejected nonexistent-conversation prepare probe.
It forwards only sanitized status codes, zero counts and empty-state booleans to
a loopback receiver with credentials omitted; no credential/user identifiers are
collected. No valid reservation, message or upload can be created by these probes.
The completed browser comparison reports normal Buying and Selling API responses
200, both empty-state views, app-context probes 200 with count=0 and no-store,
and session bootstrap authenticated=true. Two production Auth cookies were
present; server-side comparisons confirmed equality with the normal Buying
request for Buying, Selling and the final cookie check. Only counts, equality
flags, statuses and UI booleans were returned. The user's normal Messages
screenshot independently shows "No conversations yet."

The earlier static-page 401 is not reproduced in this existing authenticated
session: both bare and header-matched static requests now return 200 even before
the diagnostic bootstrap. Its original cause is not conclusively established;
the evidence does not justify attributing it to missing headers or bootstrap.
No authentication or application-routing change was required.

### Precise classification of the two IMAGE 404s

Both are **A: expected resource-level responses**, not missing routes.

- Signing: GET /api/messages/images/00000000-0000-4000-8000-000000000000
  matches the one-segment GET branch in pages/api/messages/images/[[...segments]].ts.
  Participant-RLS image metadata for this deliberately nonexistent message is
  empty; the handler returns 404 "Image message not found."
- Prepare: POST /api/messages/images/00000000-0000-4000-8000-000000000000/prepare
  matches the two-segment POST prepare branch. The RPC checks the conversation
  first and raises "Conversation not accessible." with SQLSTATE 42501 for this
  deliberately nonexistent conversation. imageError maps that to the generic
  resource-nondisclosure 404 "Image submission not found." This is a missing
  conversation rejection, not a missing existing submission, route or RPC.
  The check precedes manifest validation and reservation insertion; no fixture,
  reservation, message or upload is created.

The saved authenticated browser results record status=404 and noStore=true for
both probes. The error texts above are established from handler/RPC source;
response bodies were not collected by the sanitized harness. Independent local
credential-free requests verify the registered handlers: signing GET returns
JSON 401, signing POST returns JSON 405 with Allow=GET, and prepare GET returns
JSON 405 with Allow=POST. Missing temporary URLs return Next.js HTML 404 instead.
The loopback receiver's completion log reports AUTHENTICATED_SMOKE_PASSED and
successful temporary-page/route removal. The existing app server's separate
stdout log was not available; no claim of inspecting it is made.

**Authenticated single-account production smoke: PASSED.** This covers the real
empty Messages UI, existing-session API reads and safe IMAGE negative resource
checks. Actual two-participant production upload/finalize/render testing remains
deferred; these 404s do not prove successful production IMAGE mutations.

## Production two-account testing and recovery limits

**TWO-ACCOUNT IMAGE PRODUCTION TEST: DEFERRED.** Only the existing single safe
account is available and the production conversations table is empty. No fake
users, temporary listing, unrelated conversation upload, IMAGE send, boundary,
failure, concurrency or destructive production E2E was run. No production test
data requires cleanup. Full real two-user behavior was covered on staging in
[Phase 2D](MESSAGES_IMAGE_PHASE2D.md), with its documented coverage/limitations.

Read-only schema/API authorization and a single-account empty-state smoke do not
prove actual production participant upload/finalize/signed-byte retrieval or
TEXT sending in an existing conversation. If a later safe controlled two-account
case becomes available, it needs separate scoped authorization and cleanup.

No serious production defect has appeared. If one appears, stop further IMAGE
use, classify application versus database/Storage contract, and report before
recovery. No automatic restore, table drop, bucket deletion or history repair.
The external backup remains a recovery point requiring explicit restoration
approval. No hosting provider/deployment, Realtime or unrelated optimization.

## Final local checks and files

TypeScript, focused ESLint across the 24 changed source/test files, TEXT/API and
IMAGE/API/environment guard tests, image/presentation/conversation regressions
and both migration static suites pass. Production-configured build passes after
optimized client/server compilation and static generation. Its unchanged legacy
GlideSelect.jsx global naming-convention/parserServices error and outdated
Browserslist notices remain separate documented debt, not clean global lint.
GlideSelect and lint configuration were not modified.

Documentation validation passes 151 local links across 21 Markdown files, with
zero missing paths/anchors; git diff --check passes. The exact server credential
is absent from tracked/unignored source, no local credential files are tracked
and the index is empty.

Phase 2E-B adds this report and updates PROJECT_STATUS with the actual migration
result and passed authenticated single-account smoke. No runtime, migration,
dependency or environment-file edits in this phase. All temporary diagnostic
HTML/API routes, ignored harness/result files and the loopback receiver are
removed. Their URLs now return Next.js 404 and port 3115 is no longer listening.
The user's existing localhost:3000 app remains running. No credential/session
state file or production fixture was created. No production data was modified
by the final smoke classification or cleanup.

Final state: TEXT backend **PRODUCTION DEPLOYED**; IMAGE backend **PRODUCTION
DEPLOYED**; chat-images **PRIVATE**; IMAGE frontend/API **LOCALLY VERIFIED AGAINST
PRODUCTION (single-account empty-state and negative resource scope)**; hosted
frontend **NOT DEPLOYED**; Realtime **NOT IMPLEMENTED**; full two-account IMAGE
production mutation testing **DEFERRED**.

**NO REALTIME. NO HOSTED FRONTEND DEPLOYMENT. NO COMMIT. NO PUSH.**
