# B14 — Local Shop product publication qualification

2026-10-19. **B14 LOCAL IMPLEMENTATION COMPLETE.**
**B14 STAGING NOT DEPLOYED. B14 STAGING RUNTIME ACCEPTANCE NOT PERFORMED.**
**B15 NOT STARTED.**

## Shared architecture and approved UI scope

Shop uses the existing Listing table/IDs, shared five-step ListingForm and sheet,
metadata/taxonomy, manifest/upload recovery, finalize, edit, abandon, delete and
Sold authority. No products table, shop_id column, new bucket, subscription system,
Shop-specific Order lifecycle or CSS was added.

Only the create operation differs: POST `/api/listings/shop` -> existing Listing
repository -> `marketplace_create_shop_listing`. The strict envelope carries input
and a creation action UUID, with no seller/Shop/channel/tier authority. The RPC derives
verified seller -> unique Shop owner, whitelists metadata and enforces SQL constraints.
An action UUID identifies the new Listing and survives uncertain create responses
only while the form stays open. Same UUID/input returns the same owner Shop row;
different input/owner/channel conflicts. There is no persistent form autosave.

The same publication operations adapter uploads fixed slots, compares existing
bytes, then finalizes. A failed/uncertain creation reconciles the known ID; subsequent
attempts reuse its idempotent creation command. Already-published retries return the
same row without uploading again or rechecking new-slot eligibility. Success and
Discard clear local creation state. Discard retains the existing safe cleanup and
unconfirmed-cleanup logging; it does not claim remote deletion or restore the form.

Approved UI changes only: Add Product opens the shared wizard; real empty owner
inventory stays empty instead of injecting Demo cards; explicit demo fixtures remain
optional/test-only; a Shop-only Mark as sold menu item uses the existing confirmation
and sold operation. Owner-scoped component identity resets private inventory/dialogs
on account changes. Shared Resale presentation and menu remain unchanged. Loading,
quota denial and failed publication use existing feedback. Preview-only fixtures
still cannot publish. No CSS, layout, dimensions, colors, typography or animation edit.

## Migration and database authority

Only new local migration:
`supabase/migrations/202610190004_shop_product_publication.sql`.
Applied historical files, B11/B12 implementation, schemas/data and permissions on
unrelated objects were not edited. No backfill or history rewrite.

- New Shop create RPC, owner/identity/count-increase trigger and partial owner quota
  index. No client owner/channel/bucket assignment and no implicit Shop/Trial creation.
- Existing finalize RPC retains owner/image/idempotency checks. New Shop publication
  evaluates B12 inside the database transaction; an existing publication retry does
  not consume a new slot or rewrite its publication timestamp.
- Predicate: `listing_channel='shop' AND published_at IS NOT NULL AND status IN
  ('available','pending','reserved')`. Draft/unpublished NULL and Sold/Resale do not
  count. Actual V2 pending has a live held Order/reserved_order_id; it is not a draft.
  Current V1 explicitly prohibits Shop, so no fake V1 Shop-reserved Order was invented:
  reserved inclusion is checked against the exact SQL predicate, while real pending
  and available Shop rows are exercised with actual historical Order fixtures.
- Row order: existing Listing UPDATE lock -> Shop KEY SHARE -> existing B12 owner
  membership FOR UPDATE. After waiting, clock_timestamp and fresh statements evaluate
  entitlement/count. There is no API-only count, new counter or membership mutation.
- Plus40; Pro/Trial100; Grace uses B12's previous-tier rights. No operating membership
  denies publication. Over-capacity downgrade preserves products/IDs; safe edits,
  Sold, delete and existing Order release/completion do not consume new capacity.
- Historical regression exposed a pre-existing shared pending inventory branch that
  returned before checking metadata edits. The **Shop-only** new guard rejects held
  metadata mutation while allowing normal Order status/pointer changes. The shared
  Resale inventory function was not rewritten.

All new functions have explicit EXECUTE restrictions/empty search_path. Existing
public Listing SELECT remains published/available/Resale only. No client grants on
channel, seller, publication marker, membership tables or Shop identity were opened.

## Media, history and phase isolation

New Shop manifests derive the existing `listing-images-private` bucket, with existing
owner-only read, no-upsert, validated upload/readiness and reference-aware deletion.
Storage INSERT policies now permit private Shop manifests and deny legacy public
bucket uploads. The image-ID API was not broadened: owner reads Draft/Published/Sold
Shop images; anonymous/other users get no new public Shop access. No signed redirect,
copy-to-public publication step or bucket controlled by the browser.

Old manifests, public paths/files and snapshot source_bucket/hash remain unchanged.
Existing public Shop images can still be public by known URL. Incomplete legacy
public-bucket Shop drafts with missing bytes cannot upload those bytes under the
new policy; they remain tracked, with no automatic migration or Resale fallback.
Their deployed count was not queried. The six unclassified B05 public objects and
excluded historical snapshot byte downloads were not revisited.

New INSERT guards reject Shop Conversations, Offer revisions/requests and Orders,
including SECURITY DEFINER known-ID paths. Existing conversation reuse, messages,
historical Accept replay and legitimate existing Order progression are not gated.
Public Shop Directory/Detail sources, search/recommendations, analytics, billing,
ratings and new buyer transaction activation were not changed.

## Actual local verification

| Check | Result |
|---|---|
| `tests/shop-products-b14.cjs` | PASS actual API/repository, real same-origin guard, strict envelope/metadata/UUID, owner auth, same-ID retries, canonical fields and safe quota/membership errors |
| `tests/shop-products-b14-db.cjs` | PASS actual migration/current schema in isolated native PostgreSQL; no Shop/owner forgery/anonymous/direct-write boundaries, Plus39->40/40->41, Pro/Trial99->100/100->101, Grace, Suspended/no membership, downgrade retention, authenticated private Storage/readiness/CRUD, held-inventory safety, existing Order completion/frozen snapshot and real new Contact/Offer/Accept denial |
| Native B14 races | PASS second connection observed waiting on a PostgreSQL lock: last slot gives one winner, duplicate finalize one publication, downgrade versus finalize rechecks cap, real Grace expiry while waiting rejects publication after the lock. No scheduler/time rewrite |
| `tests/shop-products-b14.browser.cjs` | PASS 10/10: 390/430/820/1280/1536 × normal/reduced motion, real shared management/wizard, empty inventory, five steps, lost create/upload/failed finalize/quota retry using one ID, edit, Shop-only Sold, Discard/reopen empty and no overflow |
| `tests/manage-products.browser.cjs` | PASS five widths; existing search/filter/sort/edit/geometry/Resale isolation, shared Add wizard, explicit fixture-only demo boundary |
| `tests/listing-wizard.browser.cjs` | PASS five widths × both motion modes for existing Resale, Delivery UU Pay, same-ID retry, cleanup-failure Discard, existing edit and five isolated Shop preview widths |
| `tests/shop-provisioning-b11-db.cjs` | PASS existing native ownership/provisioning/uniqueness/permission/race regression; its negative publication case now has complete media and still rejects absent membership |
| `tests/shop-membership-b12-db.cjs` | PASS existing native membership/calendar/idempotency/ACL/races; obsolete blanket Shop denial assertion now preserves the image-readiness negative case |
| `tests/shop-settings-b13-db.cjs`, `tests/shop-settings-b13.browser.cjs` | PASS native owner update/CAS/RLS and all 10 real-component browser cases |
| `tests/transactions-b09-db.cjs` | PASS existing native transaction/external/UU-local-simulator/handoff/Protection and six lock races, no scheduler |
| Focused offline regressions | PASS `shop-profile.cjs`, `shop-membership-b12.cjs`, `shop-settings-b13.cjs`, `listing-channel.cjs`, `resale-recovery-b05.cjs`, `listing-image-recovery-b05.cjs`, `listing-media-isolation-api.cjs`, `order-shop-provenance.cjs`, `message-shop-provenance.cjs`, `public-shop.cjs`, `public-seller.cjs`, `transactions-b09-static.cjs` |
| Static | PASS application TypeScript `tsc --noEmit --incremental false`, focused ESLint, Prettier and diff/new-file checks |

Browser tests use real components with controlled local transport, not hosted
Staging E2E. Screenshots remain ignored local artifacts in
`tests/artifacts/message-payload-qualification/`. Existing legacy combined
`shop-surfaces.browser.cjs` Webpack/Radix static-block limitation is separately
recorded in B13; no unrelated loader/dependency workaround is part of B14.

Development failures were corrected, not skipped: misplaced new import/method and
TS/lint errors; a missing local browser process shim and unscoped nested Discard
locator; new native fixtures' anon Storage table ACL, trigger ordering, history
loader delimiter and historical-versus-new-media assertion. No test disabled an
immutable trigger. Native servers require tool-approved launch outside the Windows
sandbox and listen only on random loopback ports; they stop in finally.

## Exact files changed by B14

Migration: `supabase/migrations/202610190004_shop_product_publication.sql` (new).

Application:

- `lib/server/supabase-listings-repository.ts`
- `lib/listings-api.ts`
- `lib/listing-publication.ts`
- `pages/api/listings/[[...segments]].ts`
- `components/listings/listing-form.tsx`
- `components/listings/home-listings.tsx`
- `components/listings/resale-management-card.tsx`

New tests:

- `tests/shop-products-b14.cjs`
- `tests/shop-products-b14-db.cjs`
- `tests/shop-products-b14-db.sql`
- `tests/shop-products-b14-history.sql`
- `tests/shop-products-b14.browser.cjs`

Updated tests:

- `tests/manage-products.browser.cjs`
- `tests/listing-wizard.browser.cjs`
- `tests/listing-media-isolation-api.cjs`
- `tests/shop-provisioning-b11-db.sql`
- `tests/shop-membership-b12-db.sql`

Documentation: this qualification, B14 plan milestone and task breakdown.
Pre-existing unrelated worktree changes are preserved and not attributed to B14.

## Safety, deferred integration and stop

No Production or Staging access, Supabase CLI/relink, remote migration/data write,
real membership/payment/provider operation, email/push, existing business-data
deletion, environment/secret modification or Git mutation. SQL fixtures and internal
historical membership/Order operations ran only in new disposable loopback databases;
no external worker ran. Local ignored test artifacts were retained.

Deferred: separately approved Staging read-only preflight (current schema/ACL,
legacy public Shop drafts/orphans/history dependencies), exact-migration deployment
approval, isolated managed runtime acceptance and its retention/cleanup agreement.
No implicit legacy media migration/deletion. Public discovery and opening new Shop
transactions require later authorization. No billing/Trial UI/Analytics integration.

**Stop after local B14. Do not deploy or begin B15.**
