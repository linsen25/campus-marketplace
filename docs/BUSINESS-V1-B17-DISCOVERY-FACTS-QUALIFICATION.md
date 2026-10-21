# B17 — Discovery / Analytics Facts: local qualification

**B17 LOCAL IMPLEMENTATION COMPLETE.**

2026-10-19. Local implementation authorization only. This is the official B17
facts scope, not the separate unassigned Recommendation & Ranking proposal.
The earlier planning document remains a dated planning record. The subsequent
implementation authorization explicitly approves authenticated Shop Detail and
Listing Detail opens, including the existing shared card producers, and excludes
persistent anonymous activity for both channels.

## Implemented facts and producer contract

Reuse `marketplace_private.account_activity_events`, existing event UUIDs, server
timestamps, Listing publication/first-Sold producers, Auth identity and the current
private owner/time index. No generic events service, counters, queues, workers,
outbox integration, cookies, fingerprints or external tracking was added.

| Intent / existing surface                            | New behavior                                                                                                                                                                                             | Exclusions                                                                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual `ShopCard` Go to shop                         | After the existing router navigation resolves successfully, authenticated non-owner sends the actual Shop UUID to `/api/shops/view`.                                                                     | Preview cards, anonymous/owner, cancelled/rejected navigation, mount, hover, prefetch and carousel exposure do not record.                     |
| Actual shared `PublishedListingCard` expansion       | Existing `ExpandableCard.onIntentionalOpen` records one Listing open for a signed-in non-owner. This covers Market, canonical Shop products, Seller and Listing Favorites where the shared card is used. | No mount/openOnMount, rerender, sorting, fetching or favorite-click record. Old Market parent recording is removed to avoid double capture.    |
| Existing legacy `ListingCard` link                   | An ordinary unmodified primary click, including keyboard activation, records intent for an available published non-owned Listing. Existing navigation remains unchanged.                                 | No render, prefetch, hover, modified/new-tab click, anonymous/owner or Sold capture. This is click intent, not proof of destination rendering. |
| Direct Listing/Shop URL, SSR, refresh, focus refresh | No new automatic event.                                                                                                                                                                                  | These are deliberately outside explicit producer coverage; do not estimate missing opens.                                                      |
| Existing publication / first Sold                    | Existing producer and identities unchanged; new INSERTs gain authoritative source metadata.                                                                                                              | Manual Sold remains a Listing status fact, not a completed Order or paid sale.                                                                 |

Each explicit open gets a new UUID. One bounded immediate retry reuses that UUID;
closing and deliberately reopening gets a distinct UUID. Failure, including
synchronous UUID/network failure, does not interrupt browsing. Delivery is best
effort: exhausted retries lose an event, not a durable offline queue. A client
claim of intent is not proof of human attention or a unique visitor.

The rollout coverage begins only when migration and application code are separately
deployed. There has been no cloud rollout during this task. Metrics mean
**recorded authenticated activity**, never all traffic or all visitors. This
description applies to newly collected facts; preserved pre-B17 totals are not
retroactively authenticated. A historical NULL viewer can mean anonymous activity
or an account later deleted, and remains unclassified.

## Provenance, migration and authority

One new forward migration:
`supabase/migrations/202610190007_discovery_activity_facts.sql`.
Prior migration files are untouched by B17.

- Add nullable `listing_channel_snapshot` and `shop_origin_id` to the existing
  private activity table. Retain the existing Listing origin UUID. Add `shop_view`
  with a real Shop UUID and NULL Listing origin; never invent a Listing for a Shop.
- A restricted private BEFORE INSERT trigger resolves Listing seller/channel and
  the current authoritative owner Shop for new Listing facts; rejects mismatched
  supplied ownership/channel/Shop. Shop entity facts validate Shop/owner directly.
  Source identity uses UUIDs, never usernames or names. New legacy Listing facts
  without a resolvable Shop retain unknown Shop, rather than blocking legitimate
  historical Order completion or inventing identity.
- Existing rows remain byte-equivalent apart from new NULL columns. No historical
  channel/Shop backfill, Order snapshot/hash rewrite or transaction event update.
  New attribution is event-time source association, not a reconstruction of an
  earlier Shop that might have been deleted/recreated.
- Keep table RLS and revoked direct application-role grants. No public/raw fact
  reads, broad service-role access, new owner analytics endpoint or viewer export.
  Existing Auth deletion SET NULL and owner/profile cascade semantics remain;
  these are not an everlasting immutable accounting ledger.
- Replace only the existing Listing view RPC and add the analogous Shop view RPC.
  Both require verified `auth.uid()`, exclude owner, resolve actual sources, and
  use B15 eligibility for Shop sources. Listing requires published + available.
  Anonymous EXECUTE is revoked, without changing anonymous public browsing.
- UUID primary/identity uniqueness and the existing advisory lock namespace are
  shared across both commands. Same actor/subject/kind retry acknowledges the
  accepted event; cross-account, cross-subject and cross-kind UUID reuse fails.
  Replay acknowledges only the prior fact even after visibility changes, and
  returns no private source details.
- APIs accept only subject UUID + event UUID, exact body, no query authority;
  reuse current 1KB, same-origin/header, environment and validated session checks.
  No client channel, owner, Shop association, time or money is accepted. Anonymous
  API calls return `recorded: false` without invoking an event-write RPC.
- Reuse private/no-store responses; add `/api/shops` to existing PWA NetworkOnly
  matching. No signed URLs, new media handling or credentials in client code.

Existing account aggregate buckets, output, historical totals and first-Sold
semantics are unchanged. Its `views` filter still counts Listing `view`, not the
new `shop_view`. Shop aggregation belongs to B19, not this task.

## Sales, favorites and future costs

The new private, invoker-rights `completed_order_facts(owner, from, until)` is a
bounded read-only source projection, not a Sales table, revenue total or public
RPC. EXECUTE is revoked from PUBLIC/anon/authenticated/service_role. Later access
requires its own approved owner/tier boundary. Maximum requested interval is
366 days; timestamps come from existing authoritative records.

One row per existing completed **Order ID** requires `reservation_ended_at` and a
matching immutable `order_completed` event. `EXISTS` corroborates completion,
rather than multiplying rows across events. External completion's additional
`external_exchange_completed` event therefore does not double-count a sale.
An Offer, open Order, cancelled/expired Order or manual Sold alone is not a row.

`sale_eligible` preserves distinctions: external requires both persisted
attestations, no disagreement and no refunded status; it does not become UU Paid.
UU requires Paid and the matching Protection completion receipt. Refunded status
is not an eligible paid sale. These are source predicates, not provider financial
reconciliation, partial-refund accounting, payout or settled revenue. No monetary
sum, quantity inference or new payment operation is introduced.

Order channel comes only from its frozen snapshot. Missing historical channel
stays NULL; historical Shop UUID is NULL because the current frozen snapshot does
not contain it. Do not join today's Shop or a mutable Shop name to manufacture a
historical Shop identity. Existing Listing/seller/Order UUIDs remain usable.

Current `listing_favorites` and B16 `shop_favorites` remain separate, unchanged
relationships. No favorite history, trends, public user lists, ranking weights or
duplicate counters are created. Notification/outbox deliveries are not facts to
add to views or sales.

B18 can later link an authorized cost record to its actual owner/Shop UUID,
Listing UUID and, where appropriate, Order UUID, preserving currency and its own
approved snapshot/retention policy. These are design references, not new cost
columns/tables. The projection exposes `unit_cost_cents = NULL` to make unknown
explicit; NULL must not be treated as zero. Cost CRUD, realized profit, expenses,
dashboard aggregates and new Order Shop UUID freezing need separate approval.

## Local qualification

All fixtures run offline/local-only. Native tests create and stop disposable
loopback PostgreSQL clusters; no existing local or cloud business data is reset.
The native harness excludes scheduler/network integrations, not business guards.
Historical Shop Orders are legitimate isolated pre-B14 fixtures, subsequently
completed through existing authority. No B14 transaction guard is bypassed.

| Check                                               | Actual result / boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/discovery-facts-b17-db.cjs` + SQL companions | PASS actual forward migration, authenticated/anonymous and raw-table permissions, missing/draft/Sold/suspended/own source exclusion, forged association and cross-account denial, legacy NULL/byte preservation, unchanged prior functions except view RPC, real first-publish/Sold attribution, Auth/Listing deletion compatibility. Two connections with observed PostgreSQL lock waits prove duplicate delivery produces one row and cross-kind UUID conflict fails. |
| Completed source projection                         | PASS real historical external completion, dual completion events but one Order fact, manual Sold exclusion, unknown Shop/cost, snapshot equality and restricted EXECUTE. No mature Protection clock manipulation, scheduler execution or real provider payment.                                                                                                                                                                                                         |
| `tests/discovery-facts-b17.cjs`                     | PASS actual API handlers and shared helper with controlled dependencies: auth, exact bounded subject body, spoof rejection, method/origin/environment/errors, no-store, anonymous no RPC, same-UUID retry, distinct intent and failure isolation.                                                                                                                                                                                                                       |
| `tests/discovery-facts-b17.browser.cjs`             | PASS 10/10: 390/430/820/1280/1536, normal/reduced motion. Actual ShopCard, ShopPage and shared Listing cards; unforced opens; lost acknowledgement one UUID; intentional reopen distinct; passive/anonymous exclusion; Favorites tabs/hearts; no script errors/overflow. Session/data HTTP fixtures are isolated, not real cloud acceptance.                                                                                                                            |
| Existing Account Activity                           | PASS `account-activity-api.cjs`, historical `account-activity-db.cjs`, `account-activity-views.browser.cjs` and chart `account-activity.browser.cjs` at five widths. Historical migration test still describes its historical anonymous contract; B17 current-schema native test verifies anonymous writes are now denied.                                                                                                                                              |
| B12/B14/B15/B16 native regressions                  | PASS entitlement, publication/transaction guards, public eligibility and favorites suites. B14 includes immutable historical Order completion and denial of new Shop transactions.                                                                                                                                                                                                                                                                                      |
| B09 / Order compatibility                           | PASS `transactions-b09-db.cjs`, `order-shop-provenance.cjs`, `transactions-b09-static.cjs`, `dual-payment.cjs`. Native B09 includes external completion/dispute/cancellation, UU local simulator/handoff/Protection authorization and six lock-observed races. No cloud expiry, scheduler, actual provider or settlement acceptance is inferred.                                                                                                                        |
| API / Resale compatibility                          | PASS `shop-membership-b12.cjs`, `shop-products-b14.cjs`, `public-shop-b15.cjs`, `shop-favorites-b16.cjs`, `public-shop.cjs`, `listing-channel.cjs`, `listing-media-isolation-api.cjs`, `resale-recovery-b05.cjs`.                                                                                                                                                                                                                                                       |
| B15/B16 browser compatibility                       | PASS both suites at five widths, normal/reduced motion; current eligibility/read-only product actions, real component Favorites behavior and Resale preserved with controlled local HTTP.                                                                                                                                                                                                                                                                               |
| 390px Market navigation regression                  | PASS `market-navigation-hit-targets.browser.cjs`, all five widths in normal/reduced motion, against an isolated actual Next app: ordinary Shop/Resale/Filter/Sort clicks, pointer hit-testing and no overflow.                                                                                                                                                                                                                                                          |
| Application TypeScript                              | PASS `tsc --noEmit --incremental false`; existing source configuration excludes generated `tests/artifacts` copies.                                                                                                                                                                                                                                                                                                                                                     |
| Isolated production build                           | PASS in `tests/artifacts/b17-production-build-WSsLjx`: copied current source, no environment files, dummy local-only process configuration and outbound HTTP/fetch denied. Original `.next` and `public/sw.js` unaffected. Existing hero array-key, CSS compatibility and Browserslist warnings remain; font optimization intentionally unavailable offline.                                                                                                            |

Local browser evidence is ignored under `tests/artifacts/message-payload-qualification/`,
`b17-<width>-<normal|reduced>.png`. These are local fixtures, not merchant claims.

Initial test-only issues were corrected before qualification: a seed helper left
the wrong fixture actor selected, and the browser harness had unused/global lint
declarations. Older Webpack under Node 24 requires the existing local
`NODE_OPTIONS=--openssl-legacy-provider` test invocation; the initial invocation
without it failed before compiling components. No business assertion was removed
or application authority weakened to obtain a pass.
The existing Activity API test entry uses a named async function solely to avoid
Prettier's defensive IIFE semicolon conflicting with ESLint's no-extra-semi rule.

Final static checks: focused ESLint and Prettier PASS across the B17 application,
test and documentation set. Standard `git diff --check` PASS; no-index whitespace
checks also cover all eight new B17 candidate files, recognizing Windows CRLF and
the expected added-file exit status. Nothing was staged. The isolated Next server
started for navigation qualification was stopped after the ten passing cases.

## Exact B17 source changes

New migration and application route:

- `supabase/migrations/202610190007_discovery_activity_facts.sql`
- `pages/api/shops/view.ts`

Existing application files, B17 changes only:

- `pages/api/listings/view.ts` — anonymous early exit after session validation.
- `lib/record-marketplace-view.ts` — shared Shop/Listing UUID delivery/retry helper.
- `components/shops/shop-card.tsx` — post-navigation nonvisual Shop-open capture.
- `components/listings/published-listing-card.tsx` — central explicit-open capture.
- `components/listings/market-layout.tsx` — remove duplicate parent producer.
- `components/listings/listing-card.tsx` — legacy explicit link-intent capture.
- `next.config.js` — Shop activity API NetworkOnly.

New tests:

- `tests/discovery-facts-b17-db.cjs`
- `tests/discovery-facts-b17-db.sql`
- `tests/discovery-facts-b17-sales.sql`
- `tests/discovery-facts-b17.cjs`
- `tests/discovery-facts-b17.browser.cjs`

Existing tests: `tests/account-activity-api.cjs` now positively checks anonymous
`recorded: false`; `tests/account-activity-views.browser.cjs` supplies the same
session mock to the actual shared card and removes its obsolete duplicate producer.
Docs: this qualification and `docs/BUSINESS-V1-TASK-BREAKDOWN.md`.
Other existing worktree changes are preserved and are not attributed to B17.

## Safety and deferred cloud acceptance

UI changes: NONE; only the expressly authorized nonvisual intent capture. No CSS,
layouts, animations, controls, navigation destinations or B15 390px fix changed.
No Staging/Production request, database write, migration deployment, account,
real media download, payment/email/notification side effect, environment-file edit
or Git mutation. No B16 persistence or B14 transaction authority modification.

Separate next approval must cover: Staging read-only preflight against explicit
`pcaqxezdfxofysghssyo`, compare prerequisites and privileges, assess existing raw
facts without reattributing them; then only this migration deployment; then
uniquely identified temporary authenticated runtime opens/retries/permissions.
Do not use the Production-linked CLI target. Cloud populated Shop eligibility,
real cookie/session/navigation delivery and deployed PWA cache behavior remain
unverified. Do not create Shop transactions to manufacture analytics facts.

Historical Order Shop UUID/cost gaps, event best-effort delivery and partial
producer coverage remain explicit limitations. Mature Protection/scheduler and
real transaction/provider acceptance stay in their separately approved tasks;
no historical snapshot byte download is reopened. Ranking remains an unassigned
future proposal; B18 costs and B19 aggregation have not begun.

**B17 STAGING NOT DEPLOYED.**
**B17 STAGING RUNTIME ACCEPTANCE NOT PERFORMED.**
**RECOMMENDATION & RANKING NOT IMPLEMENTED. B18/B19 NOT STARTED.**
