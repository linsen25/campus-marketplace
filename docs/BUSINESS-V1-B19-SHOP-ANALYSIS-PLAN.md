# B19 — Real Shop Analysis: minimal implementation plan

**Planning Started. B19 PLANNING COMPLETE — IMPLEMENTATION NOT STARTED.**

2026-10-20, America/New_York. Authorization: local planning only. This document
and the task-breakdown status are the only project files changed in this round.
No application/test changes, migration creation, local database writes, remote
calls, Staging/Production inspection, payments, email or Git mutations.

## 1. Official scope, dependencies and discrepancies

The official B19 / P2 definition in `BUSINESS-V1-TASK-BREAKDOWN.md` remains:

> Add owner/tier-authorized Shop Analysis aggregate endpoint and wire it to existing dashboard; keep explicit demo preview where intended.

Dependencies:

> B12/B17/B18; real financial metrics depend on actual completed transactions. Schema:aggregate/indexes only if justified.

Acceptance:

> Server tier enforcement, cross-Shop deny, refunds/cancels/external revenue definitions, Toronto DST/range/zero values. Exit: real UI tagged real, totals reconcile, no fabricated profit when costs missing.

No task renumbering, recommendation ranking, financial execution or new Shop
transaction enablement is included. B26 owns real Shop purchase qualification.

Reported preceding milestone: B18 `202610190008` deployed to explicit Staging,
73 migration records, byte-identical archive and read-only installation verification
passed. B18 cloud runtime financial acceptance remains deferred. This is the
already reported deployment result, **not a new remote verification**. The earlier
B18 local qualification document's NOT DEPLOYED text is a historical milestone,
superseded by the later deployment result; do not silently treat it as current.

Two meaningful discrepancies need a decision before live wiring:

1. B10 grants Sales Analytics to both Plus and Pro and explicitly reserves promotion
   effectiveness for Pro. Existing Demo `Pro Insights` also locks Product
   Performance, Product Revenue Distribution and Top Selling Products. B10 does
   not explicitly classify those three sales modules as Pro-only. A Demo lock is
   not sufficient authority to invent paid benefits. See section 8.
2. Existing Demo displays Featured impressions/attributed visits, quantities above
   one and subscription expenses. B17 records none of the promotion attribution
   facts; real Orders have no quantity authority; B18 has no actual subscription
   expense ingestion. Live data must not fabricate these values.

## 2. Relevant reusable implementation and actual gaps

| Existing source                                                                                                                 | Reuse / actual limitation                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `components/shops/shop-analytics.tsx`                                                                                           | Dashboard, KPI cards, Revenue/Expenses/profit trend, donut, Order Overview, sold chart, Advanced product table/distribution/top sellers, Featured module, date-selector placement, skeleton/error/retry, pricing preview. Currently always uses fixture loader and Demo access, not server entitlement.                                          |
| `lib/shop-analysis.ts`                                                                                                          | Existing range enum, Toronto date-key calendar arithmetic, comparison helper, chart/display shapes. Calculator is explicitly fixture-oriented: no payment verification, historical attribution, soft-delete or currency validation. Do not expose its raw-order input as a live API contract.                                                    |
| `lib/fixtures/shop-analysis-fixture.ts`                                                                                         | Explicit fixed-date illustrative dataset, local expense additions. Keep for labeled preview and tests only; never fallback to it after a live API error.                                                                                                                                                                                         |
| B17 `202610190007_discovery_activity_facts.sql`                                                                                 | `completed_order_facts(owner,from,until)` supplies one row per completed Order, requires matching completion event, guards a finite range ≤366 days, distinguishes external exchange versus UU paid/protection completion. Deliberately returns NULL Shop identity and NULL cost; no money amount. Reuse rather than rewrite its evidence rules. |
| B17 + `202610160003_account_activity.sql`                                                                                       | Private activity rows carry owner, occurrence time, frozen channel/Shop attribution; event UUID/idempotency and source triggers already exist. Listing and Shop opens require a verified user, exclude self and unavailable resources. They are recorded authenticated opens, not unique visitors, all views or promoted impressions.            |
| `orders`, `transaction_events`, B09/B17                                                                                         | Frozen channel, identities, accepted item amount and lifecycle/payment; transaction events corroborate completion. Use EXISTS / one-row-per-Order, not a multiplying event join. Current Listing Sold status alone is not a completed Order.                                                                                                     |
| `202610130002_delivery_area_economics.sql`, `202610140002_order_cancellation_settlement.sql`                                    | Frozen item/delivery/protection-fee economics and cancellation settlement authorizations. Authorization is not provider refund execution, bank receipt or seller payout.                                                                                                                                                                         |
| `202610190008_shop_costs_expenses.sql`                                                                                          | Current private costs, owner expenses and immutable first-Accept cost snapshots. Join by exact Order UUID/origins; current cost must never repair a historic missing snapshot. Expenses have no per-product link and no subscription category.                                                                                                   |
| `shop_entitlements` in B12 migration `202610190003`; `lib/server/shop-membership-repository.ts`; `pages/api/shop/membership.ts` | Trusted effective tier, trial/grace/suspension/time boundaries; reuse inside analytics authority, not merely a browser GET or Demo prop.                                                                                                                                                                                                         |
| `lib/server/shop-costs-repository.ts`, `lib/supabase/server.ts`, `lib/server/marketplace-auth.ts`                               | Actual verified Western session, narrow RPC, explicit DTO projection, safe errors/private no-store. No service key required in browser.                                                                                                                                                                                                          |
| `components/shops/shop-costs-manager.tsx`, `shop-expense-dialog.tsx`, `lib/shop-costs-api.ts`                                   | Existing B18 private management and async expense save; reuse from Analysis rather than add another editor/store. Preserve Suspended access through Manage Products.                                                                                                                                                                             |
| `lib/offer-amount.ts`, `lib/shop-costs.ts`, `lib/account-activity.ts`                                                           | BigInt integer-cent parsing, safe number bounds, NULL versus zero, Toronto business date, existing authenticated activity definitions.                                                                                                                                                                                                           |

Missing: a real owner/tier-authorized aggregate, trusted Shop attribution join,
financial coverage metadata, live response validation, access-aware UI wiring and
truthful unavailable promotion/payment states. No missing generic event platform
or ledger has been demonstrated.

## 3. Smallest query / API / migration design

Recommend **one GET endpoint and one read-only aggregate RPC**, with a small
typed DTO and existing component wiring. No new table, event producer, counter,
worker, cron, ledger, materialized view or membership system.

Proposed API: `GET /api/shop/analysis?range=week|month|last-month|year`.
Reject all other keys/types, owner/shop/tier/asOf/custom timestamps. Verify actual
session using the existing repository client; no anonymous private aggregates.
GET only, private/no-store and existing `/api/shop` NetworkOnly cache boundary.

Proposed `public.marketplace_shop_analysis(p_range text) returns jsonb`:

1. SECURITY DEFINER, empty search_path, trusted owner, schema-qualified reads.
   Revoke PUBLIC/anon/authenticated/service_role default EXECUTE, then grant only
   authenticated EXECUTE. No new direct private-table grants or permissive RLS.
2. Check `auth.uid()` / `is_western_user()` again; resolve actual owned Shop.
   Capture one server timestamp for all boundaries and B12 evaluation. Call
   `shop_entitlements(actor,asOf)` and require `canUseShopAnalytics`.
3. Read existing completion facts, exact Order economics and B18 snapshots,
   active owner expenses and attributed view events in bounded reporting windows.
   Aggregate in database; do not download every raw Order/event to browser or API.
4. Return current/previous KPI totals and ≤366 daily buckets per window, coverage
   reasons, server time/timezone/bounds and authorized effective access.
   Product detail payload is tier-pruned in SQL, not CSS-hidden after delivery.
5. Add no financial writes or locks on business records. STABLE function with
   server reporting time fixed per statement; one statement snapshot avoids
   mixing independently fetched cost/expense/transaction revisions.

One future forward migration would create only this function and its narrow
EXECUTE grants. Exact version must be chosen against the then-current local
migration head. **No migration is created in this planning round.** Do not change
B17/B18 definitions or frozen facts. A helper function is not presently necessary.

DTO: separate `source:'real'` from existing `source:'fixture'` (discriminated type,
not a type cast); effective tier/status plus `nextBoundaryAt`; bounds/asOf;
nullable financial values; known subtotals; missing/excluded counts and reasons;
authenticated Listing/Shop opens; unavailable promotion/receipt status. Do not
include viewer UUIDs, Buyer details, messages, full Order snapshots, provider refs,
tokens, raw expense descriptions or internal command hashes.

Reuse existing chart/core shapes where valid, but do not coerce unavailable
revenue into numeric zero just to satisfy the current fixture-only type.

### Query bounds and indexes

Four fixed ranges, at most a calendar year each for current and comparison; no
arbitrary date span, offset or unbounded result array. Aggregate **all eligible
rows in the period**, never silently truncate totals at a row cap. Suggested
product payload: top 20 by recorded item revenue, then UUID; top sellers 5;
distribution top 5 plus exact remainder in existing Other Products segment.
Return total product count/truncation metadata and an accurate module description.
If all-product browsing is required instead, seek approval for existing pagination
controls; do not silently add a new interaction. This numeric cap is a proposal,
not an approved product requirement.

Existing useful indexes: `account_activity_owner_time(owner_id,occurred_at,kind)`,
B18 active expense `(shop_origin_id,expense_on desc,id desc)`, B18 snapshot Order
primary key, `transaction_events_order(order_id,created_at,id)` and Order indexes.
Existing `orders_seller` uses nullable current seller ID, not preserved origin ID;
it must not be assumed to index B17's origin/completion-date filter. During local
implementation EXPLAIN realistic isolated fixtures first. Only if justified,
propose one partial `(seller_origin_id,reservation_ended_at,id)` completed-Order
index. Do not preemptively add indexes or change filters to use an untrustworthy
current seller/Shop identity. Bounded result size alone is not a scan-time bound;
qualify runtime/statement timeouts and query plans without a new worker.

## 4. Exact financial definitions — proposed for implementation approval

### A. Completion and counts

- Completed Order: authoritative `lifecycle_status='completed'`, completion time
  `reservation_ended_at`, matching `order_completed` event as B17 requires.
- Eligible recorded sale: that completed Order and B17 `sale_eligible=true`,
  frozen channel Shop, verified event-time Shop attribution and valid amount/CAD.
  Count each Order once, regardless of repeated events, payment attempts or retries.
- Current real model has one Listing/lot per Order, no quantity field. Items Sold
  therefore means completed eligible Listing units/lots (one per Order), never
  the Demo quantity=2/3. Clarify existing note; do not change inventory semantics.
- Order Overview can retain existing convention: completed count by completion
  time; pending means lifecycle open among Orders accepted/created in the period;
  cancelled means lifecycle cancelled among Orders created in the period.
  This is not a same-cohort funnel. Expired is distinct, not silently cancelled;
  report excluded expiry count in coverage/disclosure if no existing display slot.
- Manual Sold/publication activity contributes neither Order count nor sales
  revenue nor COGS. A sold Listing is not payment evidence.

### B. Revenue is recorded item sales, not settled cash

Recommended existing Total Revenue KPI meaning: **Recorded Shop item sales
revenue**. Sum the immutable accepted `orders.item_amount_cents` once per eligible
sale; corroborate V2 `v2_order_economics.item_price_cents` where present and report
mismatches/missing required economics, never fall back to current Listing price.

This is item gross sales net only of Orders currently excluded by refund state;
it excludes delivery reimbursement, Buyer Protection fee, provider fees, taxes
and payouts. Do not sum buyer total or seller gross including delivery.

| State/source                                                     | Sale/revenue treatment                                                                                 | Truthful payment claim                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Accepted Offer / open Order / pending or processing payment      | No recognized sale revenue, even if a cost snapshot exists.                                            | No settled money claim.                                                                          |
| UU Pay + paid + authoritative Protection completion              | Eligible recorded item sale if B17 corroborates completion.                                            | Database-recorded UU paid; not proof of bank deposit or real provider success.                   |
| External + both exchange confirmations + no dispute + completion | Eligible externally confirmed recorded item sale. Must stay separately classified.                     | Parties attested exchange; UU did not verify/collect payment; never relabel payment_status paid. |
| Manual Sold                                                      | Excluded.                                                                                              | No transaction/payment evidence.                                                                 |
| Cancelled / expired / failed / unresolved dispute                | No completed sale revenue.                                                                             | A cancellation authorization or delivery compensation is not a sale.                             |
| Refunded                                                         | Exclude from eligible sales/revenue; retain completed operational Order and refund/exclusion coverage. | Authorization alone does not prove provider refund was executed.                                 |
| Missing or contradictory completion/payment/amount/Shop facts    | Exclude untrusted amount, flag incomplete coverage.                                                    | Unknown, not zero or verified payment.                                                           |

Current source includes trusted **staging simulator** payment outcomes
(`lib/server/order-financial-service.ts`, campus attempts and transaction source
markers). `202610160004_stripe_account_setup.sql` covers test-mode setup, not
Order payment verification. Do not infer provider-verified revenue from `paid`,
payment setup, payout readiness or presence of a Stripe account.

Recognized/verified receipts, net cash, refund cashflows, settlement and seller
payout totals must be **unavailable/not supplied** unless future approved provider
facts independently support them. B19 must not synthesize those facts or execute
provider operations. Present recorded external and UU amounts as coverage, not
one undifferentiated verified-revenue number.

The proposed refund rule restates the original completion-period eligible sales
when an Order becomes refunded; it is **not a refund-date cashflow report**.
Partially refunded principal cannot be calculated from current authorization
records alone. If encountered without authoritative executed principal allocation,
mark financial/profit coverage incomplete rather than invent proportional net
revenue. This proposed reporting basis requires approval, not a transaction-rule change.

### C. Shop attribution and historical gaps

Resolve the request's actual Shop only for access. Never assign old Orders to it
because the same seller owns it today or frozen Shop name matches.

Use B18 `shop_order_cost_snapshots` keyed by Order UUID with matching seller and
Listing origins and actual non-null Shop origin equal to the requested owned Shop.
B17's fact function intentionally supplies NULL Shop UUID/cost; join B18 evidence,
do not modify B17. A captured NULL amount is attributable but cost-unknown.

Older Shop-channel Orders without such verified Shop evidence remain unassigned;
return owner-only missing-attribution count, do not silently attach or backfill.
An activity publication fact alone does not guarantee Order-time attribution.
Historical unknown-channel Orders likewise are not inferred from current Listing.
All qualifying and excluded source counts must reconcile in tests. A known subtotal
may be reported, but a financial total with known coverage gaps is nullable/partial,
not an apparently complete CA$0.00. No historical snapshot rewrite.

### D. Product costs, operating expenses and estimated profit

- For a completed eligible sale use frozen **Order** cost, never mutable current
  `shop_product_costs`. Cost edits after Accept do not change reporting for that Order.
- Current Listing costs are prospective private management values, not COGS for
  unsold, cancelled or pending Orders. No automatic expense from cost entry.
- Count each eligible Order cost once (one Listing/lot); NULL stays unknown, 0 is
  known zero. No current-cost fallback and no cross-Order multiplication.
- Operating expenses: `shop_expenses` for trusted owner/Shop, `deleted_at IS NULL`,
  `expense_on` in the reporting date range. Sum each UUID once using its current
  revision. Edits/deletion restate current reports; B18 is not a closed accounting
  period ledger. Do not sum create/update retry commands as additional expenses.
- Total known expenses = known eligible-sale COGS + active operating expenses.
  Keep breakdown separate. B18 expenses have no product allocation; per-product
  contribution profit subtracts frozen COGS only, not arbitrary overhead shares.
  Never subtract product costs once in COGS and again as operating expenses.
- No fabricated Subscription expense for Trial, tier price, renewal intent or
  Demo `chargeReference`. Actual billing ingestion remains separately scoped.
- Estimated Shop profit = complete recorded item sales − complete eligible COGS
  − recorded operating expenses, **only when the required facts are complete**.
  This is estimated contribution after recorded expenses, not received cash,
  taxable/accounting profit or settled earnings.
- Missing cost/revenue/attribution/currency evidence produces NULL profit plus
  precise reasons and known subtotals; not CA$0 or a numeric optimistic margin.
  Refunded/cancelled product disposition or sunk cost is not modeled by B18;
  if relevant costs/losses are unresolved, flag profit incomplete. Do not assume
  full refund returned the item/COGS or invent a cancellation loss.
- Empty attributable Shop with complete coverage has true zero sales and known
  expenses; expense-only period may show negative estimate. No-sales plus unknown
  historical evidence is not a proven zero. Zero denominator margin is NULL.

Use integer cents/SQL numeric sums. Each input being JS-safe does not make a sum
JS-safe: check aggregate bounds before Number conversion. On overflow return
controlled unavailable metadata rather than round. Chart currency units are
derived only for safe display. Fixed CAD in current authority; mismatched currency
is excluded/flagged and invalidates complete profit. No FX conversion or combining
different currencies as CAD.

## 5. Authenticated views and unavailable promotion facts

Count only B17 events with exact owner, frozen `listing_channel_snapshot='shop'`
and matching `shop_origin_id`, bounded `occurred_at`, kind view/shop_view. Separate
Listing opens from Shop opens; one event UUID counted once. They are not unique
people or total traffic; multiple genuine opens can count, retries cannot.

Anonymous browsing and owner self-opens are excluded by existing producers;
delivery is best-effort and older source attribution can be missing. Report
"Recorded authenticated opens" with coverage, not all visitors. Existing unique
event identity does not imply exactly-once delivery for distinct user actions.

There are no trustworthy featured impressions, promotion source, attributed visits
or CTR facts. Keep Featured module's truthful tracking-unavailable state; do not
display fake zeros as measured promotion performance and do not use organic Shop
views as attributed visits. No new tracking events/ranking work in B19.

There is no ordinary-view KPI in the current Overview. Minimal proposal: expose
recorded Shop/Listing opens in existing explanatory text/coverage area, retaining
Featured's unavailable state. A separate card/chart would need additional UI
approval and is not proposed here.

## 6. Time, comparisons and query consistency

Preserve existing four selectors: This Week (Monday start), This Month, Last
Month, This Year. `shopAnalysisBounds` uses Toronto calendar **date keys** and
half-open `[start,end)` periods; no rolling Account Activity 1D substitution.
Server determines Toronto today/asOf; convert each midnight to timestamptz with
`AT TIME ZONE 'America/Toronto'`, not N×24h UTC arithmetic across DST.

Preserve current comparison rule: preceding equal number of calendar dates,
ending at current start. This is **not necessarily the previous calendar month
or previous calendar year**. Return exact previous bounds and explain "previous
period"; do not silently relabel a 31-day comparison as February. Changing to a
calendar-month/year comparison would require an explicit product decision.

Current query upper timestamp is min(period end, server asOf); no future events.
Current/future calendar buckets may retain chart geometry but future values are
NULL/not-yet-observed, not measured zero. Elapsed empty buckets can be zero when
coverage is known. Existing previous-period comparison is whole previous window
versus current-to-date; disclose that mismatch rather than claim like-for-like
elapsed performance. Percentage unavailable when previous ≤0 or either is unknown.

Completion/sales/COGS use the authoritative completion timestamp converted to
Toronto date; operating expenses use their explicit expense_on date; recorded
views use occurred_at; pending/cancelled use the existing created-date convention.
Do not join rows by loosely matching dates or count transaction_events as sales.
One database statement snapshot for all aggregates prevents mixed totals. Historical
expense edits/refund-state changes mean repeated reports can legitimately restate;
asOf is observation time, not an immutable accounting report version.

## 7. Entitlement, owner privacy and suspended management

| Effective B12 state                             | Real Analysis access                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active Plus (either purchase mode)              | Core Sales Analytics; no promotion effectiveness. Product-module placement requires section 8 decision.                                                 |
| Active Pro                                      | Core plus approved advanced modules/promotion area; missing promotion facts remain unavailable.                                                         |
| Pro Trial                                       | Full Pro entitlement until exact term boundary; no invented subscription charge.                                                                        |
| Grace                                           | Original effective tier preserved for 120 real hours; use B12 result, not local day calculation.                                                        |
| Suspended                                       | No paid Analysis aggregate; keep existing B18 cost/expense CRUD and legitimate Order records accessible via their existing owner/participant endpoints. |
| No Shop / not_started / anonymous / other owner | No private aggregate. Explicit labeled Demo preview can remain without fetching another account's real data.                                            |

Resolve effective membership in SQL for every read; browser props and cached
membership are display hints only. Evaluate expiry even without cron; schedule a
client refetch at nextBoundaryAt/focus and clear real values on account/logout or
authorization loss. Membership/network failure must not default to Pro/Demo or
retain another user's payload. Prevent late old-account responses with existing
generation/unmount pattern; no shared cross-owner cache.

No public API gets financial fields. SQL returns only authorized tier fields;
Plus must never receive Pro-only data for a blurred preview. Raw activity viewers,
provider state and other party information stay private. B18 raw table grants/RLS
and B12 entitlement authority remain unchanged. Uniform inaccessible-shop failures,
401 login, 403 no paid entitlement, 400 range and safe unavailable infrastructure
responses; no account-existence details or raw SQL errors.

## 8. Necessary decisions / UI exceptions before implementation

Planning does not authorize UI changes. Preserve layout/CSS/colors/cards/charts,
motion, responsive breakpoints, date-control placement, pricing dialog and 390px
Market hit-target correction. No new dashboard or expense manager.

Separate implementation approval must resolve:

1. **Tier discrepancy**: confirm either (A) current four-module Pro Insights lock
   is the intended additional B10 benefit classification, or (B) Sales product
   modules belong to Plus as B10's broad Sales Analytics wording suggests, with
   only promotion effectiveness exclusive to Pro. Recommendation: confirm A if
   preserving frozen lock structure is the priority; do not implement A as already
   approved or silently move modules under B. This is a real entitlement/UI decision.
2. **Reporting basis**: approve recorded item-sales (including separately marked
   externally confirmed exchanges), not verified receipts/net cash; completion-date
   attribution and refund-state restatement, missing facts => partial/unavailable
   profit. Otherwise identify which supported alternative revenue basis is intended.
3. **Minimal UI wiring**: real data badge/disclosures, NULL/missing/errors, actual
   tier access and existing time selectors; existing Add Expense opens shared live
   B18 dialog and reloads aggregates only after server success. Unentitled preview
   remains explicitly Demo and content-click Plans behavior; entitled users do not
   get the Demo capture overlay. No field/layout redesign.
4. **Coverage presentation**: ordinary recorded opens in existing text, truthful
   unavailable Featured module; top-20 product table with clear truncation and
   exact aggregate remainder. Approve these bounded presentation choices or specify
   a necessary additional UI exception before coding.

No additional infrastructure is needed to begin bounded local implementation
after these decisions. Lack of real promotion/provider facts blocks those metrics,
not a truthful recorded-sales dashboard. B14 and deferred B26 still block real
new-Shop transaction cloud acceptance; this plan does not reopen them.

## 9. Exact proposed implementation files

No files below are changed in this planning round except the two planning docs.

| Proposed file                                                                 | Minimal change                                                                                                                                                  |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/<next>_shop_analysis_aggregate.sql`                      | One owner/tier-scoped read RPC and EXECUTE grants; only a separately justified index if local plans require it. No tables, backfill, B17/B18 rewrite or writes. |
| `pages/api/shop/analysis.ts`                                                  | Strict GET/range/auth/private response and sanitized errors.                                                                                                    |
| `lib/server/shop-analysis-repository.ts`                                      | Existing session client + narrow RPC + explicit validation/projection; no second aggregation of raw rows.                                                       |
| `types/shop-analysis.ts`                                                      | Real response discriminant, nullable values, coverage and server-derived access; no raw party/provider data.                                                    |
| `lib/shop-analysis-api.ts`                                                    | Existing marketplaceRequest transport.                                                                                                                          |
| `lib/shop-analysis.ts`                                                        | Reuse range/comparison utilities; separate real DTO/display validation from unchanged fixture calculator, safe aggregate formatting if needed.                  |
| `components/shops/shop-analytics.tsx`                                         | Existing UI live-load/tier state, date filter, truthful missing/coverage states, expense save refresh, account/expiry cleanup. Only approved UI exceptions.     |
| `components/shops/shop-expense-dialog.tsx` / `shop-costs-manager.tsx`         | Reuse B18 live save/creation UUID recovery logic; a small shared controller extraction only if necessary, no second expense CRUD.                               |
| Actual ShopAnalysis invocation in `components/home/animated-sidebar-demo.tsx` | Only if needed to bind actual session/Shop; existing navigation and presentation unchanged.                                                                     |
| `next.config.js`                                                              | No change expected: `/api/shop` already NetworkOnly.                                                                                                            |
| `tests/shop-analysis-b19.cjs`                                                 | Actual API/repository/DTO, input/auth/tier/error/overflow qualification with controlled transport.                                                              |
| `tests/shop-analysis-b19-db.cjs` / `.sql`                                     | Isolated native PostgreSQL fixtures, actual query and monetary/boundary/permission tests.                                                                       |
| `tests/shop-analysis-b19.browser.cjs`                                         | Existing real UI under controlled local API, all required widths/motion/access/failure cases.                                                                   |
| `docs/BUSINESS-V1-B19-SHOP-ANALYSIS-QUALIFICATION.md`, task breakdown         | Only after separately approved implementation: actual results and precise cloud gaps.                                                                           |

## 10. Focused local qualification plan

- Native PostgreSQL: owner/other owner/anon/unverified; raw private tables remain
  denied; API and direct RPC tier parity; Plus/Pro/Trial/Grace exact 120h edges,
  Suspended analytics denied while B18 CRUD remains allowed; fake owner/tier/time
  parameters rejected; security definer owner/search_path/effective ACL checks.
- One fixture Order per state: paid open, processing, completed UU Protection,
  external both confirmed, one-sided/disputed, manual Sold, failed, cancelled,
  expired, refunded and ambiguous refund allocation. No real payment execution.
- Monetary truth: accepted price rather than mutable listing; exclude delivery
  and protection fee; independent payment not verified; missing versus zero cost,
  later cost edits never reprice snapshot; no pending/cancelled COGS; expense
  edit/soft deletion/date/UUID retry; CAD mismatch and aggregate overflow; partial
  and genuinely empty cases, negative estimate and zero denominator margin.
- Provenance: old Shop-name-only snapshot, deleted/renamed Listing/Shop, unknown
  source channel, absent B18 row and exact origin mismatch; no historical
  reattribution. Public Shop/Search/Favorites/Order-party projections remain private.
- Idempotency/data grain: duplicate transaction events/payment attempts cannot
  multiply an Order; authenticated view retry one UUID counts once, distinct opens
  can count twice; self/anonymous/organic versus Featured remain distinct.
- Time: Toronto midnight/DST (23h/25h days), week Monday, month/year/leap boundaries,
  equal-calendar-day previous periods, completion not acceptance attribution,
  elapsed/future buckets, expense dates and current-to-date comparison disclosure.
- Query qualification: at most four fixed ranges; bounded product/day payload,
  totals include all facts, stable tie-break, sum consistency across KPI/trend/donut,
  empty attribution coverage; local realistic EXPLAIN before any index recommendation.
- Integration: B09/B12/B14/B15/B16/B17/B18 and Resale regressions; no payment,
  scheduler, new Shop transaction authority, notification/event producer changes.
  Actual Accept/snapshot seam only in existing isolated pre-B14 historical fixture
  phase, then install/assert current B14 guards remain closed. No shared data reset.
- Browser: 390/430/820/1280/1536 × normal/reduced motion; real versus Demo labels,
  actual tier filtering, date/retry/load/error/NULL/unavailable, Add Expense API
  success/failure/idempotency, stale account response rejection, expiry refetch,
  normal pointer/keyboard/focus, no overflow, unchanged Market 390px navigation.
- TypeScript, focused ESLint/Prettier/diff and safely isolated build in future
  implementation. This planning round runs no tests and claims no new PASS.

Cloud deployment, actual ordinary-user runtime, financial provider truth and B26
Shop transaction acceptance remain separately authorized; B18's read-only install
verification is not runtime financial acceptance. No remote calls in B19 planning.

**B19 PLANNING COMPLETE — IMPLEMENTATION NOT STARTED**

**B19 STAGING NOT DEPLOYED. B19 RUNTIME ACCEPTANCE NOT PERFORMED.**

**RECOMMENDATION & RANKING NOT IMPLEMENTED.**
