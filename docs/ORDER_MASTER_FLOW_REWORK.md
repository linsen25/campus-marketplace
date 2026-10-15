# Master Order flow rework — staging

The 2026-10-14 Master Order contract and its two resolved cancellation decisions supersede conflicting older V2 flow descriptions. Scope is `western-marketplace-staging` / `pcaqxezdfxofysghssyo`. This is provider-independent authority, not real money movement.

## Authoritative flows

| Flow | Progress stages | Ordinary cancellation cutoff |
| --- | --- | --- |
| On Campus | Agreement → Payment → Meet / Inspect → Handoff → Protection → Completed | Successful handoff verification |
| Seller delivery | Agreement → Payment → Delivery / Inspect → Handoff → Protection → Completed | Successful handoff verification |
| Courier | Agreement → Payment → Shipped → Delivered / Received → Protection → Completed | Authoritative shipment |

On Campus payment no longer requires an inspection receipt. Existing historical inspection records remain unchanged. No new Campus payment timer was introduced. Delivery keeps the original one-time 30-minute checkout/payment window, or the Buyer-origin Offer's 12-hour checkout claim followed by that one-time window.

Paid means financial commitment, not possession or payout eligibility. Seller delivery now has a Seller-only, Paid-only, persisted, idempotent `started_at` milestone. Courier does not use it. Possession starts the existing 24-hour Protection; shipment alone does not. Completion and sale payout eligibility remain dependent on mature, unheld Protection.

## Cancellation and settlement

Frozen Order economics are preserved. New private settlement authorizations record secured cents, Buyer release cents, reversed Buyer fee, zero retained platform fee, zero sale payout, and any Seller delivery-compensation entitlement. No provider refund or payout is fabricated. A cancelled Order may retain historical `payment_status = paid`; the separate authorization records the release required. It must not be misrepresented as an executed refund.

| Circumstance | Authoritative disposition |
| --- | --- |
| On Campus before handoff | Full secured Buyer amount released; no cash cancellation penalty |
| Seller delivery before delivery starts | Full Buyer release including Delivery fee |
| Seller cancels after delivery starts | Full Buyer release; no delivery compensation |
| Buyer ordinary cancellation after delivery starts | Item and Buyer fee released; Delivery fee becomes Seller compensation, not sale payout |
| Buyer full-refund request; Seller agrees | Persist both actors' request/response and timestamps; full release |
| Seller disputes a full-refund request | Existing Case domain, `pre_handoff_cancellation` phase; settlement remains held |
| Courier before shipment | Full Buyer release including Delivery fee |

A Buyer allegation is context only. Neither selecting “Seller fault” nor requesting “mutual” can self-award a refund. The Seller's disagreement is not a financial win. The existing unresolved Case boundary remains `resolution_required`; adjudication/execution remains deferred rather than inventing a final fault decision.

### Processing cancellation

An eligible cancellation received during Processing persists actor, server request time, reason/note, Payment and fulfillment context, path and state. It blocks new payment attempts, delivery start, shipment, handoff and completion. Failed payment finalizes cancellation with no secured amount. Later Paid authorizes the full applicable release and finalizes cancellation in the same transaction; fulfillment does not resume. The client does not resubmit cancellation.

## Order Detail

The formal V2 page uses this order:

1. Compact Order header.
2. Existing `OrderProgress` → Velora Stepper.
3. Agreement / Terms: frozen Original asking price → Confirmed terms and role-specific economics.
4. Current Step, using current confirmed terms only.
5. Role/fulfillment/state-specific explanatory Cancel section.
6. Existing Overview / Fulfillment / Payment tabs, default Overview.

The standalone summary was removed. Compact Listing media/condition/category/description/counterparty/identity remain inside Overview. The existing compact sizing overrides and shared Listing components are retained. Original asking price uses the immutable Order snapshot; no live Listing baseline is substituted. No missing original location/time is invented.

Buyer-held handoff presentation has separate QR placeholder and real six-digit blocks, only after Paid and never for Courier. QR rendering/scanning remains deferred: no dependency, fake pattern or visible raw token. Seller verifies the real existing code. One redeemed authorization invalidates both channels.

## Backend and API

Additive staging migrations:

| Migration | SHA-256 |
| --- | --- |
| `202610140001_campus_payment_before_inspection.sql` | `cb471cae0d202873b57163a35462741f67e870e82f5ec712554ebdeb2978b52f` |
| `202610140002_order_cancellation_settlement.sql` | `05b99441c452909904d926fb42f7c79e8cb17d9e216edf0fab712cdccbea01f7` |

Both applied once to staging after rollback qualification and a dry-run restricted to these filenames. Deployed function bodies, security-definer ownership, empty search paths and grants were checked. Historical Listing/Request/Order/event fingerprints were equal before and after application. Applied historical migration files were not rewritten.

Existing `/api/orders/:id/cancel` now accepts ordinary cancellation and Processing intent. Participant-scoped `/api/order-domain/:id/:operation` adds:

- GET `cancellation`.
- POST `start-delivery`.
- POST `request-cancellation` with reason/note and action UUID.
- POST `respond-cancellation` with `agree`/`dispute` and action UUID.

The fulfillment projection includes delivery start and cancellation/settlement state. Delivery Pay reuses the existing trusted staging simulator outcome; callers cannot choose Paid/Failed or submit amounts. The service retains staging guards, verified auth, same-origin writes, no-store responses and sanitized errors. Exact address visibility still comes from the existing private checkout RPC, never Offer history or notifications.

All critical mutations share Listing → Order locking. Command identities bind actor, Order, action and input. Private tables/helpers have no user/service-role direct grants. Handoff/shipment/payment progression checks cancellation/Case holds. Legacy V1 cancellation is delegated to its unchanged rules.

## Qualification and tooling

- Rollback fixtures cover payment before inspection, roles, early credential rejection, idempotency, paid cancellation for all flows, Processing → Cancel → Paid/Failed, post-start compensation, Seller cancellation, full-refund agreement/dispute, Case hold, shipment/handoff cutoffs, immutable Request acceptance and exact event counts.
- Concurrent Cancel/Handoff qualification uses independent backend PIDs/transaction IDs. The leader holds its transaction after the operation; the follower is observed waiting on that lock via `pg_stat_activity`/`pg_blocking_pids`. Both winner orders are tested for On Campus and Seller delivery.
- Browser fixtures exercise the actual components/hooks with local transport contracts, at 390/430/1280/1536 for both roles; no hosted browser mutation or login is used.
- Final actual-component browser checks passed: Order flow/cancellation 252 cases and Messages/Offer 204 checks. TypeScript, focused ESLint, API/role/input guards, Auth/session, TEXT/IMAGE/Realtime, legacy Order and Payment/Progress regressions passed. The optimized staging-configured build passed; its 46 browser files had no privileged/session secrets. Documentation links and `git diff --check` passed.
- Across two runs, 24 Cancel/Handoff races passed all outcome/cardinality/inventory checks, with zero deadlocks or lock timeouts. The first run required exact journal recovery for a cleanup-tool deferred-trigger ordering error; the final 12-race run completed automatic cleanup. Both cleanup baselines matched. The Storage metadata deletion allowance was transaction-local and scoped to synthetic snapshot batch IDs; no application Storage behavior changed.
- The real localhost:3000 app responds HTTP 200 and its client bundle contains the staging Supabase URL, with no production Supabase URL. No fresh manual Buyer/Seller browser-session acceptance is claimed; role UI was tested in browser fixtures and authority against synthetic staging identities.
- DB lint reports only the existing `marketplace_private.order_money` volatility warnings; no unrelated auto-fix. The global `GlideSelect.jsx` lint parser issue remains existing technical debt.

Tooling uses a separate ignored CLI working directory with an explicit staging project ref. The repository's cached project link is not used or rewritten. Synthetic journals/diagnostics are ignored. Recovery is exact journal-scoped, never a Demo/Nike/D1 reset.

Commands:

```text
node tests/order-master-staging-admin.cjs verify
node tests/order-master-concurrency.cjs
node tests/order-master-concurrency.cjs recover
node tests/order-current-step.cjs
node tests/order-domain-api.cjs
node --openssl-legacy-provider tests/order-flow-ui.browser.cjs
```

The candidate rollback runner is for pre-application qualification; do not rerun candidate DDL after deployment. The concurrency runner refuses an existing journal until that exact scope is recovered.

Production, `.env.local`, canonical Demo/Nike/manual/D1 data are outside this change. No real payment/payout provider, QR package, commit or push.

## Files changed in this Master pass

This list excludes earlier uncommitted Messages/Offer/UI work preserved in the working tree.

- `components/home/formal-v2-order-detail.tsx`
- `components/home/order-current-step.tsx`
- `components/home/order-campus-payment.tsx`
- `components/home/order-flow-cancellation.tsx`
- `lib/order-current-step.ts`
- `lib/order-flow-api.ts`
- `lib/server/order-domain-service.ts`
- `supabase/migrations/202610140001_campus_payment_before_inspection.sql`
- `supabase/migrations/202610140002_order_cancellation_settlement.sql`
- `tests/order-current-step.cjs`
- `tests/order-domain-api.cjs`
- `tests/order-flow-ui.browser.cjs`
- `tests/order-master-payment-qualification.cjs`
- `tests/order-master-payment-staging.sql`
- `tests/order-master-settlement-staging.sql`
- `tests/order-master-staging-query.cjs`
- `tests/order-master-staging-admin.cjs`
- `tests/order-master-concurrency.cjs`
- `docs/ORDER_MASTER_FLOW_REWORK.md`
- `docs/ORDER_PAYMENT_PRODUCT_DESIGN.md`
- `docs/MARKETPLACE_V2_PRODUCT_CONTRACT.md`
- `docs/PROJECT_STATUS.md`

## Later locked UI composition

The [formal V2 stage-page UI](ORDER_STAGE_FLOW_UI.md) supersedes this pass's
historical three-tab presentation. Master backend semantics and qualification
remain unchanged; Back/Next are bounded presentation navigation only.
