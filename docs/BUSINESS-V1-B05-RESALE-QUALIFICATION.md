# B05 — Resale qualification (2026-10-19)

Status: REAL STAGING CORE PASS / BLOCKED ON UNPUBLISHED IMAGE VISIBILITY.
The separately authorized acceptance and exact fixture cleanup are recorded below.
No schema/RLS/policy/Auth/cron changes have been performed.
Only the finally authorized publication recovery/Discard behavior changed. No
layout, styles, animation, five-step navigation or additional controls changed.
No IndexedDB/localStorage/sessionStorage draft persistence or cleanup cron added.

## Exact scope and existing implementation reused

B05 is qualification of existing draft/media/publish/edit/delete/sold/favorites,
not replacement CRUD. Source: task breakdown B05; logic audit Resale rows and
journeys 2/3; source index API/table/function listings.

- UI: `components/listings/home-listings.tsx`, shared
  `components/listings/listing-form.tsx` and existing cards/upload/review controls.
- Orchestrator: `lib/listing-publication.ts`; API client `lib/listings-api.ts`;
  input/image validation `lib/listing-validation.ts`, `lib/listing-images.ts`.
- APIs: `pages/api/listings/[[...segments]].ts`,
  `pages/api/listing-images/[id].ts`, `pages/api/favorites/[[...segments]].ts`.
- Repository: `lib/server/supabase-listings-repository.ts`; cookie identity and
  same-origin checks reuse current Auth infrastructure.
- Tables: listings, listing_images, listing_favorites; listing-images Storage.
- RPC: marketplace_finalize_listing. Parent locks serialize image metadata changes
  with finalization; unique listing_id/slot and immutable expected_image_count
  define the creation manifest. Published media/taxonomy/channel stay immutable.
- Migrations: 202609290001_marketplace.sql (base/RLS/Storage),
  202610040001_marketplace_taxonomy.sql,
  202610050001_marketplace_publication_favorites.sql,
  202610130013_offer_revision_guards.sql,
  202610150001_meeting_location_references.sql,
  202610150002_listing_fulfillment_defaults.sql,
  202610160005_dual_payment_paths.sql (held inventory/payment restrictions),
  202610160007_listing_channel_authority.sql (latest finalize/channel rules).
  These are local source references, not fresh deployed-definition certification.

## Confirmed defect and local fix

Previously `createPublishedListing` caught upload failure, confirmed publishedAt=null, and
tries abandonListing. If abandonment itself fails before row deletion, its error
is swallowed and the original upload error is thrown. ListingForm catches the
error without setting pending, losing the live draft ID. Next submit creates a
new draft. The existing continuation only calls finalize; it cannot resume missing
uploads. Existing foundations tests explicitly expect this throw, so passing them
alone does not satisfy B05 recovery acceptance.

`tests/resale-recovery-b05.cjs` originally reproduced the lost ID and two remaining
drafts. With the fix its unchanged acceptance assertions now PASS: the pending
result retains the same ID and leaves only one draft. No network/database.

Final product rule replaces the earlier autosave proposal: Create is new; Discard
discards. The open form alone retains files/pending server ID. Upload failure no
longer automatically abandons the known draft or loses its ID. Existing Continue
publication first performs owner-only reconciliation, returns immediately if already
published, and refuses unknown state. Manifest count must match the selected files.
For each immutable slot, the API validates identity, MIME/signature/size and owner,
then `lib/server/listing-image-recovery.ts` checks the authoritative reservation and
Storage bytes. Exact existing bytes are reused; only explicit Storage 404 permits
upload, always upsert=false. Unique-slot races reuse the winning reservation;
conflicting bytes, unknown reads and missing ready objects fail closed. A committed
upload with lost response is matched without a second upload. Existing finalize
RPC remains the publication authority. No schema, grant, RLS or trigger changes.

Discard attempts existing atomic unpublished-only abandonment; whether cleanup is
confirmed or fails, it clears fields/files/pending and exits via the existing path.
Published reconciliation is never treated as an unpublished deletion. No form
restoration on reopen. Unconfirmed cleanup is logged with Listing ID in the API
and client console, without field/file/credential data. These are diagnostic log
records, not a new durable cleanup queue; production log retention remains an
operational concern. No promise of remote deletion when cleanup fails.

Additional failure gap: metadata-first removal is safe for references, but Storage
delete failure can leave an orphan after its metadata is gone. Existing errors
request cleanup retry, yet image DELETE looks up metadata that was removed and
abandon starts by requiring the deleted Listing. Durable/owner-scoped cleanup
recovery needs focused qualification, not a fabricated successful cleanup claim.
No local or Staging asset deletion is authorized by this report.

## Local validation and remaining Staging scope

Existing suites PASS: listings-v1, listing-fulfillment-repository, listing-channel,
marketplace-foundations-api. The foundations expectation was updated deliberately:
failed upload now returns same-ID pending instead of throwing/abandoning it.
New resale-recovery-b05 and listing-image-recovery-b05 tests PASS. The latter covers
same-slot races, byte identity, wrong owner, unknown Storage, failed/lost uploads,
missing ready objects and removed metadata. Wizard browser tests include same-ID
finalize retry, partial-upload recovery, Discard on cleanup failure, empty reopen,
all five widths and reduced motion. Application TypeScript, focused ESLint and
diff/new-file whitespace checks PASS. Full wizard run passed all five widths in
normal/reduced motion; a final focused 820 run reconfirmed failed-cleanup Discard,
empty reopening, editor compatibility and all Shop fail-closed previews.
These in-memory adapters do not prove hosted RLS,
row locks, actual Storage concurrency or refresh persistence.

Separate Staging approval needed for uniquely marked temporary seller/buyer/outsider
accounts, real JPEG/PNG/WebP fixtures in their exact prefixes, create/upload/publish
retry/edit/delete/sold/favorite/unfavorite/relogin matrix, and exact fixture cleanup.
Read actual latest RPCs/ACL/RLS/bucket config first with explicit project ref
pcaqxezdfxofysghssyo. Never default CLI target. Held inventory should be produced
through the existing authorized transaction commands, not forged pointers; because
this can create Orders/events/notifications, request that exact scope separately.
No payments, emails, existing listings or historical snapshots may be changed.

B05 is NOT yet Staging accepted. B06 has not started. B04 is separately recorded COMPLETED in
the task breakdown with its real Staging report.

## Exact B05 files changed

- `lib/listing-publication.ts`: retain pending ID, same-ID reconciliation/resume.
- `lib/listings-api.ts`: optional fixed upload slot on the existing image endpoint.
- `lib/server/listing-image-recovery.ts`: owner/path/slot/byte-safe recovery.
- `pages/api/listing-images/[id].ts`: validate recovery slot and reuse existing
  authentication, owner check, MIME/signature/size and publication restrictions.
- `pages/api/listings/[[...segments]].ts`: sanitized abandon-failure log record.
- `components/listings/listing-form.tsx`: same-ID Continue, Discard clears local
  create state even when cleanup is unconfirmed; publication clears pending ID.
- `tests/resale-recovery-b05.cjs`: original lost-ID regression now passing.
- `tests/listing-image-recovery-b05.cjs`: byte/slot races and integrated publication
  recovery, lost response and unknown/published-state checks.
- `tests/marketplace-foundations-api.cjs`: pending result replaces obsolete throw.
- `tests/listing-wizard.browser.cjs`: upload recovery, cleanup failure/Discard,
  empty reopen/no autosave, existing responsive/editor/Shop regressions.
- `docs/BUSINESS-V1-TASK-BREAKDOWN.md`: B04 completed; B05 local fix, live pending.
- `docs/BUSINESS-V1-B05-RESALE-QUALIFICATION.md`: scope, results and acceptance limits.

The local phase above used controlled I/O; the later real Staging phase is separate
evidence below. No CSS/component design changes, migration,
bucket/policy/trigger change, cron, automatic form persistence, Git staging,
commit/push, Production access, or B06 work.

## Authorized real Staging acceptance — 2026-10-19

Target: `pcaqxezdfxofysghssyo`, exact environment/JWT ref verified; every CLI query
used the guarded explicit project ref. Never used default Production link.
Test harness: `tests/resale-b05-staging.cjs`, preflight/accept modes; acceptance
requires `B05_STAGING_WRITE_APPROVED=1`. Actual current local API handlers + installed
Supabase SDK + real Staging DB/Storage/Auth; actual ListingCreationSheet in local
browser HTTP harness, no application deployment or application code changes.

Run `7546f352-afc6-4299-a991-c380a2c73492`; ignored journal:
`tests/artifacts/b05-live-7546f352-afc6-4299-a991-c380a2c73492/result.json`.
Real UI screenshot: same directory, `discard-fresh-create-1280.png`.
Three uniquely marked no-email Admin-created users, five temporary Resale Listings,
10 stored image objects/11 metadata reservations before cleanup. Their email
preferences were disabled before Listing work. No price decrease, notification
recipients, mail endpoint, order, or payment. Read-only trigger preflight checked
the current relevant functions; scoped cleanup precheck confirmed zero Orders and
zero Notifications for these fixtures.

Actual PASS:

- JPEG, PNG and WebP upload/publish; owner derived from Auth, Resale channel,
  ordered complete three-slot manifest, anonymous published row and exact bytes.
- Local rejection of second Storage upload leaves one same-ID pending draft;
  parallel Continue operations and repeated finalize converge on one Listing with
  exactly three unique image slots. No second create.
- Second real upload commits before its response is locally replaced with 503;
  recovery checks stored bytes, uploads only missing third image. Exactly three
  successful Storage object POST paths, no overwrite or duplicate successful path.
- Unpublished Listing/image metadata hidden from buyer/outsider/anonymous;
  outsider RLS updates/deletes have no effect, outsider finalize forbidden,
  unauthenticated mutation/recovery denied; signature and slot checks reject.
- Same-ID edit preserves images, repeated Favorites POST deduplicates, relogin
  restores favorite/list, other-user favorite state isolated and forged owner
  insert denied. Seller-only Sold hides Listing from public/Favorites; sold edit
  denied; unfavorite persists through real API.
- Forged Shop channel create and direct channel update denied; Resale unaffected.
- Actual Create UI: failed upload retains ID; local rejection of remote DELETE on
  Discard produces application server log + browser warning with exact Listing ID.
  Draft remains unpublished; modal closes; reopen has zero photos/step 0/empty
  title; no auto restore, no new Listing until Publish. Layout/controls unchanged.

### FAIL / acceptance blocker: item 11 byte access

Existing bucket `listing-images` is public. Read-only anonymous probe of the
unpublished fixture image for Listing
`6d250903-87a4-4e4d-aa5d-d72c74d797c9` returned **HTTP 200** via its known public URL,
while its Listing/image metadata remained hidden by RLS. Thus metadata tests alone
cannot certify unpublished photo privacy. The public bucket is existing authority,
not a bucket/policy change made by B05. No fix was attempted; changing Storage
visibility and image delivery needs separate explicit approval and impact review.
All remote testing stopped after this discovery except finishing authorized cleanup.

### Cleanup and operational limit

Initial test cleanup incorrectly assumed service-role REST table grants. REST
Listing reads returned 403; no grants were widened and account deletion was held.
Cleanup then revalidated exact run metadata, IDs, seller/title prefix and no Order
references, deleted only these five fixture Listings in guarded SQL with existing
triggers enabled, removed only their exact Storage prefixes through Storage API,
and deleted only the three run-owned Auth users after checking their run metadata.
The harness now uses this guarded exact-run cleanup rather than assuming table ACLs.

Final read-only counts all **0**: users, identities, sessions, refresh tokens,
profiles, Listings, image metadata, Favorites, notification preferences, activity
events and Storage objects for this run. No remaining fixture/orphan resources.
Auth/security audit history retained. Cleanup receipt retained its original failure
entries plus final success; no failure history was erased.

Not newly exercised live: UI double-click Publish (API concurrency was tested),
held inventory (Orders forbidden this run), external worker outages, browser reload
during an unknown create response, and exhaustive size/rate-limit cases. Existing
offline tests are separate evidence. Item 11 blocks full B05 acceptance until the
image visibility requirement is decided/resolved. No B06, Production, stage,
commit or push.


### Local image-isolation follow-up (not deployed)

The separately authorized local implementation adds forward migration
`202610190001_listing_image_isolation.sql`, a private source bucket for new Resale
images, ID-scoped read API, source-aware recovery/cleanup and order snapshot source
compatibility. See [image-isolation implementation and deployment plan](BUSINESS-V1-B05-IMAGE-ISOLATION.md).
Local native PostgreSQL, API, recovery, Seller and snapshot regressions passed.
No Staging migration/policy/object change occurred. The existing real Staging
privacy blocker remains until separately authorized deployment and acceptance;
legacy public draft objects are intentionally not migrated in this task.


### Image-isolation Staging deployment and acceptance (2026-10-19)

Explicit target `pcaqxezdfxofysghssyo`, only `202610190001` deployed. New Resale
private source, Draft/Published/Sold API access, real Storage URL/download/render
unauthorized-byte denial, immutable source, same-ID recovery/concurrency and
Seller/Favorites/channel regressions passed. Both temporary test runs cleaned to
zero; historical image/Order frozen hashes unchanged. Known legacy public draft
objects=0; seven detached public objects retained (one historical-reference,
six unclassified). See [detailed acceptance and remaining limits](BUSINESS-V1-B05-IMAGE-ISOLATION.md).
Status: new image isolation Staging PASS; full historical snapshot byte round-trip
and new transaction snapshot prepare/bind not certified by this limited run.
UI changes NONE. No production, mail, payments, Git staging/commit/push or B06.


### User-confirmed scoped closure (2026-10-19)

Authorized B05 scope ACCEPTED: Resale publication recovery, new-image privacy,
real Staging Storage/RLS/API/UI regressions and historical snapshot metadata/ACLs
passed. Historical snapshot byte download/hash is explicitly EXCLUDED by user
decision; no re-request in this workflow. New real-transaction snapshot prepare/bind
is deferred to B07 transaction acceptance, not passed here. Six unclassified legacy
public objects remain a separate risk; do not delete/migrate. Retain original
untested transaction/held-inventory cases as gaps rather than an unconditional
all-criteria completion claim. B06 proceeds with local-only authorization.
