# Payment / Payout / role-specific Order product contract

> **2026-10-14 flow override:** the [Master Order flow rework](ORDER_MASTER_FLOW_REWORK.md)
> supersedes conflicting payment-before-inspection, paid cancellation, Seller delivery
> compensation/dispute and Processing cancellation rules below. Historical V1 facts remain unchanged.

> **CURRENT STAGING V1 / historical implementation reference.**
> The approved [Marketplace V2 product contract](MARKETPLACE_V2_PRODUCT_CONTRACT.md)
> supersedes conflicting future product rules in this document. Current V1 code,
> applied-state records and historical transaction facts remain unchanged.
> The former "V2 implementation has NOT started" boundary is historical.
> The provider-independent V2 backend is now complete/verified on staging; real
> providers remain deferred. See [current qualification](BACKEND_COMPLETION_STAGING.md)
> and [external integrations](EXTERNAL_INTEGRATIONS_BACKLOG.md).

## Active / History and Request presentation (2026-10-11)

Purchases and Sales reuse the existing purple segmented capsule: **Active | History**,
with Active as the default. The capsule filters authoritative Orders only; it
never settles expiry or writes lifecycle state. In-progress Orders, including
Pending, Paid, shipping-cost pending and unresolved work/payout holds, stay Active.
Authoritative Expired, Cancelled, Completed and Refunded outcomes belong to History.
Completed is forward-compatible presentation only; no new backend state is added.

History uses muted cards and neutral View details, without countdowns/actions.
Its newest terminal timestamp wins (cancellation, expiry settlement, completion,
refund); missing timestamps fall back to authoritative update/creation time.
Active preserves server order. Each Order retains its exact ID, even when Listing
and participants match. Empty views say "No active orders" / "No order history yet."

`orderView=active|history` preserves list origin through detail/back. Messages
without list origin derives the destination from the linked authoritative Order.
Accept still opens its exact returned Order; Cancel returns to History. An
expired record moves out of Active after authoritative refetch, never clock ticks.

Messages compact Request shows current outcome; expanded Request shows original
Request status, linked Order outcome, agreed terms and original seller note.
Cancellation/expiry reports belong exclusively to full Order View details. This
supersedes the earlier expanded-Request cancellation metadata presentation.
Close stays red, expanded View details/Accept green, list View details neutral.
Desktop expanded Request retains split centered-cover media with compact terms
and no internal scroll; mobile permits one content scroll region.


Validation: 48-case Buyer/Seller terminal/active/history matrix, followed by 16
list/delayed-refetch/Active Request cases at 390/430/1280/1536; eight cancellation
cases and four-width Accept direct/recovery flows pass. Three real Nike history
Orders remain separate and navigate to their exact IDs. Protected Nike graph
fingerprint is unchanged. Cancel/expiry test transitions are intercepted browser
DTOs only: zero hosted transaction writes, zero runtime errors. Desktop concise
Requests have no internal scroll; mobile has at most one content scroll region.
Background refetch retains content without a skeleton; empty views are stable.
TypeScript, focused ESLint, Orders/Request/cancel/expiry/Phase E/Phase F,
Messages/Auth-session regressions, 93 documentation links and diff checks pass.
Completed/Refunded bucket/timestamp checks are pure future-state fixtures, not
new hosted lifecycle implementation. No backend/schema/migration/RPC changes;
production untouched; no commit/push.

## Manual-flow UX consistency - staging (2026-10-11)

Formal expanded Request Accept and confirmation Accept & Reserve are green;
Close/Cancel and confirmation Go Back are red. Confirm & Send and payout-settings
proceed actions remain green. Expanded terminal Request View details is green,
while the Purchases/Sales terminal list retains its neutral historical action.
Normal page back links retain the existing subtle navigation treatment.

Accept uses the authoritative returned Order ID. It first installs the existing
non-actionable barrier and refreshes Request history; once server history confirms
Accepted, the Buyer navigates to `/home?section=orders&destination=purchases&order=<id>`.
Failed/still-stale history keeps Accept blocked, shows recovery, and does not
manufacture an Order or navigate prematurely. A later successful refetch resumes
the exact destination. Refresh preserves that existing formal route.

Cancel applies the authoritative response and navigates to the authenticated
Purchases/Sales list, which refetches. A failed list read shows recoverable error
(or retains already loaded terminal data); it never fabricates an active Order.
The cancellation dialog reuses FadingDialog and the project's GlideSelect, with
560px maximum width, 24/28px padding, 24px section spacing and 20px field spacing.
Keep order is green; Cancel order is red, including its disabled semantic family.
Reason codes, validation, idempotency and backend authorization are unchanged.

Expanded Request shows Request status, linked Order outcome and immutable agreed
terms only. Cancellation actor, reason, note and timestamp live in Order View details.
The full terminal Order detail remains the report; Request Accepted and Order
Cancelled remain separate. Desktop media uses centered cover and stretched pane
geometry; mobile retains the existing stacked media and scrolling detail layout.
Verified still means official Request origin only.

Validation: four-width Accept direct/recovery flows and refresh persistence;
eight Buyer/Seller cancellation cases, list failure/retry, shared cancellation
facts, colors and terminal report navigation; four-width Confirm/Payout matrix
and fully loaded Nike/MacBook images. Browser transaction/capability mutations
are intercepted synthetic DTOs, with zero hosted transaction writes/runtime
errors. Existing staging rollback tests verify exact Accept Order/event
cardinality, cancellation idempotency and both cancellation/payment winner
orders, with canonical data fingerprints unchanged. The old pre-Phase-A Accept
admin runner rejects later migration history before testing; current Accept
regression runs through the updated rollback cancellation fixtures instead.
TypeScript, focused ESLint, Request/Accept recovery, Orders, cancellation,
Phase E Payment, Phase F Progress and Messages regressions pass.
No backend/schema/migration/RPC or lifecycle changes. Manual samples and
production untouched. No commit/push.

## Terminal Order presentation - staging (2026-10-11)

Expired and pre-payment Cancelled Orders remain visible in Purchases / Sales as
muted historical cards with neutral **View details** navigation. No Archive tab.
Both use the existing Order Detail layout as a report: immutable Listing/terms,
money breakdown, participants and authoritative transaction timestamps. Expired
shows **Order expired**, **Reservation expired**, **No payment was completed**;
Cancelled also shows original actor role, reason, optional note and cancellation
time. Next Step, active Progress Stepper, countdown, payment/account-setup/simulator
and fulfillment actions are omitted for these terminal Orders. Payment remains a
read-only historical breakdown; the account's current method is omitted.

Request acceptance remains a separate historical fact. Both Buyer and Seller
Messages now prioritize the linked authoritative outcome: **Order expired** or
**Order cancelled** is the primary muted terminal badge, with **Request accepted**
as secondary text. Accepted plus an active Order remains **Accepted** (success).
Non-Accepted Requests retain Active/Replaced/Cancelled/Expired as their primary
status. Explicit Completed/Refunded outcomes display **Completed** (success) /
**Refunded** (neutral), with Request accepted secondary. Expanded Request separates
**Request status** from **Order outcome** and retains historical View details;
there is no second Accept. The shared read-only derivation is
`lib/request-card-status.ts`; no viewer role, browser clock or local state decides
an Order outcome. Refunded reads the existing payment status. Completed requires
an explicit authoritative completion value; the current lifecycle model has no
Completed value and is unchanged. Completion is not inferred from Paid or payout.

Buyer Payment method is **not required before Accept**. Accept creates the real
Order/reservation where applicable; a Buyer may set a method afterward and pay
before expiry. Set is required at actual Payment Success only. No new Accept gate.
Active fixed Pending, Paid and shipping-cost-pending presentation is preserved.
Backend Request/payment/expiry authority, migrations and RPC semantics unchanged.
Production untouched; no commit/push.

Validation: TypeScript and focused ESLint pass. Terminal list/detail and linked
outcome tests, Request/Accept, cancellation/expiry, Phase E Payment, Phase F active
derivation, role/workspace and Messages regressions pass. Real authenticated Buyer
and Seller browser sessions cover 40 terminal/active cases, 56 Phase F active
role/fulfillment cases and 8 cancellation/recovery cases at 390/430/1280/1536,
with zero runtime errors or hosted transaction writes. Non-Nike outcomes use
intercepted DTOs only. The current Nike Order is read through its actual authorized
detail API; its Accepted Request, Expired Order and Listing match read-only SQL
fingerprints before/after. The Buyer Unset-method Accept visibility check passes.
Git-ignored screenshots/results remain under `tests/artifacts/`; no fixture writes.

Changed presentation: `formal-orders.tsx`, `formal-order-detail.tsx`,
`order-cancellation.tsx` (historical display only), `order-detail-preview.module.css`,
`order-request-preview.tsx`, `messages-chat.tsx` in `components/home/`, and the pure
`lib/order-terminal-presentation.ts` helper. The participant DTO additionally
projects existing `accepted_at`/`expired_at` via `types/order.ts` and
`lib/server/orders-service.ts`; no RPC/write path changed. Tests:
`tests/order-terminal.cjs`, `tests/order-terminal.browser.cjs`, updated cancellation
and active Progress browser regressions. Product/status/cancellation-history docs
record the new list rule. No database schema or migration changes.

## Narrow post-Phase-F cleanup - staging (2026-10-11)

Only the three remaining recorded UI bugs were corrected:

- Accept confirmation now uses the existing `profile.dialog` card surface with
  `FadingDialog`; title, snapshot terms, actions and backend call are unchanged.
- Successful Accept immediately installs a per-authenticated-user/conversation
  interaction barrier for that Request and fences pre-success history reads.
  It does not rewrite Request status or synthesize an Order. A failed refresh
  retains the barrier and shows a recoverable error/Retry; an old Active response
  remains non-actionable. Fresh server non-Active/absent state reconciles the barrier.
- Homepage planned-payment copy now distinguishes Buyer payment before fulfillment,
  Protection after confirmed handoff/receipt and later Seller payout eligibility.
  No escrow claim, 72-hour reference or payment-after-Protection implication.

New recovery tests cover synchronous barriers, stale read fencing, refresh failure,
server-truth recovery and conversation/user scope. Four-width browser checks
(390/430/1280/1536) use real staging authentication but fully intercepted synthetic
Accept/Order/history responses: correct card surface, native keyboard/focus,
Cancel/Escape zero writes, disabled duplicate confirmation and recoverable stale
eligibility. Actual transaction writes and runtime errors are zero.

Final validation: TypeScript, focused ESLint, Request/Accept, Orders, Phase E
Payment, Phase F Progress, Auth/session and Messages local regressions passed.
The unchanged Phase F/Payment read-only two-session browser matrix passed 64
state/viewport cases with zero runtime errors and transaction writes. Read-only
staging fingerprint verification preserved the manual Monitor Request and
financial state. Sensitive-value/bundle scans, documentation links and
`git diff --check` passed; Git index remains empty.

No database/migration/RPC or lifecycle/financial semantics changed. Phase E Payment
UI, Phase F Progress/Next Step, Settings, payout gate and simulator are untouched.
The manual Monitor Request is preserved. Production untouched; no commit or push.
The sections below retain earlier implementation history.


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
- Expired/Cancelled: terminal report without active Next Step or Stepper; the
  terminal cleanup above supersedes the original terminal milestone presentation.
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


## Phase E role-specific Payment UI - staging (2026-10-11)

The formal localhost:3000 Order Payment tab now derives Buyer/Seller role solely
from the authenticated user ID and persisted Order participants. Buyer sees the
Order money snapshot, own account payment method, reservation context or confirmed
amount/paid time. Seller sees Buyer payment, item earnings, separate shipping
reimbursement, zero platform fee, authoritative payout status and own payout
account metadata. Account setup links reuse Settings -> Payments & payouts.

The exact-staging Buyer-only STAGING ONLY simulator calls the existing Phase D
API. Unset/Needs attention disables it. Success ignores the mutation DTO and
refetches the exact Order; background reads retain content. Shipping pending,
Expired and Paid show no simulator/countdown. No normal production Pay action.
Independent real Buyer/Seller sessions, Settings navigation and 36 responsive
state checks at 390/430/1280/1536 passed. Held-refetch testing proved no optimistic
Paid state/full-page loading flash; refresh preserves Paid for both roles. Scoped
fixtures were removed and canonical data/manual Monitor Request preserved.

Seller Payment mirroring Buyer is fixed. The other four known bugs remain:
role-shared Stepper labels, Accept confirmation surface, Accept/refetch stale
eligibility and Homepage trust copy. Backend financial semantics, Request UI,
Overview/Fulfillment and milestone labels were not changed. Phase F remains next.
Production untouched; no migrations, emails, provider, commit or push.
See [financial state record](ORDER_FINANCIAL_STATE_STAGING.md#phase-e---role-specific-payment-ui).

## Phase D Order financial state - staging (2026-10-11)

[Phase D technical record](ORDER_FINANCIAL_STATE_STAGING.md): one additive
migration `202610110002_order_financial_state.sql` applied exactly once to staging.
Orders now separate Payment (initial Pending) and Payout (initial Not eligible),
with an authoritative paid timestamp. Three historical expired Orders were
backfilled without revival or history changes. The Buyer-only staging simulator
requires a persisted Set payment method and a payable, unexpired reservation;
shipping pending is rejected. Paid retains inventory and cannot be expired by the
unpaid reservation path. Idempotent retries emit no duplicate payment event.
Hosted lock races, competing inventory, security tests and independent Buyer/Seller
API/read/refresh checks passed. Test fixtures were removed; canonical capabilities
restored to Unset and manual Monitor Request preserved. Minimal Paid display and
unpaid-countdown hiding only; the five known UI bugs remain unchanged. No provider,
normal Pay UI, payout execution or other Phase E/F work. Production untouched;
no emails, commit or push. Earlier phase entries below are historical.

Phase A account capability infrastructure is now implemented on **staging only**.
See [schema, safe read and trusted-server boundary](FINANCIAL_CAPABILITIES_STAGING.md).
Existing users remain Unset/Unset. Settings/onboarding, payout-ready gates, Order
payment state and the payment simulator remain deferred; product rules below are
unchanged. Contract-closure statements describing no implementation refer to the
earlier documentation-only pass.

Finalized and V1 decision closure approved 2026-10-10. **This is the single authoritative product contract for
future Payment, Payout and role-specific Order UX.** It replaces the earlier
open-ended product sketch and conflicting future rules in technical proposals or
the frozen preview. It is not authorization to implement, migrate or deploy.
Provider selection, concrete schema/enums and provider-specific mechanisms remain
separate design work.

## 1. Current implementation versus future product rules

Implemented: real Auth; staging formal Requests with Create / Replace / Cancel;
atomic Buyer Accept; persisted Orders; fixed-cost reservations and server expiry;
role-specific formal detail guidance; Order Progress presentation;
Overview / Fulfillment / Payment tabs; display-only server-offset countdown;
exact Accepted Request / list -> Order navigation with URL refresh persistence;
initial-only skeletons and retained content on background refresh.

These formal transaction capabilities are staging-only in the real localhost:3000
app, bound to western-marketplace-staging (`pcaqxezdfxofysghssyo`). Auth is already
production deployed; this does not mean Orders or financial features are deployed
in production. The current detail remains a pre-payment slice: the Stepper stops
at Order accepted and the Payment tab has safe monetary summaries, not the full
future account/payment/payout UX below.

Not implemented: real payment provider; account Payment method; Seller Payout
onboarding; payout-ready Request gate; authoritative payment transition; staging
payment-success backend simulator; Order cancellation backend; shipping quote
confirmation; address/tracking; handoff-code backend; protection backend; payout
execution. These rules describe required future behavior, not current capability.

Implementation evidence: [Accept staging slice](ORDERS_ACCEPT_STAGING.md),
[formal detail parity](FORMAL_ORDER_DETAIL_PARITY.md). The
[frozen preview](ORDERS_PAYMENT_UI_PREVIEW.md) is an isolated historical visual
reference, not financial authority or a parallel implementation contract.

## 2. Account model, storage and Settings

An account is not permanently Buyer or Seller. The same user can buy and sell;
the role belongs to the individual Order and comes from authenticated participant
identity.

Two independent **account-level** financial capabilities:

| Capability | Used as | V1 limit | User-facing status | Management |
| --- | --- | --- | --- | --- |
| Payment method | Buyer | One active default method | Set / Unset / Needs attention | Set up / Manage |
| Payout account | Seller | One active account | Ready / Unset / Needs attention | Set up / Manage |

Multiple payment methods/accounts are out of scope. Financial management belongs
under existing **Settings -> Payments & payouts**, with separate Payment method
and Payout account sections. No new primary sidebar destination in V1.
Profile/Overview may show simple status summaries; management stays in Settings.
In-Order payment-method setup updates the same account-level setting, not a
per-Order banking record.

**Security requirement:** the future provider owns full card numbers, CVV, raw
bank account numbers and banking login credentials. Marketplace must not store
those raw credentials. It may persist safe provider customer/account/payment-method
references, setup/readiness and verification states, safe brand/institution display
labels and last4. Such metadata does not establish payment or payout success.
Provider onboarding, tokenization, webhooks, payout rails and verification
requirements will be designed separately; no provider is selected here.

## 3. Setup gates

### Seller Payout account

A Payout account is not required to create an account or Listing, browse, message
or negotiate. **Payout status must be Ready before sending a formal Order Request.**

Send Order Request -> authoritative payout-readiness check:

- Ready: continue Request creation.
- Unset / Needs attention / not Ready: require setup; after successful setup and
  readiness confirmation, continue the Request flow.

Do not defer onboarding until after Buyer Accept. The Seller must be capable of
receiving future payout before a reservation/payment window begins. This gate is
not yet implemented; existing staging Requests are not proof of readiness.

### Buyer Payment method

A saved method is not required to browse, message, receive or Accept a Request.

Accept -> persisted Order and reservation where applicable -> Payment -> set up a
missing method there -> Pay through the future real payment boundary.

Setup does not recreate or extend the reservation deadline. Shipping-cost-pending
remains the no-reservation exception. Do not block Accept solely because the
Buyer lacks a saved method.

## 4. Role-specific Payment tab

### Buyer: payer

The tab answers amount owed, amount breakdown, remaining time, method used,
payment outcome and next action. Before payment show:

- Payment pending.
- Authoritative Item price, Shipping, Service fee and Total, when finalized.
- Remaining reservation time when applicable.
- Payment method: safe saved-method display or Not set.
- Set up / Change payment method.
- Future real action: **Pay CA$XX.XX**.

No Seller payout controls. Shipping pending has no final payable total or ready
Pay action; it must show Shipping cost pending instead.

### Seller: payment status and payout status

Before Buyer payment show:

- Waiting for buyer payment.
- Buyer payment: Pending.
- Authoritative Order total, when finalized.
- Your earnings.
- Payout status: Not eligible yet.
- Payout account: safe display and Ready / Needs attention status.
- Reserved-for-this-buyer guidance only when the Order actually holds inventory.
- Do not hand over the item until payment is confirmed.

**Never render** Buyer card-entry UI, Pay button, Buyer payment-method selector or
Buyer-only payment-success simulator for Seller. Seller is not the payer.

### Seller earnings

V1 Seller platform fee = **CA$0**. The agreed item price is the Seller's displayed
Marketplace earnings. Payment-processing costs are platform economics and must
not be silently deducted from that displayed amount.

| Example | Amount |
| --- | --- |
| Item price | CA$80.00 |
| Buyer service fee | CA$3.20 |
| Buyer total | CA$83.20 |
| Seller earnings | CA$80.00 |

Shipping paid by Buyer is **Seller shipping reimbursement**, not item earnings
and not platform revenue. Expected payout is item earnings plus authoritative
shipping reimbursement. Seller platform fee remains CA$0. Payment-processing
costs remain platform economics and must not be silently deducted from either
Seller displayed earnings or reimbursement.

| Shipping example | Amount |
| --- | --- |
| Item price | CA$80.00 |
| Shipping | CA$10.00 |
| Buyer service fee | CA$3.60 |
| Buyer total | CA$93.60 |
| Seller item earnings | CA$80.00 |
| Shipping reimbursement | CA$10.00 |
| Expected payout | CA$90.00 |

Do not equate Buyer total with Seller earnings or expected payout. Provider
settlement execution/timing is separate technical work, not an open question
about who receives the shipping charge.
Existing fee snapshots/calculator are unchanged by this contract; the example is
not a new tax, refund or provider pricing specification.

## 5. Separate financial lifecycles

| Buyer Payment | Seller Payout |
| --- | --- |
| Pending | Not eligible |
| Processing | Pending |
| Paid | On hold |
| Failed | Eligible |
| Refunded | Processing |
| | Paid |
| | Failed |

These are distinct conceptual lifecycle vocabularies, **not paired row-by-row
transitions or final database enums**. Payout-account Ready is also distinct from
an individual Order's payout eligibility/status.

| Transaction situation | Payment | Payout |
| --- | --- | --- |
| Buyer paid, no confirmed handoff/receipt yet | Paid | Not eligible |
| Marketplace Protection running | Paid | On hold |
| Protection ends without issue | Paid | Eligible |
| Payout execution | Paid | Eligible -> Processing -> Paid |

Authoritative Buyer payment Paid produces **Payment confirmed** for Buyer and
**Buyer payment confirmed** for Seller, from the same persisted fact. The next
fulfillment step becomes available. One role must not advance via local state
while the other still reads Pending.

Payment success is not Completed. Handoff is not immediate payout. Eligibility is
not execution; payout can fail independently of successful Buyer payment.

## 6. Order Progress and Next Step

One authoritative Order/event state underlies both views. Progress derives from
**state/events + fulfillment method + viewer role**. Do not permanently hard-code
one universal five-step semantic timeline for Buyer and Seller.

| Fulfillment / role | Conceptual milestones |
| --- | --- |
| Pickup / Meet, Buyer | Order accepted -> Payment -> Meet & inspect -> Handoff confirmed -> Marketplace Protection -> Completed |
| Pickup / Meet, Seller | Order accepted -> Buyer payment -> Meet buyer / handoff -> Handoff confirmed -> Payout on hold -> Payout |
| Shipping, Buyer | Order accepted -> Payment -> Shipped -> Received -> Marketplace Protection -> Completed |
| Shipping, Seller | Order accepted -> Buyer payment -> Ship item -> Delivered / Protection -> Payout |

Visual compression can be designed later without losing these role priorities.
Seller Payout reaching Paid is the financial endpoint from the Seller's perspective;
it must not be confused with earlier protection completion/payout eligibility.

**Order Progress:** where is this transaction?
**Next Step:** what should this viewer do now?

| Same authoritative situation | Buyer Next Step | Seller Next Step |
| --- | --- | --- |
| Payment pending | Complete payment; current unavailable-provider slice truthfully says Payment pending | Waiting for buyer payment |
| Paid Pickup / Meet Order | Meet the seller | Meet the buyer |

Current staging does not implement paid fulfillment; these examples are future
requirements, not currently enabled actions. Do not use identical generic copy
for the two roles.

### Default Purchases / Sales and historical Request outcomes

Purchases / Sales defaults to Active; terminal transactions are in History. Persisted Orders are
never deleted merely because they become terminal. V1 workspace visibility:

| Outcome | Default workspace behavior |
| --- | --- |
| Unpaid Expired | Remain visible as a muted historical record; neutral View details |
| Pre-payment Cancelled | Remain visible as a muted historical record; neutral View details |
| Completed | History |
| Refunded | History |
| Disputed / issue-related | Active while unresolved |

Purchases and Sales use an Active | History capsule (Active by default), not an
Archive destination. Historical terminal Orders remain visible in History and
navigable with normal participant authorization. Terminal
detail is a read-only report, not an active workflow. Refund/issue visibility must not
be lost by treating those financial outcomes as ordinary unpaid expiry.

Request acceptance is an immutable historical fact. If a linked Order expires,
present **Order expired** as primary and **Request accepted** as secondary. Do not rewrite
Request.status to Expired and do not expose a second Accept. The same principle
applies to cancelled/completed/refunded linked Orders. Accepted Requests may retain
historical View Order access. Outcome presentation is derived separately from the
linked authoritative Order; it does not change Request lifecycle.

Expired/Cancelled visibility and separate linked outcomes are implemented by the
terminal presentation cleanup above; future outcomes remain out of scope.

## 7. Shipping cost pending and reservation

Shipping / To be arranged Accept -> persisted Order with shipping-cost-pending:

- Listing is **not reserved**.
- `reservation_expires_at` is null.
- No 30-minute payment countdown.
- No final payable total; unknown shipping is not a temporary CA$0 charge.

| Role | Conceptual pre-quote progression |
| --- | --- |
| Buyer | Order accepted -> Shipping quote -> Payment -> Shipped -> Received -> Protection -> Completed |
| Seller | Order accepted -> Set shipping cost -> Buyer payment -> Ship item -> Protection -> Payout |

The core later quote workflow is **LOCKED + NOT IMPLEMENTED**: Seller finalizes
shipping quote and Buyer confirms it. The server then atomically finalizes money,
checks the Listing is still available, reserves it, starts a 30-minute
reservation/payment window from the authoritative confirmation boundary, and
makes the Order payment-ready. If inventory is unavailable, fail cleanly without
partial money finalization or reservation. Do not infer a countdown from the
original pending Accept or implement quote negotiation in this documentation pass.

For payable accepted Orders that currently hold inventory, both participants may
see the same server-authoritative remaining reservation time:

- Buyer: Reserved for you.
- Seller: Reserved for this buyer / waiting for buyer payment.

Use persisted expiry plus server-time calibration; frontend countdown is
presentation-only. Refresh, method setup and client clock do not create or extend
a deadline. Existing fixed-cost staging reservations are 30 minutes; this document
does not change their semantics or expiry release.

## 8. Fulfillment, Protection and payout relationship

Seller payout Ready -> Seller sends Request -> Buyer Accept -> Order / reservation
where applicable -> Buyer payment -> fulfillment -> handoff / receipt ->
Marketplace Protection -> Order Completed / payout eligibility -> Seller payout.

This describes product milestones, not one combined database status.
**Order Completed** means fulfillment has completed and Marketplace Protection has
completed without a blocking open issue. It does not require provider payout to
have reached the Seller's bank account. Valid: Order=Completed and
Payout=Processing, then later Payout=Paid. Buyer may see Purchase completed;
Seller may see Sale completed alongside Payout processing.
Buyer Payment Paid != Order Completed != Seller Payout Paid.

After successful handoff / receipt, a **24-hour Marketplace Protection** window
begins. Without an issue, the transaction may complete and Seller payout becomes
eligible. An issue may keep payout On hold. Buyer payment does not itself start
Protection or complete the transaction; handoff does not immediately release money.

Do not describe the mechanism as provider-level **escrow** unless the selected
future provider actually offers that legal/payment mechanism.

### Tracked shipping and trusted receipt

Marketplace-protected Shipping requires tracked shipping. Seller must provide
valid tracking before the Order is considered Shipped. Trusted receipt is either
carrier/provider-reported Delivered **or** explicit Buyer confirmation of receipt.
Seller marking Shipped alone cannot start Protection. Protection begins after
trusted Delivered / Buyer-confirmed receipt; Buyer receipt does not require a
prior carrier Delivered event. These are future server-authoritative actions,
not client-only progression or a required carrier integration in this task.

### Report an issue

Both participants may report an issue after authoritative Buyer payment and
before Order completion where relevant. An open issue prevents automatic
completion where applicable and places/keeps Seller payout On hold. If opened
before the 24-hour Protection deadline, clock expiry must not release payout.
The issue remains open and payout On hold until resolution. V1 does not need a
multi-level appeal system. Resolution will use a later audited server-side dispute
workflow; this is not a client action that fabricates payout/refund success.

### Late payment after reservation expiry

Once server expiry has made the Order Expired and released its reservation, a
late provider success must not revive the Order, recreate its reservation, take
inventory from a new/current transaction, or reactivate the historical Request.
Use reconciliation/refund instead, preferably automatic refund where supported.
If immediate refund cannot complete, persist a refund/reconciliation-pending
financial state for trusted processing. Keep the expired Order lifecycle and
current Listing state unchanged. Financial refund handling does not rewind
inventory or overwrite Request history.

### Handoff security defaults

For Pickup/Meet, Buyer inspection precedes handoff; the server generates an
Order-scoped **six-digit** code and verifies the Seller's submission. Successful
verification is single-use and starts confirmed handoff/Protection. Regeneration
invalidates the previous code. Repeated wrong attempts are rate-limited or
temporarily locked. The client never authoritatively confirms handoff.
Avoid storing plain code; use an appropriate server-side verifier/hash design.
Exact TTL, lock duration and related security parameters are implementation
choices, not further product approvals. Do not expose codes through general
Order DTOs, logs or Broadcast.

### Optional Maps / Places

Maps UI is optional in V1; Pickup/Meet works without Google Maps. Formal location
snapshots may support placeId, placeName, formattedAddress, latitude, longitude
and meetingDetails. A small map/place context may be added later. No live
tracking, routes or navigation is in this product contract.

## 9. Required next staging testing capability

Future **STAGING ONLY - Simulate successful payment**:

- Buyer only, authenticated against the real Order.
- Exact staging environment/project bound; never production.
- Server-authoritative, persisted and idempotent; survives refresh.
- Seller observes the same state through normal reads/refetch.
- Stepper/Next Step advance only from persisted state.
- No client-only preview mutation or fake parallel React state machine.

A guarded Buyer action may initiate a server test boundary; this is not permission
for a browser to write Paid, supply trusted amounts or receive privileged keys.
Server authorization and command design belong to the next phases. Production
must have neither this simulator nor fake payment/preview local state.
The operator-only recommendation in the early proposal is superseded by this
Buyer-only staging acceptance requirement. **No simulator is implemented here.**

## 10. Upcoming implementation order

| Phase | Scope |
| --- | --- |
| A | Payment/Payout account data model and provider-independent server contract |
| B | Settings -> Payments & payouts status/setup integration |
| C | Seller payout-ready gate before Send Order Request |
| D | Authoritative Order payment state and staging-only payment-success simulator |
| E | Role-specific Payment tab bound to real payment/payout state |
| F | Role/fulfillment-specific Order Progress and Next Step derivation |
| G | Formal real payment-provider integration |
| H | Fulfillment / handoff / protection / payout lifecycle |

This ordering is a roadmap, not implementation authorization. Provider-specific
onboarding/tokenization details remain separate decisions; don't fabricate setup
readiness while the required integration is absent. No provider, financial schema,
API, migration, simulator or UI is implemented by this documentation task.

Existing Seller-only immutable Requests, atomic Buyer Accept, CAD snapshots,
Purchases/Sales navigation, Messages Buying/Selling and no-cart V1 direction remain.
Direct Listing purchase / Buy Now and expanded dispute/appeal products are outside
current planned phases. Provider-specific reconciliation, tokenization, webhook
retry and payout rails are technical implementation work; they must obey the
locked late-success/refund, issue-hold and settlement rules above.

## 11. Conflict audit and precedence

| Earlier document/rule | Resolution |
| --- | --- |
| Original product sketch left Request sender, Accept/reservation, Orders navigation and payout timing open | Seller sends, Buyer Accepts; formal staging implementation recorded separately; Orders uses Purchases/Sales; finalized financial contract above replaces the stale open questions |
| Frozen preview's shared step labels / local payment success and local protection advance | Historical localhost:3112 behavior only. Future formal progress is role-specific; staging payment is Buyer-only and persisted/server-authoritative |
| Backend proposal required operator-only payment simulation | Superseded by section 9; privileged transition remains server-only behind authenticated Buyer authorization |
| Backend proposal treated payout solely as derived eligibility, with no separate payout representation | Eligibility remains distinct from execution; model separate conceptual payment and payout lifecycles. Concrete financial tables/enums remain Phase A work |
| Early proposal still suggested a 30-minute hold for shipping pending | Removed: null expiry, no inventory reservation/countdown/total; quote workflow remains future |
| Homepage Trust design used 72-hour protection | Superseded by 24 hours. Historical copy is not authority; existing UI copy is not changed in this documentation-only task |
| Handoff/status said no Orders backend / design still open | Updated current staging boundary and next-phase references; no claim of production Orders/payment deployment |

No existing rule was found authorizing Seller card entry/Pay, a saved Buyer method
before Accept, mandatory payout setup at account/Listing creation, immediate payout
on payment, or hidden Seller processing deductions. These are nevertheless
explicitly prohibited above. No existing payout-ready Request gate was implemented;
this finalized requirement precedes future financial implementation.

## 12. Known implementation bugs and pending UI alignment

These are implementation tasks, not product ambiguities. Record only; do not
repair them during documentation closure.

| ID | Current implementation deviation | Source | Locked correction |
| --- | --- | --- | --- |
| A | Fixed on staging in Phase E: role-specific authoritative Payment UI | components/home/formal-order-detail.tsx | Seller payment-status/earnings/payout presentation; no Buyer payment controls |
| B | Fixed on staging in Phase F: authoritative role/fulfillment Progress and Next Step | components/home/order-progress.tsx | Derive milestones from authoritative state, role and fulfillment |
| C | Fixed on staging: Accept confirmation reuses approved FadingDialog card surface | components/home/order-request-preview.tsx and .module.css | Use approved confirmation surface while retaining FadingDialog behavior |
| D | Fixed on staging: successful Accept stays non-actionable until authoritative history reconciliation | components/home/messages-chat.tsx; hooks/use-formal-order-requests.ts | Reconcile known success / stale eligibility without changing atomic backend semantics |
| E | Fixed: Homepage distinguishes Buyer payment before fulfillment from later payout eligibility | components/listings/homepage-footer-content.ts | Distinguish Buyer payment before fulfillment from later payout/settlement |

Default terminal-list filtering and separate linked Order outcome presentation
are also approved pending implementation, not changes already made to staging.
The existing detail tabs/countdown/navigation foundation remains implemented.

## 13. Decision closure and next-phase boundary

**PRODUCT CONTRACT CLOSED FOR CURRENT PLANNED PHASES.**

No material product decisions currently require user input.

Phase A remains safe to start when separately authorized: Payment/Payout
account data model and provider-independent staging server contract. Existing
A-H ordering remains. Provider choice, onboarding/tokenization mechanics,
webhook retries, payout rail timing, exact handoff TTL/lock duration and internal
names are provider/security/implementation decisions, not reasons to reopen the
product contract. Audited dispute implementation may come later without weakening
the locked open-issue hold or automatic-completion fence.

This closure records decisions, not delivery: no code/UI/backend/schema/RPC/RLS,
migration, staging fixture, production change, commit or push.
