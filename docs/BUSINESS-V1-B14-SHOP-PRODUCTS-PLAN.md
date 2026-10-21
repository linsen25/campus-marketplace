# B14 — Shop product management and publication plan

2026-10-19. **Historical approved plan — local implementation subsequently authorized.**
Results: [B14 local qualification](BUSINESS-V1-B14-QUALIFICATION.md).
The proposals below preserve the planning baseline; they do not authorize deployment.
Official B14 matches this authorization: positive Shop draft/publication authority,
immutable channel, existing ListingForm/media, B12 eligibility and atomic quotas;
ordinary Resale unchanged. No B15 discovery or B17 promotion/metrics activation.
B11/B12 migrations are deployed/read-only verified; B11/B12/B13 managed Staging
runtime write acceptance remains deferred. Earlier design/qualification documents
contain historical local-only deployment labels; those are not the current milestone.

## A. Current capabilities and source evidence

| Existing implementation | Reuse / actual boundary |
|---|---|
| `202610160006_shop_profile_foundation.sql`, `202610190002_shop_profile_provisioning.sql` | `shops.id`, unique owner FK to Profile, owner GET/PATCH, explicit provisioning; no owner delete/transfer API or DELETE/owner-update grant. Existence is not membership |
| `202610160007_listing_channel_authority.sql` | Immutable `listing_channel`; client INSERT/UPDATE of channel denied; public policy is published/available/**resale** only; finalize explicitly denies Shop before its idempotent return |
| `supabase-listings-repository.ts`, `pages/api/listings/[[...segments]].ts` | Owner channel-filtered management, shared metadata validation, update/sold/delete/abandon and finalize. Default create omits channel and produces Resale |
| `listing-form.tsx`, `listing-creation-sheet.tsx`, `home-listings.tsx` | Existing five-step shared wizard, edit preload/update, modal/guard, same-ID Continue publication and Discard; Shop mode/context already exists but new creation is blocked |
| `listing-publication.ts`, `listing-image-recovery.ts` | Manifest slots, byte comparison before upload, no overwrite, response-loss recovery, original Listing ID, image validation and retry; no across-close form persistence |
| `202610190003_shop_membership_authority.sql` | Private `shop_entitlements(owner,time)` returns authoritative rights/cap; membership commands lock owned Shop KEY SHARE then membership FOR UPDATE. No publication integration yet |
| `202610050001_marketplace_publication_favorites.sql`, `202610160005_dual_payment_paths.sql` | Irreversible publication/image manifest; Sold edit restrictions, inventory/reservation guards and existing Order completion/release authority |
| `202610190001_listing_image_isolation.sql`, `lib/listing-media.ts`, `lib/server/listing-media.ts` | Two existing buckets, trusted manifest bucket, controlled private-image API, source-aware cleanup and Order media snapshots. Currently only new **Resale** images are private |

### Exact ownership model — no assumed shop_id

There is **no `listings.shop_id`**. Current association is
`listings.seller_id -> profiles.id <- shops.owner_id`, with UNIQUE shops.owner_id.
Listing ID and Shop ID are independent UUIDs. Provenance code already derives Shop
by seller ownership (`202610160008_order_shop_provenance.sql` and
`202610160009_message_shop_provenance.sql`), then freezes channel/name in history.

Not every privileged/fixture Shop row is currently guaranteed to have a Shop:
no FK or insert invariant enforces that existence. Ordinary users cannot create
Shop listings at all; Resale creation with no Shop remains valid. Ordinary users
cannot reassign seller_id (no column grant), Shop owner/id, or Listing channel.

**Recommendation: no new shop_id column/FK for B14.** The existing one-Shop-per-owner
identity plus server-derived ownership is sufficient for this authorized lifecycle:
there is no supported Shop deletion/recreation/transfer operation. Require an owned
Shop at Shop draft insert and finalize, lock its existing row, preserve both IDs,
and add an existence/identity guard for new Shop inserts. Do not claim this is a
physical FK or that arbitrary privileged orphan records are valid. A future Shop
delete/recreate/transfer feature must review this association before it is allowed;
it cannot silently attach old products to a different Shop. Future deployment
preflight must identify orphaned existing Shop listings and stop for review rather
than inventing a Shop, backfilling ownership or deleting them.

## B. Actual gaps

1. `ListingForm.shopBlocked` blocks new Shop forms, replaces them with
   `ShopListingWorkspace`, and disables Publish. Owner management reads are real,
   but empty successful reads inject six explicitly labelled demo cards.
2. `validateListingInput/rejectClientChannel` correctly rejects client channel
   fields. There is no positive Shop draft creation RPC/API. Reusing ordinary POST
   would create Resale; it must never be the fallback.
3. Finalize denies every Shop, regardless of B12 rights; no atomic quota authority
   exists. An API count followed by the current RPC would be unsafe.
4. New Shop manifest images currently select the public `listing-images` bucket.
   Merely opening the wizard would expose draft bytes by direct URL. The existing
   private-bucket insert guard currently permits Resale only.
5. `HomeListings` renders `ResaleManagementCard`, which exposes Edit/Delete only.
   The parent has sold handling/confirmation, but no control calls it. Another
   older `ManagedListingCard` has a sold button; it is not this rendered surface.
6. Publication would also make known IDs eligible for SECURITY DEFINER contact/
   Offer paths: `marketplace_find_or_create_conversation`, conversation identity
   trigger, `mutate_offer_revision` and Accept currently test publication/state,
   not B12 rights. Public RLS alone is not an adequate phase boundary.

## C. Minimal architecture and proposed database change

One new forward-only migration, version selected only after implementation approval;
do not edit applied files. No new product table, bucket, membership flags or upload
system. Proposed objects/changes:

- Add narrow authenticated `public.marketplace_create_shop_listing(p_input jsonb,
  p_client_action_id uuid)` with SECURITY DEFINER, empty search_path, explicit ACL.
  Derive seller/Shop from verified auth, whitelist the same validated metadata,
  force channel=shop, unpublished available state and immutable image count.
  Never accept seller, Shop ID, tier, count, status, publication or bucket fields.
  Apply SQL constraints and equivalent input validation; repository validation
  alone cannot protect direct RPC invocation.
- Use one create-intent UUID retained only in the open Shop wizard and reuse it
  across an uncertain draft-create response. It may identify the new Listing UUID
  (or be deterministically mapped to it), never authorize it. Existing ID conflicts
  must verify ownership/channel and canonical creation fields; identical retry
  returns the same draft, changed/cross-owner intent fails safely. No operations
  table or persistent form storage. This prevents the new Shop create RPC from
  introducing a duplicate-create gap before B05 receives its first Listing ID.
- Add private Shop insert/identity and active-count-increase guards. Keep existing
  channel/manifest/publication/inventory guards; never disable them. Derive owned
  Shop for new Shop inserts, disallow inserted published Shop rows, and reject
  identity reassignment. Resale branches retain current behavior.
- Replace only `marketplace_finalize_listing(uuid)`'s Shop denial with the approved
  transactional gate below. Preserve ownership, image completeness, same-ID
  idempotency and Resale behavior. Never check quota before returning an already
  published owned ID: a retry after expiry/downgrade confirms prior publication,
  grants nothing and must not republish/rewrite timestamps.
- Add a bounded partial index on seller_id for published Shop rows in
  available/pending/reserved, unless the implementation query plan proves an
  existing index sufficient. No counter table or automatic unpublish job.
- Extend `assign_listing_image_bucket()` so **new Shop manifests also use the
  existing private bucket**. Extend existing private insert policy to Shop; close
  the legacy public-upload allowance for new Shop bytes. Keep no-upsert, owner
  read/delete and still-referenced-object protections. Existing rows/source_bucket,
  public URLs, historical snapshot hashes and stored files are not rewritten.
- Keep listing public SELECT resale-only. Private-media API already permits owner
  reads and public Resale only; leave its public predicate unchanged. No new Shop
  public-read policy is needed for owner management/publication in B14.
- Add narrow fail-closed **new Shop transaction** guards at new Conversation,
  order_request/revision and Order INSERT boundaries (derive channel from real
  Listing). B14 does not open these paths even for an active Shop; later authorized
  public/transaction integration may open them with B12 checks. Do not gate updates
  to existing conversations/messages/Orders, existing Order media or replay of an
  already created Order. No rewrite of transaction state machines, snapshots,
  economics or settlement. Test direct RPC bypass attempts, not just UI/RLS.

Draft creation requires verified ownership, not a new paid-status rule. Existing
private management is retained during suspension; **publishing** consumes a valid
membership/quota slot. No implicit Shop/Trial/membership creation or renewal.

## D. Quota, locks and lifecycle

Canonical counted predicate:

`listing_channel='shop' AND published_at IS NOT NULL
 AND status IN ('available','pending','reserved')`.

Current database status enum is available/reserved/pending/sold (`202610120004`).
`pending` is the V2 held reservation, not a draft. Draft/unpublished is
published_at=NULL. There is no separate unlisted status or supported unpublish
command; publication cannot be reversed and Sold cannot be relisted. Do not add
statuses or unpublish/republish UI merely to satisfy a hypothetical branch.

Publication transaction/guard order: lock the target Listing, acquire owned Shop
KEY SHARE, then existing membership row FOR UPDATE; capture clock_timestamp after
the locks, evaluate the existing B12 function and count in a fresh statement.
No membership row => deny; never create one as a publication side effect.
All paths that increase the predicate use that same locking/gate. Two different
drafts can hold their own Listing locks, but serialize on one owner membership row;
the second count sees the first commit. No bulk locking of all product rows.
B12 also uses Shop KEY SHARE -> membership and never waits for Listing rows, so do
not add a reverse Listing dependency to B12 or inconsistent owner-first publication
locking that could deadlock with row triggers. Native lock-race tests must prove
the observed ordering/count, including membership changes while publishing.

B12 decides Trial/Pro=100, Plus=40, Grace retains previous effective cap. Suspended,
not-started, unavailable evaluator or missing Shop deny new publication atomically.
Count existing products even when membership is expired/over-capacity. Downgrade
does not mutate any Listing; at 80/40 they remain, additional publish fails until
count<40. Edit does not consume a slot and must not be blocked just for exceeding
quota; Sold/delete decrease the count under current safety rules.

available <-> reserved/pending remains counted: cancellation/expiry returning held
inventory to available must not be denied due to expiry or quota. Existing Order
completion to Sold remains its original authority. A future sold/unpublished to
active transition must pass the same increase guard, but B14 introduces no such
command. Add coverage for direct authenticated SQL attempts too.

Denied finalize leaves the same unpublished row/private media; Continue publication
reconciles that same ID, uploads only absent slots after byte checks, then retries.
No public copy/move, partial published state or Resale fallback. Discard clears the
open form and attempts existing unpublished cleanup; uncertain cleanup is logged,
not reported as deletion, and never restores the discarded form.

## E. Membership, historical media and public boundary

Use `shop_entitlements` **inside SQL publication**, not a browser membership DTO or
separate API count. Existing membership GET/repository can inform the wizard's
truthful feedback; they cannot grant rights. No B12 mutation or provider integration.

New Shop private photos work through the existing image-ID API for the owner.
Anon/other user denied before and after B14 publication, because B15 is not enabled.
Order snapshots already freeze actual source_bucket; no hash/schema rewrite needed.
Do not revisit excluded B05 historical snapshot byte downloads.

Legacy Shop public objects remain physically public, including any old drafts;
local source cannot establish their deployed count. Do not imply the migration
retroactively makes them private. Old public-bucket Shop drafts cannot upload new
bytes after the tightened policy; keep them tracked and fail clearly, not duplicate
them in Resale or silently migrate their manifest. A later separately authorized
inventory/remediation decision is required before claiming legacy recovery support.
Historical public objects and the six unclassified B05 objects remain untouched.

## F. Exact UI V1 exceptions for separate approval

- Eligible owner data wiring replaces the unconditional Add Product blocker with
  the **existing** five-step Shop-context wizard; reuse all geometry/animations,
  field validation, Review, buttons, error regions, Continue and Discard.
- Replace hardcoded `Your Shop isn't active yet.` / `Available with Shop Plus or
  Pro` where needed with truthful loading, no-Shop, membership unavailable,
  expired/over-quota errors. Keep owner/private editing and deletion separate from
  publish eligibility. No new upsell, activation CTA or pricing integration.
- Real empty Manage Products must show its existing `No active products yet.`
  state, not inject demo inventory. Keep examples only in isolated explicit tests/
  demo entry; no fixture fallback on live null/error.
- **Missing control decision:** if manual Mark sold must be reachable in this
  surface, approve one Shop-only `Mark as sold` item in its existing action menu,
  wired to the parent's existing confirmation/handler. No new card layout or Resale
  changes. Without that exception the backend action can be qualified, but the
  current management UI cannot expose it. Do not silently change shared controls.

No CSS, navigation, card design, Settings, Pricing Card, public Shop page or Resale
presentation changes. All exceptions remain proposals, not changes in this task.

## G. Focused local tests (planned, not run)

Reuse isolated native harness and local controlled browser transport; no new
environment, shared data, remote accounts or real payments:

- Native current migrations + proposed migration: owned/other/no Shop, direct RPC
  forgery, seller/channel/ID tampering, original identities and owner-only reads.
- No membership/Plus/Pro/Trial/Grace/Suspended and evaluator failure; exact expiry
  after waiting on a lock, membership command versus publication, current-time
  authorization, no unauthorized grants. No Trial/payment RPC through product API.
- Plus39->40/40->41; Pro/Trial99->100/100->101; two distinct drafts competing for
  last slot; duplicate same draft/intent; quota index/query. Draft/Sold/unpublished/
  Resale excluded, pending/reserved included; downgrade over-capacity preservation.
- Finalize/photo/discard races, partial upload, lost create/upload/finalize response,
  fixed slots and byte mismatch, idempotency, late upload and cleanup failure;
  no partially public state, Storage read/download/transform bypass denied.
- Available edit; pending/reserved edit/delete denied; Sold rules; manual sold
  permissions; Order completion/release despite suspension/over-capacity; immutable
  snapshots/media metadata and no rewriting histories. New Shop contact/Offer/
  Accept known-ID calls denied, existing legitimate Order work unaffected.
- Existing `shop-profile.cjs`, B11/B12/B13 tests, `listing-channel.cjs`/DB,
  `resale-recovery-b05.cjs`, `listing-image-recovery-b05.cjs`, media isolation API/DB,
  `transactions-b09-*`, Order/Message Shop provenance and public Seller/Shop tests.
  Update only obsolete blanket-denial assertions after approval; retain negative
  cases for ineligible owners, forgery and public access.
- Extend `manage-products.browser.cjs` + focused B14 tests using real management,
  ListingForm and sheet: 390/430/820/1280/1536, normal/reduced motion, create/edit/
  failure/retry/discard, empty versus demo, no overflow/layout/Resale regression.
  This entry imports the management/wizard tree, not ShopAnalysis/Radix's umbrella
  Progress import. The known combined `shop-surfaces.browser.cjs` build failure is
  recorded separately; actual B14 build must still be tested, not assumed PASS.
  Do not modify global loaders/dependencies to fix unrelated Analysis.
- Application TypeScript, focused ESLint/Prettier and diff/new-file checks.

## H. Real dependencies / blockers

Implementation needs a forward migration (RPC, gates, index/policies), the exact UI
exceptions above, and local tests. No unresolved pricing/quota/Trial product choice.
Cloud runtime acceptance and old public Shop draft handling remain separately
authorized work. Do not mark B14 hosted acceptance complete from fixtures.
Public discovery/transaction activation is deliberately not an exit criterion here.

## I. Exact proposed file changes

| File | Limited responsibility |
|---|---|
| New `supabase/migrations/<next_version>_shop_product_publication.sql` | Objects/policies/ACL/index in C/D; retain original guards, Resale public policy and all history |
| `lib/server/supabase-listings-repository.ts` | Explicit createShopListing via RPC, canonical fields, safe errors; reuse getCreation/finalize/update/sold/delete, not API-only quota enforcement |
| `pages/api/listings/[[...segments]].ts` | Recognize explicit POST `/api/listings/shop` before treating segment as ID; existing auth/origin/size/error conventions, stable creation-intent UUID outside metadata; ordinary POST unchanged |
| `lib/listings-api.ts` | Typed explicit Shop create transport, no client channel metadata or Resale fallback |
| `lib/listing-publication.ts` | Minimal explicit Shop operations adapter/stable create intent, shared reconciliation/upload/finalize; no duplicated publication pipeline |
| `components/listings/listing-form.tsx` | Approved Shop wizard wiring, create-intent lifetime, existing pending/error/recovery/discard; keep Resale unchanged |
| `components/listings/home-listings.tsx` | Real Shop-only inventory/empty state, existing edit/sold/delete/confirmation and stale-session result isolation; remove live demo injection only |
| `components/shops/shop-listing-workspace.tsx` | Correct blocker feedback if still used; no dynamic badge or pricing integration |
| `components/listings/resale-management-card.tsx` | Only if approved: optional Shop-only manual sold callback/menu item; preserve default Resale structure |
| New `tests/shop-products-b14.cjs`, `tests/shop-products-b14-db.cjs` / `.sql`, `tests/shop-products-b14.browser.cjs` | Targeted actual API/native/controlled-component tests; reuse current infrastructure |
| `tests/manage-products.browser.cjs`, `tests/listing-channel.cjs` / `listing-channel-db.cjs`, `tests/listing-media-isolation-api.cjs` and local DB fixture SQL as necessary | Extend conditional positive/negative paths; no remote staging test execution or weakened isolation assertions |
| B14 qualification and task progress | Exact local results and deferred hosted/legacy risks |

No planned change to B12 evaluator/repository, Shop Settings, Listing DTO ownership
model, Order snapshot code/hash, public Shop source, shared CSS or historical SQL.
No new generic membership hook/framework is required.

## J. Smallest next approval

Approve local-only implementation of the single forward migration proposal, existing
API/repository/publication/wizard wiring, private-media policy extension, new-Shop
transaction fail-closed guards, exact UI exceptions in F (including the separate
manual sold item decision), and isolated tests. Approval must not imply Staging
deployment, remote data classification/migration, real memberships/payments,
discovery/transaction activation or B15. Select the migration version only then.

This planning task changes **only this document and task progress**. No application,
UI, migration, environment, database, remote or Git mutation; no test execution.
**Stop and wait for separate implementation authorization.**
