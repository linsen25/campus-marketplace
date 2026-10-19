# UI V1 handoff ? Usual & Unusual

Date: 2026-10-18. Authority: current LOCAL WORKTREE, not only HEAD or GitHub. This is a conditional UI handoff, not a production-readiness certification. Existing unrelated working-tree changes were preserved. No commit/push or production access.

## Scope and actual changes

This final pass changed Profile analytics colors only: selected Overall/Views/Listings/Sold and 1D/7D/30D use #7C3AED with white text; Activity stroke/config/gradient and Marketplace Trends main bar use #7C3AED. `components/home/profile-analytics.tsx` retains all fetches, counts, periods, axes, tooltip, zero/loading/error handling and chart geometry. `components/home/profile.module.css` scopes the selected-color rule to `.analytics .segment`, preserving unrelated `.listingChoices`. No chart recreation, panel remount or business feature implementation.

Final Shop acceptance delta: real Shop cards retain route navigation but do not render a Shop favorite control because no Shop-entity favorite authority exists yet. Demo Shop cards keep local-only favorite state. `ShopProducts` retains its channel/status eligibility guard and bounded page lookahead; the focused discovery suites verify that this does not leak resale, sold, or demo rows into the real Shop product surface.

Separately authorized maintenance: six exact staging seed Listing titles and seven media references migrated to canonical photo bytes. This was explicit user-approved staging maintenance, not a database migration or general media-edit feature. See [exact execution and rollback record](STAGING-TEST-MEDIA-MIGRATION-PLAN.md). Seven original objects and four historical private Order snapshots remain. [Cleanup report](DEMO-IMAGE-CLEANUP-REPORT.md): zero deleted local resources, zero reclaimed bytes; no proven safe obsolete product-illustration deletion candidate.

## Acceptance matrix

A = backend-connected; B = real UI with partial backend; C = local fixture; D = visual shell; E = blocked by missing authority. Source-level review covers all areas below. Fresh browser evidence is distinguished from source review; there was no full authenticated production-like end-to-end certification.

| Module | UI status | Real data status | Business logic status | Known blockers | Next action |
|---|---|---|---|---|---|
| Market Resale | Implemented; fresh actual staging cards checked at five widths | A: SSR/client Listing repository | Existing filters/search/sort/pagination/favorites | Pending seed is intentionally not in public available feed; verified in authenticated owner management | Retain eligibility; add release regression coverage |
| Market Shop mode | Implemented directional content-only switching | B/C mixed sources | No membership inferred from browsing | Public Shop projection is empty stub | Connect authoritative directory after eligibility |
| Recommended Shops | Overlapping carousel UI | C demo profiles | Demo favorite/open state only | Not a recommendation authority | Source real eligible shops later |
| All Shops overview/expanded | 1/2/4-column grid; overview 8 / expanded 16 pagination | C five demo identities, supports injected real props | In-place expansion/filter/sort UI | Only Luna demo has real demo detail; other four Go to shop handlers are no-ops | Resolve demos explicitly; do not claim working destinations |
| Popular Shop Products | Shared real cards, 25-item paging and lookahead | B: channel=shop available query; bounded Luna demo fallback | Existing Listing eligibility, no new ranking backend | Public publication authority fail-closed; no authoritative popularity ranking | Eligibility then real discovery projection |
| Shop Detail | Demo top/header/products/back flow implemented | C Luna; public real route scaffold | Existing shared cards/actions where real | `lib/server/public-shop.ts` returns null, so real Shop route not activated | Implement server public projection |
| Shop card Favorites | Demo-only heart UI; real Shop cards intentionally omit it | C local useState for demos | No persisted Shop-entity favorite service | Demo state is lost on remount/reload; real Shop favorites are unavailable | Separate Shop favorite authority |
| Home Shop Favorites | Implemented shared Favorites page | A Listing favorites scoped channel=shop | Existing Listing favorite authority, NOT shop-entity favorites | Sparse real eligible Shop products | Keep distinction explicit |
| Manage Products | Reuses owner management surface | B owner channel=shop query; demo six products on allowed empty-success path | Owner/update/channel validation exist | Demo rows cannot impersonate persisted products; publication entitlement unavailable | Real eligibility and owner Shop integration |
| Add/Edit Product | Shared ListingForm wizard context | B shared Listing API/repository | Channel immutable; Shop publish fails closed | Shop entitlement/publication authority | Do not bypass for UI demos |
| Shop Plans | Shared PricingCard and ShopPricingDialog implemented | D plan/trial UI | CTAs do not create billing/trial/entitlement | Continue/trial buttons have no authority | Subscription project separately |
| Shop Analysis | Dashboard, tickers, tables, charts and ranges implemented | C `loadShopAnalysisFixture` | Demo local expenses, not persisted ledger | Real authorized projection/expense storage absent | Keep demo labeling; later server authorization |
| Shop profile/settings | Owner API exists; public/demo editors separate | B `/api/shop` owner GET/PATCH | Owner whitelist/auth validation; not activation | UI fixture editor is not real persisted Shop management | Wire owner editor without claiming entitlement |
| Manage Resale | Active/Sold, Filter, creation/Edit modal | A owner query/update | Existing ID-preserving CRUD | No new management change in this pass | Retain approved layout |
| Create/Edit Resale | Shared modal multi-step wizard | A Listing/media APIs | Required Subcategory, Meeting input authority, Delivery UU Pay restriction | Short viewport Review may scroll intentionally | Do not reintroduce rejected scaling fix |
| Resale Favorites | Shared Listing favorites page | A channel=resale | Existing server favorite authority | None newly found in focused coverage | Broaden release E2E later |
| Profile / Account Analytics | Final purple pass verified | A activity API/RPC and category aggregation | Real zero values; no mockTrend replacement | Live account coverage is not exhaustive | Preserve replay and no-skeleton range changes |
| Settings | Existing actions/preferences/financial setup UI | A preferences/account; B provider setup | Optimistic independent preferences; account auth; real SetupIntent/hosted setup | Provider collection/settlement not implemented by setup UI | Preserve existing dialog behavior |
| Buying/Selling Messages | Compact/expanded contact rail, product header and timeline | A conversations/messages | Role and participant authority, Offer lifecycle | Historical full Offer test assertion stale; demo browser tests are controlled | Keep source/layout separate from lifecycle |
| Purchases / Sales | Active/History management UI | A Order repository | Existing participant/status authority | Provider financial execution absent | Payment work against existing domain |
| Order Detail | Stage content/progress and role controls implemented | A authoritative Order/fulfillment APIs | Agreement both-party ack, QR/code, protection/cancellation gates | No real charge/refund/transfer executor | Preserve frozen terms and authoritative transitions |
| QR / manual code | Buyer display / Seller scan+input | A credential/verification authority | TTL/role/idempotency rules exist | Real-device camera verification not rerun here | Device staging acceptance before release |
| Notifications | Dedicated feed/detail/filter/select, realtime/preferences/sound | A API/realtime/outbox foundation | Safe destination resolver, immutable Shop provenance | Email foundation does not certify every production delivery case | Provider deployment/operational testing separately |
| Welcome | Interactive resale/shop/story demos and footer | C/D intentional | No transaction authority | Prototype displays must not be mistaken for real inventory | Preserve demo boundary |
| Mobile navigation | Shared Home destinations and Market tabs | A UI navigation | Existing compatibility section IDs | Full route matrix not authenticated end-to-end this pass | Release navigation suite |

## Shared architecture and conventions

- Listing data: `types/listing.ts`, `lib/supabase/listing-mapper.ts`, `lib/server/supabase-listings-repository.ts`; ready images use persisted Storage paths. No test photo fallback for failed real uploads.
- Cards: PublishedListingCard for actual shared Listing surfaces; Market uses its current ExpandableCard presentation. ListingMedia/ImageSlider own cover/carousel/swipe behavior. Owner-management cards wrap existing identity/actions; Welcome remains an isolated prototype.
- Shop Card presentation is shared across directory/demo surfaces. Shared ShopProBadge is placed on the My Shop parent navigation row, not Shop Analysis child. A label/badge is not subscription authority.
- Motion: existing shared-layout spring pattern; separate Market Resale/Shop content transition and decorative sink/rise background carrier. Do not animate page shell or replace scroll owners. Reduced motion is an existing supported path.
- StatefulButton provides genuine loading/action states. DynamicAction provides arrow animation only; use the actual existing action family appropriate to each flow. Destructive and exit semantics must remain unchanged. ShiningButton and Settings triggers retain local contracts.
- FadingDialog uses native showModal/focus semantics, presence exit, opener focus return and shared reference-counted `utils/dialog-scroll-lock.ts`. Lock snapshots root/body overflow, compensates measured gutter and restores scroll position after last modal releases. Auth outside-dismiss policy is Auth-specific; do not globally alter other dialogs.
- Current Shop Plans dialog uses `components/pricing-card.tsx`, not the older ShopProPricing multi-card implementation. Real UU MarketBrandMark, top-right close, mobile bottom sheet; >=640 centered container with short slide-up; reduced-motion translation disabled. Continue/trial are shell controls, not working purchase actions.

## Color and responsive contract

Primary selected/workflow purple #7C3AED; white selected text. Optional related purple #A78BFA/#DDD6FE only where actually needed. Semantic green/red, pink Favorite hearts and Shop identity are separate. Do not globally replace semantic colors. Shop star token is #FFC83D where present.

Current source discrepancy: `components/listings/market-background.tsx` Shop palette currently reads #00bf6f / #37ff00 / #b6ffd5, not the earlier requested sage palette. This is documented for review; NOT changed during Profile/media scope.

Do not infer one universal grid from one component: current Market infinite grid is 2 columns below640, 3 at640, 4 at1024, 5 at1440. Shop product discovery overrides desktop to5 at1024; All Shops is1/2/4 at640/1024. Owner management/Favorites use their own approved shared rules. Profile changes no sizing/breakpoints. Target viewport matrix:390/430/820/1280/1536, usually900px height. Short-height modal overflow is an accepted fallback, not proof of broken normal desktop geometry.

## Navigation and compatibility

Current `animated-sidebar-demo.tsx` group source: Profile; My Resale -> Manage Resale, Resale Favorites; My Shop PLUS+ -> Manage Products, Shop Favorites, Shop Analysis; Messages -> Buying/Selling; Orders -> Purchases/Sales; Notifications and Settings footer entries. Creation is a page/modal action, not a permanent create child. Preserve internal `my-listings`, `create-listing`, `favorites`, `my-shop`, `create-shop-listing` compatibility where handled. Seller UUID and username public aliases share the authoritative projection; Shop username public route is a separate future eligibility boundary.

Profile currently renders AccountAnalysis within Profile on desktop/mobile (`account-analysis.tsx`); do not rely on older planning text saying there is always a separate Account Analysis navigation destination. Shop Analysis remains its own My Shop destination.

## Data and media audit

Canonical `lib/fixtures/test-pictures.ts` has30 distinct WebP files under public/static/testPic, with SOURCES.md provenance. scripts/lib/test-pictures.cjs adapts the same source for tests/seed uploads. Named demo items use semantic assignments; generic fixture helper is deterministic. No new images were generated in this pass.

Staging migration kept all Listing IDs/owners/prices/categories/channel/status/timestamps and all historical snapshots. Current-title edits regenerate search_text only. Exact verified seed markers/account provenance?not [DEMO] matching?limited the change set. Historical Order synthetic photos are intentional frozen snapshots and are not a failed live-media replacement. Storage deletion requires separate audit/approval and was not performed.

## Validation and evidence

Fresh PASS:
- Application-source TypeScript (ignored dedicated config excludes historical tests/artifacts copies).
- Focused ESLint and tracked/untracked candidate whitespace checks after fixing Windows newline formatting in the touched files.
- account-activity.browser.cjs at all five widths: four metric choices, three periods, selected computed purple, actual Activity stroke/Trends bar token, zero data, contained loading/error/retry, stale response suppression, same panel/control identity,260px chart height and no overflow. Real chart components, controlled API fixture; no claim of real activity totals tested end-to-end.
- account-activity-api, profile-polish-api, shop-profile, listing-channel, order/message/notification-shop-provenance offline tests: all pass; no network.
- Actual staging-backed `/listings`: all five available targeted fixtures at five widths; exact new final URLs, image decode, collapsed/expanded parity, no horizontal overflow. Screenshots `tests/artifacts/staging-market-migrated-<width>.png`; URL evidence JSON. External Google font requests aborted to verify fallback and avoid a readiness stall; no DOM/data override.
- messages-sidebar-layout browser: PASS at all five widths, both motion modes, Buying/Selling, no remount/draft/scroll loss, controls/media/send/attachments. Canonical photo browser: PASS at all five widths across Market/Shop/owner/Messages/Sales/Purchases/Order Detail; no broken demo images or overflow. These are controlled component/browser tests, not live staged transactions.
- order-management browser: PASS at all five widths in reduced/normal motion, Purchases/Sales classification, image rendering, detail/back, loading/error and perspective isolation.
- Pending Canvas Sneakers image: PASS authenticated owner Manage Resale at all five widths, exact new Storage path decodes, no overflow, pending state untouched. Public direct detail remains inaccessible as before. Owner Selling/Sales pages loaded read-only; this is not an assertion that every live historical Order detail image path was browser-exercised.

The prior Shop return-scroll assertion concern is resolved by the current focused run; no Shop scroll implementation change was needed.

Current focused rerun: `shop-discovery.browser.cjs`, `shop-marketplace-browsing.browser.cjs`, `all-shops-grid.browser.cjs`, and `public-shop.browser.cjs` pass at 390/430/820/1280/1536 in their covered motion modes. The public-shop test now asserts the intentional local demo-directory behavior when no real Shops are injected and the existing five-column desktop Shop page contract.

Remaining validation limitations: full messages-offer-correction expects old Buyer service fee copy; home-three-ui legacy webpack harness cannot compile the current Radix collection dependency static class block; `hero-parallax.tsx` has two non-blocking index-key warnings. TypeScript, full ESLint, and `next build` now pass. The production build also reports existing Browserslist staleness and Autoprefixer mixed-support warnings. Tests/profile-chart-replay.browser.cjs requires a live authenticated Home test environment; dedicated offline analytics test exercises actual replay/state conditions, but does not replace complete live navigation replay acceptance. The live replay test still expects the older Analysis navigation destination and inactive Shop analysis absence, while the current UI renders AccountAnalysis within Profile and a visible fixture Shop dashboard; inspect/update that test in a separate compatibility pass.

## Remaining issues by priority

1. Release blocker: no real provider payment/refund/transfer/payout executor; real financial rollout must not use staging simulated outcomes.
2. Product blocker: Shop entitlement/subscription/public eligibility authority absent; public Shop projection empty; four demo Go to shop actions no-op. Never claim active paid Shops.
3. Validation debt: unrelated full-lint/build errors and stale legacy suites remain separate from the passing Shop acceptance set.
4. Demo boundary: Shop-entity hearts and Shop Analysis/expenses remain local; Shop Favorites navigation is product Listing favorites, not shop subscriptions/follows.
5. Visual discrepancy: current Shop wave palette differs from prior sage request; separate decision/fix.
6. Acceptance coverage: full live Order consumer image flow and camera hardware checks not fully certified here; public available Market and frozen snapshot data invariants verified.
7. Test debt: stale assertions/legacy dependency loader failures above. Keep separate from application regressions.

UI is ready for continued targeted business implementation with these explicit conditions, not a claim of100% functional completeness. The roadmap below is plan-only: [BUSINESS-IMPLEMENTATION-ROADMAP.md](BUSINESS-IMPLEMENTATION-ROADMAP.md).

Fresh Welcome test limitation: welcome-demo-cards.browser.cjs fails before browser rendering because it byte-compares market-listing-feed.tsx to HEAD. The current worktree already contains the approved MarketPagination extraction. This is a stale baseline assertion caused by prior completed work, not a reason to revert the shared pagination or change Welcome during this pass. No assertion was skipped or edited to claim a pass.

Additional current fixture/test boundary: the staging seed script now creates approved photo-matching titles without [DEMO], preserving its legacy description identity lookup to avoid duplicates. Existing exact-title consumers formal-ui-recovery.browser.cjs and order-manual-fixture-staging.cjs still name the old monitor/textbook titles; they were not silently updated or run against mutated expectations. Update those fixtures explicitly before the next live staging scenario. Notification preferences browser also PASS at all five widths: optimistic nonblocking/latest-intent queue, independent concurrent saves, stale-response protection, isolated failure rollback and reload persistence.

## Exact final-pass local files

components/home/profile-analytics.tsx; components/home/profile.module.css; tests/account-activity.browser.cjs; scripts/staging-demo.cjs; docs/UI-V1-HANDOFF.md; docs/BUSINESS-IMPLEMENTATION-ROADMAP.md; docs/DEMO-IMAGE-CLEANUP-REPORT.md; docs/STAGING-TEST-MEDIA-MIGRATION-PLAN.md; docs/test-image-audit.md. Ignored local operation SQL/backups/browser screenshots/receipts remain under tests/artifacts; no credentials/environment file was modified. These are this pass's changes, not a claim that the entire previously dirty worktree contains only these files.
