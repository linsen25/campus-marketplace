# B15 — Public Shop Directory and Detail plan

2026-10-19. **Historical approved plan — local implementation subsequently authorized.**
Results: [B15 local qualification](BUSINESS-V1-B15-QUALIFICATION.md).
The proposals below preserve the planning baseline; they do not authorize deployment.

The official B15 row matches this scope: anonymous whitelist Directory/Detail,
authoritative eligibility and truthful product availability. B11/B12/B14 migrations
are deployed and read-only verified; B14 archive repair is complete. Their real
Staging runtime write acceptance remains deferred. B13 owner Settings is locally
qualified. Earlier qualification documents retain historical local-only milestones.

## A. Current reusable foundation

| Actual source | Reuse / current limitation |
|---|---|
| `lib/server/public-shop.ts`, `pages/listings/index.tsx`, `pages/shop/[username].tsx` | Public source currently returns `[]`/`null` synchronously; Shop SSR always 404. Marketplace passes empty Shops on success and Resale failure. No real directory endpoint exists |
| `components/shops/shop-directory.tsx`, `shop-directory-workspace.tsx` | Existing grid, pagination, scroll ownership and transitions. `real = shops.length > 0` makes an empty real result select five Demo Shops; filtering/pagination are currently local |
| `shop-card.tsx`, `shop-card-presentation.tsx` | Real card already links to `/shop/<username>` and has optional image/avatar fallback, verification, figures and heart. Omitted optional figures/heart do not need a second card |
| `recommended-shops-slider.tsx`, `recommended-shops-demo.ts` | Always Demo, local favorite state; only Luna opens the timed inline `ShopDetailDemo`; other actions are no-ops. Not real recommendations |
| `shop-page.tsx`, `shop-detail-demo.tsx`, `shop-demo-data.ts` | Canonical real page is a simpler header/shared Listing feed, with fixed PRO badge and client page state. Rich inline Detail is a separate Demo with fixed Luna identity, reviews, sold figures, products and no-op Contact shop. Do not silently replace one layout with the other |
| `shop-products.tsx` | Requests real `getListings(channel=shop)`, but public RLS denies Shop. An empty first page can inject Demo products. Heading says Popular while request sorts newest. Next-page probe changes pageSize to 1, which changes the offset and cannot prove the next 25-item page exists |
| `lib/shop-directory.ts`, `shop-directory-controls.tsx` | Ten browsing categories, four explicit legacy-category aliases. Sort labels Recommended / Highest Rated / Best Selling depend on Demo figures, not authoritative metrics |
| `lib/server/public-seller.ts`, `lib/auth-username.ts` | Anonymous, no-cookie client; strict public projection, username-normalized lookup, UUID compatibility and paginated Listing reads. Username authority is 3–20 letters/numbers/underscores; Shop stub's 1–64 check is not that authority |
| `lib/server/supabase-listings-repository.ts`, `lib/supabase/listing-mapper.ts` | Existing Listing identities, owner management, validation, DTO and image URL mapping. General selection is `*` and is not a public-Shop whitelist. Session-scoped reads can include owner/held inventory, so cannot define public eligibility |
| `published-listing-card.tsx`, `pages/listings/[id].tsx`, `use-listing-offer-context.ts` | Shared presentation and direct detail route; non-owner buyer actions are not channel-gated. Hook can query Offer context before any click. Both surfaces need an approved Shop-only read-only presentation gate |
| `202610160006`, `202610190002`, `202610190003`, `202610190004` migrations | Unique Shop owner, B11 provisioning, private B12 entitlement, B14 idempotent publication/quota and private media. No new tables or relationships needed |
| `lib/server/listing-media.ts`, `pages/api/listing-media/[imageId].ts`, `lib/listing-media.ts` | Image-ID API streams checked bytes, no signed redirect, private/no-store and second authorization check. Currently public only for available published Resale; validManifest expects private bucket. Legacy URL mapper still returns historical public Storage URLs |

Existing public Shop browser tests use controlled fixtures, not real cloud data.
`tests/public-shop.cjs` deliberately asserts the current empty/404 phase boundary;
replace those obsolete expectations only with positive and negative B15 tests.

## B. Missing functionality

No real public Shop eligibility query, whitelist directory/detail projection,
public Shop product/media delivery or suspended-route result exists. Opening general
Shop SELECT is unsafe: private owner reads and membership data are separate rights.
Empty, loading, error and Demo are currently conflated in the directory. Canonical
real links work structurally but lead to the empty source. Shop favorites, reviews,
ratings, popularity and recommendation ranks have no authoritative B15 source.

## C. One minimal architecture

**Use narrow SECURITY DEFINER read projections; keep base-table public RLS closed
for Shop.** One future forward migration, version selected at implementation time.
No product/Shop/entitlement table, redundant shop_id, new bucket or public view.

Proposed database objects (names are the implementation contract, not installed):

- Private `public_shop_eligibility(owner)` calls the unchanged B12
  `shop_entitlements(owner, statement_timestamp())`. Caller cannot supply time,
  tier or activation. Internal helpers have empty search_path and no app-role
  EXECUTE. Never expose the full membership result.
- Private public-Shop/product JSON projection helpers build explicit whitelists,
  shared by these three bounded public read RPCs:
  `marketplace_public_shops(p_query jsonb)`,
  `marketplace_public_shop(p_username text, p_query jsonb)`,
  `marketplace_public_shop_products(p_query jsonb)`.
  Return JSON; the product query supports either a single Listing UUID or bounded
  browsing, optionally scoped by authoritative username. No arbitrary SQL/path/owner
  authority. Validate all keys/types, category aliases, query length, page >=1,
  bounded maximum page and pageSize <=100 in SQL as well as the API.
- RPCs owned by the trusted migration owner, SECURITY DEFINER, empty search_path,
  fully qualified objects; revoke PUBLIC/default access, grant EXECUTE only to
  anon/authenticated. No new SELECT grants/policies on shops, listings,
  listing_images or membership tables. No mutation from a public read RPC.
- Reuse an explicitly anonymous, non-persistent Supabase client for SSR and the
  new GET-only `/api/public-shops` and `/api/public-shops/<username>` transport.
  No auth cookies or service role in the public read repository. Strictly validate
  returned DTOs; errors are 503, not successful empty results.
- Public product projection is also consumed by the existing Listing GET transport
  for channel=shop and by direct `/listings/<id>` resolution. Keep private owner
  management/creation, existing Order reads and ordinary Resale paths separate.
  Never fall back from an unavailable public Shop result to an owner/session read
  that reveals the hidden live product. Existing historical Order UI keeps its
  authorized frozen snapshot path, not the public Listing page.
- Reuse `listings_public_channel_newest`, `listings_owner_channel_newest` and B14's
  owner index first. No speculative new index. Add one only if local EXPLAIN on
  the actual bounded query establishes a need; no time-dependent partial index.

Directory baseline: `shops.created_at DESC, shops.id ASC`; products default to
`listings.created_at DESC, listings.id ASC`, with existing price sorts and ID
tie-break where requested. Apply eligibility/category/search BEFORE limit/offset.
Fetch pageSize+1, return page/hasNextPage, reuse existing pagination; never change
pageSize to probe. Ordering is deterministic for a fixed dataset, not a promise of
an immutable multi-request snapshot while shops/products/eligibility change.

## D. Entitlement, lifecycle and routing

Eligible owner: owned Shop + B12 `canOperateShop=true` + canonical current username.
Active Plus/Pro, Pro Trial and the full 120-hour Grace qualify; Suspended/no term do
not. No Trial activation, membership mutation, cron flag or browser badge inference.
Directory does not require at least one product: a legitimate eligible empty Shop
is shown with the existing empty-products state.

Public product predicate: actual seller -> UNIQUE shops.owner_id, channel='shop',
published_at IS NOT NULL, status='available', eligible owner. Draft/unpublished,
pending, reserved and Sold are excluded from public browse/detail, following the
current shared public Listing rule. Held/Sold history remains in authorized Order
and owner surfaces. Do not relabel Shop as Resale. Pro-to-Plus over-capacity does
not limit displayed rows to 40 or delete/unpublish anything; B14 alone gates new
publication.

| Request | Proposed public result |
|---|---|
| Eligible `/shop/<username>` | 200, whitelist profile and bounded real products |
| Known Shop without operating entitlement, including Suspended | Minimal unavailable result, 200 with `This shop is temporarily unavailable.`; no normal profile/products or new actions |
| Unknown/invalid username, no Shop, or old username after rename | 404; no fabricated slug, username history or redirect system |
| Case variant of current username | Resolve username_normalized, redirect to current canonical username after authoritative lookup |
| Eligible available Shop `/listings/<id>` | Same Listing ID, existing presentation, read-only buyer actions |
| Ineligible Shop `/listings/<id>` | Same unavailable marker; no product DTO in HTML/JSON. Draft/unknown ID remains generic 404, not a Shop-existence oracle |
| Database/API failure | 503/error state; never 404/empty/Demo fallback |

Keep `/seller/<UUID>` and `/seller/<username>` compatible. Explicitly scope its
existing listing query to Resale so it cannot accidentally expose Shop products
when permissions evolve; Shop discovery uses its own canonical public route.

Each SQL read captures database time and evaluates membership anew. SSR, API and
media responses remain private/no-store; no ISR/CDN/stale fallback or signed URLs.
Mounted directory/detail refresh on focus/navigation and a bounded timer, using a
server-computed refresh delay capped at the next visibility boundary. Re-resolve
before opening a cached card. On denial discard stale public profile/products.
Already delivered HTML/image bytes cannot be recalled; no claim of instantaneous
revocation of content already rendered or of legacy public Storage URLs.

## E. Public DTO, privacy and image delivery

Shop whitelist: public Shop ID, existing public seller Profile UUID, canonical
username, shopName/category/description, optional controlled avatar/cover URL and
`badgeTier: plus|pro` only for an eligible Shop. This small public presentation tier
does not expose Trial history, billing mode, expiry, renewal references or private
entitlement JSON. Do not emit email, legal name, private settings or analytics.

No Shop cover field/upload exists. Prefer the first eligible product's first ready
image in deterministic slot order; otherwise reuse public avatar/initial fallback.
Do not add cover customization, fake imagery or a fabricated verification claim.
Omit unbacked rating/review/sold figures, rather than treating unknown as zero.

Product whitelist maps into the existing Listing presentation: ID/channel, title,
description, cents/CAD, category/subcategory/condition, existing public exchange
preferences, available state, public timestamps, seller public UUID/username and
ordered image-ID API URLs. Omit private storage path/bucket, expected_image_count,
reservation pointers, frozen/private records and arbitrary DB object spreads.
Reuse existing presentation/mapping primitives; no second card or Listing identity.

Add one narrowly scoped, service_role-only read resolver RPC,
`marketplace_public_shop_image(p_image_id uuid)`, with PUBLIC/anon/authenticated
EXECUTE revoked. It returns only the real current manifest source to the existing
server media handler when image ready, parent published/available and Shop eligible.
The public RPCs never return that source. Existing server-only Storage client calls
the resolver; no browser service key and no caller-supplied bucket/path.

Extend the current image-ID handler with this Shop-public branch, preserving the
original owner/Resale branches and uniform unauthorized 404. Download and validate
through the existing storage adapter, re-resolve the same manifest/eligibility
before sending bytes. Streaming API URLs cover both new private and valid legacy
Shop manifests without exposing their paths; do not normalize/rewrite old sources.
No signed URL/redirect, cacheable draft, public bucket conversion, copy or cleanup.
Raw private Storage SELECT/download/transform stays owner-restricted. Missing files
use existing safe image failure/fallback, never Demo. Historical public URLs remain
physically public; six B05 unclassified objects and excluded historical snapshot
byte downloads remain untouched. Order snapshot source/hash/access are unchanged.

## F. Data wiring and UI V1 exceptions requiring approval

No changes are authorized yet. Preserve grids, shared cards, toolbar geometry,
scroll/focus ownership, transitions, responsive behavior and all CSS/design tokens.
Recommended smallest implementation exceptions:

1. Separate explicit Demo fixture mode from live ready/loading/error/unavailable;
   zero real rows never selects Demo. Existing fixture/Welcome examples can retain
   their current behavior. Wire directory filters/pagination to bounded real reads.
2. Use existing empty/error areas and retry treatment for truthful results; add the
   exact unavailable sentence to existing Shop/Listing containers. Preserve product
   card dimensions and animations; refresh eligibility without remounting the shell.
3. Use canonical **existing `ShopPage`**, not silently redesign it into the rich
   Luna Demo. Its fixed PRO badge uses the existing badge's actual plus/pro variant.
   Rich Demo detail remains explicit fixture-only; do not publish its fake stats,
   reviews or no-op Contact shop as real content. No generic Contact Shop control.
4. Recommended Shops: retain its section position, show restrained unavailable/empty
   copy until B17, no live Demo carousel or claimed ranking. Global product section
   may show the same eligible newest-first cards, with heading **Shop Products**
   instead of Popular Shop Products; no popularity claim or weighting.
5. Directory Sort: propose **Newest shops** as the live deterministic default;
   Highest Rated / Best Selling unavailable until authoritative metrics exist.
   This label/availability change requires approval; do not silently pretend that
   all three sort choices work or fabricate scores. Keep dropdown component/style.
6. Shop-entity hearts: omit the optional callback on real Shop cards/detail until
   B16. No fake local persistence. Existing real `ShopCard` already omits it.
7. Shared Listing card and direct route: Shop-only presentation gate hides new
   Message Seller/Offer actions and avoids initiating Offer-context hooks. Never
   use `owner=true` to suppress actions. Ordinary Resale and historical Order UI
   remain unchanged. B14's DB INSERT guards remain the actual security boundary.
8. Product hearts are distinct from Shop hearts: existing `setFavorite` checks a
   session/RLS Listing read and its INSERT policy also reads listings. RPC-only
   Shop visibility alone does not make that write work. For this read/discovery
   task, propose omitting the product heart only on live Shop browse/detail until
   a separately approved extension of existing Listing favorites is qualified.
   Do not broaden RLS or add a new favorite system. Existing Resale favorites,
   stored Shop favorite records and owner/private behavior remain unchanged.

The four persisted Shop categories stay unchanged. Reuse the explicit legacy-to-
directory aliases server-side as well as client-side; other browsing categories
legitimately yield no results. No taxonomy widening in this task.

## G. B16 / B17 / B26 boundaries

- B16: Shop-entity favorites only; no table/API/counter/local-state imitation here.
- B17: recommendation/Pro weighting/rotation/popularity/search boosting and real
  metrics facts remain absent. B15 search can do plain bounded text matching only.
- B26/later transaction authorization: B14's Conversation, order_requests and
  Orders INSERT guards are retained byte-for-byte. Do not reopen known-ID RPCs,
  Offer/Counter/Accept or add Contact Shop. Existing conversation reuse and valid
  historical Order participant workflows remain their existing authority.
- No membership/Trial/payment/billing/provider writes, new scheduler or retention
  cleanup. No historical image download/migration/deletion.

## H. Planned local qualification — not executed

Use existing isolated PostgreSQL bootstrap/native harness plus actual shared
components with controlled local transports; no shared/cloud data or emails.

- DB: Plus/Pro/Trial/Grace; exact Grace end and absent/expired membership; no client
  clock/tier bypass; empty eligible Shop; stable IDs and Pro-to-Plus over-capacity
  retention. Test current-time decisions across different session timezones.
- Public DTO/ACL: anon and authenticated get identical public projection; owner
  cookies do not unlock public hidden data; direct tables/member/helper RPCs deny
  broad reads. Invalid/extra input, limit/page abuse, unknown user/no Shop, rename,
  canonical case and unavailable responses; no private fields/paths in raw RPC,
  HTTP or SSR props. Legitimate owner and Order participant access remains intact.
- Products: actual published/available/channel predicates; exclude Draft/Sold/
  pending/reserved/unpublished, cross-Shop mismatches; no Resale fallback or channel
  mutation. Filter before paginate, same page size throughout, deterministic ties,
  0/1/full/last pages, real error versus empty, no Demo injection or fake metrics.
- Media: anon/auth eligible Shop image, owner draft fallback, Suspended/draft/
  missing/cross-owner denial; permission changes during download; HEAD/no-store/
  cache headers, no signed redirect; public/private source compatibility, direct
  Storage bypass attempts. No historical byte-download acceptance reopened.
- Native negative transaction calls: exact valid Shop Contact/Offer/Order paths
  still denied after public read access; historical Order progression/participant
  reads and existing Resale remain valid. No real provider or scheduler dispatch.
- API/browser: real directory -> canonical route, filter/sort/page/focus refresh,
  expired stale results, empty/error/unavailable, safe image fallback, no Shop
  transaction or false favorite hooks, correct tier badge, no fake destinations.
  390/430/820/1280/1536 x normal/reduced motion; grid/overflow/keyboard/scroll/focus
  regression. Known legacy combined Webpack/Radix `static {}` limitation remains
  separately recorded; use focused Shop entry, no global loader/dependency repair.
- Regressions: B11/B12/B14 native suites, B13 Settings, public Seller/username,
  Resale publication/recovery/media, Listing favorites, Order/Message provenance
  and B09 transaction tests; application TypeScript, focused ESLint and diff checks.

Cloud deployment/preflight and runtime acceptance require separate authorization;
local PASS cannot prove managed Auth/Storage/RLS/CDN/runtime behavior.

## I. Proposed implementation files

| File(s) | Limited change |
|---|---|
| One future `supabase/migrations/<next>_public_shop_projection.sql` | Private eligibility/whitelist helpers, three public read RPCs and one service-only image resolver; minimal ACL; no business DML/base public RLS widening/B14 trigger rewrite |
| `lib/server/public-shop.ts`, `types/shop.ts` | Async anonymous source, bounded response unions/whitelist validation, real public identity and public badge variant |
| New `pages/api/public-shops/[[...segments]].ts`, `lib/public-shop-api.ts` | GET-only directory/detail transport, safe states/strict query/no-store; no duplicate owner API |
| `pages/listings/index.tsx`, `components/listings/market-layout.tsx` | SSR and independent Shop state/error handoff; preserve Resale failure semantics, toolbar and mode transitions |
| `components/shops/shop-directory.tsx`, `shop-directory-workspace.tsx`, `shop-products.tsx` | Explicit live/Demo boundary, authoritative page/filter data and public product reads, existing shells/scroll/animation |
| `lib/shop-directory.ts`, `components/shops/shop-directory-controls.tsx` | Server-compatible category alias mapping; approved truthful live sort behavior; no new dropdown design |
| `components/shops/recommended-shops-slider.tsx` | Explicit fixture-only Demo use; approved live empty recommendation treatment |
| `pages/shop/[username].tsx`, `components/shops/shop-page.tsx`, `shop-card.tsx` | Canonical async resolution, public states, real tier/optional cover, bounded products and shared cards; no rich-detail redesign |
| `lib/server/supabase-listings-repository.ts`, `lib/listings-api.ts`, `pages/api/listings/[[...segments]].ts`, `pages/listings/[id].tsx` | Narrow Shop public-read branch and unavailable response; preserve separate owner/favorite/Order and Resale paths |
| `components/listings/published-listing-card.tsx`, `use-listing-offer-context.ts` | Approved Shop-only read-only action/heart gate and no unwanted context effects; no visual token change |
| `lib/server/listing-media.ts`, `pages/api/listing-media/[imageId].ts` | Existing ID-based byte streaming with restricted public-Shop resolver and second eligibility check; keep private/no-store |
| `lib/server/public-seller.ts` | Explicit Resale listing scope; preserve UUID/username and avatar routes |
| New `tests/public-shop-b15.cjs`, `public-shop-b15-db.cjs` / `.sql`, `public-shop-b15.browser.cjs` | Focused actual API/native/controlled UI qualification |
| Existing `tests/public-shop.cjs`, `public-shop.browser.cjs`, `shop-discovery.browser.cjs`, `shop-directory-controls.browser.cjs`, `listing-media-isolation-api.cjs`, `public-seller.cjs` | Update only phase-obsolete expectations, retain permission/privacy/Resale regressions and explicit Demo tests |
| B15 qualification (later) and task progress | Actual results versus deferred cloud acceptance |

No planned edit to shared CSS, B11/B12/B14 historical migrations, membership
evaluator/commands, Shop Settings, Pricing, financial logic or snapshot hashes.

## J. Smallest next approval

Approve local-only implementation of this single public-read architecture,
forward migration file, existing-route/card/media wiring and isolated tests,
**including the eight precise UI/data-interaction exceptions in F**. If those
exceptions are not approved, stop the affected surface rather than silently
shipping dead controls, fake data or a redesigned Detail page.

No remote deployment, runtime fixtures, real payment/Trial, favorite persistence,
ranking/metrics or opening new Shop transactions is implied. Stop after planning
and await that separate authorization; do not begin B16/B17/B26.
