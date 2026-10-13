# V2-C pre-apply media retention review

## V2-C2 implementation update (2026-10-12)

C2 was applied only to staging as `202610120004_offer_accept.sql`.
Recipient-only Accept, explicit V2 Order protocol, immutable snapshots/private
media binding, one Listing winner/Pending, competing V2 Closed and safe unpaid
cancellation are implemented. Hosted qualification, 13 true-concurrency runs, three-session Realtime and
390/430/1280/1536 browser qualification passed. Canonical/manual fingerprints
are unchanged and synthetic fixtures are cleaned. See
[the C2 technical record](OFFER_ACCEPT_V2_STAGING.md).
Earlier B/C1 scope statements below describe those phases, not current C2 scope.
Production and manual history are untouched; no commit/push. D/E/F/Notifications
remain out of scope. Before V2-G, stop for a stable Git checkpoint.


## V2-C1 private snapshot media foundation (2026-10-12)

**MEDIA RETENTION FOUNDATION COMPLETE / STAGING QUALIFIED.** Only additive
migration `202610120003_order_snapshot_media.sql` was applied to staging
`pcaqxezdfxofysghssyo`. Private immutable copies, authoritative preparation,
byte verification, complete-batch binding, leased orphan cleanup and participant
signed reads passed hosted tests, including four independent overlapping
transaction cases with both winner orders and zero deadlocks/lock timeouts.
[Technical implementation and qualification](ORDER_SNAPSHOT_MEDIA_V2_STAGING.md).
Canonical/manual fingerprints are unchanged; synthetic fixtures are removed.
Public Listing and private chat media behavior remain intact. Production was not
accessed; no commit/push. Full V2 Accept, Listing winner/Pending, timers and
Notifications are **not implemented by C1**. V2-C may resume only as a subsequent
task; do not resume automatically. Keep the stable checkpoint requirement before
V2-G.

## Historical pre-implementation review

The following review records the original privacy stop. Its reference-only
proposal is superseded by the implemented private-copy foundation above.


2026-10-12. **Design review only; V2-C is not implemented or qualified.**
No migration was authored/applied, hosted query issued, fixture created, or
transaction consumed during this review. The running localhost:3000 application
returned HTTP 200 with staging project `pcaqxezdfxofysghssyo` in its configuration
and no production project reference. `.env.staging.local` resolved to the same
project with `APP_ENV=staging`. Production `.env.local` was not read or changed.

Authority: [V2 contract](MARKETPLACE_V2_PRODUCT_CONTRACT.md),
[implementation record](OFFER_DOMAIN_V2_STAGING.md), and the V2-C task's durable
media requirement. This record does not supersede the approved product contract.

## Hosted staging privacy audit ? media unblock STOP (2026-10-12)

**MEDIA RETENTION NOT IMPLEMENTED / NOT QUALIFIED. Full V2-C remains stopped.**
The narrow unblock's section 20 requires stopping and reporting an atomicity
strategy before implementing a necessary binary-copy model. Its private-object
and outsider-denial criteria cannot be satisfied by reference-only retention of
an object in the current public Listing bucket.

Read-only queries targeted staging `pcaqxezdfxofysghssyo` explicitly; the helper
verified `.env.staging.local` and the running localhost:3000 main application
first. Hosted `storage.buckets` returned `listing-images.public = true` and
`chat-images.public = false`. Seven actual Storage policies were inspected.
The sole UPDATE policy is the restrictive `chat_images_no_client_update`; no
permissive authenticated object UPDATE policy exists. The current authenticated
Listing DELETE policy checks live image references, not immutable Order refs.
No hosted configuration, data, bucket, policy, migration or object was changed.

The previous reference-retention proposal above is insufficient for this new
private-read requirement. It remains a candidate for *public asset durability*,
not participant-only historical binary access. RLS on an Order reference table,
a SELECT policy, or issuing a signed URL does not revoke an existing public
object URL. Existing application code explicitly uses `getPublicUrl` for Listing
and conversation images. No public bucket was converted to private: doing so
would break existing V1/Marketplace URLs and exceed this narrow task.

### Current immutable-key and cleanup findings

The schema generates each path from `owner UUID / listing UUID / image UUID`.
Normal image insertion grants do not permit supplying an image ID; a replacement
gets a new database-generated UUID. The
[image API](../pages/api/listing-images/[id].ts) uploads with `upsert: false`;
published image mutations are rejected both at API and database boundaries.
The actual Storage policies provide no permissive overwrite policy. This is a
code/policy finding, not a claimed real A/B upload test. Privileged credentials
can bypass RLS and therefore remain trusted administrative authority.

Normal image removal deletes metadata successfully before invoking Storage
removal. Draft abandonment and Listing deletion use the same database-first
pattern. The demo cleanup script uses service-role Storage removal after scoped
database cleanup. These paths currently have no independent Order-media reference
check. No Listing-media deletion queue/receipt worker was found in the inspected
application paths; the chat-image queue/receipts concern a different private
bucket and must not be repurposed silently. Future retained-asset cleanup needs
execution-time checks, including privileged cleanup.

### Proposed private preparation model ? not implemented

The concrete constraint requiring consideration of copy is the existing public
bucket, not mutable normal upload paths. Preserve public V1 Listing media and
consider a separate private, server-owned evidence asset with a new UUID key.
Do not perform an external copy during the database Accept transaction.

1. Before Accept, prepare a candidate asset journal for a precise source image
   identity, object key, trusted byte digest, size, media type and Listing material
   fingerprint. Claim preparation with an idempotent server command. Neither an
   Offer nor an Order changes state during this preparation.
2. Upload/copy to a private immutable UUID key using trusted server credentials
   and no upsert. Verify availability and bytes before recording a ready receipt.
   A failed copy leaves no ready asset and no Order. A lost response reconciles
   the same journal/key; it must not overwrite the candidate.
3. Future Accept locks Listing, validates the Offer's material baseline, and locks
   the exact ready evidence assets in deterministic order. It verifies source
   identity/digest and readiness, then inserts participant-authorized immutable
   Order references in the same transaction as Order/Offer/winner changes. If
   preparation is absent, incomplete or stale, Accept rejects without creating
   an Order. There is no post-commit copy dependency.
4. Asset cleanup claims an exclusive deletion lease under the same asset lock,
   rechecks all live/candidate/Order references, and only then performs Storage
   deletion. Reference creation rejects deleting/tombstoned assets. If cleanup
   wins, Accept cannot bind that asset; if Accept wins, cleanup cannot claim it.
   The lease must span the external Storage operation: a one-time pre-delete
   query followed by an unlocked HTTP delete is insufficient.
5. An Accept rollback leaves only an unreferenced prepared candidate, recoverable
   through a bounded cleanup/reconciliation journal. Terminal Order states never
   detach evidence references. Retry/reconciliation handles failed or ambiguous
   Storage deletion before allowing any key to be considered reusable; UUID keys
   are never reused regardless of cleanup outcome.
6. Participant-authorized server reads issue short-lived signed URLs only after
   verifying Order ownership. The private bucket denies normal direct mutation
   and outsider reads. Do not expose server credentials or persist signed URLs.

This is a design requiring review and independent-transaction/Storage tests, not
an established consistency proof or permission to implement the full V2-C flow.
A private copy protects the private snapshot object's access; it cannot retract
copies or knowledge of an image previously published as Listing content. That
existing public exposure must be stated accurately rather than called private.

### Evidence and scope at STOP

Before/after hashes matched for all existing Requests (4), Orders (3), transaction
Events (14), Listings (6) and Listing-media rows (7). Existing Nike/manual history
was not mutated. No synthetic user, Listing, Order, media object, reference,
receipt or cleanup entry was created. No upload/delete/concurrency/RLS participant
acceptance test was run because implementation stopped at the privacy boundary;
those criteria remain unproven, not passed.

No migration filename/checksum/application result exists for this task. No V2
Accept, Order creation, Listing Pending, competing Closed, cancellation or timers
were implemented. Production was not accessed; `.env.local` was not read or
changed. No commit/push. The narrow foundation and full V2-C remain incomplete.

## Existing protections and their limits

The [publication migration](../supabase/migrations/202610050001_marketplace_publication_favorites.sql)
locks the Listing before changing image metadata and rejects mutations of
published image rows. Its Storage DELETE policy permits authenticated owner
deletion only when no `listing_images` row references the path. There is no
authenticated Storage UPDATE/upsert policy. These are meaningful protections:
ordinary Seller actions cannot currently remove or overwrite published photos.

The [Order migration](../supabase/migrations/202610100002_order_accept.sql)
restricts deletion of a Listing referenced by an Order. The
[Listing repository](../lib/server/supabase-listings-repository.ts) deletes
database state before calling Storage removal; database failure prevents that
cleanup. The [demo workflow](../scripts/staging-demo.cjs) likewise waits for its
scoped database deletion before removing objects. Do not weaken these guards.

However, no independent accepted-Order asset-retention record or Storage policy
was found. A JSON snapshot containing an original object path does not itself
retain that object. If an authorized future image-replacement path removes the
live image row, the current orphan-deletion policy no longer sees a reference.
The required image-set-A to image-set-B durability test therefore cannot be
satisfied merely by comparing snapshot paths, nor by treating today's published
image immutability as a permanent Order media implementation.

This is a missing V2 retention guarantee, not evidence that an ordinary Seller
can currently delete published images. No such deletion was attempted.

## Minimum proposed reference-retention strategy

Add an immutable, server-owned Order-media reference set in the new additive
V2-C migration. Capture bucket, object path, image identity, slot and available
validated object metadata at the same acceptance transaction as Listing evidence.
Use stable identifiers, not expiring signed URLs. Link references to the exact
V2 Order and enforce slot/path uniqueness. Clients get no INSERT/UPDATE/DELETE
grant; participant reads must follow the owning Order's authorization.

Add a restrictive authenticated Storage DELETE policy denying removal of any
retained path, independent of `listing_images`. Retain the existing publication
and orphan-deletion protections. Keep authenticated overwrite denied; explicitly
audit all permissive UPDATE policies before relying on that property. Normal
application cleanup must respect retained references. Privileged synthetic-test
cleanup may remove only its explicitly scoped Order references after removing
the synthetic transaction graph.

Do not add triggers to `storage.objects`, mutate its metadata directly, or rely
on a cross-schema Storage foreign key. Do not broaden listing-photo editing as
part of C. Preserve the current restriction on edits while inventory is held.

The reference strategy is valid only after its race proof: before acceptance,
published live image rows prevent ordinary object deletion; acceptance acquires
the Listing lock and verifies those rows and objects before inserting retained
references. After acceptance, the independent references block removal even if
live image metadata is subsequently replaced. A future metadata-removal path
must acquire that same Listing lock and must never open a gap between dropping
live references and establishing retained references. Administrative bypasses
are outside ordinary Seller authority and must remain explicitly scoped.

If the hosted-policy audit or overlap test invalidates this proof, stop before
apply and use a server-owned immutable-copy model instead. Do not report media
durability based solely on static policy inspection.

## Required qualification before accepting an Offer

1. Inspect actual staging Storage policies and Listing/image triggers with the
   exact project guard; capture canonical/manual history fingerprints first.
2. Qualify retention with real decodable image A: accept, release the synthetic
   Order through authorized cancellation, change only synthetic live metadata to
   image B under explicitly scoped test administration, and confirm historical A
   still decodes and ordinary Seller deletion/overwrite is rejected. The current
   formal UI does not support published-photo replacement; do not claim it does.
3. Test Listing-edit versus Accept overlap using independent transactions and
   the shared Listing lock. Test media cleanup versus retention, including any
   proposed future metadata-removal path. Report domain rejection separately from
   deadlock/timeout/invariant failure.
4. Confirm scoped cleanup restores exact canonical/manual fingerprints and
   leaves no synthetic Order/media/reference/Storage object behind.

## Other pre-apply integration findings

The existing [Orders service](../lib/server/orders-service.ts) maps every Order's
terms through the V1 Request mapper. It needs an explicit V2 protocol branch;
On Campus must not be disguised as legacy Pickup/Meet/Shipping.

Existing schema constraints require a finalized V1 Order to start a 30-minute
reservation. V2-C must add protocol-specific constraints preserving every V1
row and deadline, while V2-C holds have no D/E timer. Existing unique Listing-hold
index remains the cross-protocol winner backstop.

The existing V2-B Offer-time `updated_at` reference is not a material baseline:
price-only changes have different eligibility rules. New Offers need a locked,
server-derived material fingerprint; pre-C Offers lacking it must require a new
Offer rather than receiving an invented historical baseline.

Recipient-only Accept, capability locking, deterministic competing-conversation
locks, idempotent receipts, authoritative eligibility DTOs, independent competing
Offer closure, V2 cancellation and V2 detail/navigation remain unimplemented.
No completion or V2-D readiness claim is made here. Before future V2-G,
create the required stable Git checkpoint.
