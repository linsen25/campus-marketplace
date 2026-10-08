# Messages Phase 2B: hosted staging database and Storage verification

**PASS, 2026-10-07. STAGING ONLY. NOT DEPLOYED TO PRODUCTION.**
Frontend IMAGE persistence/upload/signing is **NOT INTEGRATED**; IMAGE Send stays
gated. No Realtime, production mutation, commit or push.

## Target, migration and hosted compatibility

CLI confirmed the sole linked target **western-marketplace-staging**,
`pcaqxezdfxofysghssyo`, PostgreSQL 17.11.0.003. Every database CLI operation used
both --linked and this explicit ref. SDK origin and service-key JWT project ref
were independently pinned to that same project. campus-marketplace was not a
database/Storage target, and no production credential was used.

Before mutation, the first five versions were applied: 202609290001,
202610030001, 202610040001, 202610050001, 202610070001. Only 202610070002 was
pending. Dry-run proposed **only 202610070002_messages_images.sql**, with empty
seeds/roles. Applied that migration once using the normal CLI push and --skip-vault.
It succeeded on first execution. Post-apply all six local/remote versions match.
No SQL defect, SQL fix, reset, manual patch, reapply or history repair was needed.

[Authored migration](../supabase/migrations/202610070002_messages_images.sql)
remains unchanged, SHA256:
`e9257f0b3121660a7db574c92cc23a557575910513e7220ae6fe60b4bc10ea18`.
Its NOT APPLIED header records Phase 2A authoring; this report supersedes it for
staging only. The Phase 1 TEXT SQL remains byte-for-byte unchanged:
`2ee6cb35370c05cbc76d57fa78efd319cda24c1987cb8a5cbf5593121a3d4b7f`.

Actual hosted Storage columns matched the offline design assumptions, including
bucket limits/MIME arrays and object id/name/bucket_id/metadata/owner/owner_id.
Real SDK upload/info/download/remove/signing worked with installed SDK 2.117.2.
Receipt/finalize accepted actual Storage mimetype/size and object UUID metadata.
No Storage schema shim, policy weakening, custom Storage trigger, raw physical
object metadata deletion or storage.protect_delete bypass was used.

chat-images was absent before migration and now exists **PRIVATE**, cap 3145728
bytes, allowed MIME exactly image/jpeg, image/png, image/webp. listing-images
retains its original public=true, 3145728 cap and MIME array. No listing-image
file upload was used by the IMAGE suite. Publication fixtures used the established
administrative SQL-only listing-image metadata mechanism, removed through supported
Storage API cleanup after listing removal. No listing bucket configuration changed.

## Actual catalog and security results

Hosted catalog assertions passed for four RLS tables (messages plus three new
tables), 25 validated constraints, ten enabled noninternal triggers, two initially
deferred constraint triggers, six new public RPCs and four restrictive Storage
fences. Index validity checks reported zero invalid indexes. Direct authenticated
INSERT/UPDATE/DELETE privileges on message_images, image_message_submissions and
the private cleanup table are absent. Three ordinary RPCs grant authenticated
execution; verification/expiry/cleanup-ack RPCs are service-role-only; anon has no
new RPC execute. All six are SECURITY DEFINER with empty search_path. No Messages
tables are published to Realtime.

Real GoTrue password sessions were created for disposable Seller A, Buyer B and
Outsider C using confirmed Western accounts and valid usernames. Sessions/passwords
were never saved. Normal prepare/finalize/read/write-denial checks used their
actual SDK Auth sessions and real PostgREST RLS. Admin context was limited to
fixture setup/cleanup, the intended trusted byte-verification/signing primitive,
operator actions and explicit administrative/integrity tests.

New `message_images` schema was exercised: one UUID child per ordered slot,
message FK/cascade, unique slot/path, filename, MIME, size, SHA256 and canonical
creation time. IMAGE content=NULL and image_count=1/4 persist. Existing TEXT
still requires trimmed 1-2000 characters. Attempting a complete-reservation IMAGE
parent insert without children failed the actual deferred constraint at SET
CONSTRAINTS IMMEDIATE, with its expected check-violation message and rollback.
Privileged sent-child UPDATE/DELETE also failed the actual immutability trigger.

## Real upload/finalize/read matrix

Executed [messages-images-staging.cjs](../tests/messages-images-staging.cjs), plus
its --cleanup-isolation and --activity-race modes. These are staging verification
primitives, not new application upload routes or frontend integration.

| Area | Actual result |
| --- | --- |
| Prepare | Buyer and Seller accepted; outsider/nonexistent conversation rejected; 1/4 descriptors accepted, 0/5 and client path/position fields rejected. Canonical UUID namespace matched conversation/submission/image IDs. |
| Nonce | Exact prepare returned same UUID/expiry; changed hash payload rejected. TEXT reuse of IMAGE nonce rejected. Exact finalize returned same row/sequence/children; retry after later incoming TEXT did not re-acknowledge it. |
| Upload authorization | Sender-RLS server primitive succeeded; other participant/outsider and arbitrary path rejected before privileged upload. Direct participant/outsider Storage upload, signed-upload token creation, private download/signing and sent overwrite rejected. |
| Real bytes | JPEG, PNG and WebP uploaded/downloaded/hash-verified through private Storage. Exactly 3145728 bytes accepted (valid JPEG padded for boundary size); 3145729 and GIF rejected by the actual bucket. Server primitive rejected incorrect signature/hash/length. |
| Receipts | Stored object UUID/path/MIME/size and SHA256 reconciled. Wrong actor, slot, hash, MIME and actual stored size rejected. Normal users could not record fake verified receipts. Repeated stored-byte verification was idempotent. |
| One image | One IMAGE parent, NULL content, correct conversation/sender, canonical sequence 2, image_count=1 and one ordered child. No visible sent row before successful finalize. |
| Four images | One IMAGE parent at sequence 4, exactly four child slots 1/2/3/4, correct ordered metadata and unique paths. |
| Incomplete | Missing first, middle or last of four uploads rejected finalize; no message appeared. Missing receipt, wrong metadata and expired complete upload also rejected. |
| Lost response | A real finalize committed, its response was deliberately ignored, and retry returned the same canonical message. No extra sequence, children or upload objects. Upload retry reconciled existing object rather than overwrite. |
| Mixed history | TEXT, IMAGE(1), TEXT, IMAGE(4) returned unified sequences 1..4. Canonical image_count projected Photo / 4 photos. No app repository/UI image mapper was installed or claimed. |
| Activity/read | IMAGE last_message_sequence/last_message_at matched its returned sequence/time; successful send advanced sender watermark. Exact retry preserved sender watermark after newer incoming TEXT. Existing unread/read semantics also passed Phase 1 suite. |
| Private reads | Buyer and Seller RLS metadata lookup authorized server batch signing; outsider metadata was empty and signer rejected before privileged call. Signed JWT lifetime was 300 seconds and fetched bytes matched hashes. Public URL access failed. URLs were not persisted. |
| Immutability | Direct table writes rejected for Buyer/Seller/Outsider; private/operator mutation RPCs denied. Privileged child edits/deletes rejected. Finalized cancel rejected; live referenced cleanup-ack returned false. |
| Sold/deleted listing | Actual seller sold then deleted a fixture listing; existing signed reads and additional IMAGE sends survived. New unrelated buyer entry was rejected after sale. Immutable listing snapshot/origin survived. |
| Participant deletion | Deleting Buyer preserved history/images; surviving Seller signed/read them with buyer_id NULL. Seller deletion while another owned listing remained was blocked by the known listing FK. |

The intended server Storage client uses **staging service_role only**, held in
memory. It is needed because the design denies direct client byte access/signing.
The normal user client establishes current Auth identity, author/participant RLS,
reservation slot/path and bounds first. Then the privileged client uploads with
upsert=false, re-downloads bytes, checks existing image signature + actual size
and SHA256, records the object receipt, and signs only authorized paths for 300s.
No browser/public environment, server production secret, new application env key
or service-role history query was introduced. All SDK HTTP origins were enforced
as the pinned staging origin. Test reports never contain keys, passwords, tokens,
cookies or signed URLs.

## Independent-session concurrency

The harness holds the first real transaction for 12 seconds, observes its granted
message-table lock through pg_stat_activity/pg_locks, then starts the second.
It asserts distinct pg_backend_pid values and an actual second-session wait.
Authenticated database roles/claims match the real disposable Auth identities.
This is not sequential execution or a single serialized in-memory client.

| Case | First / second sequence | Final result | Observed second wait |
| --- | --- | --- | ---: |
| Same IMAGE submission | 5 / 5 | Same UUID, one durable IMAGE | 8.052665s |
| Different IMAGE submissions | 6 / 7 | Two distinct sequential messages | 8.282947s |
| TEXT then concurrent IMAGE | 8 / 9 | Unified serialized sequence | 8.013569s |

All durable sequence values afterward were contiguous and unique. The separate
cancel/finalize test held actual cancellation locks, then made a real authenticated
finalize request. It waited 5.726s, rejected the abandoned submission, and left no
message for it. The finalized branch separately rejected later cancellation.

## Orphans, cascades and physical cleanup

Verified reservation cancellation before upload, partial-success cancellation,
cancel retry, fully uploaded expiry/finalize failure, unknown finalized outcome
and administrative conversation deletion. Pending failure creates no durable
history; finalized lost-response objects remain live, not abandoned or deleted.
Abandon/expiry queue canonical paths; administrative parent deletion captures
paths before messages/images/submissions cascade. The queue has no parent FK.
Physical files remain until supported Storage API removal, not an FK effect.

Cleanup removed scoped objects only through `.storage.from(bucket).remove(paths)`.
A separate isolation test queued one disposable private orphan, removed exactly
that path (asserted the API returned its exact name), verified its private download
failed, and hash-checked an unrelated private object was still readable. Both
isolation objects were subsequently removed. Repeated removal/ack was safe.
Ack rejected existing objects/live references and too-young queue records; eligible
absent-object acknowledgment removed queue entries and repeated acknowledgment
returned true. No background worker or scheduled job was added.

Two timestamp-boundary tests use explicit **administrative fixture-clock
simulation**, not 24-hour/ten-minute wall-clock waiting:

- For one disposable submission, a transaction temporarily disabled its identity
  guard, backdated only that row's expires_at, then re-enabled the guard before
  committing. Real authenticated finalize and service-role expiry subsequently
  exercised the enabled actual guards. No Storage policy was disabled, and final
  catalog reports zero disabled triggers.
- For only this run's queued paths, administrative setup backdated queued_at by
  11 minutes after proving recent acknowledgment rejects. Real ack then passed.

These are controlled fixtures for the time predicates, not a migration edit or
runtime expiry bypass. A real 24-hour wait, five-minute signed-URL expiration wait,
hard upstream upload timeout/late-write chaos test and full long-term inventory
reconciliation were not performed. Unknown upstream outcomes must remain queued
as the design requires; no deployed cleanup worker is claimed.

## TEXT regression, harness corrections and checks

The unchanged [Phase 1 hosted SQL suite](../tests/messages-text-staging.sql) passed
all 13 groups after IMAGE application: find/create, TEXT trim/blank/2000/2001,
retry, independent sequences, buyer/seller/outsider RLS, write denial, read/unread,
immutable identity/message guards, sold/deleted histories, participant deletion
and administrative cascade. Its SQL-only fixtures rolled back. The API/frontend
source and applied TEXT migration did not change.

Harness corrections were not SQL defects:

1. Initial Outsider username exceeded the existing 20-character rule. Shortened
   fixture names; fixed an empty-UUID-list count query. A separate read-only check
   confirmed zero failed-run users/conversations/messages before retry.
2. An added test initially expected cleanup-ack to throw for a live reference;
   the authored contract correctly returns false. Fixed the assertion. That run's
   cleanup passed with all fixture counts zero before the complete rerun.
3. New harness global/lint/format declarations were fixed locally; no product code.

Pre- and post-suite staging database lint both reported **No schema errors found**,
results=[], no warnings/auto-fixes. Local TypeScript, harness/static-test ESLint,
both migration source contracts and local API/environment/CSRF/auth guards passed.
Documentation link check passed: 122 local links across 17 Markdown files, zero
missing targets/anchors. Final git diff --check passed.

## Final state and evidence

Final hosted counts: fixture Auth users=0, profiles=0, listings=0,
conversations=0, messages=0, message_images=0, submissions=0, cleanup_queue=0,
chat-images objects=0 and listing-images fixture metadata=0. No invalid indexes
or disabled triggers. Temporary SQL directories were deleted; actual test keys/
passwords/sessions existed only in memory. chat-images remains PRIVATE as intended
staging infrastructure; it was not removed.

Ignored evidence under `tests/artifacts/messages-phase2b/` includes catalog SQL/JSON,
preflight/final read-only queries and sanitized results. Successful extended run:
`results-71030cb4.json`; physical isolation: `results-6f9e3f90.json`; activity/race:
`results-d5123abe.json`. Earlier failed harness runs are retained as failed evidence,
not presented as successful verification. No secrets or signed URLs are included.

Phase 2B adds this report and the staging harness, updates PROJECT_STATUS and adds
a staging-verification pointer to the Phase 2A design. Phase 2A migration/static
files remain present; SQL had no changes. No application/frontend/production file
or environment changes. `.env.local` hash remained
`476751f10507725f4f24852621c856badf467f85a2c27f923072069a6267b504`.

**Phase 2 IMAGE migration: AUTHORED, DEPLOYED TO STAGING,
HOSTED STAGING EXECUTION VERIFIED, NOT DEPLOYED TO PRODUCTION.**

**STAGING ONLY. PRODUCTION NOT MODIFIED. PHASE 1 TEXT BEHAVIOR PRESERVED.
NO FRONTEND IMAGE INTEGRATION. NO REALTIME. NO COMMIT. NO PUSH.**
