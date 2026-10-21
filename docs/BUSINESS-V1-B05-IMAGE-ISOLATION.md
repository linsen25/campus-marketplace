# B05 image isolation ? local implementation

Authorization: local code, forward migration and tests only. No remote operations.

## Access matrix (fixed before implementation)

| State | Seller owner | Buyer / other authenticated user | Anonymous |
|---|---|---|---|
| New private draft, ready image | Yes | No | No |
| Published available Resale | Yes | Yes | Yes |
| Sold private source | Yes | Order snapshot only for authorized participants | No |
| Deleted / detached manifest | No via image API | Authorized historical snapshot only | No |
| Public Seller page | Existing published available Resale projection only | Same | Same |
| Order snapshot | Existing participant RPC authority | Existing participant RPC authority | No |

Legacy public URLs retain existing behavior, including known legacy draft exposure.
Private Storage owner-prefix SELECT remains available to the verified owner for
upload reconciliation and orphan deletion; it never grants another user access.
The public image API requires a current ready manifest and never accepts a path.
No UI, card, form or wizard changes are authorized or included.

## Implemented local architecture

- Forward migration: `202610190001_listing_image_isolation.sql`.
- `listing_images.storage_bucket` defaults existing rows to `listing-images`;
  a security-definer BEFORE INSERT trigger chooses private for every new Resale
  image, even if a trusted caller supplies another destination. No client column
  INSERT/UPDATE grant. Identity protection also freezes the bucket.
- Existing public bucket and generated owner/Listing/image path are unchanged.
  New private bytes never move on finalize. The existing parent lock, exact image
  manifest checks, MIME/size limits, channel gate and idempotent finalize remain.
- `/api/listing-media/<image UUID>` uses the session/anonymous RLS client to read
  a real ready manifest and parent, verifies the association and generated path,
  then fetches bounded bytes through the existing server-only guarded Storage
  capability. It rechecks visibility after download. No path/bucket input, signed
  URL, redirect or public cache. GET and HEAD follow identical authorization.
- Public available Resale is anonymous-readable through this API. Other states
  require the verified owner. Missing/unauthorized resources share HTTP 404.
- Restrictive Storage policies guard private reads, inserts, updates and deletes
  even in the presence of an unrelated permissive policy. Owner reads support
  reconciliation/orphan cleanup. UPDATE/upsert remains disallowed. Public bucket
  INSERT cannot accept new Resale bytes or a private manifest destination.
- Mapping covers Listing repository, shared Favorites projection, public Seller
  and Messages live Listing reads. No visual components changed. PWA configuration
  explicitly routes listing-media to NetworkOnly; generated `public/sw.js` is not
  hand-edited and must be rebuilt as part of a separately approved app deployment.
- `order_media_assets.source_bucket` freezes the actual source for NEW preparation.
  Existing rows retain legacy source. Existing manifest JSON, hash algorithm,
  bound snapshot target objects, participant RPC and transaction states unchanged.
  Legacy V1 historical URL mapping remains untouched.
- Cleanup is metadata-first, grouped by authoritative bucket, using session RLS
  rather than privileged deletes. Late uploads recheck reservations. Failures
  log exact candidate keys for reconciliation without clearing/lying about
  remote cleanup. No new queue, cron or cross-close form persistence.

## Compatibility limits

The migration does NOT privatize old public objects. Legacy known draft URLs may
still return bytes. Existing legacy UNREADY Resale reservations cannot upload more
public bytes after rollout; they fail closed until a separately approved migration
of those drafts. Already-uploaded complete legacy manifests remain recoverable.
New reservations are private. Shop routing and publication authority stay unchanged;
this is not a claim that historic Shop draft media is private.

Private API responses use no-store; previously downloaded bytes cannot be revoked.
Owner-created third-party copies or deliberately shared files are outside this
access-control guarantee. The app never creates signed links for private sources.

## Local validation and limits

Native PostgreSQL 17 on an isolated 127.0.0.1 cluster runs the real prerequisite
Listing/taxonomy/publication/channel and snapshot-media migrations, then the exact
new migration. Supabase-owned auth/storage schemas and minimal Order tables are
local fixtures, not a live Storage server or a full end-to-end transaction stack.
Tests cover legacy row/path/manifest/hash preservation, source ACLs/immutability,
owner/other/anonymous RLS, restrictive guards against broad policies, manifest
finalization/retry, two independent concurrent finalize connections, Sold,
Favorites, orphan deletion, unchanged Shop gate and frozen snapshot source.

The actual Next API/service runs with an offline DB/Storage boundary for access
matrix, path injection, no-byte denials, GET/HEAD, download-time deletion/Sold races,
legacy/new URLs and no signing/redirect. Existing byte recovery tests include
concurrency, lost responses, failed uploads, Discard-late upload and failed cleanup.
Public Seller and mixed private/legacy snapshot transport regressions are included.

Actual Supabase Storage public/download/render endpoint behavior and post-deployment
service-worker behavior require later authorized Staging acceptance. Local SQL RLS
and API tests cannot certify the hosted Storage/CDN implementation.

## Historical unpublished image inventory ? READ ONLY, NOT EXECUTED

1. Explicitly verify Staging ref and enter a read-only transaction. Never use the
   Production-linked CLI default. No UPDATE, DELETE, bucket change or file move.
2. Inventory `listing-images` objects joined by EXACT path to `listing_images` and
   `listings`; partition published/available, sold, draft, detached/orphan and unknown.
   Report IDs/path/ready/size/reference counts only; do not expose private account data.
3. For each legacy draft candidate, exclude any exact image ID/path referenced by:
   `order_media_assets.source_media_id/source_path/source_bucket`, ALL media batch
   states/manifests, bound `order_snapshot_media`, `order_requests.listing_media_snapshot`,
   and Orders' frozen `terms_snapshot` / `listing_snapshot`. For old asset schemas
   lacking source_bucket, treat their source as `listing-images`.
4. Check conversation/notification payloads and any persisted media-bearing JSON
   against exact paths/URLs, not just live Listing FKs. Conversations currently keep
   live Listing links/text snapshots; do not infer absence of historical references
   from the absence of a direct FK. Unknown JSON shapes => retain for manual review.
5. Objects with no current manifest are NOT automatically safe to delete: keep
   separate orphan candidates, check every historical reference and in-flight work,
   and use an age/grace window. No blanket directory removal.
6. Produce a scoped report: current public drafts, reference-free candidates,
   protected/history-referenced objects, unresolved records, exact counts/bytes.
   Copy/switch/delete operations require separate approval. Do not probe unrelated
   users' image bytes or migrate any existing Staging object in this local task.

Initial inventory query shape (review against the actual schema before execution):

```sql
begin transaction read only;
select l.id as listing_id, i.id as image_id, i.path, i.ready,
       l.published_at, l.status, l.listing_channel,
       o.id as object_id, o.metadata->>'size' as size_bytes
from public.listing_images i
join public.listings l on l.id=i.listing_id
left join storage.objects o on o.bucket_id='listing-images' and o.name=i.path
where i.storage_bucket='listing-images' and l.published_at is null
order by l.id,i.slot;
rollback;
```

This query only IDENTIFIES drafts; it is not deletion authorization or proof of no
historical references. Before deployment omit the not-yet-existing bucket column
and treat all current image sources as legacy.

## Exact later Staging deployment sequence ? NOT AUTHORIZED/NOT EXECUTED

1. Obtain separate deployment/test-write approval for `pcaqxezdfxofysghssyo`.
2. Explicit project-ref read-only preflight: actual bucket definitions, image column
   ACLs, current function bodies/search_paths/owners/grants, Storage policies,
   snapshot table shape and migration ledger. Compare prerequisites and stop on drift.
   Read-only inventory legacy drafts and flag incomplete old reservations before rollout.
3. Ensure local server-only Storage credentials/environment already target that same
   Staging project; do not edit environment files or reveal values. Coordinate rollout
   so no old application instance continues handling creates during the schema/API switch.
4. Apply ONLY `202610190001_listing_image_isolation.sql` through an explicitly
   Staging-targeted SQL/migration mechanism and register ONLY that migration version.
   Never use linked db push or batch pending migrations. Do not change old files.
5. Verify bucket private flag, column ACLs, trigger/function identity, policy predicates,
   preserved legacy object/path/hash evidence and RPC grants. No legacy media moves.
6. Run the new local application against Staging using uniquely tagged temporary
   accounts/images only. App deployment beyond localhost requires separate approval.
7. Verify direct `/object/public`, `/object/authenticated` download and
   `/render/image/public` / authenticated transform endpoints: no anonymous or
   cross-user private bytes; app API Draft/Published/Sold/Deleted matrix; all old
   public URLs remain identical. Confirm unauthorized responses by absence of bytes,
   not an assumed provider-specific status code.
8. Verify actual upload/partial failure/lost response/concurrency/finalize/Discard,
   Seller/Favorites/Messages, snapshot preparation from both buckets and preserved
   participant access to historical orders. Any new test Orders need explicit approval.
9. Check no public copies were created. Clean ONLY this run's fixtures using exact
   ownership/reference checks and Storage API; report unresolved resources honestly.
10. Report Staging acceptance separately. Do not mark overall B05 complete while
    hosted endpoint verification or legacy-draft privacy remains unresolved.

No Staging/Production connection, migration deployment, historical image migration,
Git staging/commit/push, UI modification or B06 work occurred in this local pass.


## Staging acceptance ? 2026-10-19 (supersedes earlier local-only status)

Explicitly authorized target: `pcaqxezdfxofysghssyo`. No default CLI target,
Production access, hosted application deployment, Auth/Stripe configuration or
historical data modification. Only migration `202610190001_listing_image_isolation`
applied and registered at 2026-10-19T05:17:39.748Z, SHA256
`4ce1477c77666fbadf993fe3d9db9376c73473226b58c5540b68e2ca86aca53e`.

Preflight: six prerequisite function bodies match; owner/search_path/ACLs, RLS,
Storage policies, generated path and expected columns checked. No drift detected.
Known unpublished Listings, draft manifests, public draft objects and waiting
uploads all zero. New private bucket verified public=false after deployment.

Preservation: before/after and after-cleanup hashes match for all 10 prior image
records, 24 prior listing/snapshot objects, 7 snapshot assets, 5 batch manifests /
material hashes and 5 Orders' frozen terms/listing snapshots. No old media moved.
All existing snapshot sources remain legacy; participant RPC executable only to
its intended authenticated role, preparation remains service-only.

Successful live run: `10606d37-fa0a-4313-9897-4b1cd7f041a3`:
- 3 confirmed temporary users, no signup/recovery/email calls; test-user email
  preferences disabled before publishing. No payments, Offers or Orders created.
- Real JPEG/PNG/WebP uploads and public Listing/Seller API projections.
- Draft image API owner=200 correct bytes; anon/other=404 uniform JSON, no bytes.
  All success/error image API responses private,no-store,max-age=0; no redirects.
- Published image API anonymous=200; direct private Storage stays inaccessible.
  20 unauthorized probes cover draft AND published, anon AND other-user, public,
  ordinary/authenticated/download and public/authenticated render paths. Each
  returned HTTP 400 JSON and no image bytes. This proves current endpoint denial;
  it does not assert the provider's image-transformation service is enabled.
- Source column INSERT/UPDATE forgery denied. No this-run objects in Public Bucket.
- Partial upload, concurrent Continue, repeated finalize and lost successful-upload
  response retain original Listing ID and reconcile exact bytes without duplicates.
- Same-ID edit, Favorites dedup/re-login, cross-user permissions, owner-only Sold,
  Sold image owner access / other-user denial and Shop channel guard pass.
- Real local five-step Create UI against Staging: injected upload and Discard
  cleanup failures remain unpublished and logged; reopen empty with no auto-restore.
  Separate five-width normal/reduced-motion offline wizard suite passes.
- 5 Listings and 11 tracked image reservation paths. All this run's users, profiles,
  sessions, refresh tokens, Listings, manifests, Favorites, preferences, activity
  rows and Storage objects verified zero after exact-run cleanup.

Initial live run `bcb10fbb-44a8-4196-8b2a-fff49b7e1f95` stopped on a test-harness
TypeError (new audit entries without path reached an old path.includes assertion).
No product fix was needed. Its 3 users / 3 Listings and associated resources were
also cleaned and verified zero before retry. An automatic cleanup transport failure
was recovered by the exact-run standalone cleanup. Immutable Auth audit history kept.
The first deployment wrapper attempt had a JavaScript $$ replacement escaping error;
read-only checks confirmed no migration/bucket/columns applied before correction.
The approved migration file was never changed for these harness corrections.

Legacy inventory: 17 old public objects, 10 linked to current manifests. Known
public draft objects=0, draft historical references=0. Of 7 detached objects,
1 has historical media references and 6 remain unclassified. They were retained.
No inference that detached means unused, draft, safe to delete or confidential.
Known URLs to legacy public objects retain their existing exposure. No current
old incomplete draft is blocked, because the preflight inventory contained none;
future recovery of a legacy unready reservation would fail closed as documented.

Remaining verification boundaries:
- A supplemental service-role download of HISTORICAL bound snapshot bytes to local
  memory was rejected by automatic approval review; it was NOT executed. Existing
  SQL hashes and RPC ACLs verified; image-byte round-trip for old snapshots deferred
  unless separately authorized. No fallback or indirect download attempted.
- New Offer/Order creation and snapshot prepare/bind through a new real transaction
  were not exercised: this authorization was limited to test accounts/Listings/images.
  Native PostgreSQL tests cover source freezing/hash compatibility and local transport
  regressions cover mixed public/private snapshot sources.
- Local API cache headers and PWA NetworkOnly source checked; no externally hosted
  application/CDN/service-worker deployment or shared-cache runtime validation.

Conclusion: NEW RESALE IMAGE ISOLATION passed the performed Staging acceptance.
Do not mark all B05 business/media/history verification unconditionally complete.
No B06 work. Supporting sanitized receipts are in ignored
`tests/artifacts/b05-image-isolation/` and the two exact-run journal directories.


### User-confirmed scoped closure (2026-10-19)

Authorized B05 scope ACCEPTED: Resale publication recovery, new-image privacy,
real Staging Storage/RLS/API/UI regressions and historical snapshot metadata/ACLs
passed. Historical snapshot byte download/hash is explicitly EXCLUDED by user
decision; no re-request in this workflow. New real-transaction snapshot prepare/bind
is deferred to B07 transaction acceptance, not passed here. Six unclassified legacy
public objects remain a separate risk; do not delete/migrate. Retain original
untested transaction/held-inventory cases as gaps rather than an unconditional
all-criteria completion claim. B06 proceeds with local-only authorization.
