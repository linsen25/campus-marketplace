# Formal Order Detail presentation parity

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


V1 [decision closure](ORDER_PAYMENT_PRODUCT_DESIGN.md#13-decision-closure-and-next-phase-boundary)
is now authoritative. Current code has not yet applied default terminal filtering,
separate linked Order outcomes, full Seller Payment or role-specific Stepper
labels. The validation below proves the implemented foundation, not those pending
changes. Known bugs are recorded, not repaired, by the documentation closure.


This records the implemented pre-payment staging slice. The
[finalized Payment/Payout contract](ORDER_PAYMENT_PRODUCT_DESIGN.md) now governs
future account setup, financial state and role/fulfillment-specific Stepper and
Payment tab semantics. The shared labels and safe unavailable-payment summaries
here are current implementation, not the final universal financial UX. No parity
code is changed by that documentation finalization.


This pass connects the approved detail presentation to existing staging Order
DTOs. It does not change backend behavior, Request lifecycle, Accept, reservation,
expiry, filtering, or archive policy.

- Shared `OrderProgress` uses the existing Stepper and approved step labels in
  both the frozen preview and formal detail. Current persisted Orders stop at
  Order accepted; payment and fulfillment are not simulated.
- `FormalOrderDetail` reuses the approved CSS, FluidTabs, LocalTabContent,
  ListingMedia, OrderVisualTerms and OrderCountdown. Next Step derives Buyer or
  Seller from the authenticated participant ID. No preview store is mounted.
- Overview and Payment use server monetary snapshots, omitting null amounts.
  Fulfillment is read-only. Shipping pending has neither reservation countdown
  nor payable total. There are no payment, shipment, handoff or cancellation
  actions.
- Orders use the existing Home URL convention:
  `/home?section=orders&destination=purchases&order=<persisted-id>` (or `sales`).
  List and Accepted Request links select the exact persisted Order. Refresh
  retains selection; inaccessible IDs show an error rather than another Order.
- Accepted Request links are resolved from the existing authenticated Orders
  workspace using requestId and conversationId. No Request API projection,
  schema, RPC or RLS change was needed.
- Detail skeletons appear only during initial remote loading. Background refresh
  retains the full detail. The other approved Request/timeline/composer fixes are
  preserved.

## Validation

The [browser checks](../tests/formal-order-detail.browser.cjs) fail closed on a
non-staging runtime, use independent existing Buyer A / Seller A sessions, block
transaction writes and read acknowledgements, and never click Accept.
Eight Buyer/Seller cases passed at 390/430/1280/1536, with zero runtime
errors and zero transaction writes. They verify exact Accepted Request navigation, list navigation,
deep-link refresh, Stepper, all tabs, initial skeleton and retained background
content, role identity and no horizontal overflow.

Existing Orders available during this pass were expired. Running reservation and
shipping-pending presentation checks therefore use explicitly intercepted browser
response projections, not new staging fixtures or proof of a live reservation.
They cover role-specific guidance, server-offset countdown, unchanged deadline on
refresh, missing payable total, and absence of unimplemented actions.

The existing recovery suite also checks Buyer A / Seller A / Seller B across
all four widths. The preserved manual Active Request is separately checked by the existing
read-only fixture audit; no Accept call or new Order is permitted.
Screenshots/results remain in Git-ignored `tests/artifacts/order-accept/`.

TypeScript, focused ESLint, Request/Accept static/API tests, timeline, frozen
Orders interaction/scheduling/replacement/workspace tests, TEXT/IMAGE/Realtime
API and migration static tests, Marketplace session tests and `git diff --check`
passed. No production access, migrations, commit or push.
