# Phase D: authoritative Order financial state

> **CURRENT STAGING V1 / historical implementation reference.**
> The approved [Marketplace V2 product contract](MARKETPLACE_V2_PRODUCT_CONTRACT.md)
> supersedes conflicting future product rules in this document. Current V1 code,
> applied-state records and historical transaction facts remain unchanged.
> V2 implementation has NOT started. Check the V2 contract before further V1
> feature expansion; this notice authorizes no implementation or data operation.

## Phase F role/fulfillment Progress and Next Step - staging (2026-10-11)

Formal Order Detail now derives one read-only presentation from the persisted
Order DTO and the authenticated Buyer/Seller identity. `lib/order-progress-ui.ts`
selects Pickup/Meet, fixed Shipping or shipping-quote milestones; the shared
`OrderProgress`/Velora Stepper renders supplied labels and variable step counts.
The frozen preview retains its isolated legacy sequence. No preview transaction
store or client progression participates in formal derivation.
Formal flows have 5/6/7 milestones. Mobile uses the same markers and rail in a
vertical arrangement so the full labels remain readable; desktop remains
horizontal. The isolated preview keeps its existing responsive layout.
Paid marks only accepted/payment complete, with no current future milestone;
Next Step interprets the persisted awaiting-fulfillment state separately.

- Fixed Pending: Buyer **Complete payment**; Seller **Waiting for buyer payment**.
  Only the authoritative unpaid reservation displays a countdown.
- Paid Pickup/Meet: Buyer **Meet the seller**; Seller **Meet the buyer**. Shared
  snapshot location, schedule and optional note appear; Payment is completed.
- Paid Shipping: Buyer **Waiting for seller to ship**; Seller **Ship the item**.
- Shipping cost pending: Buyer **Waiting for shipping quote**; Seller **Set
  shipping cost**. No quote action, countdown or finalized payable total.
- Expired: terminal **Reservation expired**, role-specific explanation, no active
  Payment step. Completed/current/inactive milestones have accessible labels.
- Fulfillment, Protection, completion and payout milestones remain inactive.
  `payoutStatus` never fabricates fulfillment progress; Not eligible stays inactive.

Phase E Payment UI and simulator semantics are unchanged. A successful simulator
POST followed by the exact authoritative Order GET naturally updates this
presentation; no optimistic transaction transition is introduced. Overview,
Fulfillment, Payment tabs and Next Step/Stepper styles are preserved.

No migration, schema, RPC, reservation, inventory, Request/Accept, financial
semantics, provider or future fulfillment action changed. Production untouched.
The manual Monitor Active Request `88260b5b-0851-4bf2-a100-8a5c11edd8c9` is preserved.
Remaining known bugs: Accept confirmation surface; Accept success/history-refetch
stale eligibility; Homepage payment/payout trust copy. Global GlideSelect.jsx
parser debt remains pre-existing. No commit or push.

Phase F validation passed: 64 read-only state/viewport cases in independent
real Buyer/Seller staging sessions (Pickup and Meet tested separately), 8 detail/
navigation checks and 44 skeleton/loading checks. All report zero runtime errors
and zero transaction writes. Approved Phase E browser regression passed 36
state/viewport cases, including exactly one Buyer simulator POST, held exact Order
GET, subsequent persisted Paid presentation and Seller refresh of the same Order.
Pending presentation stayed until the authoritative GET completed; Paid then
marked accepted/payment complete and removed the reservation Next Step/countdown.
Seller never received Buyer payment controls; Buyer never received payout account
metadata. Scoped synthetic fixtures were removed, capabilities restored to Unset,
and canonical/manual history fingerprints unchanged.

TypeScript, focused ESLint, pure mapping/Stepper accessibility tests, financial/
capability guards, payout gate, Request/Accept/static contracts, Orders/schedule/
expiry, Auth/session and Messages TEXT/IMAGE/Realtime regressions passed.
Staging financial rollback SQL regression passed without applying migrations.
An additional optional local marketplace-security PGlite check could not run:
the separately installed PGlite tooling is absent; no dependency was installed.
The corresponding hosted rollback security regression passed. Sensitive-value/
browser bundle scans, documentation links and git diff --check passed; index empty.
Screenshots/results are Git-ignored. No production access, email, commit or push.

Earlier sections below are historical implementation records.


Verified on 2026-10-11 against **western-marketplace-staging**
(`pcaqxezdfxofysghssyo`), using the real localhost:3000 application.
Production was not accessed or changed. No emails, commit or push.

## Schema and migration

Migration: `202610110002_order_financial_state.sql`.
SHA-256: `2ccaecae40e39699ca5ade46dbe2fb92c79cbc638135189a7cccaf24c8758c92`.
Applied exactly once to staging after rollback validation and hash review.
Earlier Request, Accept and payout-gate migrations were not edited.

The existing Orders table previously allowed only `payment_status=not_enabled`,
with no paid timestamp or separate payout state. Phase D extends that table:

| Field | Domain / initial value |
| --- | --- |
| payment_status | pending, processing, paid, failed, refunded; initial pending |
| payment_paid_at | Server timestamp; initially null |
| payout_status | not_eligible, pending, on_hold, eligible, processing, paid, failed; initial not_eligible |
| fulfillment_status | Existing awaiting_payment plus awaiting_fulfillment after payment |

The three existing expired Orders were backfilled from not_enabled to pending,
with null paid timestamp and not_eligible payout. Their lifecycle, inventory,
reservation timestamps and transaction history were not revived or rewritten.
New Orders receive the same unpaid financial defaults. Payment and payout are
independent: payment does not complete an Order or execute/qualify payout.
The additional financial domain values reserve future transitions; Phase D does
not implement processing, refunds or later payout progression.

## Authority and API

`public.marketplace_simulate_order_payment_success(uuid,uuid,uuid)` is a
security-definer, empty-search-path function owned by postgres. Only service_role
can execute it. Direct authenticated/anonymous execution and direct financial
table writes remain denied.

`POST /api/orders/[orderId]/simulate-payment-success` is an authenticated,
same-origin, no-store **staging-only test API**, not a normal Pay control.
The server derives the Buyer from the verified cookie session and ignores client
identity, readiness, payout status and paid timestamp claims. Both the server
environment/service-key guard and database JWT project guard require the exact
staging project. Missing/mismatched/production configuration fails closed.
Seller, unrelated user and anonymous calls return 403, 403 and 401 respectively.
The bounded response exposes safe Order fields, not secrets or provider metadata.

The first payment requires the persisted Buyer's payment method to be Set, an
open, finalized, reserved Order and a deadline that has not passed. Unset/Needs
attention returns `buyer_payment_method_not_ready`; shipping pending and expired
Orders return `order_not_payment_ready`. Shipping pending still has no payable
total, inventory hold or reservation deadline. Seller payout readiness is not
rechecked after the already-authorized Order was created.

## Atomic transition, expiry and retries

Success atomically records Paid with the database timestamp, changes fulfillment
to awaiting_fulfillment, retains Open and the Accepted Request, and keeps the
Listing reserved by the same Order. Payout remains not_eligible. Exactly one
immutable `payment_paid` transaction event records Buyer actor and explicit
`staging_simulator` provenance; it triggers the existing safe realtime
invalidation. No fake TEXT message or provider reference is generated.

The simulator uses command idempotency, the shared Buyer capability lock, and
Listing then Order locks. The existing authoritative reservation settler now
expires only unpaid Orders. Paid Orders retain their original deadline as
history but never expire or release inventory through the unpaid path. Completed
same-key and new-key retries return the original Paid timestamp without another
payment event, including after the payment method is cleared.

Lazy-expiry denial uses a safe domain-error envelope so legitimate expiry can
commit rather than being rolled back by an exception. It never records Paid.
The API maps these domain errors to 409 with sanitized copy.

## Verification and cleanup

- Local API/static tests cover project/key/session/CSRF guards, identity injection,
  safe responses, errors and direct-client denial expectations.
- Hosted pre/post-apply rollback tests cover financial gates, defaults/backfill,
  immutable fields, Request/Accept regressions, read isolation and expiry.
- Two actual competing transactions: payment first remains Paid/Open/reserved
  after the old deadline; expiry first remains Expired/Pending/released and
  rejects payment. The second transaction was observed waiting on the lock.
  A competing Buyer cannot Accept the Paid Order's Listing. No deadlock occurred.
- Independent real Buyer/Seller browser sessions tested the API denials, Set
  requirement, shipping pending rejection, injected identity rejection, timestamp
  idempotency and authoritative reads. Refreshed Order UI shows Payment paid and
  hides the unpaid reservation countdown; no runtime errors occurred.
- Synthetic race users and all new browser/race transaction fixtures were removed.
  Demo capabilities were restored to Unset; zero financial capability rows remain.
  Canonical data fingerprints and the manual Monitor Active Request were preserved.
- Final TypeScript and focused ESLint passed. Local Auth/session, capability,
  payout-gate, Request/Accept, Orders and TEXT/IMAGE/Realtime API/static/client
  regressions passed. Served browser privileged-secret scan and commit-eligible
  configured-secret/JWT scan passed; 114 documentation file links resolved.
  `git diff --check` and new Phase D file whitespace checks passed. The Git index
  remains empty. The broader working tree includes earlier uncommitted phases;
  this is not a claim that all existing changes were authored in Phase D.

Repeat local tests: `node tests/order-financial.cjs`.
Hosted rollback/review: `node tests/order-financial-staging-admin.cjs test` or
`verify`. Race and browser modes deliberately create and finally remove scoped
staging fixtures; browser mode uses ignored demo credentials and external
Playwright/Chrome tooling. Never target production.

## Remaining boundaries

No real provider, card entry, bank onboarding, normal payment button, payout
execution, shipping quote, address/tracking/handoff/Protection/issue handling,
refund engine or Order cancellation was added. The simulator is a server test
boundary for later provider evidence, not a claim that real money moved.

The five known UI bugs remain unchanged: Seller Payment mirrors Buyer; shared
Stepper labels; Accept confirmation card surface; successful Accept plus failed
history refetch stale eligibility; Homepage payment/payout trust copy. See the
[product design](ORDER_PAYMENT_PRODUCT_DESIGN.md#12-known-implementation-bugs-and-pending-ui-alignment).
Phase E/F UI work remains separate. Phase D stops here for manual inspection.

## Phase E - role-specific Payment UI

Phase E connects the unchanged Phase D DTO/API to the formal Order Payment tab.
`FormalOrderPayment` derives role from authenticated user ID versus buyerId or
sellerId. It uses the existing own-account `useFinancialCapabilities` hook;
Buyer never renders payout account metadata and Seller never renders Buyer card
controls. No preview perspective, workspace-based role or local financial state.

Buyer Pending displays persisted item/shipping/service fee/total and Set/Not set/
Needs attention, safe masked account metadata and Settings navigation. Buyer Paid
shows Payment confirmed, amount and locally formatted paid timestamp. Seller
Pending/Paid shows Waiting for buyer payment / Buyer payment confirmed, item
amount plus separate shipping reimbursement, zero Seller platform fee, expected
payout excluding Buyer service fee, persisted payout status and own account state.
An attention-needed payout account links to Settings without changing the Order.

The explicit dashed STAGING ONLY test area is visible only for an authenticated
Buyer of an open, finalized Pending reservation in the exact approved staging
configuration. Set is required; errors use the safe Phase D API messages. It calls
the existing HTTP endpoint through the cookie/same-origin request helper, never
an RPC. A stable action UUID prevents accidental duplicate commands. Success
ignores the mutation DTO and awaits a generation-guarded exact Order GET before
mapping server data into the existing workspace. If that read fails, a Refresh
Order action is shown rather than locally setting Paid or repeating payment.

Shipping pending has no finalized total/countdown/test action. Expired has
role-specific explanation and historical amounts without payment actions. Future
Processing/Failed/Refunded display state text without implementing transitions.
Paid has no payment countdown/simulator and does not imply Completed.

Verification: SSR/component tests cover role privacy, money, capability states,
future/terminal states, loading/error and production/mismatched/unknown environment
hiding. Real independent staging sessions exercised the visible Buyer control:
exactly one UI simulator POST and an exact Order GET. With that GET held, content
remained Pending with no full-page skeleton; after release both Buyer and Seller
read/refreshed Paid with payout Not eligible. Settings links and 36 responsive
checks across 390/430/1280/1536 passed; no runtime errors. Temporary fixtures were
cleaned and canonical capability rows restored to zero. Served browser secret
scan passed. Repeat local tests: `node tests/order-payment-ui.cjs`;
scoped real browser run: `node tests/order-payment-ui-staging.cjs` with external
Playwright/Chrome environment variables as in Phase D.

The mobile/desktop workspace already remounts detail when crossing breakpoints;
responsive tests reopen Payment after that existing remount. No navigation change
was made. Phase D's historical five-bug/deferred lists above describe that phase:
only Seller Payment mirroring Buyer is now fixed. Phase F milestone work and the
other three known UI fixes remain deferred. No backend/migration/production change,
normal Pay/provider integration, emails, commit or push.

Final Phase E validation passed: TypeScript, focused ESLint, Auth/session,
capability/payout gate, Request/Accept/Orders, Phase D financial API and hosted
rollback/expiry tests, TEXT/IMAGE/Realtime regressions, served and commit-eligible
secret scans and documentation links. The existing detail loading regression was
run serially after fixture cleanup: eight Buyer/Seller viewport checks, zero
runtime errors and zero browser mutation requests. Its blocked external asset
requests are deliberate transport guards. The UI simulator button remains pending
through the exact read; a read failure offers refresh without optimistic Paid.
The test runner now also supports exact-scope browser cleanup recovery and handles
response/click promises together so rejection does not bypass fixture cleanup.
