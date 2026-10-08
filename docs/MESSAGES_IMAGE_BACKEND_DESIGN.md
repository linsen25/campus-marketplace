# Messages Phase 2A: durable IMAGE backend design

2026-10-07. **DESIGN + SQL AUTHORING ONLY. NOT APPLIED OR EXECUTED.**
Staging verification and API/frontend integration are pending. No Supabase calls,
bucket creation, production changes, Realtime, commit or push in this phase.
Phase 1 TEXT is production deployed and locally smoke verified; its applied SQL,
API and UI source are unchanged. The user reports that baseline is committed/pushed.
Frontend hosting remains NOT DEPLOYED.

Subsequent Phase 2B executed the unchanged migration and real database/Storage
tests on hosted staging only. See [hosted staging verification](MESSAGES_IMAGE_STAGING_VERIFICATION.md)
for results, fixture cleanup and limitations. This document retains its Phase 2A
authoring checkpoint; IMAGE frontend integration and production rollout remain pending.

Subsequent [Phase 2C](MESSAGES_PHASE2C.md) implements and verifies the API/frontend
flow on staging. The descriptions of pending integration below retain their
Phase 2A context; production IMAGE rollout remains pending.

Authored migration: [202610070002_messages_images.sql](../supabase/migrations/202610070002_messages_images.sql).
Its sequence follows 202610070001 using the existing twelve-digit convention.
Static checks: [messages-images-migration.cjs](../tests/messages-images-migration.cjs).
This document supersedes the earlier illustrative IMAGE sketches in
[Phase 1 backend design](MESSAGES_BACKEND_DESIGN.md), not the verified TEXT contract.

## Evidence inspected and architecture decision

Read [project status](PROJECT_STATUS.md), [staging database evidence](MESSAGES_STAGING_VERIFICATION.md),
[Phase 1C](MESSAGES_PHASE1C.md), [Phase 1D](MESSAGES_PHASE1D.md) and
[production rollout](MESSAGES_PHASE1E_B.md). Inspected the actual
[TEXT migration](../supabase/migrations/202610070001_messages_text.sql),
[Messages repository](../lib/server/supabase-messages-repository.ts),
[catch-all API](../pages/api/messages/conversations/[[...segments]].ts),
[message types](../types/message.ts), [selection validator](../lib/message-images.ts),
[attachment composer](../components/home/message-attachments.tsx), its CSS,
[gallery](../components/expandable-gallery.tsx), its CSS, history renderer and
[Marketplace binary upload route](../pages/api/listing-images/[id].ts).

Installed `@supabase/supabase-js` and `@supabase/storage-js` are **2.117.2**.
The local SDK source `node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts`
provides `.upload(path, bytes, { contentType, upsert:false })`, `.download(path)`,
`.info(path)`, `.remove(paths)`, `.createSignedUrl(path, expiresIn)` and
`.createSignedUrls(paths, expiresIn)`. The signing implementations require object
SELECT authorization and accept expiry seconds. Signed upload documentation in
that installed source says tokens last **two hours** and can enable upsert at
creation. They are not selected for this design.

Use Browser -> existing Next.js Pages APIs -> authenticated request-scoped DB
client/RPCs. A **separate server-only privileged Storage client** is needed for
IMAGE bytes, short-lived signing, verified receipts and orphan removal. No browser
Supabase client, browser Storage token or service-role key is added now. This is a
deliberate Phase 2 capability boundary, not a rewrite of TEXT authentication.

Normal prepare/finalize/cancel/read use the user's existing public-key client with
HTTP-only session, requireMarketplaceUser, same-origin writes and APP_ENV target
guard. Finalize actor remains auth.uid(), never an API-supplied sender. The future
privileged client must validate the same exact environment/project URL, accept only
server secrets, disable session persistence and never be exported by browser
modules or substituted into the normal request client. Configure its secret
locally/host-secret storage only in the later implementation phase; none is
requested, read, logged or committed here. Service role is broad by nature:
keep its use in a small server module restricted to canonical reservation paths
and the three explicitly server/operator-only RPCs. Do not use it for history
authorization, ordinary sends, conversation creation or read watermarks.

## Product contract and data model

- Exactly JPEG (`image/jpeg`), PNG (`image/png`), WebP (`image/webp`).
- 1-4 ordered images, each **1-3,145,728 bytes (3 MiB)**.
- One Send produces **one IMAGE parent**, with 1-4 child records, no caption.
- IMAGE content is NULL; no fake text, pending message or provisional sequence.
- Sent image bytes and metadata cannot be changed through participant APIs.
- Durable storage paths and metadata are persisted, never public/signed/blob URLs.
- Sold/deleted listings and profile deletion retain surviving conversation history.

| Table | Fields and integrity |
| --- | --- |
| `public.message_images` | UUID id; message_id FK ON DELETE CASCADE; position 1-4; unique `(message_id,position)`; unique storage_path; original_name 1-255 printable characters; MIME whitelist; size_bytes 1-3145728; sha256 lowercase hex; created_at derived from parent |
| `public.image_message_submissions` | UUID id (future sent message UUID); conversation FK ON DELETE CASCADE; historical sender UUID without Auth/profile FK; client nonce unique per conversation/sender; immutable ordered bounded manifest; verified_objects object-id receipts; pending/finalized/abandoned state; created_at; fixed 24-hour expiry |
| `marketplace_private.chat_image_cleanup` | Unique storage_path and queued_at; passive durable operator worklist with no parent FK, retained after administrative deletion |

Submission manifest has at most four items. Each holds canonical image UUID,
1-based position, canonical Storage path, original_name, mime_type, size_bytes,
sha256. It is a bounded upload manifest, not JSON message history. Final child
rows contain only immutable sent metadata. The SHA256 is necessary to reject a
same-nonce retry carrying different bytes even when count/MIME/size/name match;
it is not complicated duplicate detection or a deduplication project. Browser
can calculate the descriptor hash with Web Crypto; the server independently
hashes actual streamed/stored bytes before attesting it. User claims are not proof.

Pending state is outside `messages`: recipient lists/history, activity, unread and
read watermarks cannot accidentally include it. Author-only RLS may expose their
own reservation for retry reconciliation, but the UI will not resume unsent drafts
on navigation/remount. Reserve only after Send, not while browsing/selecting photos.

## Evolving messages without changing the TEXT baseline

The new migration drops only `messages_text_phase_only` and `messages_text_content`,
makes content nullable, adds image_count and installs `messages_payload`:
TEXT remains trimmed 1-2000 characters, image_count NULL; IMAGE requires content
NULL and image_count 1-4. Existing type discriminator, sequence/idempotency indexes,
history indexes, participant SELECT, conversation identity/snapshots, allocation,
activity/read triggers and sent-message immutability remain.

`prepare_text_message()` is replaced under its existing trigger name, retaining
the TEXT branch's validation, parent lock, sequence/time assignment. It adds IMAGE
reservation checks and rejects a new TEXT send reusing a reserved IMAGE nonce.
The three Phase 1 public RPC definitions are not replaced. Existing TEXT exact
retry still returns before allocation and never re-acknowledges later incoming
messages. A TEXT nonce cannot become IMAGE, or vice versa.

IMAGE child inserts must exactly match the locked reservation. Child UPDATE/DELETE
is denied while the parent exists; after administrative parent removal cascade
is allowed. Deferred constraint triggers on both parents and children require
TEXT to have zero images and IMAGE to have exactly image_count contiguous positions
1..count. Unique slots plus count/min/max establish contiguity at commit. A partial
parent cannot commit, including through an accidental privileged insert. No
pending status is added to the working messages table.

## Prepare, upload, verify, finalize and retry

1. **Prepare:** authenticated participant RPC receives conversation UUID, client
   nonce and ordered descriptors. Locks conversation, validates 1-4 items, refuses
   arbitrary path/identity fields, generates submission/image UUIDs and paths.
   Exact descriptor retry returns the same immutable reservation and expiry;
   changed descriptors/order/hash produce 23505 -> 409. It checks sent nonce
   collisions too. It never renews expiry or reopens an abandoned submission.
2. **Upload:** dedicated Next binary endpoint uses bodyParser:false. Same-origin
   and authenticated Western checks precede accepting bytes. Read only the caller's
   reservation through RLS, match conversation, sender, slot, pending state and
   expiry. Reject arbitrary paths, caption/sender fields and unknown slots. Stream
   at most 3 MiB; enforce declared length, MIME and existing signature validation
   (JPEG FF D8 FF; PNG signature; RIFF/WEBP), then compare actual SHA256. Signature
   validation is the existing contract, not proof of full decoder validity or
   image moderation. No compression/resizing in this phase.
3. **Private write and receipt:** privileged server `.upload()` to the canonical
   path, `upsert:false`, `cacheControl:'0'`, correct contentType. Never mint signed
   upload tokens. After write, use `.info()` and `.download()` to verify stored
   identity/metadata and bytes (bounded read, signature/hash), then call the
   server-only receipt RPC with the already verified session actor, image UUID,
   actual Storage object UUID and verified hash. The RPC checks reservation owner,
   state/expiry/participant, exact descriptor, object id/path and Storage MIME/size.
   It records object-id receipts, not browser ready flags. Duplicate upload errors
   are reconciled by re-reading the immutable object and rechecking bytes; never
   overwrite. Service-owned objects may have NULL owner_id; reservation ownership,
   canonical path and receipt are authoritative, not Storage owner_id.
4. **Finalize:** user's RPC locks conversation -> submission -> Storage metadata,
   requires every object and server receipt to match. Missing object/receipt, bad
   metadata, expiry or abandonment reject before insertion. Inserts one IMAGE,
   its ordered children and terminal submission state in one DB transaction.
   Existing triggers assign sequence/time and update activity/sender watermark.
   Deferred constraints prove complete children at commit. Failed transaction
   rolls everything back. Receipt creation never changes activity.
5. **Unknown outcome:** GET the same reservation/history, or retry finalize with
   the same submission UUID. Finalized state returns the original message, with
   no new sequence/activity/read update. Do not delete objects while success is
   uncertain. Exact prepare after finalize returns the finalized reservation too.
   Network failure is not evidence of rollback. Concurrent IMAGE/TEXT/finalize
   operations serialize on the same conversation lock; staging must prove this.

Receipt writing is service-role-only: participant table writes and receipt RPC
execution are not granted. Direct Storage uploads/signing are denied to all
normal clients, so a caller cannot bypass the server's byte checks, mint a
long-lived upload token or overwrite after Send. Trusted operator access remains
privileged, as with any database/storage administrator, and is not a user feature.

## Private bucket, authorization and signed reads

Create `chat-images` reproducibly with `storage.buckets` in the new migration:
public=false, file_size_limit=3145728, allowed MIME whitelist. An existing bucket
causes failure; do not silently flip a bucket that might contain public data.
This follows the existing listing-bucket migration convention, while retaining
completely separate privacy and four-image limits.

Path format: `<conversation UUID>/<submission UUID>/<image UUID>` (no extension,
email, username, original filename or public URL). Original name is escaped display
metadata only. All IDs and paths are generated by SQL and returned as a manifest.

Four restrictive Storage RLS fences exclude chat-images from normal SELECT,
INSERT, UPDATE and DELETE even if another permissive policy is added. No custom
Storage trigger or Storage table grant changes; listing-images policies remain
untouched. Participant SELECT is preserved on DB messages/image metadata; actual
bytes and signing are server-mediated. The normal API first queries the requested
message_images through user RLS/current Western authorization and derives the
canonical path list. Only then does the server Storage client call
`.createSignedUrls(paths, 300)` (five minutes), batched per history page. Never
accept browser paths for signing. No URLs stored in DB or logs; no service-role
history queries. Unauthorized/outsider/missing image lookup is uniformly 404.

Signed URLs are bearer capabilities: someone given a valid URL can use it until
expiry. Five-minute lifetime bounds that window; this is not instant revocation
or a promise that participants cannot copy images. Normal users cannot mint
longer URLs directly because Storage SELECT is denied. If immediate per-request
revocation becomes required, use authenticated streaming instead in a later
approved change. Do not use `getPublicUrl`, public bucket paths or listing bucket.

Local compatibility evidence: the existing external pre-Messages production backup
was decoded **schema-only**, without a database connection. It contains
storage.buckets id/name/public/file_size_limit/allowed_mime_types and Storage
objects id/bucket_id/name/metadata/owner/owner_id/user_metadata. Existing listing
migrations validate metadata->>'mimetype' and metadata->>'size'. The authored SQL
uses that established contract and compares decimal size strings safely. This
does not prove hosted current Storage API behavior. **Before applying in Phase 2B,
inspect the actual staging catalog/defaults, triggers/policies and SDK upload
metadata shape; schema/API compatibility remains an explicit gate.** Never edit
Storage internals or disable storage.protect_delete for physical files.

## Cancellation, orphan cleanup and deletion

| Situation | Required outcome |
| --- | --- |
| Selection cancelled before Send | Only local object URLs revoked; no reservation/upload/message |
| Partial failure | Keep same pending manifest for explicit retry; no message/activity; cancel abandons all slots |
| Upload succeeds, receipt/finalize fails | Re-read object and retry verification/finalize; never replace slots |
| Lost upload/finalize response | Reconcile same IDs; finalized outcome retains objects and message |
| Cancel races finalize | Conversation/submission locks pick a terminal result: abandoned or finalized, never both; cancel of finalized rejects |
| Expired or disconnected session | 24-hour expiry prevents finalize; operator-only bounded expiry RPC abandons pending rows and queues paths |

On explicit cancel, abandon via authenticated RPC first, abort and settle in-flight
requests, then the server removes canonical orphan paths through Storage API.
Never raw DELETE storage.objects. The service cleanup module must recheck no sent
image reference and terminal abandoned state, and accept only reserved/queued
paths. Keep tombstone/manifest so late upload compensation still has a known path;
new retries require a new nonce and fresh UUID namespace. Do not auto-abandon on a
timeout after an unknown finalize result. Navigation/unmount clears local unsent
drafts, with best-effort cancel only if send has not committed; server expiry is
the fallback when clients disappear. No automatic unfinished draft restoration.

The private worklist is populated on abandon/expiry and BEFORE administrative
conversation deletion, before cascades remove metadata. The latter captures
both sent children and reserved pending paths, idempotently. Listing/profile
deletion does not queue chat objects. DB cascades are not physical deletion.
Approved operator tooling later reads bounded worklist batches, checks no sent or
active reservation references, calls `.remove()` in fixed chat-images, confirms
each returned path/absence through the Storage API, then acknowledges via guarded
RPC. Errors remain queued; removal/ack retry is safe. Ack refuses surviving
metadata/references and entries younger than ten minutes. Future upload endpoints
must enforce at most 60 seconds per request, abort upstream work and compensate
late writes; the reconciliation window exceeds bounded in-flight work. Re-list
the namespace after the window before ack, not merely a single earlier empty
result. An administrative service write outside this protocol is out of scope.
No cron, background service or worker is installed in Phase 2A.
If any upstream upload outcome is still unknown, leave the worklist entry
unacknowledged rather than treating the ten-minute window as proof of completion.
A later bounded manual inventory reconciliation can list chat-images, compare
UUID paths against sent children and active reservations, and queue/remove
unreferenced objects older than the 24-hour draft lifetime. This catches late
orphan writes even after a previous apparent removal. Never sweep young or
referenced objects. No inventory scan runs in this phase.

Do not purge abandoned/finalized tombstones casually: they retain nonce identity
and cleanup provenance. Any later retention policy requires separate review;
24 hours is draft expiry, not deletion of sent images or tombstones. Surviving
participants continue reading after account/profile removal; sender UUID/grouping
survives. The existing owned-listing FK/account deletion limitation is unchanged.

## SQL access and RPC inventory

All new functions harden search_path='' and explicitly qualify tables. Definer
functions are justified for guarded writes, protected receipt/object validation,
integrity triggers and cleanup; normal read projections use user RLS. All new
private helpers and public RPCs revoke default PUBLIC/anon/authenticated execute
before granting only the required entry points.

| RPC | Caller | Result |
| --- | --- | --- |
| marketplace_prepare_image_message(uuid,uuid,jsonb) | authenticated verified participant | author-only canonical submission row |
| marketplace_finalize_image_message(uuid) | authenticated sender/participant | canonical messages row; exact retry same row |
| marketplace_abandon_image_message(uuid) | authenticated sender/participant | terminal abandoned reservation; finalized rejects |
| marketplace_record_verified_chat_image(uuid,uuid,uuid,uuid,text) | service_role only after API byte verification | append idempotent object receipt |
| marketplace_expire_image_submissions(integer) | service_role operator only | abandon at most 100 expired pending reservations; SKIP LOCKED |
| marketplace_ack_chat_image_cleanup(text) | service_role operator after Storage remove | acknowledge only unreferenced absent object after reconciliation window |

New public tables grant authenticated SELECT only, with author/participant RLS.
No direct participant INSERT/UPDATE/DELETE. Private cleanup has no normal user
access; service operator can SELECT, guarded acknowledgment deletes. Existing
messages/conversations grants and RLS are unchanged. No Auth FK cascade added.

## Future Pages API contract (not implemented)

Base `/api/messages/conversations/:conversationId`. Extend the existing catch-all
for JSON operations; split raw byte upload into a dedicated Pages route because
bodyParser:false conflicts with the catch-all's 32 KB JSON parser. All results
are private/no-store and writes retain same-origin/header guards.

| Method / suffix | Request | Response |
| --- | --- | --- |
| POST `/image-submissions` | `{clientMessageId, images:[{name,mimeType,size,sha256}]}`; 1-4, bounded JSON; maps names to SQL descriptor keys | `{submissionId,state,expiresAt,images:[{id,position,name,mimeType,size,uploadEndpoint}]}`; no signing token/path authority |
| PUT `/image-submissions/:submissionId/images/:imageId` | bounded raw bytes; exact MIME/size/hash; sender's current reservation; separate byte route | `{imageId,verified:true}`; duplicate object reconciled, not overwritten |
| GET `/image-submissions/:submissionId` | no path/sender fields; author lookup through RLS | pending with verified slot IDs, abandoned, or finalized plus canonical message; expiresAt |
| POST `/image-submissions/:submissionId/finalize` | empty object; no caption, URLs, path, sender, count or timestamp | `{message}` containing one canonical IMAGE DTO |
| DELETE `/image-submissions/:submissionId` | no client object paths | abandoned + cleanupPending boolean; does not delete a sent message |
| POST `/messages/:messageId/image-urls` | `{imageIds:[...]}` 1-4 bounded IDs belonging to that message | `{images:[{id,previewUrl,expiresAt}]}` after participant RLS |
| GET `/messages?before=<sequence>` | current sequence pagination | existing `{messages,nextBefore}` union, ordered images and five-minute URLs |

404 inaccessible identity; 401 no session; 403 eligibility/origin; 400 invalid
shape/slot; 409 nonce conflict/incomplete/expired/terminal state; 413 >3 MiB;
415 MIME/signature mismatch; 503 temporary Storage/DB failure. Never expose raw
provider errors, privileged keys, signed query strings, hashes or private paths
in diagnostics. Hash need not be returned in presentation DTOs. API cannot send
success until DB finalize commits; signing failure after commit means a committed
message needs URL refresh, not that upload should be cancelled/deleted.

## Existing UI mapping and bounded performance

Keep current `Message = TextMessage | ImageMessage` and `ImageAttachment` fields.
Future ImageMessage gains canonical sequence/clientMessageId; image descriptors
map id/original_name/size_bytes/mime_type to id/name/size/mimeType, with signed URL
as previewUrl and expiresAt as additional renewal metadata. Do not revoke HTTPS
signed URLs with revokeObjectURL; retain revocation for local draft blobs only.
The attachment send callback will later become async over selected File values,
using existing StatefulButton state flow and replacing previews only on canonical
success. This phase changes none of that code and leaves IMAGE Send gated.

Single-image containment/alignment, 2-4 image stacked/shared-layout gallery,
go-back/outside/Escape exit and scroll restoration remain. Incoming IMAGE uses
the current sender positioning/grouping. Refresh re-fetches metadata/URLs.
Before integrating, generalize the existing TEXT-only merge/read sequence logic
to canonical IMAGE sequence; do not leave IMAGE at fallback sequence 0. Renew
URLs while viewed and on image-load expiry without dropping the existing gallery
state, mark-read callback or conversation selection. PWA already excludes
/api/messages; private Storage URLs must not be cached by the service worker
or persisted across sign-out. Inspect runtime cache matching in that later phase.

History: one bounded messages page plus one `message_images IN (page IDs)` query
ordered by message_id,position (max 200 URLs for a 50-message page), then one
SDK createSignedUrls batch or documented bounded chunks after measuring provider
limits. Check each per-path error; no silent omitted images. Preview uses existing
latest message query's type/content/image_count -> `Photo` or `N photos`, without
new per-image preview calls. Keep sequence pagination and backend activity sorting.
Conversation-list N+1 optimization remains separate and is not implemented here.
The current repository mapper and read/merge code are TEXT-only. Do not apply
this migration to production or expose IMAGE finalize through application APIs
until union DTO support, private URL renewal and server secret safeguards are
implemented and verified. Phase 2B may exercise isolated backend fixtures on
staging; those checks alone do not prove the existing app can display durable
IMAGE history. Keep IMAGE Send gated throughout design/database verification.

## Exact Phase 2B hosted-staging verification plan (do not run now)

1. Pin `western-marketplace-staging`, verify URL/public and server-only secret
   target guards; confirm production is not selected. Review backup/recovery,
   Storage catalog columns/defaults/protect_delete/current policies, signed URL
   behavior and SDK `.info()`/upload metadata shape. Stop on incompatible schema.
2. Obtain separate approval before migration execution. Dry-run must show only
   202610070002; apply using normal CLI. Check history/catalog/RLS/grants/functions,
   lint; no manual fragments/repair. Confirm existing TEXT rows/constraints and
   zero historical data loss. Rerun Phase 1 behavior/independent-session tests.
3. Confirm chat-images exists PRIVATE, exact MIME/3145728 cap; listing-images
   unchanged. Public URL and anonymous raw download fail. Direct client Storage
   upload, signed-upload-token creation, signing, overwrite/move/delete fail for
   both participants and outsider: intentional server-mediated policy.
4. Use two disposable verified Western users and outsider in real API sessions.
   Before API implementation, a staging-only verification harness performs the
   documented server steps with isolated operator key and actual Storage API;
   do not claim frontend integration is verified by SQL-role fixtures.
5. Prepare 1 and 4 slots: caller owns pending metadata, recipient/outsider cannot
   see it, no sent message/sequence/preview/activity/unread changes. Reject zero,
   five, bad UUIDs, forged sender/path/slot and other-conversation reservations.
6. Upload real JPEG/PNG/WebP at ordinary size and exactly 3145728; reject GIF,
   PDF/TXT/video, zero bytes, 3145729 bytes, wrong MIME/signature/hash/length and
   incorrect manifest. Assert receipt RPC is inaccessible to normal users.
7. Real participant server upload allowed; other participant/outsider/wrong sender
   rejected. Attempt direct SDK signed upload and upsert bypass. `.upload()` retry
   is read/verify of the same object, not overwrite or an extra physical path.
8. Incomplete upload or missing receipt must not finalize. Simulate corrupted
   metadata/object removal and failed trusted receipt; transaction leaves no
   sent rows/activity. Removing raw Storage metadata is not physical cleanup.
9. Finalize 1 -> one IMAGE/one child; 4 -> one IMAGE/four children in exact order;
   content NULL, image_count, ids, size/MIME/hash, immutable path and creation
   time match. Commit incomplete/extra/TEXT-child manifests must fail deferred
   constraints. Direct update/delete/append of sent child/message/object denied.
10. Mixed TEXT/IMAGE sequence and monotonic timestamps/read sender watermark:
    concurrent IMAGE/IMAGE and IMAGE/TEXT finalize/send sessions serialize;
    no gaps from reservation/cancellation, own unread excluded and recipient
    unread derives rows. Same nonce exact prepare/finalize returns same UUID;
    changed descriptor/order/bytes and cross-type nonce conflict reject.
11. Lose a finalize response after actual commit; retry returns same parent and
    four children, no new activity/read acknowledgment. Reconcile finalized GET.
    Lose upload/receipt response; same object verified again, no duplicate receipt.
12. Authorized signed reads for both participants through user-RLS lookup and
    server `.createSignedUrls(...,300)` return all paths; outsider signing fails
    without privileged request. Test anonymous bucket URL, valid bearer window,
    expiration and authorized renewal. Document bearer sharing limitation.
13. Cancel before upload, partial failure, pending cancel, expiry, abandon retry
    and concurrent cancel/finalize; assert exactly one terminal state. Abort/
    settle late uploads, remove physical objects, retain queued failures and
    ten-minute reconciliation window. Operator expiry is bounded 100/SKIP LOCKED.
14. Sold/deleted listing: both participants still read/sign/send IMAGE, no object
    deletion. Delete disposable buyer/profile (listing-owner FK restriction as
    Phase 1) and verify surviving seller images remain accessible.
15. Administrative conversation deletion: DB messages/images/submissions cascade,
    private cleanup paths persist, physical files still exist until normal
    Storage `.remove`. Check object removal includes every requested path; ack
    refuses live references, existing metadata or a too-young queue entry, then
    succeeds after reconciliation. No raw Storage DELETE/guard bypass.
16. Buyer/seller metadata RLS succeeds; outsider sees zero rows. Normal users
    cannot write rows, forge receipts, expire others' drafts, read worklist or
    acknowledge cleanup. Hardened search_path and execute grants inspected.
17. Clean only disposable staging fixtures: deliberately delete conversations,
    process cleanup while keys remain available, verify every physical path gone,
    clear eligible queue entries, then users/listings. Assert zero fixture rows/
    files/worklist entries, remove temporary keys/SQL/session artifacts. No
    production fixture or second production account.

## Phase 2A validation and boundaries

Only four repository files change: this document, the new SQL migration,
`tests/messages-images-migration.cjs` and `docs/PROJECT_STATUS.md`. Runtime/types/UI
and all Phase 1 SQL stay unchanged. Static tests inspect SQL structure/invariants,
not SQL execution, real RLS, Storage bytes or concurrent transaction behavior.
TypeScript is unchanged; local TypeScript/API baseline checks may still be rerun.
Relevant test ESLint, both migration source contracts, local API/environment guard,
documentation links and diff check are the safe validation scope.

Validation completed: TypeScript `--noEmit --incremental false`, scoped ESLint for
the new test, both TEXT/IMAGE static source contracts, local Messages API/explicit
environment/CSRF/auth guards, 117 local documentation file/heading links across
16 Markdown files, and `git diff --check` passed. The TEXT migration SHA256 remains
`2ee6cb35370c05cbc76d57fa78efd319cda24c1987cb8a5cbf5593121a3d4b7f`.
No SQL parser/database execution, hosted lint, dry-run/push, Storage creation or
hosted security/concurrency tests ran. Hosted verification is pending Phase 2B approval.

**PHASE 1 TEXT BASELINE UNCHANGED. PHASE 2 IMAGE MIGRATION AUTHORED ONLY.
STAGING NOT MODIFIED. PRODUCTION NOT MODIFIED. NO REALTIME. NO COMMIT. NO PUSH.**
