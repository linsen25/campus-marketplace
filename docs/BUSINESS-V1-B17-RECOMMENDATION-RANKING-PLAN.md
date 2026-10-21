# Future Recommendation & Ranking Proposal — NOT the Official B17 Plan

2026-10-19. **UNASSIGNED FUTURE WORK PACKAGE. IMPLEMENTATION NOT STARTED.**
The historical filename is retained to preserve the draft and its source findings.
The user has confirmed that official B17 remains Discovery / Analytics fact
collection. Its plan is [B17 Discovery Facts](BUSINESS-V1-B17-DISCOVERY-FACTS-PLAN.md).
Recommendation & Ranking requires separate scheduling and implementation approval;
no new B-number is assigned. No application, UI or migration change is authorized.

## A. Reconciled scope and baseline

The current B17 backlog row in `BUSINESS-V1-TASK-BREAKDOWN.md` is **discovery and
analytics fact collection**: views/sales/cost attribution, owner exclusion,
idempotent events and reconciliation. Its dependency graph also calls B17
"metrics facts". This is materially different from the new attachment's
**recommendation/ranking** task, which expressly excludes new event collection.
B10 section 1 does separately defer the promotion algorithm to B17.

The user's subsequent scope decision resolves the discrepancy: preserve the
original B17 row and its B18/B19 dependencies. B10's reference to B17 for promotion
algorithm parameters is historical cross-reference wording, not authority to
expand B17 after that decision. No other numbered task explicitly owns the full
recommendation/ranking package; B15 provides discovery, B29 addresses bounded
Resale queries, and B27 handles notifications, none of which is reassigned here.

This document is a future proposal only. Its block size of three, maximum
two-place displacement, daily rotation, 128 raw candidates and eight outputs are
**provisional, unapproved design choices**. All numerical parameters, algorithm,
search wiring, UI exceptions and migration/file lists below require fresh review
and approval in that future package. They are not official B17 implementation
requirements or approved product rules. Useful principles remain eligibility and
relevance before bounded promotion, real data only, Resale independence and stable
ordering/pagination with explicit live-data limitations.

Per the separately completed deployment reports, B11/B12/B14/B15/B16 migrations
are deployed/read-only verified and Staging has 71 versions. This planning round
does not recheck the cloud. B15/B16 populated-data/browser/runtime acceptance
remains deferred. Historical local-only headings in their qualification files
are dated milestones, not the latest deployment status.

## B. Existing discovery architecture

| Surface                      | Actual source and behavior                                                                                                                                                                                                                                                                                                                                         | Missing behavior / smallest proposed change                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live Recommended Shops       | `components/shops/shop-directory-workspace.tsx`, `PublicShopDirectoryWorkspace`: static "Recommendations will appear here." No live recommendation request.                                                                                                                                                                                                        | Read eligible real Shop DTOs through the existing directory API with a narrowly validated recommendation placement; reuse the existing slider presentation.                                                                                  |
| Demo Recommended             | `components/shops/recommended-shops-slider.tsx`, `recommended-shops-demo.ts`, `shop-demo-data.ts`: explicit illustrative cards, local hearts and fixture ratings/reviews/sold. `OverlappingSlider` is shared presentation.                                                                                                                                         | Keep Demo isolated. Add a real-data adapter using real ShopCard/B16 identity; never send fixture IDs to persistence.                                                                                                                         |
| Featured                     | No separate live Featured directory/rotation or persisted featured flag found. `components/pricing-card.tsx` promises "Featured Shop promotion"; `lib/fixtures/shop-analysis-fixture.ts` manufactures featured impressions/visits for the Demo analysis.                                                                                                           | Treat Featured as the promotion placement inside Recommended, not a new page, badge or invented measurement. A separate Featured surface would require another explicit UI/product decision.                                                 |
| All Shops                    | Workspace -> `lib/public-shop-api.ts` -> `lib/server/public-shop.ts` -> `marketplace_public_shops(jsonb)` in `202610190005_public_shop_projection.sql`. SQL applies eligibility/category aliases/search before offset and orders `shops.created_at DESC, id ASC`. Overview 8, expanded 16.                                                                         | Add explicit recommended ordering in SQL. Preserve genuinely chronological Newest. Current request hardcodes newest; do not sort an already paginated array.                                                                                 |
| Sort/filter                  | `lib/shop-directory.ts` contains Recommended/Highest Rated/Best Selling demo options; `shop-directory-controls.tsx` deliberately exposes only Newest. Four stored Shop categories map to the existing ten browsing labels.                                                                                                                                         | Enable only a truthful Recommended option, subject to the UI exception below. Do not enable unsupported ratings/sales sorts or alter the taxonomy.                                                                                           |
| Shop products                | `components/shops/shop-products.tsx` calls `marketplace_public_shop_products(jsonb)` through the same public API, `sort='newest'`, 25/page; SQL orders created_at/id or price with stable ties. The actual live heading is **Shop Products**, not Popular Shop Products.                                                                                           | Use the proposed recommendation mode for the global discovery feed; retain the truthful heading and canonical single-Shop Newest/price behavior. No fabricated Popular score.                                                                |
| Shop search                  | B15 SQL supports literal, case-insensitive substring search over Shop name/description and product title/description. `MarketLayout` does not pass its applied search to the live Shop directory/products. Suggestions currently come from the Resale source.                                                                                                      | Connect the existing applied query, without a second search state/box. In Shop mode use the existing text-submit suggestion rather than wrong-channel Resale item/category suggestions. This is a separately approved interaction exception. |
| Resale search/ranking        | `components/listings/market-layout.tsx` loads all available Resale pages in batches of 100, then uses `lib/market-search.ts`: exact title, word prefix, title phrase, subcategory, category, description; ties retain source order. Local price sorts override it; no-query sorts created_at. Repository SQL has literal escaped ILIKE and created_at/id ordering. | Preserve it unchanged. It is not a membership-ranked mixed feed. Its existing all-pages load is B29 debt, not permission for a B17 rewrite.                                                                                                  |
| Canonical detail / Favorites | `components/shops/shop-page.tsx`, `components/shops/shop-favorites.tsx`, `hooks/use-shop-favorites.ts`: B15 detail reads; B16 own favorites ordered by saved time/UUID. Products uses original Listing Favorites.                                                                                                                                                  | Do not promote/reorder saved favorites or owner/history views. Reuse canonical routes and shared hearts.                                                                                                                                     |

Transport: `pages/api/public-shops/[[...segments]].ts` is GET-only, bounded JSON
query and private/no-store. Its anonymous repository projects whitelist DTOs.
`hooks/use-public-shop-read.ts` clears stale data on errors/denial, rejects late
responses, refreshes on focus and uses the B15 boundary delay (100–30000ms).
`pages/listings/index.tsx` supplies the initial eight Shops separately from Resale.
These are the integration points; no new recommendation service is needed.

## C. Genuine signals and limits

| Signal                       | Existing trusted source                                                                                                  | Proposed use                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Eligibility / effective tier | B12 `shop_entitlements(owner, database time)`; B15 `public_shop_eligibility(owner)`                                      | Mandatory eligibility; Pro flag derived internally from the effective public tier. Never accept tier/clock from the browser.                                                                                                                           |
| Publication / availability   | `public.listings.listing_channel`, published_at, status; B14 guards                                                      | Mandatory Shop/published/available predicate. No Draft/Sold/pending/reserved items.                                                                                                                                                                    |
| Category / text              | Shop and Listing fields, B15 category mapping/search                                                                     | Hard filters first; text match tier next. Preserve existing literal substring matching; no vector/FTS semantics change.                                                                                                                                |
| Recency / stable identity    | Shop/Listing created_at and UUID; first publication also exists                                                          | Keep created_at/id as the existing baseline. Do not reward updated_at edits or invent a republish timestamp.                                                                                                                                           |
| Shop favorites               | B16 `shop_favorites`, unique account/Shop, index on shop_id; own eligible Shop favorites allowed                         | Genuine relationships, but not reviews, impressions or anti-abuse-qualified popularity. Defer count ranking; no relationship disclosure or count infrastructure.                                                                                       |
| Listing favorites            | `listing_favorites`, index on listing_id                                                                                 | Real records, but live Shop product hearts are intentionally closed by B15 and Shop insert eligibility has not been qualified as a public popularity producer. Defer; keep Resale behavior intact.                                                     |
| Views                        | `202610160003_account_activity.sql`, private `account_activity_events`; Resale Market intentional-open hook              | Existing account facts, not a qualified Shop recommendation exposure stream. No Shop impression attribution, no Shop-specific abuse qualification; index is owner/time/kind, not a product ranking index. Do not aggregate it for B17 or add tracking. |
| Completed sales              | Orders/transaction_events and frozen Shop provenance; manual `listing_sold` is a different fact                          | Cancellations, refunds, external exchange and seller-marked Sold cannot be treated as equivalent sales. New Shop transactions remain gated by B14. Defer sales ranking/revenue work.                                                                   |
| Ratings/reviews/featured CTR | Demo card figures and `shop-analysis-fixture.ts`; no authoritative review/rating table found in the inspected migrations | Not ranking inputs or live display claims. Never copy Demo figures into real DTOs.                                                                                                                                                                     |

Minimum V1 inputs: eligibility, category/text, existing recency/UUID and effective
Pro. No numeric popularity weights, favorites aggregates, event writes or counters.

## D. One bounded, explainable ordering rule

For recommendation mode only, perform this in SQL **before final pagination**:

1. Apply B15 visibility, channel/publication/availability and all applicable hard
   filters. A subscription never admits an otherwise excluded row.
2. If there is text, group matches into relevance tiers: exact name/title;
   name/title word-prefix; other name/title substring; description substring;
   final concatenated-field substring fallback. Keep the B15 literal matching
   predicate, including its cross-field matches; do not silently introduce new
   category/username/full-text matching. Empty query has one tier.
3. Within each tier, establish the normal stable base order: created_at DESC,
   UUID ASC. Divide it into consecutive blocks of **three**.
4. Within each block only, place effective Pro before Plus; retain the base order
   within each membership class. Final order is relevance tier, block ordinal, Pro-first,
   base ordinal. A Pro can advance **at most two places**, never cross a relevance
   tier/block, and does not permanently take rank 1.

This is a displacement limit, not a quota or additive mystery score. A block may
contain three Pro or three Plus Shops. Every candidate remains in the ordered
All Shops/product result; no membership-based removal or star-rating fabrication.
The block size is one explicit initial product parameter for implementation
approval, not an empirically validated conversion claim.

Worked examples:

- Query `desk lamp`: Plus exact-title item is tier 0; Pro matching only in the
  description is tier 3. Plus wins regardless of recency/tier subscription.
- Same relevance, base block `[Plus A, Pro B, Plus C]` becomes
  `[Pro B, Plus A, Plus C]`. B advances one position; relevance is unchanged.
- Same relevance base `[Plus A, Plus B, Plus C, Pro D]`: D stays in block 2,
  so Plus A remains first. Pro does not guarantee the first position.

Explicit Newest and price sorts retain their actual meanings; no hidden boost in
those orders. Defaulting All Shops to Recommended and exposing that existing
option requires approval under I. Single-Shop product listings need no paid
boost because every product has the same owner entitlement.

## E. Membership and public boundaries

Effective Pro, Pro Trial and Pro Grace receive the same small promotion. Effective
Plus and Plus Grace receive normal placement. Suspended/no entitlement never
enters ranking. Reuse B15's statement-time eligibility; no new status state,
Trial issuance, billing behavior or browser Pro flag.

Pro-to-Plus over-quota inventory remains publicly discoverable when otherwise
eligible: B14 limits new publication, not the public result count. An eligible
empty Shop remains a valid Shop recommendation candidate. UUID controls ties and
rotation; current username controls the canonical destination after rename.

## F. Recommended / Featured rotation

Use one small daily candidate selection for this **non-paginated placement**:

- Derive the date in America/Toronto from the database clock. Derive a stable UUID
  pivot from a namespaced hash of that date, not username or React render time.
- Use the Shop PK to take at most **128 raw Shop IDs** cyclically after the pivot,
  wrapping once with disjoint ID ranges. This is an internal bounded sample, not
  All Shops or search pagination. It may include private/ineligible candidates;
  none may reach the next step or public output without B15 eligibility/filters.
- Filter this sample authoritatively, then establish a daily deterministic
  hash/UUID base order within each relevance tier. Apply the same block-of-three
  Pro displacement rule; return at most eight unique eligible Shop DTOs.
- No guaranteed impressions, Pro slot count or uniform lifetime exposure is
  claimed. Small populations are not padded with invented Shops. A sample with
  no matching eligible candidate produces a truthful empty recommendation state,
  even if All Shops has matches outside the sample. It is not a global absence
  claim; never fall back to Demo.
- Repeat reads on unchanged data during the day are stable. Eligibility changes
  apply immediately on the next read. No recommendation pagination crosses the
  midnight rotation boundary; the existing refresh delay also respects midnight.

This replaces the real placeholder using the existing carousel language, not
`ORDER BY random()`, a worker, new featured flags or promotion analytics. Demo
carousel behavior remains separate. "Featured" describes this placement, not
a new Verified badge, review score or tracked impression.

## G. Products, search, pagination and freshness

Keep the live **Shop Products** heading: current genuine engagement is insufficient
to label a computed result as popularity. The global feed can use recommendation
ordering with the same rule; zero-engagement/new/equal products simply use normal
recency/UUID. First publication is required, Sold/pending/reserved disappear, and
no expired Shop gains placement. No arbitrary engagement default values.

Wire the toolbar's existing applied text into directory and global products.
Preserve their distinct Shop-category/product-category semantics; do not equate
the two taxonomies. Preserve all accepted filters; reject unsupported parameters
explicitly instead of dropping them. Public Shop products currently do NOT accept
price-range/subcategory/condition/pickup filters (`publicShopRows` rejects them).
If such filters are presented in a future Shop search UI, their proper bounded SQL
support must be approved explicitly; do not change the existing Resale filters.
No mixed Shop/Resale endpoint is proposed. Resale-only results stay available
even with zero Shop results and receive no inferred subscription boost.

Keep existing offset pages, maximum page 1000/pageSize 100 and pageSize+1 probe.
For recommended All Shops/products, select the ordered eligible base prefix
through `offset + pageSize + 1 + 2` before block promotion, then slice/probe.
Because promotion moves at most two rows and cannot cross blocks, this includes
every row that could enter the requested prefix. Complete each block using its
absolute within-tier ordinal; do not restart blocks on each page. Public DTO/image
projection should run only for selected output rows. Never rank page 1 alone in JS.

With unchanged rows/entitlements, all page concatenations must equal one complete
SQL ordering, including block/page boundaries. Existing live offset pagination
is not a snapshot: publication, deletion, eligibility/tier changes can shift rows
between separate requests. Do not promise no omissions/duplicates across arbitrary
concurrent dataset changes. Retain filter/sort page reset and empty-page fallback;
qualify mutation cases separately. Strict snapshot traversal would need a separate
cursor/snapshot design approval, not a silent cache subsystem in B17.

Keep private/no-store, existing NetworkOnly transport, bounded eligibility refresh,
focus refresh, error/unavailable clearing and request-generation guards. Do not
add ISR, client scores, client membership timestamps or materialized rankings.

## H. Data, security and performance proposal

One future forward migration, provisionally
`supabase/migrations/202610190007_shop_discovery_ranking.sql` (reconfirm next free
version at implementation), is necessary for DB ordering, not created now:

- Add at most two private helpers: `shop_discovery_query(jsonb,text)` for the
  narrowly allowed placement/recommended-mode extension, delegating old keys to
  B15 validation; `shop_discovery_text_rank(text,text,text)` for deterministic
  internal relevance. Empty search_path, revoked application EXECUTE.
- Replace only the existing `marketplace_public_shops(jsonb)` and
  `marketplace_public_shop_products(jsonb)` bodies, maintaining signatures,
  JSON unions, private helpers/public whitelist and existing anon/auth EXECUTE.
  Placement accepts only directory/recommended; recommendation is page 1 with
  at most eight rows. No arbitrary seed, weights, tier, user or SQL expression.
- Preserve B15 eligibility/profile/product/query helpers, B12, B14 guards, B16
  table/RPCs, base RLS/grants, Storage, detail single-ID/username errors and Order
  participant paths. No business writes, backfill, count table or public access
  to favorite/member relationships.

Existing useful indexes: Shop UUID PK/unique owner, profiles normalized username,
`listings_public_channel_newest`, `listings_owner_channel_newest`, B14
`listings_shop_active_owner`, B16 `shop_favorites_shop` and Listing favorite lookup.
The last two do not justify counting favorites for this algorithm. No local
trigram/FTS search index was found; B15 position/substring searches are not made
index-supported merely by applying LIMIT.

Only output/ranking prefixes and recommendation sampling are bounded by those
limits; eligibility/text scans can still examine many rows. Avoid per-product
repeated membership evaluation by deriving eligible owners once per query, and
avoid projecting images for all candidates. In local qualification use EXPLAIN
ANALYZE on representative 100/1000/5000-Shop datasets, both mostly ineligible and
matching/empty searches, shallow/deep pages, with appropriate product volumes.
Compare to B15; do not confuse a returned-row limit with a scan bound.

If the query cannot meet the existing execution budget, stop rollout and propose
the measured minimal index/query correction (for example a Shop created_at/id
index where the plan proves useful). Do not add pg_trgm, workers or caches by
default. Do not ship unrestricted engagement-history/favorites aggregation scans.

## I. UI V1 exceptions to approve before implementation

1. Replace the live Recommended placeholder with real results in the **existing**
   overlapping-slider presentation; reuse real ShopCard/B16 hearts, optionally
   forwarding its existing compact presentation variant. No new cards, CSS,
   metrics, Featured badge or separate Featured section.
2. Expose existing **Recommended** beside **Newest shops**, and make Recommended
   the All Shops default so Pro promotion is truthful. Explicit Newest remains
   unboosted. Do not expose Highest Rated/Best Selling without real authority.
3. Connect existing Shop-mode search submit to live directory/products; avoid
   wrong-channel Resale suggestions by using the existing text-submit suggestion
   in that mode. Do not alter Resale suggestions or introduce a search box.

These are proposals, not current UI authorization. Keep cards, text sizes,
geometry, routes, 390px fix, filters, mode transitions, scroll behavior, Favorites,
Settings/Manage/Analysis and Demo views unchanged. Shop Products stays truthfully
named; no popularity copy change is necessary. Any further UI issue must stop the
affected implementation for approval.

## J. Local qualification plan — not executed

- Native PostgreSQL: Plus/Pro/Pro Trial/Pro Grace/Plus Grace; elapsed expiry,
  Suspended/no membership; B12 authority and actual database time; no client tier
  forgery. Available vs Draft/Sold/pending/reserved; retain downgraded over-quota
  published inventory; own/empty Shop, current username with stable UUID.
- Ordering: worked relevance cases; nonmatching Pro excluded; maximum two-place
  promotion, Pro not always first, equal/null optional metrics, new/old publication,
  no updated_at boost; Newest and both prices unaffected; correct category mapping
  and literal wildcard/Unicode/empty/maximum search behavior.
- Rotation: fixed day repeats, Toronto midnight/DST, bounded raw sample/wrap and
  unique IDs, 0/1/2 candidates without fabricated records, changing eligibility,
  all/none Pro; no implied impressions or random render reshuffling.
- Pagination: sizes 1/2/3/8/16/25/100 crossing blocks/relevance tiers; compare all
  pages to complete static ordering, probe/final/empty/deep pages. Separately
  exercise publication/Sold/expiry changes and document live-offset limitations.
- API/security: exact bounded query allowlists/invalid/duplicate parameters,
  GET-only/no-store, anon/auth identical whitelist, no private fields/paths/raw
  counts, helper/table EXECUTE denial, no B16 relationship discovery or writes.
- Compatibility: B12/B14/B15 native/API regressions, B16 saved state/list/order and
  Listing Favorites/Resale search/prices, Seller/Order history and media; actual
  Shop Conversation/Offer/Order attempts remain denied. No scheduler/provider or
  email actions. Fixture table/history snapshots prove no business writes.
- Performance: EXPLAIN tests described in H; no new favorite/activity aggregation.
- Browser: 390/430/820/1280/1536, normal/reduced motion; existing Shop/Resale tabs,
  search/filters/sorts, real carousel/empty/error, favorite/detail navigation,
  stable repeat reads, no overlap/overflow, 390px unforced clicks and focus/scroll.
  Fixtures only; no Staging account or data creation.
- Later local implementation checks: application TypeScript, focused ESLint,
  Prettier/diff and safe offline build. Existing unrelated legacy browser harness
  debt remains separately reported, never skipped into PASS.

## K. Smallest expected implementation files

New: the one proposed migration; `tests/shop-ranking-b17-db.cjs`,
`tests/shop-ranking-b17-db.sql`, `tests/shop-ranking-b17.cjs`,
`tests/shop-ranking-b17.browser.cjs`; later separate B17 qualification document.

Existing files to change only as needed for this proposed integration:

- `types/shop.ts`, `lib/server/public-shop.ts`, `lib/public-shop-api.ts` — bounded
  discovery mode/placement types, validation and existing whitelist transport.
- `pages/api/public-shops/[[...segments]].ts` — existing GET query validation only
  if required by the added mode; no new endpoint or auth system.
- `lib/shop-directory.ts`, `components/shops/shop-directory-controls.tsx` —
  approved recommended default/option; no rating/sales option or taxonomy rewrite.
- `pages/listings/index.tsx`, `components/listings/market-layout.tsx` — align Shop
  SSR ordering with client mode and wire the existing applied search; Resale intact.
- `components/shops/shop-directory.tsx`, `shop-directory-workspace.tsx`,
  `shop-products.tsx` — query propagation, separate live recommendation read,
  global product ordering and existing loading/empty/error states.
- `components/shops/recommended-shops-slider.tsx`, `shop-card.tsx` — real-data
  adapter and optional existing compact variant; preserve the explicit Demo export.
- `docs/BUSINESS-V1-TASK-BREAKDOWN.md` — actual progress and explicit scope decision.

Do not edit B12/B14/B15/B16 historical migrations, `lib/market-search.ts`, Listing
Favorites authority, PulseHeart, CSS, public Seller routes or transaction modules.
Existing focused tests change only for an explicitly approved new default, keeping
their eligibility/security assertions.

## L. Next authorization and stop

Official B17 scope is now settled: facts only. First obtain scheduling approval
for this separate, currently unassigned ranking work package. Then review the
provisional algorithm, sample coverage, pagination limitations and I's proposed
UI exceptions before any local implementation authorization. Its proposed
migration/version/file names are placeholders, not reserved or created. No cloud
operation, B17 fact implementation or B18/B19 work is implied.

The original ranking planning round ran no implementation tests and made no
application/database/remote, environment, credential or Git changes. This scope
reconciliation changes only the approved three planning documents.

**FUTURE RECOMMENDATION & RANKING PROPOSAL — UNASSIGNED, NOT IMPLEMENTED**
