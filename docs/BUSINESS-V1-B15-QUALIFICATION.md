# B15 — Local public Shop qualification

2026-10-19. **B15 LOCAL IMPLEMENTATION COMPLETE.**
**B15 STAGING NOT DEPLOYED. B15 STAGING RUNTIME ACCEPTANCE NOT PERFORMED.**
**B16/B17 NOT STARTED.**

## Implemented authority

New forward-only `202610190005_public_shop_projection.sql` adds four private
helpers, three anonymous/authenticated public read RPCs and one service-role-only
image manifest resolver. No table, bucket, broad SELECT/RLS grant, business DML,
historical migration rewrite or B12/B14 mutation. Public base Shop/Listing RLS
remains closed for Shop. All functions use empty search_path and qualified tables;
public read wrappers are SECURITY DEFINER, explicit EXECUTE grants. Private
helpers are revoked from app roles, including service_role. Trusted native test
owner executes them through wrappers, not a client-supplied identity/tier/clock.

Eligibility calls B12 with database statement time. Active Plus/Pro, Pro Trial,
full Grace are visible; no term/Suspended hidden. No cron/status flag, implicit
Trial or paid grant. Products require correct owner/channel, published_at and
available status. Pending/reserved/Sold/draft are excluded; owner and historical
Order paths remain separate. A downgrade does not truncate the visible inventory
to 40: the native test retains 45 products while further publication is denied.

Public JSON is explicitly built in SQL and projected again by the anonymous
server repository: current username, Shop identity/name/category/description,
actual badge tier, controlled media URLs and shared Listing public fields.
No raw profile/member object, email, trial/renewal facts, storage path/bucket or
token. Empty eligible Shop is legitimate. Missing Shop/old username is not_found;
recognized ineligible Shop and its published Listing give only unavailable.
SSR displays `This shop is temporarily unavailable.` without normal DTO content.
Case variants resolve to authoritative canonical username; no rename history
redirect system. Existing Seller UUID/username projection explicitly stays Resale.

Bounded SQL query allowlists/pagination apply before result slicing. Directory
orders created_at DESC/id ASC; products newest or existing price sorts with stable
ties. pageSize+1 proves next page at the SAME pageSize. Category aliases preserve
the current four stored categories; other directory categories can return empty.
No time-based partial index or new counter. Existing read indexes are reused.

## Media, caching and transaction boundary

The existing image-ID byte API resolves eligible public Shop manifests through the
service-only resolver. Path/bucket are never accepted from public requests or
returned in public DTOs. Legacy and private manifest sources are supported without
migration; ready/identity/path/MIME/signature/size checks and a second manifest/
eligibility check after download apply. Owner/private Resale branches remain.
No signed URLs, redirects, bucket public change, copy or deletion. Historical
public Storage URLs remain physically public; six B05 unclassified objects and
excluded historical snapshot byte downloads were not touched/reopened.

SSR/API/media use no-store. PWA NetworkOnly now includes public-shops, canonical
Shop pages and their Next data requests. Periodic/focus refresh uses bounded
server visibility delay; request-key/version/abort guards discard old responses.
Loading/error transitions discard stale public content. Already delivered bytes
cannot be recalled, and a previously installed old service worker requires its
normal update; no claim of retroactive cache erasure or instantaneous client expiry.

B14 Conversation/Offer/Order INSERT guards remain unchanged. Shop-only shared card
and direct Listing route suppress new buyer controls and Offer-context effects;
no generic Contact Shop. Valid historical Order updates/participant access retain
the existing authority. No second product, message, favorite or transaction system.

## Approved UI exceptions actually used

- Real directory and canonical ShopPage data wiring; no empty/error Demo fallback.
  The old rich Luna detail and fixture cards remain explicit Demo-only, not reused
  as fictional live merchant data. Existing grid/card/scroll/motion CSS unchanged.
- Existing loading/error/empty containers plus exact unavailable message. No full
  Shop Detail redesign. Shared cards still own expansion and responsive geometry.
- ShopPage uses actual Plus/Pro badge variant; shared badge component unchanged.
  No invented ratings/reviews/sold/verification/Featured claims.
- Live Recommended Shops uses truthful pending-recommendations content; global
  products heading is Shop Products. Directory Sort offers Newest shops; unsupported
  rating/sales/recommendation ranking is not advertised as functional.
- No Shop-entity favorite callback. Live Shop product heart is omitted as approved
  in plan F8 until existing Listing-favorite write eligibility is separately wired;
  genuine Resale favorites/backend and stored history are not replaced or deleted.
- Shop buyer actions hidden; Resale actions/favorite geometry are unchanged.

## Validation and precise limits

PASS:

- `tests/public-shop-b15-db.cjs` / `.sql`: native PostgreSQL, actual current schema
  plus new migration, anon/auth roles and raw-RLS/private-RPC denial, Plus/Pro/
  Trial/Grace/Suspended/no membership/no Shop, whitelist, bounded stable pages,
  legitimate cooldown-protected rename via existing RPC and historical eligible
  fixture, 45-product downgrade retention, service-only ready-image resolver,
  draft denial, actual elapsed Grace expiry/no scheduler, suspended direct Listing
  and image denial, existing Contact INSERT denial, B11/B12/B14 helper preservation.
- `tests/public-shop-b15.cjs` (also `tests/public-shop.cjs` entry): actual repository,
  API and Shop SSR with mocked transport, no network, anonymous client, whitelist,
  malformed query/405/400/503, empty vs error, canonical redirect, unavailable vs
  not-found, arbitrary image URL rejection. No private cookie/service client.
- `tests/public-shop-b15.browser.cjs` (also `tests/public-shop.browser.cjs` entry):
  actual Directory/ShopPage/Listing route/shared card, controlled local GETs,
  five widths 390/430/820/1280/1536 x normal/reduced; real destination/Plus badge,
  products/empty/error/unavailable, no fake data or buyer/favorite API effects,
  stale-state clearing, overflow, shared Resale button/favorite preservation.
  Screenshots under ignored `tests/artifacts/message-payload-qualification/`.
  Browser transport and image bytes are controlled local fixtures, not managed
  Staging responses; screenshots wait for the existing expansion animation.
  This repository's older Webpack requires `NODE_OPTIONS=--openssl-legacy-provider`
  with local Node 24. A retry without that existing runtime option failed during
  bundling (OpenSSL unsupported); the configured browser run passed. No dependency
  or application workaround was added.
- `tests/listing-media-isolation-api.cjs`: all original Resale owner/anon/other/
  Draft/Published/Sold/Deleted/readiness/path/no-signing/HEAD cases, plus eligible
  anonymous/other Shop bytes, draft denial and expiry-during-download denial.
  Cache test checks actual NetworkOnly regex rather than an obsolete substring.
- Native B11, B12, B13, B14 and B09 regressions: actual existing ownership,
  permissions, publication/recovery/quota/lock races, held Shop history and
  transaction progression. B12/B13/B14 harnesses load the new read migration after
  their deliberately staged B12 dependency, not before it. No assertion weakened.
- B13 browser: 10/10 existing Settings/account/conflict/recovery/geometry cases.
- Offline public-seller, shop-profile, shop-membership-b12, shop-settings-b13,
  shop-products-b14, listing-channel, resale-recovery-b05,
  listing-image-recovery-b05, order-shop-provenance, message-shop-provenance and
  transactions-b09-static. Channel test now asserts explicit safe public Resale
  default versus separate Shop projection; owner/shared favorites remain unscoped.
- Application TypeScript, focused source ESLint, Prettier and diff/new-file checks.
- Normal Next production build in an exact current-source copy without environment
  files, with non-secret dummy search/Supabase values and all HTTP/fetch blocked.
  Production build completed; original .next/public/sw.js untouched. Existing hero
  index-key, CSS start/flex-start and outdated Browserslist warnings remain; external
  font optimization is intentionally blocked. No build-system/dependency change.

Not PASS / separately recorded:

- Legacy `tests/published-listing-card.browser.cjs` reaches the preexisting Manage
  Resale surface expecting PublishedListingCard. Current management renders
  ResaleManagementCard, so its old DOM expectation times out. B15-specific API mock
  and Shop no-heart expectations were updated; no management UI/obsolete menu
  redesign or broad test rewrite was performed. Focused B15 browser explicitly
  exercises the actual shared Resale card as regression. This comprehensive legacy
  entry is not reported passed.
- Known combined `shop-surfaces.browser.cjs` Webpack/Radix static-block limitation
  remains separately documented, not rerun/fixed here. B15 focused browser and
  normal application build do pass.
- Real managed Auth/PostgREST/Storage/CDN and Staging data acceptance not performed.
  Raw private Storage restrictions are preserved and covered by B14's native
  regression; local controlled byte transport does not prove managed download or
  image-transform endpoint behavior. No real external provider or scheduler.

Development failures were resolved within scope: new SQL CASE parentheses,
rename fixture attempting generated/cooldown fields (replaced by legitimate
legacy fixture and real username RPC), missing browser Next/process shims and
async loading waits, new source lint/format issues, and obsolete test transport/
cache substring expectations. No permissions/triggers were disabled to pass tests.
The first sandboxed copied build stalled, was stopped only within its task-owned
process subtree, and the same normal build completed outside the Windows process
sandbox after dummy non-secret required build configuration was supplied.

## Exact B15 files

Migration (new): `supabase/migrations/202610190005_public_shop_projection.sql`.

Server/transport/model/config:

- `types/shop.ts`
- `lib/server/public-shop.ts`
- `lib/public-shop-api.ts` (new)
- `hooks/use-public-shop-read.ts` (new)
- `pages/api/public-shops/[[...segments]].ts` (new)
- `lib/server/supabase-listings-repository.ts`
- `lib/server/public-seller.ts`
- `lib/server/listing-media.ts`
- `next.config.js` (only NetworkOnly route additions)

Existing pages/components:

- `pages/listings/index.tsx`, `pages/listings/[id].tsx`, `pages/shop/[username].tsx`
- `components/listings/published-listing-card.tsx`
- `components/listings/use-listing-offer-context.ts`
- `components/shops/shop-directory-workspace.tsx`
- `components/shops/shop-directory-controls.tsx`
- `components/shops/shop-products.tsx`, `components/shops/shop-page.tsx`
- `lib/shop-directory.ts`

Tests (new): `tests/public-shop-b15.cjs`, `tests/public-shop-b15-db.cjs`,
`tests/public-shop-b15-db.sql`, `tests/public-shop-b15.browser.cjs`.
Updated: `tests/public-shop.cjs`, `tests/public-shop.browser.cjs`,
`tests/listing-channel.cjs`, `tests/listing-media-isolation-api.cjs`,
`tests/shop-products-b14-db.cjs`, `tests/shop-membership-b12-db.cjs`,
`tests/shop-settings-b13-db.cjs`, `tests/published-listing-card.browser.cjs`.
Documentation: this qualification, planning milestone and task breakdown.

## Environment and next authorization

Only local implementation and disposable random-loopback PostgreSQL/browser/build
artifacts. Servers stop in finally; test artifacts retained and ignored. No Staging
or Production request, remote account/data/schema write, Stripe/payment/email,
existing data/media cleanup, secret/env edit, application deployment or Git mutation.
Existing unrelated worktree preserved. No automatic later task start.

Next: separately authorized exact-migration Staging read-only prerequisite review,
then deployment approval and separately scoped runtime acceptance with explicit
test-data retention/cleanup boundaries. B16 Shop favorites, B17 rankings/metrics
and later Shop transactions remain deferred. Do not infer cloud runtime acceptance
or historical image privacy from these local results.
