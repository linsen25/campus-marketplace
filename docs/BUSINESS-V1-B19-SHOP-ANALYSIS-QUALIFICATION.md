# B19 — Real Shop Analysis local qualification

Date: 2026-10-20. Scope: the separately approved **local** implementation only.
The earlier planning document remains the historical proposal; this report records
what was actually implemented and tested. No B19 cloud access or deployment.

## Implementation and reuse

One forward migration, `202610200001_shop_analysis.sql`, installs exactly one
read-only RPC: `public.marketplace_shop_analysis(p_range text)`. No tables, fields,
triggers, counters, materialized views, workers, cron, or indexes are added. No
historical migration is edited. The function is STABLE / SECURITY DEFINER, with
empty search_path and fully qualified relations. PUBLIC, anon, authenticated and
service_role inherited function privileges are revoked before granting EXECUTE
only to authenticated. Existing trusted migration ownership is retained.

Local SQL SHA-256:
`622755482533ec34dc0c5e9bc696abba6f11a222e219a14e4de9393a36bbde27`.
This records the tested local file, not deployment authorization.

One authenticated GET API, `/api/shop/analysis?range=...`, reuses the existing
session client and verified-Western identity check. Only the enumerated period is
accepted; caller-supplied owner, Shop, tier, clock and other arguments are rejected.
The database derives owner from `auth.uid()`, resolves their existing Shop and
checks B12 effective entitlement at a single server statement timestamp. No
service-role analytics client, arbitrary Shop lookup or public analytics API.
Response caching is `private, no-store`.

Existing B17 activity and completed-Order facts, B18 frozen Order cost snapshots
and active expenses are read without mutation. B12/B14/B15/B16/B17/B18 authority
and B14 transaction guards are unchanged. Public Shop projections do not receive
costs, Order rows, viewer identities or analytics payloads.

## Financial meaning

- **Recorded Product Sales** is the accepted item subtotal of eligible completed
  Orders, not money received, bank settlement, payout or provider verification.
  UU Pay and external exchange totals are reported separately. Delivery charges
  and protection fees are not product revenue. Manual Sold, Offer Accept, pending,
  cancelled and expired Orders do not create sales or COGS.
- Grain is one eligible completed Order / Listing lot, not an invented product
  quantity. B17 completion evidence is reused so duplicate events do not multiply
  revenue. Completion time attributes sales; other Order overview states use
  creation time. Expired is separately disclosed.
- Frozen Shop/channel/seller/Listing origin, capture timestamp, CAD currency and
  accepted economics must match. Unknown historical channel or missing/mismatched
  B18 provenance is incomplete evidence, never silently assigned to a Shop.
  Historical records are not backfilled. Explicit Resale is excluded.
- COGS uses immutable B18 captured cost, never today's editable product cost.
  NULL cost is unknown; zero is explicitly known. Known COGS plus active dated
  B18 operating expenses is shown as known expense. Soft-deleted expenses are
  excluded. Unknown costs or source/currency facts make estimated profit NULL.
- Refunded completed Orders are excluded from eligible sales. Their supported
  frozen item amount is disclosed as an exclusion, not an executed refund amount.
  Gross known item value and exclusions are separate. Unknown return-cost/refund
  disposition makes profit unavailable; no refund cash-flow ledger is fabricated.
- Product contribution excludes unallocated operating expense and is described
  accordingly. No fabricated allocation to products. Currency conversion is not
  performed. Financial aggregate overflow beyond safe JS integer cents is rejected.

## Periods, bounded products and privacy

Only week/month/last-month/year; Toronto calendar midnight, Monday week start,
server `asOf`, current observed upper bound and equal-calendar-day previous window.
The prior window may be fully elapsed while the current window is still partial;
the UI discloses observed bounds rather than suggesting like-for-like cash results.
Future trend buckets are NULL. At most 366 daily points, top 20 products with stable
UUID tie-break, true top 5 best sellers, top 5 revenue groups plus **Other Products**
computed from every remaining eligible product. No false pagination completeness.
Missing historical product images are omitted, not replaced with Demo photographs.
Authenticated opens are explicitly scoped facts, not anonymous reach, unique
customers, ad impressions or promotion attribution.

The API and browser share an explicit validated projection: bounded arrays,
safe cents, valid ranges/dates, truthful NULLs and a whitelist of response fields.
Unknown private DTO fields are discarded. Invalid source/fixture payloads fail
closed. Late responses from a previous owner are ignored; account identity keys
reset component state. Authentication loading/error hides previous data. Focus,
period change, retry and server-derived entitlement expiry refetch safely. Expiry
delay accounts for transport elapsed time without trusting the browser wall clock.

## Entitlements and approved UI exceptions

- Genuine product performance, distribution and best sellers are available to
  eligible Plus, Pro, Pro Trial and corresponding Grace, according to B12.
  No extra product-statistics paywall is copied from the Demo implementation.
- Suspended analytics is denied by B12; B18 private cost/expense management remains
  available under its own authority. Analytics does not broaden that authority.
- Promotion-effect analytics is Pro-only and explicitly unavailable because real
  attribution is absent. No invented promotion counts or historical ad results.
- Existing dashboard, charts, selectors, motion and CSS are reused. Authorized
  changes are live data, labels, tier handling, loading/error/empty/incomplete
  states, coverage disclosure, bounded product contents and existing Add Expense
  wiring. No CSS/layout/token redesign or new controls.
- Demo stays reachable only through the existing explicit Demo props/loader.
  Errors, missing membership and empty live data never fall back to Demo.
- The existing B18 ExpenseDialog/API is reused. Its UUID survives a failed retry;
  focus/refetch does not unmount an open expense draft. No second expense system.

## Exact implementation files

New:

- `supabase/migrations/202610200001_shop_analysis.sql`
- `types/shop-analysis.ts`
- `lib/shop-analysis-validation.ts`
- `lib/shop-analysis-api.ts`
- `lib/server/shop-analysis-repository.ts`
- `pages/api/shop/analysis.ts`
- `components/shops/real-shop-analysis.tsx`

Modified:

- `lib/shop-analysis.ts` — shared nullable real observations and bounded real
  product result types; existing fixture calculations preserved.
- `components/shops/shop-analytics.tsx` — reuse existing presentation, explicit
  Demo/live boundary, approved live labels/permissions/states and B18 integration.

Tests added:

- `tests/shop-analysis-b19.cjs`
- `tests/shop-analysis-b19-fixture.cjs` (test-only, never imported by application)
- `tests/shop-analysis-b19-db.cjs`
- `tests/shop-analysis-b19-db.sql`
- `tests/shop-analysis-b19-sales.sql`
- `tests/shop-analysis-b19-matrix.sql`
- `tests/shop-analysis-b19.browser.cjs`

Documentation: this report and `BUSINESS-V1-TASK-BREAKDOWN.md`.
Ignored build copies, screenshots and logs are local verification artifacts only.

## Local evidence and its limits

PASS: `node tests/shop-analysis-b19.cjs`: actual API/repository/client projection,
mocked Auth/RPC only, no network. Owner/unverified/anonymous checks, period/forged
input rejection, sanitized errors, NULL/unsafe totals/array bounds, projection
privacy and Toronto helper boundaries.

PASS: both `node tests/shop-analysis-b19-db.cjs` and `--capture-fixture` in fresh
disposable loopback PostgreSQL clusters. Current-schema test uses actual B12
membership, B17 and B18, owner/other/unverified/anon, effective ACL/search_path,
Plus/Pro/Trial/Grace/Suspended, all ranges, genuinely empty and expense-only data,
soft deletion, historical missing provenance, and an actual READ ONLY transaction
under authenticated role. Existing B18 retention/CRUD/concurrency qualification is
retained. The second mode uses the existing isolated pre-B14 Accept seam to test
actual atomic frozen-zero/unknown costs and external two-party completion; then
installs current B14 guards and proves they remain closed. No real payment.

The same native runner also creates a separate synthetic read-shaped matrix DB:
the actual B17 completion function and actual B19 RPC execute against explicitly
constructed Order/event/cost facts, with only auth/membership stubs. This tests
aggregation math, not real state-machine/provider transitions: UU/external,
duplicate completion evidence, pending/cancelled/refunded/disputed, currency and
unknown provenance, current-vs-frozen costs, soft-delete/date filters, 27 products
bounded to 20 with full Other reconciliation, event channel isolation, unknown
legacy channel, Toronto 23/25-hour days and aggregate overflow. It is not evidence
of real refund execution or mature Protection/scheduler acceptance.

PASS: 13 offline regressions: `shop-analysis`, `shop-settings-b13`,
`shop-products-b14`, `public-shop-b15`, `shop-favorites-b16`,
`discovery-facts-b17`, `shop-costs-b18`, `order-shop-provenance`,
`transactions-b09-static`, `dual-payment`, `resale-recovery-b05`,
`listing-channel`, `listing-media-isolation-api` (all `.cjs`).

PASS: 7 isolated native database regressions: `transactions-b09-db`,
`shop-membership-b12-db`, `shop-products-b14-db`, `public-shop-b15-db`,
`shop-favorites-b16-db`, `discovery-facts-b17-db`, `shop-costs-b18-db`.

PASS: `shop-analysis-b19.browser.cjs`, 10/10 (390, 430, 820, 1280, 1536;
normal and reduced motion). The actual exported component, live controller,
charts, selectors and B18 dialog run with controlled local API fixtures and
blocked external requests. Plus product access, Pro unavailable attribution,
period change, expense failure/retry with same UUID, partial/empty/error states,
no Demo fallback, stale-owner response rejection, expiry refresh, no overflow or
page errors. Normal-mode screenshots wait for the existing NumberTicker to settle;
the application animation is unchanged. Evidence:
`tests/artifacts/message-payload-qualification/b19-real-<width>-<reduced>.png`.
These are local fixtures through the real component, not cloud business records.

PASS: original `shop-analysis.browser.cjs`, 10/10 plus its loading/retry/unauthorized/
empty/missing-cost/negative-profit cases; explicit Demo behavior retained.
PASS: `shop-products-b14.browser.cjs`, 10/10, including five-step recovery/edit/Sold/
Discard. PASS: `market-navigation-hit-targets.browser.cjs`, 10/10, actual isolated
Next app with empty offline fixtures; ordinary tab/Filter/Sort clicks and hit tests,
including 390px. The temporary navigation app was stopped after verification.

Existing `shop-settings-b13.browser.cjs`: first full run **9/10 PASS, 1 FAIL** at
1536px reduced motion, `dialog remains after screenshot` (line 119; expected 1,
observed 0). With the same unmodified test and `B13_WIDTHS=1536`, both normal and
reduced cases then **2/2 PASS**. This is an observed intermittent regression-test
limitation, not a proven B19 defect or a silently repaired Settings interaction.
No B13 test/application changes. Preserve the first-failure log and targeted
rerun in `tests/artifacts/b19-settings-browser.log` and
`tests/artifacts/b19-settings-rerun-1536.log`; do not claim the initial full run
was clean. All five widths in both motion modes have passing observations.

PASS: application TypeScript (`tsc --noEmit --incremental false`), focused ESLint,
Prettier and tracked `git diff --check`; explicit no-index whitespace checks also
cover the 15 new implementation/test/report files without staging. Git line-ending
conversion notices are not whitespace failures. No application CSS was changed.

PASS: final safe isolated production build, exit 0, including `/api/shop/analysis`.
Source copied to an ignored task-owned directory; no environment files copied,
fake loopback configuration, network fetch/HTTP blocked and telemetry disabled.
Build-generated service worker files remain in the copy. Existing build warnings
(Browserslist, CSS `start`, hero-parallax keys and blocked external fonts) do not
prevent build. No original environment or generated production app was deployed.

## Outstanding acceptance and safety

NOT TESTED: deployed RPC/PostgREST/schema cache/ordinary cloud-user runtime,
real cloud membership changes across devices, realistic production-scale query
plans, provider settlement/refund/payout truth, mature scheduler execution and B26
new Shop transaction acceptance. No scale/index performance claim is made from
small local fixtures. Promotion attribution is unavailable by design.

Staging needs a separately approved read-only preflight, exact migration hash and
dependency/ACL/history comparison, then a separately approved single migration
deployment and isolated runtime plan respecting immutable transaction history.
Do not deploy this file automatically or create cloud transactions to fill charts.

No Staging/Production operations, payment/provider/email calls, existing business
data modifications, environment changes, or Git mutations in B19. Native test
clusters and task-owned offline app processes are disposable; no shared data reset.
B20 and Recommendation & Ranking have not started.

**B19 STAGING NOT DEPLOYED**

**B19 STAGING RUNTIME ACCEPTANCE NOT PERFORMED**

**B19 LOCAL IMPLEMENTATION COMPLETE**
