> 2026-10-18 execution update: the user subsequently approved the exact six staging seed Listing photo/title migration. Seven new WebP objects are attached; originals and four frozen Order images remain retained. Current public Market checks passed at all five widths for the five available seed Listings; the sixth remains pending. See [execution/rollback audit](STAGING-TEST-MEDIA-MIGRATION-PLAN.md) and [local cleanup report](DEMO-IMAGE-CLEANUP-REPORT.md). Statements below describing staging as unmodified are the earlier pre-approval checkpoint.

# Completion pass: 30-photo registry and remaining staging boundary

Current local-worktree follow-up, 2026-10-18. The earlier 20-photo implementation was incomplete. The report below distinguishes local repair from persisted staging media; it does not claim staging was migrated.

## Confirmed root causes

1. `components/shops/recommended-shops-demo.ts` omitted `image` for `demo-tech` and `demo-story`. `ShopCardPresentation` correctly rendered its real-user `UserAvatar` fallback, producing giant C/S covers. The fixture data now requires and supplies photographic covers. No real-user fallback component changed.
2. `/listings` supplies server Listing DTOs, not `marketPreviewListings`. `mapListing` maps ready `listing_images.path` directly to public Storage URLs. Therefore editing a local registry cannot replace images already uploaded to staging.
3. `scripts/staging-demo.cjs` only uploads photos for unpublished drafts. The six known marked fixtures were published on 2026-10-09, before the prior photo pass. Re-running its existing seed would reuse them and skip their old media. Browser cache is not the cause: direct GET of all seven ready public objects returned HTTP 200; the monitor still visibly contains "STAGING DEMO / Synthetic illustration / Not for sale".
4. Some specifically named local products used generic hash selection or a single jewelry image. A bigger pool does not make these assignments semantic. All named application fixtures now use explicit photo keys. The user authorized changing LOCAL demo names/descriptions to match the real photographed subjects; persisted records/titles remain unchanged.

## Canonical library and scope

Exactly 30 distinct WebP files remain under `public/static/testPic/`; the original 20 usable photos are retained. The only registry remains `lib/fixtures/test-pictures.ts`; its ordered pool is deterministic, with no render-time randomization or runtime stock-site hotlinking. `SOURCES.md` records source pages/photographers/license for all 30. The ten additions are workspace, bookshelf, clothing display, stationery, crochet bunny, phone case, candle, tote bag, beaded accessories and decorative tray. The full 30-image contact sheet was visually inspected; images are real photographs with preserved aspect ratios and no synthetic product drawings.

Known-product fixture construction now uses explicit semantic assignments rather than generic pool fallback in `market-layout.ts`, `hero-parallax-demo-products.ts`, `listings.ts`, `shop-analysis-fixture.ts` and `shop-demo-data.ts`. Compatibility IDs, prices, lifecycle/status fields and UI geometry are preserved. Generic test entities may still use the deterministic helper. Local Market titles have no `[DEMO]` prefix; there is no global title stripping. Historical staging `[DEMO]` titles are deliberately untouched.

| Demo Shop ID | Shared cover (Recommended + All Shops) |
| ------------ | -------------------------------------- |
| demo-luna    | jewelry.webp                           |
| demo-maple   | chair.webp                             |
| demo-tech    | workspace.webp                         |
| demo-story   | bookshelf.webp                         |
| demo-thread  | clothing-display.webp                  |

Shop Detail and Manage Products continue to import the SAME `demoShopProducts`, including chair, beaded accessories, necklace, crochet bunny, phone case and tote. Welcome chair uses the same chair photo; Welcome Shop uses Luna's same cover. Technical tests that intentionally assert malformed encodings, exact pixel/aspect specimens, avatar input validation, or error handling remain technical specimens, not a demo product-image fallback. Ordinary visual test Listing/message fixtures are migrated to canonical serialized photo bytes through `scripts/lib/test-pictures.cjs`.

## Read-only staging evidence and blocker

Project inspected: `pcaqxezdfxofysghssyo` only. Six exact IDs were read from the existing seed state and checked in a read-only SQL transaction; every row has the `campus-marketplace-staging-demo-v1:<key>` description marker and the expected seeded seller. No DB/Storage write or production access occurred.

| Seed key   | Listing ID                           | Canonical replacement proposed (not executed) |
| ---------- | ------------------------------------ | --------------------------------------------- |
| lamp       | 5e1234d0-0f67-4af1-a036-0c18e4a8693a | desk-lamp.webp                                |
| textbook   | 82680659-1f93-405c-a0b6-cebe52011498 | textbook.webp                                 |
| macbook    | 90d144b0-7bf1-4e1e-9b63-8aa5c4b3ce60 | laptop.webp (2 slots)                         |
| monitor    | cbbc071e-4ea5-447e-b048-e700187234f9 | monitor.webp                                  |
| nike       | d5fcc2b1-2369-4757-b604-cd98f1f0e650 | sneakers.webp                                 |
| controller | f0629930-524c-452c-91e4-c47a3a231ae6 | controller.webp                               |

Ready legacy object paths use `<seed seller UUID>/<Listing UUID>/<image UUID>`, not `/static/testPic/`. Exact paths, public URLs and read-only downloads are in ignored `tests/artifacts/demo-media-staging-readonly.json` and `tests/artifacts/staging-legacy-photo-report.json`. These old Storage objects are retained. No synthetic physical product assets were found in public to delete. Old stock/category banner assets remain for unrelated legacy consumers, not named demo products.

A separately authorized fixture-only operation is required to change visible staging cards: verify exact project, seller ownership, ID and marker again; inventory every current object and frozen snapshot reference; replace only those demo image objects with mapped photo bytes using correct content types/cache handling; validate live listing media and independently retained Order snapshots. Do not run the broad seed/reset or mutate transaction snapshots blindly. Real uploaded media is outside this operation. Current seeded product names can name specific models not established by illustrative stock photos (e.g. PS5 versus generic controller); exact model accuracy must be reviewed before that separate staging update. Existing snapshots/history are not rewritten here.

## Exact legacy staging media paths (read-only)

These exact existing paths were read and fetched successfully; none were overwritten.

| Listing | Ready object path |
| --- | --- |
| `5e1234d0-0f67-4af1-a036-0c18e4a8693a` | `2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2/5e1234d0-0f67-4af1-a036-0c18e4a8693a/358a65e8-e50a-4c6b-9885-1e23f364035e` |
| `82680659-1f93-405c-a0b6-cebe52011498` | `eb0fc272-b774-4253-af20-dd53713222a0/82680659-1f93-405c-a0b6-cebe52011498/8a4fe4e0-227d-4e69-ae4b-fdb43b1dd0ba` |
| `90d144b0-7bf1-4e1e-9b63-8aa5c4b3ce60` | `2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2/90d144b0-7bf1-4e1e-9b63-8aa5c4b3ce60/d5ccc0b1-8ce9-4e3c-9fd0-6d9b509c821d` |
| `90d144b0-7bf1-4e1e-9b63-8aa5c4b3ce60` | `2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2/90d144b0-7bf1-4e1e-9b63-8aa5c4b3ce60/e1275464-4f5e-426e-b39c-375a54c2eb2d` |
| `cbbc071e-4ea5-447e-b048-e700187234f9` | `eb0fc272-b774-4253-af20-dd53713222a0/cbbc071e-4ea5-447e-b048-e700187234f9/2d7be7e6-58dd-4d66-8df2-05591dc38e8e` |
| `d5fcc2b1-2369-4757-b604-cd98f1f0e650` | `2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2/d5fcc2b1-2369-4757-b604-cd98f1f0e650/f912e481-566c-4a6d-b6f7-7f250289285e` |
| `f0629930-524c-452c-91e4-c47a3a231ae6` | `eb0fc272-b774-4253-af20-dd53713222a0/f0629930-524c-452c-91e4-c47a3a231ae6/6deb87ab-8c38-4586-bdd3-506ec469785e` |

## Browser evidence / validation

`tests/test-pictures.browser.cjs` renders actual MarketLayout local fixtures, Shop Directory/Recommended/Detail, Manage Products empty-success demo path, Welcome Listing/Shop and the real shared Listing/Favorites/Messages/Order list/Detail consumers. It checks actual final `img.src`, image decoding and overflow at 390 / 430 / 820 / 1280 / 1536. The same chair/monitor/laptop fixture ID retains identical image source across Market/expanded/Favorites/owner/Messages/Sales/Purchases/Order Detail. Failed real upload URLs remain unchanged rather than falling back to testPic.

Ignored browser artifacts: `tests/artifacts/message-payload-qualification/rendered-photo-evidence.json`, `migrated-market-<width>-page-<page>.png`, `migrated-recommended-<width>.png`, `canonical-photo-pool-<width>.png`. These show LOCAL fixture repairs; they do not prove staging old media changed. Additional focused browser regressions and static validation results are recorded after execution below.

## Final validation results (2026-10-18 completion pass)

- `tests/test-pictures.cjs`: PASS, exactly 30 distinct, normalized, provenanced WebP photos; semantic fixture/registry checks and real-upload/empty-state guards.
- `tests/test-pictures.browser.cjs`: PASS at 390 / 430 / 820 / 1280 / 1536. All 30 Market fixtures checked, including both desktop pages; all 30 assets decoded at each width. Final rendered-src evidence contains 340 entries. Three shared fixture identities retain identical photos across Market/expanded/Favorites/owner/Messages/Sales/Purchases/Order Detail. Shop covers match between Recommended and All Shops. No horizontal overflow or broken demo image; failed real-upload URLs remain unchanged.
- Focused browser regressions PASS: Manage Products (all five widths), Welcome cards (all five, normal/reduced motion), Shop Detail (all five, normal/reduced), homepage Marketplace story (all five, normal/reduced), Listing actions, Offer Detail scrolling, Message image actions, Gallery scroll restoration (single/multiple images, normal/reduced), Market shared-layout motion (all five).
- Supplemental regressions: `messages-offer-correction.browser.cjs:559` still expects old `Buyer service fee` wording; `home-three-ui.browser.cjs` cannot compile the current Radix collection dependency static class block in its legacy webpack harness. The public Shop suite now passes after its stale demo-directory and desktop-column assertions were aligned with the current approved behavior. No product behavior or unrelated assertions/loaders were weakened.
- The new photo browser test's scroll mock now returns stable callback identities, matching the real hook; an unstable mock had reset desktop pagination to page 1. The test waits for the next page's rendered image before inspecting it. Application pagination is untouched.
- Application-source TypeScript: PASS (temporary ignored config excludes historical test/artifact copies). Focused ESLint: PASS for all 24 touched source/test files. Tracked diff whitespace: PASS. Full candidate-set text whitespace check, including untracked files: PASS (36 completion-pass files, binary photos excluded from text checking).
- Actual 1280 Market and Recommended/All Shops screenshots were inspected after the final run. All five widths have screenshot/src evidence under the ignored artifact paths listed above.
- Remaining external-data prerequisite: separately authorize a narrowly scoped update of the six marked staging fixtures / seven existing Storage objects listed above. None were changed here. No real uploaded media, database schema, production, commit or push.

## Full canonical 30-entry registry (completion pass)

| Semantic key      | Local public source                     |
| ----------------- | --------------------------------------- |
| `chair`           | `/static/testPic/chair.webp`            |
| `deskChair`       | `/static/testPic/desk-chair.webp`       |
| `deskLamp`        | `/static/testPic/desk-lamp.webp`        |
| `monitor`         | `/static/testPic/monitor.webp`          |
| `textbook`        | `/static/testPic/textbook.webp`         |
| `controller`      | `/static/testPic/controller.webp`       |
| `laptop`          | `/static/testPic/laptop.webp`           |
| `headphones`      | `/static/testPic/headphones.webp`       |
| `backpack`        | `/static/testPic/backpack.webp`         |
| `sneakers`        | `/static/testPic/sneakers.webp`         |
| `keyboard`        | `/static/testPic/keyboard.webp`         |
| `mouse`           | `/static/testPic/mouse.webp`            |
| `speaker`         | `/static/testPic/speaker.webp`          |
| `camera`          | `/static/testPic/camera.webp`           |
| `bicycle`         | `/static/testPic/bicycle.webp`          |
| `calculator`      | `/static/testPic/calculator.webp`       |
| `mug`             | `/static/testPic/mug.webp`              |
| `plant`           | `/static/testPic/plant.webp`            |
| `jacket`          | `/static/testPic/jacket.webp`           |
| `jewelry`         | `/static/testPic/jewelry.webp`          |
| `workspace`       | `/static/testPic/workspace.webp`        |
| `bookshelf`       | `/static/testPic/bookshelf.webp`        |
| `clothingDisplay` | `/static/testPic/clothing-display.webp` |
| `stationery`      | `/static/testPic/stationery.webp`       |
| `crochetBunny`    | `/static/testPic/crochet-bunny.webp`    |
| `phoneCase`       | `/static/testPic/phone-case.webp`       |
| `candle`          | `/static/testPic/candle.webp`           |
| `toteBag`         | `/static/testPic/tote-bag.webp`         |
| `bracelet`        | `/static/testPic/bracelet.webp`         |
| `decorativeTray`  | `/static/testPic/decorative-tray.webp`  |

## Exact files changed by this completion pass

```text
lib/fixtures/test-pictures.ts
lib/fixtures/market-layout.ts
lib/fixtures/hero-parallax-demo-products.ts
lib/fixtures/listings.ts
lib/fixtures/homepage-listing-demo.ts
lib/fixtures/shop-analysis-fixture.ts
components/shops/shop-demo-data.ts
components/shops/recommended-shops-demo.ts
components/listings/homepage-listing-demo.tsx
public/static/testPic/SOURCES.md
docs/test-image-audit.md
public/static/testPic/workspace.webp
public/static/testPic/bookshelf.webp
public/static/testPic/clothing-display.webp
public/static/testPic/stationery.webp
public/static/testPic/crochet-bunny.webp
public/static/testPic/phone-case.webp
public/static/testPic/candle.webp
public/static/testPic/tote-bag.webp
public/static/testPic/bracelet.webp
public/static/testPic/decorative-tray.webp
tests/test-pictures.cjs
tests/test-pictures.browser.cjs
tests/homepage-marketplace-story.browser.cjs
tests/welcome-demo-cards.browser.cjs
tests/shop-detail-demo.browser.cjs
tests/manage-products.browser.cjs
tests/published-listing-card.browser.cjs
tests/home-three-ui.browser.cjs
tests/listing-actions.browser.cjs
tests/listing-layout-motion.browser.cjs
tests/messages-offer-correction.browser.cjs
tests/offer-detail-scroll.browser.cjs
tests/public-shop.browser.cjs
tests/message-image-actions.browser.cjs
tests/gallery-scroll-audit.browser.cjs
```

Ignored SQL/read-only/download/browser artifacts are evidence only and not shipped. No environment file, production code mapper, API, database schema, upload/delete implementation, card layout/CSS, carousel animation, navigation or gradient palette was changed by this image completion pass.

---

# Demo/test product-image audit

Audited the current LOCAL working tree on 2026-10-18, before replacing image paths. Existing unrelated uncommitted changes were preserved. This is a fixture-media cleanup, not a card redesign or hosted-data rewrite.

## Surface and card/data map (before migration)

| Surface                                               | Actual components / card reuse                                                                                     | Data / fixture source                                                                | Image field and previous source                                                                            | Type / shared identity                                                 | Action                                                                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Marketplace real listings / expanded listing          | `market-layout.tsx`, `PublishedListingCard`, `ListingCardSummary`, `ListingMedia`, `ImageSlider`, `ExpandableCard` | `getPublicListings` / supplied Listing rows; mapper `lib/supabase/listing-mapper.ts` | `Listing.photoUrls` -> adapter `images`; ready `listing_images` -> `publicImageUrl(path)`                  | Real uploaded media                                                    | Preserve completely, including empty/missing-media behavior                                                                                              |
| Marketplace local layout preview                      | `MarketCard` in `market-layout.tsx` -> `ExpandableCard` / `ListingMedia`                                           | `lib/fixtures/market-layout.ts`, explicit `market-preview-*` IDs                     | All 30 entities used `/demo/reading-chair.jpg`                                                             | One local photo incorrectly shared by unrelated products               | Explicit index-to-semantic registry mapping, deterministic pool for unmatched subjects                                                                   |
| Favorites / Resale Favorites / Shop Favorites         | `favorites.tsx` -> `PublishedListingCard`                                                                          | `getFavoriteListings({channel,...})`                                                 | `Listing.photoUrls`                                                                                        | Same real Listing identity as Market                                   | No component or API changes; test DTOs supply fixture photos                                                                                             |
| Manage Resale                                         | `home-listings.tsx` -> `ResaleManagementCard` / `ListingMedia`                                                     | `getMyListings({channel:'resale'})`                                                  | `Listing.photoUrls`                                                                                        | Real owner records                                                     | Preserve uploaded media                                                                                                                                  |
| Manage Products                                       | same `HomeListings` -> same `ResaleManagementCard`                                                                 | Shop query; existing explicit empty-success-only `demoShopProducts.slice(0,6)` seam  | `Listing.photoUrls`; demo rows in `components/shops/shop-demo-data.ts` used chair + clothing/banner photos | Local demo products are reused by Shop Detail                          | Change dataset only, preserve guards and real-record priority                                                                                            |
| Shop Directory / Recommended Shops                    | `shop-directory.tsx`, `ShopDirectoryWorkspace`, `RecommendedShopsSlider`, `ShopCardPresentation`                   | Real Shop previews plus `recommended-shops-demo.ts` / `lunaStudioDemo`               | Real `imageUrl                                                                                             |                                                                        | avatarUrl`; demo `image` used old banners/chair or initials                                                                                              | Shop covers/avatars are distinct from product identities; Luna shared with Welcome/Detail | Preserve real covers/avatars; demo photographic covers reuse registry, not brand/logo replacement |
| Shop Detail products                                  | `shop-detail-demo.tsx` -> `DemoListingCard`                                                                        | same `demoShopProducts`                                                              | same `listing.photoUrls` as Manage Products                                                                | `local-demo-luna-product-*` identity                                   | Keep exact dataset sharing                                                                                                                               |
| Public Seller / public Shop                           | `pages/seller/[id].tsx`, public Shop components, `PublishedListingCard`                                            | existing public seller/shop projection                                               | real Listing `photoUrls`, seller/shop avatar fields                                                        | Real public projections                                                | Untouched                                                                                                                                                |
| Welcome Listing / From listing to exchange            | `HomepageListingDemo` -> `ExpandableCard` / `ListingMedia`; `HomepageMarketplaceStory` -> `ListingCardPreview`     | `lib/fixtures/homepage-listing-demo.ts`                                              | `photoUrls: ['/demo/reading-chair.jpg']`                                                                   | Woven accent chair also first local Luna product                       | Both use registry `chair`; no layout/heart/video changes                                                                                                 |
| Welcome Shop                                          | `WelcomeShopDemoCard` -> `ShopCardPresentation`                                                                    | inline Luna visual duplicated shop cover                                             | `/static/images/banners/accessories-women-desktop.jpg`                                                     | Same demo Luna as Directory/Detail                                     | Reuse existing Luna fixture image, preserve card structure                                                                                               |
| Development hero products                             | `pages/index.tsx` -> `HomepageScene` / hero parallax                                                               | `lib/fixtures/hero-parallax-demo-products.ts`                                        | five old retail banner paths rotated over 21 items                                                         | Separate `visual-demo-*` entities                                      | Semantic per-index assignment / deterministic pool                                                                                                       |
| General development listings                          | no active runtime import of `listingFixtures` found                                                                | `lib/fixtures/listings.ts`                                                           | 10 empty `photoUrls` arrays                                                                                | Explicit `student-*` fixtures; not real records                        | Assign photos at fixture construction only                                                                                                               |
| Shop Analysis                                         | `ShopAnalytics` product table                                                                                      | `lib/fixtures/shop-analysis-fixture.ts`                                              | five embedded colored SVG bag-like placeholders                                                            | `demo-shop-*` analysis products; orders retain product.image           | Assign once at product fixture definition, retain aggregation/data logic                                                                                 |
| Messages listing preview / View Listing / Offer media | `MessagesListingPreview`, `OfferMedia`, `ListingMedia`, `ExpandedCardPreview`                                      | conversation listing snapshot / live Listing; message API                            | `ChatListing.photoUrls`; snapshot/live media as projected                                                  | Real Listing identity retained through conversation/offer snapshots    | No runtime remapping/fallback; offline fixture inputs migrate                                                                                            |
| Sales / buyer Orders / Order-list cards               | `Orders`, `FormalOrders` -> `OrderListCard` -> `ListingMedia`                                                      | local visual snapshots or `useFormalOrders` real DTOs                                | `order.snapshot.listing.photoUrls`                                                                         | Same frozen Listing snapshot passed to Detail                          | Preserve all status/classification/permission logic; migrate offline DTO photo definitions                                                               |
| Order Detail / Agreement                              | `FormalOrderDetail`, `FormalV2OrderDetail`, `OrderStageDetails`, `OrderDetailPreview` -> `ListingMedia`            | same Order snapshot                                                                  | `snapshot.listing.photoUrls`                                                                               | Shared with list, not independently chosen by view                     | Keep snapshot authority untouched                                                                                                                        |
| Notifications                                         | `NotificationsView` / detail dialog                                                                                | notifications provider/feed                                                          | No product-thumbnail field/rendering in current list/detail                                                | Semantic icons only                                                    | No change                                                                                                                                                |
| Staging demo seed                                     | `scripts/staging-demo.cjs`; wrapper `tests/staging-demo.cjs`                                                       | six explicit catalog keys; test-owned rows                                           | `image(item,variant)` generated six product SVG illustrations, converted to PNG then uploaded              | Snapshot propagation already preserves uploaded listing image identity | Replace generation with local registry photo bytes for FUTURE seed runs only; do not run hosted seed or rewrite existing stored snapshots                |
| Offline/browser fixtures                              | `tests/*.browser.cjs`, `tests/order-flow-ui.browser.cjs`, existing fixture builder/mocks                           | explicit synthetic DTOs / generated entry files                                      | chair path, banner path, data-URI SVG rectangles, 1px PNGs, example URLs                                   | Many independent test-only entities                                    | Migrate reusable photographic product fixtures; keep intentionally technical image specimens where exact aspect/encoding/error behavior is the assertion |

All component basenames above are under `components/listings`, `components/home`, or `components/shops` as appropriate; no invented card abstraction was introduced.

## Card reuse / identity boundaries

- Real cards: `PublishedListingCard` (Market/Favorites/public seller), `ResaleManagementCard` (owner Resale/Shop management). Both reuse `ListingCardSummary`, `ListingMedia`, and the existing expanded-card machinery.
- Local visual cards: `DemoListingCard` serves Shop demo products. Welcome `HomepageListingDemo` and Market local `MarketCard` separately reuse `ExpandableCard` / `ListingMedia`; the Welcome story uses `ListingCardPreview`. These remain separate from live Favorite/mutation authority.
- Shop covers: `ShopCardPresentation` (Welcome/Directory/recommended/detail profile) is not a Listing card. Actual Shop images/avatars and logos remain real metadata.
- Orders: shared `OrderListCard` reads frozen snapshot media; Detail reads the same snapshot. Messages reads its existing conversation Listing projection. Views must never substitute fixture photos for failed real media.
- There is NO single built-in local Listing ID that already spans Market + Favorites + Messages + Order. Those live surfaces are server-data driven. Cross-surface test coverage must deliberately pass the SAME fixture/snapshot, not invent ID equality between unrelated demo rows.

## Asset inventory and deletion policy

Before cleanup there were 43 physical image assets under public; SHA-256 scan found no byte-identical duplicates. `/demo/reading-chair.jpg` was the only general-purpose dedicated local demo photo. The legacy retail banners are separate originals, not exact duplicate fixture copies. Desktop/mobile banner pairs are intentional responsive crops (near-duplicates), retained for the legacy CLI/category configuration and kit consumers; they are not independent product-fixture photo copies. Their consumers were checked before deletion decisions. Logos, avatars, QR assets, notification icons and decorative backgrounds are excluded.

The staging six-product synthetic drawings existed in source, not as reusable physical public files. Analysis placeholders also existed as inline source strings. No physical generated monitor/lamp/controller product files were found in public. Ignored browser artifacts/build outputs are not reusable assets and will not be mass-rewritten/deleted.

## Visible [DEMO] audit (before changes)

- `scripts/staging-demo.cjs`: stored title prefix `[DEMO] ${title}` for six staging-owned catalog rows. Ownership uses explicit app metadata / description markers, not title inference. Keep the prefix and ownership guards.
- `tests/formal-ui-recovery.browser.cjs`: expects `[DEMO] 24-inch Monitor` and `[DEMO] Calculus Textbook` in existing staging records. Keep.
- `tests/order-manual-fixture-staging.cjs`: stored/manual-fixture reference `[DEMO] 24-inch Monitor`. Keep.
- No frontend component appends `[DEMO]` to real titles. Other visible Demo/sample badges and explicit non-transactional copy remain.

## Planned canonical media boundary

`public/static/testPic/` owns 20 local photographic files and `SOURCES.md`; `lib/fixtures/test-pictures.ts` owns all public paths. Semantic mapping is explicit at fixture construction. Generic assignment accepts an explicit stable fixture ID (never a title and never Math.random). Browser/seed CommonJS tooling loads the same TypeScript registry through a small test-only bridge rather than duplicating a path map. Real mappers, media components, APIs, upload behavior, snapshots and business authority remain unchanged.

## Additional whole-project findings

- Messages attachment Gallery/Full Image Viewer uses attachment `previewUrl` / existing signed media, not Listing product photography; no attachment payload, lifecycle, gallery or viewer change was made.
- Create/Edit preview continues to use `ListingForm`'s actual pending object URLs / current `Listing.photoUrls`; no test-picture fallback was added to an upload draft.

- `pages/listings/[id].tsx` is the existing canonical standalone Listing page, using `ProductImage` (`components/product/product-image.tsx`, Next Image) for `listing.photoUrls`. It is not a separate fixture registry and is untouched.
- The legacy retail/Algolia `cli/data/products_dataset.json` and configuration remain separate from UU Listing DTOs. Category banner URLs in `cli/data/products_configuration.json`, plus `pages/kit/banners.tsx` importing `public/static/images/home/banner.jpg`, still explain the retained retail banner assets. They are not copied into the new fixture pool or rewritten as Shop inventory.
- `components/ui/Lanyard.jsx` retains its 1px texture fallback: UI/3D asset, not a product photo.
- Error/empty-media, uploaded attachment, QR, avatar, format-sniffing and extreme-ratio SVG fixtures remain technical test inputs. They must not be mistaken for reusable photographic product assets.

## Completed migration

Canonical public paths now live ONLY in `lib/fixtures/test-pictures.ts`. The 20 entries are `chair`, `deskChair`, `deskLamp`, `monitor`, `textbook`, `controller`, `laptop`, `headphones`, `backpack`, `sneakers`, `keyboard`, `mouse`, `speaker`, `camera`, `bicycle`, `calculator`, `mug`, `plant`, `jacket`, `jewelry`. Jewelry is the permitted substitution for the miscellaneous twentieth subject, supporting the existing Luna demo cover/products.

All 20 files are WebP, long edge 1440px, quality 83, with orientation normalized and no upscaling. Filename, human-readable Pexels source page, photographer and local dimensions/size are recorded individually in `public/static/testPic/SOURCES.md`. The 20-photo contact sheet was inspected: photographic subjects, no watermarks or generated illustrations.

Migrated application fixture datasets:

- `lib/fixtures/listings.ts`: explicit `student-*` mapping.
- `lib/fixtures/market-layout.ts`: semantic index mapping; generic stable-ID assignment for subjects absent from the pool.
- `lib/fixtures/homepage-listing-demo.ts`: chair; Welcome story inherits the same object.
- `lib/fixtures/hero-parallax-demo-products.ts`: semantic index mapping plus deterministic generic assignment.
- `lib/fixtures/shop-analysis-fixture.ts`: product-level image assignment, inherited by its orders/calculation projections; removed embedded synthetic bag graphics.
- `components/shops/shop-demo-data.ts`: one product dataset for Manage Products and Shop Detail; the first chair shares the Welcome photo. Luna's cover is shared by Welcome/Directory/Detail.
- `components/shops/recommended-shops-demo.ts`: photographic demo covers use canonical assets; real Shop logos/avatars untouched.
- `scripts/staging-demo.cjs`: removed six SVG illustration generators; future seed image uploads transcode the selected canonical photo to the existing PNG upload format. Existing hosted rows/frozen snapshots are NOT rewritten and this script was NOT run.

### Cross-surface image identity

Identity is assigned in data, never inferred from title text. Known product mappings use `TEST_PICTURES.*`; generic fixture namespaces use `testPictureForFixture(stableId)` (integer polynomial hash modulo the fixed 20-element pool). The same ID returns the same path on reload/SSR; no Math.random. Real Listings never call this function.

`tests/test-pictures.browser.cjs` passes the SAME fixture Listing/photo through actual Market-style `PublishedListingCard`, expanded media, Favorites, owner `ResaleManagementCard`, Messages preview, Sales/Orders `OrderListCard`, and real `FormalOrderDetail`. It checks exact src identity and decoded images for chair, monitor and laptop at all five widths. This deliberately verifies propagation rather than falsely asserting separate existing demo IDs are one entity.

### Node/browser test tooling

`scripts/lib/test-pictures.cjs` is a Node-only adapter that transpiles the SAME canonical TypeScript registry, with no duplicate path table. Offline file:// component harnesses may serialize those exact bytes as a WebP data URI. Existing synchronous JPEG upload/snapshot tests use an in-memory JPEG transcode helper (cached per process); no extra physical test photo copies are generated. Controlled HTTP browser harnesses serve normal `/static/testPic/` URLs with WebP MIME types.

### Cleanup result and retained assets

- Deleted `public/demo/reading-chair.jpg` only after all executable repository references were migrated. There are no remaining runtime/test references outside historical documentation or ignored generated artifacts.
- Removed synthetic staging product SVG generation and Analysis inline product illustrations from source. There were no dedicated physical synthetic product image files to delete.
- No physical duplicate photo sets found by SHA-256. All 20 new assets have distinct hashes.
- Retained retail banners/home banner for the explicit legacy CLI/category/kit references above; retained UU branding, icons, QR assets, avatars and decorative UI art.
- Kept all visible `[DEMO]` sources listed above. No global title cleanup or title-prefix-based authority was introduced.
- Existing persisted staging demo images remain unchanged because this pass authorizes no DB/data writes. Future runs of the existing explicit seed use photographs; refreshing those hosted fixtures would be a separate authorized data operation.

## Validation

See `tests/test-pictures.cjs` for 20-file/registry/provenance/unique-hash/determinism/semantic mapping and real Listing mapper regression. A real upload URL remains unchanged on decode failure; empty real Listing media remains empty. Browser checks use only offline/local fixture transport, never production or staging writes.

## Exact cleanup file scope

The following 70 paths belong to this pass; existing unrelated dirty worktree files are not included. `public/demo/reading-chair.jpg` was deleted. The testPic photos, registry, adapter, audit and two test-pictures suites are new. Other paths are fixture references/asset-routing adaptations.

- `components/listings/welcome-shop-demo-card.tsx`
- `components/shops/recommended-shops-demo.ts`
- `components/shops/shop-demo-data.ts`
- `docs/test-image-audit.md`
- `lib/fixtures/hero-parallax-demo-products.ts`
- `lib/fixtures/homepage-listing-demo.ts`
- `lib/fixtures/listings.ts`
- `lib/fixtures/market-layout.ts`
- `lib/fixtures/shop-analysis-fixture.ts`
- `lib/fixtures/test-pictures.ts`
- `public/demo/reading-chair.jpg`
- `public/static/testPic/SOURCES.md`
- `public/static/testPic/backpack.webp`
- `public/static/testPic/bicycle.webp`
- `public/static/testPic/calculator.webp`
- `public/static/testPic/camera.webp`
- `public/static/testPic/chair.webp`
- `public/static/testPic/controller.webp`
- `public/static/testPic/desk-chair.webp`
- `public/static/testPic/desk-lamp.webp`
- `public/static/testPic/headphones.webp`
- `public/static/testPic/jacket.webp`
- `public/static/testPic/jewelry.webp`
- `public/static/testPic/keyboard.webp`
- `public/static/testPic/laptop.webp`
- `public/static/testPic/monitor.webp`
- `public/static/testPic/mouse.webp`
- `public/static/testPic/mug.webp`
- `public/static/testPic/plant.webp`
- `public/static/testPic/sneakers.webp`
- `public/static/testPic/speaker.webp`
- `public/static/testPic/textbook.webp`
- `scripts/lib/test-pictures.cjs`
- `scripts/staging-demo.cjs`
- `tests/action-footer-reference.browser.cjs`
- `tests/content-loading-spinner.browser.cjs`
- `tests/create-success.browser.cjs`
- `tests/home-content-loading.browser.cjs`
- `tests/homepage-marketplace-story.browser.cjs`
- `tests/homepage-shop-demo.browser.cjs`
- `tests/listing-creation-sheet.browser.cjs`
- `tests/listing-fulfillment.browser.cjs`
- `tests/listing-toolbar.browser.cjs`
- `tests/listing-uploader.browser.cjs`
- `tests/listings-profile-polish.browser.cjs`
- `tests/listings-shop-navigation.browser.cjs`
- `tests/listings-v1.browser.cjs`
- `tests/local-tab-content.browser.cjs`
- `tests/manage-products.browser.cjs`
- `tests/messages-e2e-staging.cjs`
- `tests/messages-images.browser.cjs`
- `tests/offer-accept-concurrency.cjs`
- `tests/offer-accept-edge.cjs`
- `tests/offer-accept-staging.cjs`
- `tests/offer-accept.browser.cjs`
- `tests/offer-revision-listing.browser.cjs`
- `tests/offer-revision.browser.cjs`
- `tests/offers-ux.browser.cjs`
- `tests/order-flow-ui.browser.cjs`
- `tests/order-management.browser.cjs`
- `tests/order-meetup-fixtures.cjs`
- `tests/order-snapshot-media-staging.cjs`
- `tests/order-snapshot-media.cjs`
- `tests/published-listing-card.browser.cjs`
- `tests/shop-analysis.browser.cjs`
- `tests/small-ui-polish.browser.cjs`
- `tests/test-pictures.browser.cjs`
- `tests/test-pictures.cjs`
- `tests/ui-correction-route.browser.cjs`
- `tests/welcome-demo-cards.browser.cjs`

### Validation results / limits

- `tests/test-pictures.cjs`: PASS (20 unique local WebPs, exact registry pool, provenance entries, deterministic mapping, shared Welcome/Luna identity, real `mapListing` URL ordering/no fallback, in-memory JPEG format).
- `tests/test-pictures.browser.cjs`: PASS at 390 / 430 / 820 / 1280 / 1536. All 20 local images decode, three explicit fixture entities retain exact image src through seven collapsed surfaces plus expanded card, object-fit cover stays intact, no horizontal overflow, a failed real upload URL is never swapped for testPic.
- `tests/manage-products.browser.cjs`: PASS all five widths, real-product priority/fallback, Shop-only operations and Resale isolation preserved.
- `tests/welcome-demo-cards.browser.cjs`: PASS all five widths with normal/reduced motion; approved Listing/Shop geometry, hearts, content and both video placeholders unchanged.
- `tests/shop-analysis.cjs` and `tests/order-snapshot-media.cjs`: PASS (existing financial projection/immutable-media test semantics unchanged).
- Application-source TypeScript: zero diagnostics. Focused application fixture/adapter/new-test ESLint: zero errors.
- Expanded ESLint of migrated historical test files: 69 existing errors across 8 files; each file's rule counts match `git show HEAD:<file>` exactly. These tests were clean relative to HEAD before this pass; unrelated old globals/unused-variable/semicolon debt was not disabled or refactored.
- Existing `tests/published-listing-card.browser.cjs` stops at a repeated `data-published-listing` selector timeout. Its owner iteration still expects that Published-card selector, whereas current owner pages use `ResaleManagementCard`. Its photo source was migrated without loosening selectors. The new actual-component cross-surface suite covers current owner cards explicitly.
- Hosted staging seed/browser scripts whose image input references changed were NOT executed. No staging/production data writes, credentials/env reads, Stripe/Supabase calls, commit or push were performed.

- `tests/shop-detail-demo.browser.cjs`: PASS 390 / 430 / 820 / 1280 / 1536, normal and reduced motion; actual Shop covers/product cards, expand, local filters, and scroll boundaries preserved.
- `git diff --check` plus whitespace checks for every tracked/untracked candidate text file: PASS. No old executable chair/synthetic-illustration paths or runtime Pexels/Unsplash URLs remain in components/lib/pages/scripts/tests (ignored generated artifacts and historical docs excluded).
- Photo payload total: 1,931,248 bytes for all 20 assets. No backend/API/database/migration changes or card CSS/layout redesign.

- `tests/shop-analysis.browser.cjs`: PASS all five widths, normal/reduced motion, Plus/Pro/trial/ranges/table/cost/empty/error/loading regressions; local photographic thumbnails resolve.
