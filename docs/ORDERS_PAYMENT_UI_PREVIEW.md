# Orders / Order Request interaction preview

> **CURRENT STAGING V1 / historical implementation reference.**
> The approved [Marketplace V2 product contract](MARKETPLACE_V2_PRODUCT_CONTRACT.md)
> supersedes conflicting future product rules in this document. Current V1 code,
> applied-state records and historical transaction facts remain unchanged.
> V2 implementation has NOT started. Check the V2 contract before further V1
> feature expansion; this notice authorizes no implementation or data operation.

The [closed V1 product contract](ORDER_PAYMENT_PRODUCT_DESIGN.md) supersedes
historical preview default-list/outcome rules and delivered-before-receive gates.
Formal Shipping requires tracking and starts Protection on trusted Delivered OR
Buyer receipt; Order Completed is independent of payout Paid. Default unpaid
Expired/pre-payment Cancelled are hidden without deletion; Accepted Request and
linked outcome remain separate. Preview code/tests below are frozen history,
not proof that these formal rules are implemented. Handoff security defaults and
optional Maps are now locked; local simulations remain non-authoritative.


## Historical preview scope and product precedence

This document records the frozen localhost:3112 preview, not the current formal
app or future financial contract. The [finalized Payment/Payout contract](ORDER_PAYMENT_PRODUCT_DESIGN.md)
controls future work: account settings and readiness gates, separate payment/payout
states, role-specific progress and a Buyer-only persisted server-authoritative
staging payment simulator. The shared step mapping and local simulation controls
below describe existing isolated preview behavior only; do not carry them into
formal implementation. Current formal staging evidence is in
[Accept staging](ORDERS_ACCEPT_STAGING.md) and [detail parity](FORMAL_ORDER_DETAIL_PARITY.md).


**LOCAL / EPHEMERAL STAGING PREVIEW ONLY.** No Order database, migration, API,
payment provider, inventory lock, carrier integration, payout or dispute system.
No Order/address/shipment data is written to Supabase or browser storage. No real
payment details are collected. The staging demo dataset remains unchanged.

Run `npm run demo:dev:staging` and use the local demo credentials described in
[STAGING_DEMO_DATA.md](STAGING_DEMO_DATA.md). The viewer runs at localhost:3112.
New interaction and simulation controls fail closed unless the public environment
is staging and the project URL is exactly `pcaqxezdfxofysghssyo.supabase.co`.

## Editor and immutable request history

In Seller Messages, open `+` → **Send Order Request**. Attachment remains unchanged.
The fixed conversation listing uses ExpandedCardPreview, ListingMedia and
ListingDetails beside native Create Listing `.form`/`.field`/`.hint` styles.
The editor caps at 1040px with a scrollable body and visible blue footer action.
Pickup/Meet/Shipping use Profile `.segment`; Pickup and Meet retain independent
location/time drafts, and Shipping retains its fee/method. Price and note are
shared transaction fields. Go Back preserves all editor values.

Client-only validation requires a positive agreed price with at most two decimal
places; Pickup/Meet require a nonblank location. Shipping cost offers Included,
Flat rate (required nonnegative amount, including zero), and To be arranged.
Shipping method is optional. The flat-rate draft survives switching cost options.
Pickup/Meet requires location, date and time; there is no schedule TBD mode.
Send Request stays disabled for invalid fields. Confirmation includes only the
selected fulfillment terms and the immutable-request warning.

Confirm & Send appends a local request with a cloned, recursively frozen snapshot.
Earlier unaccepted active requests for that conversation become Replaced without
changing their terms or chronological position. Accepted requests remain Accepted. Any Order already created from an earlier request retains its
own status and immutable snapshot. Cards stay compact and image-free, with Active/Replaced/
Accepted/Expired pills and subtle Preview only / Not sent copy. No Edit action exists.
The expanded card uses the Verified top-action slot. Verified means intended
official request origin only, not seller identity, item authenticity or payment.

## Clickable flows

Accept an Active expanded request to create one local Order and navigate to its
relationship-owned Order Detail. Replaced requests cannot be accepted; repeated acceptance cannot
create duplicate Orders. The accepted Order captures the original listing and
transaction terms. Later drafts cannot change that snapshot.

Buyer/Seller view controls inspect **the same in-memory transaction** in one
browser. They do not sign in as another person, grant capabilities or synchronize
between independent sessions. Refreshing Home clears every preview. Account change
or logout also clears the context. Temporary Orders are derived from authenticated participant IDs into Purchases
(buyer) and Sales (seller), with shared compact cards. A debug perspective never
adds an Order to another workspace.
Preview detail navigation follows Home's existing local destination state instead
of changing the URL/query, so Accept does not trigger a new session/API lookup.

- **Pickup / Meet:** Accept → Reserved / Payment pending, with a local 30-minute
  countdown → Continue to Payment → DEV Simulate payment success → Paid / Awaiting
  fulfillment → Buyer Confirm item is acceptable → inspect confirmation → reveal
  six-digit local Handoff Code → Seller Enter Handoff Code → incorrect code gives
  an inline error, correct code enters the preview 24-hour protection window.
  Handoff does not immediately complete the Order. A labelled staging debug control
  may advance the protection window to Completed; it performs no payout.
- **Shipping:** Accept → Buyer Add shipping address (synthetic details only) →
  Save & Continue → Order Summary → DEV Simulate payment success → Seller can see
  the preview address and enters carrier/tracking → Confirm Shipped → DEV Simulate
  package delivered → Buyer Confirm received → safety confirmation → the same
  preview 24-hour window. Delivered alone does not complete the Order.
- **Pre-payment cancellation:** Buyer or Seller Cancel Order, select a required
  reason and optional note, confirm Cancel this Order?. The Order becomes Cancelled
  and the Accepted Request remains Accepted. A local conversation cancellation
  event records the time/reason. Reservation stops; no payment/refund occurs.
  Listing availability is conceptual only; no live listing changes.
- **Post-payment issue:** either perspective Report an issue → role-specific
  reasons → local Issue reported / Preview only and payout text On hold. There is
  no refund, return, manual review or dispute decision. Debug completion is disabled
  while the issue hold is displayed.

Both roles can Cancel Order only while reserved and unexpired, before payment.
Neither receives normal cancellation after payment; use Report an issue instead.
No Seller Buyer-payment controls. Local timestamps are not inventory authority.
Address visibility is now unambiguous: Buyer enters it after accepting; Seller UI
does not render it until simulated payment. This is a UI boundary, not security for
shared browser memory. Use synthetic addresses only.

## Detail layout, progress and fees

Order Detail remains a normal Home/Orders destination, capped at 1120px. Profile
panels/pills supply the surfaces and status language. Next Step and the process
Stepper stay outside FluidTabs / LocalTabContent Overview, Fulfillment and Payment.
The accepted snapshot, current state, fulfillment, address boundary, handoff area,
tracking and payment summary react to local transitions. Payment has only an
embedded-provider placeholder and labelled local simulation control, never card,
expiry, CVC or bank fields. Protection/payment copy is labelled product-design
preview; no real coverage is provided by this preview.

`lib/order-visual-preview.ts` is the single fee helper: protected subtotal is item
plus fixed shipping (or item only for Included); buyer fee is 4%, minimum CA$1, maximum CA$15; seller fee is zero.
CA$80 Pickup totals CA$83.20. CA$80 + CA$10 Shipping totals CA$93.60. These are
preview design assumptions, not a production pricing policy. To be arranged
stores an unknown shipping amount, renders Shipping cost pending, and has no
payable total or local simulated payment action. Buyer acceptance remains allowed;
no shipping quote negotiation workflow is implemented.

Historical preview progress mapping (zero-based current step; superseded as a
future formal semantic contract by role/fulfillment-specific progress):

| Local state                                    | Pickup / Meet       | Shipping        |
| ---------------------------------------------- | ------------------- | --------------- |
| Reserved / payment pending                     | 1 Payment           | 1 Payment       |
| Paid                                           | 2 Awaiting handoff  | 2 Ready to ship |
| Shipped                                        | —                   | 3 Shipped       |
| Delivered                                      | —                   | 4 Delivered     |
| Handoff / receipt confirmed; protection window | 3 Handoff confirmed | 4 Delivered     |
| Debug-completed protection window              | 4 Completed         | 5 Completed     |

The [official Velora Stepper source](https://velora.colorlib.com/components/stepper)
was adapted previously into `components/velora/stepper.tsx`, `stepper.module.css`
and its upstream MIT `stepper.LICENSE.txt`. It retains fractional fill, completed
checkmarks, reduced motion and `aria-current="step"`. No CLI/install or React/
Tailwind upgrade. The Stepper remains quieter than Next Step.

## Validation and scope

`tests/orders-interaction.cjs` executes pure local transition/guard tests, including
snapshot immutability, supersession, duplicate acceptance, expiry, role restrictions,
address/payment sequencing, code mismatch, delivery and issue hold.
`tests/orders-visual.cjs` covers fee boundaries and protected subtotal calculations.
`tests/orders-visual.browser.cjs` reviews all five flows at 1280/1536, with 390/430
preservation checks. It uses real staging listing/conversation reads and existing
demo sign-in, blocks every application data mutation and intercepts automatic
read acknowledgements. No signup, email, fixture or live Order writes.
Screenshots/build output stay ignored under `tests/artifacts/orders-interaction`.

TypeScript, focused ESLint, TEXT/IMAGE/Realtime/session regressions, Phase 1/2/3
static migration tests, pending-username regression, optimized staging-configured
build, secret scan, local documentation links and diff whitespace validation are
checked. The unchanged GlideSelect.jsx global lint parser issue remains pre-existing
technical debt; global lint is not represented as passing.

Final results: all five interaction flows pass at 1280 and 1536; the Pickup flow,
dialog bounds, Attachment opening and reload disposal pass at 390/430. TypeScript,
focused ESLint, pure preview tests, TEXT/IMAGE/Realtime/session regressions, migration
static checks, pending-username regression and the optimized staging-configured
build pass. Secret scanning and local documentation links pass; the Git index is
empty. No temporary credentials or session dumps were created. Temporary validation
scripts are removed after the audit; ignored screenshots/build output remain for review.

Interactions requiring backend work remain deliberately unavailable: independent
Buyer/Seller synchronization, real inventory reservation, authenticated Order
permissions, payment/provider outcomes, address privacy enforcement, carrier
events, authoritative expiry/protection, reports/refunds/disputes and payouts.
Mobile has basic preservation checks; redesign remains deferred.

## Files changed in the interaction task

- `components/home/messages-chat.tsx`
- `components/home/animated-sidebar-demo.tsx`
- `components/home/messages-chat.module.css`
- `components/home/order-request-preview.tsx`
- `components/home/order-request-preview.module.css`
- `components/home/order-visual-context.tsx`
- `components/home/orders.tsx`
- `components/home/order-detail-preview.tsx`
- `components/home/order-detail-preview.module.css`
- `components/home/order-preview-forms.tsx` (new)
- `lib/order-visual-preview.ts`
- `lib/order-interaction-preview.ts` (new)
- `tests/orders-visual.cjs`
- `tests/orders-visual.browser.cjs`
- `tests/orders-interaction.cjs` (new)
- `docs/ORDERS_PAYMENT_UI_PREVIEW.md`
- `docs/PROJECT_STATUS.md`
- `docs/PROJECT_HANDOFF.md`

The existing Stepper, Listing/UI components, API/migration/server modules, dependency
versions and demo seed/cleanup workflow were not changed in this task. Other
uncommitted demo/earlier visual-preview files predate this interaction task.
No commit or push.

## Focused perspective/alignment correction

Staging-only Messages Preview Controls retain their Buyer/Seller perspective.
Order Detail uses an isolated debug override of its workspace-derived role. They reuse the existing Profile segmented
control styling and never change the authenticated account. TEXT/IMAGE rows and
Seller-created requests share MessageRow sender/viewer identity alignment; actual
message read/write identity remains the authenticated user. Accept is rendered
only for an active request in Buyer view, with an additional local action guard.
Superseded/accepted requests cannot render Accept. Perspective changes preserve
the same request/order objects and reservation, address, tracking and issue state.
Overview uses the existing ListingMedia in a wider desktop column at its existing
4:3 aspect ratio. No Order API, persistence, migration or demo mutation was added.

1280px browser acceptance uses one existing staging session, intercepts all
application data writes, exercises all five local flows and checks alignment,
role eligibility, state preservation and duplicate counts. TypeScript, focused
ESLint, Order model tests and TEXT/IMAGE/Realtime/session regressions pass.

## Pickup / Meet schedule preview

Uses the existing @daypicker/react 10.0.2 installation. Its package stylesheet
is imported once from pages/_app.tsx; Order-specific calendar appearance lives
in order-schedule-field.module.css. The anchored native popover stays in the
browser top layer to avoid clipping, closes on valid selection, outside click
or Escape, and preserves DayPicker day buttons and keyboard behavior.

lib/order-schedule-preview.ts centralizes browser-local date/time formatting and
the 60-minute minimum notice, 30-local-day maximum and 15-minute increment.
The earliest boundary rounds up, including partial seconds; user input never
rounds or changes silently. Calendar matchers disable past and beyond-window
dates, and today if no valid time remains. The full combined timestamp is also
validated at editor submission and again at Confirm & Send.

Pickup and Meet each retain a separate ScheduleDraft inside the editor handoff
state, including their independently required date/time. Immutable request snapshots
store scheduleMode and an optional numeric scheduledAt, preserving JSON cloning
and deep freezing; display is derived in local time. No incomplete Pickup/Meet request can be confirmed.
Buyer Accept uses strictly future scheduledAt (no recurring one-hour buffer);
expired active requests stay in history with a separate unavailable notice.
UI and local acceptance guards enforce this. Shipping cost, address/payment,
Stepper and all existing transaction simulation rules remain independent.

Deterministic helper tests cover rounding, same-day bounds, late hours, 15-minute
validation, final +30-day timestamp, TBD, confirmation ageing, local formatting
and Buyer expiry. Focused 1280 browser coverage checks real disabled dates,
keyboard/Escape/outside close, draft preservation/isolation, confirmation-time
revalidation, immutable request display and future/expired acceptance.

## Pickup / Meet time wheel UI

Uses the already-installed @ncdai/react-wheel-picker 1.2.3 npm primitives directly:
WheelPicker, WheelPickerWrapper and WheelPickerOption. No shadcn CLI, registry
copy, components.json, dependency reinstall or Tailwind configuration changes.
The package stylesheet is imported once beside DayPicker in pages/_app.tsx.
Order-specific appearance is scoped to order-time-wheel-picker.module.css.

The compact Time button opens a native top-layer popover with controlled Hour,
Minute (00/15/30/45) and AM/PM wheels. visibleCount=12 satisfies the package's
multiple-of-four rule. Wheel values are transient popup state; Cancel, Escape and
outside dismissal preserve the canonical schedule draft. Done converts to HH:mm
and applies the existing centralized schedule validator for the selected date.
An empty picker seeds a temporary rounded local time (today uses the +60-minute
boundary); merely opening never commits it. Date changes retain existing time.

Independent disabled wheels can automatically skip a previously selected option
in this package. To avoid silently correcting the user's existing value, invalid
boundary combinations remain visible and Done reports the existing validation
message. Seller confirmation remains authoritative. No new schedule rules or
changes to Shipping, immutable snapshots, Accept, Orders layout or message
chronological placement.

The local wrapper refreshes only a changed column's options identity to keep
v1.2.3 controlled keyboard callbacks current when returning to the initial
selection. The installed dependency remains untouched. Focused 1280 checks cover
empty/cancel/done, conversion, reopen, keyboard/mouse-wheel/drag, dismissal,
date-change validation, independent drafts and immutable snapshots.


## Independent Orders workspaces

The old list rendered every Order under both tabs, chose its role from the tab
index, and listened to the global debug perspective to select navigation. This
made the tabs cosmetic filters and duplicated desktop sidebar navigation.

Desktop now uses Orders > Purchases / Sales in the existing sidebar only. The
active workspace is the sole main title. Mobile uses the existing Home nested
menu, without redundant in-page FluidTabs. Two keyed OrderList boundaries
derive buyer/seller collections from one memory store using viewerId and
participant IDs; missing identities fail closed. No separate datasets or APIs.

Detail starts with the workspace relationship role and retains its origin for
Back to Purchases / Back to Sales. Local detail Preview Controls never update
global perspective, navigation, identities or order state. Business simulation
actions remain unchanged.

Request creation now captures the existing conversation's buyer/seller UUIDs,
plus its fixed listing identity. These are real participants, never display-name
identity guesses or authentication changes. Local workspaces remain derived from
one shared store with the authenticated viewer ID.

Validation for this correction: TypeScript and focused ESLint pass; isolated
workspace rendering tests prove simultaneous owned collections, fail-closed
identity, detail role/origin independent of global perspective and desktop/mobile
navigation boundaries. 1280 staging browser Pickup flow passes with existing demo
Seller A, no application data writes or runtime errors: sidebar workspace switch,
Purchases empty / one Sale, no desktop tabs, debug override leaves origin intact,
Back to Sales, preserved terms/status and no duplicates. Buyer-owned Purchase
detail is covered by isolated rendering, not a fabricated browser product dataset.
Interaction, amount/shipping and scheduling model tests and diff whitespace checks
pass. No production access, backend changes, commit or push.


## Seller Request cleanup and unified timeline

Pickup/Meet no longer expose schedule To be arranged. Both retain separate
location/date/HH:mm drafts. The existing +60-minute, +30-local-day and 15-minute
validation remains; confirmation revalidates the immutable scheduledAt snapshot
against current time. Buyer acceptance still requires a strictly future timestamp.
Shipping cost Included / Flat rate / To be arranged is independent and unchanged.

The time-wheel wrapper previously copied a captured whole temporary draft from
each column callback. Cached primitive callbacks could overwrite another column's
new value. Column changes now merge only their field into the latest state with a
functional update. Done commits HH:mm to the fulfillment draft; reopen seeds from
that committed value. Cancel/Escape/outside dismissal still discard temporary edits.
The wheel primitive/library and date picker are unchanged.

Previously Requests lived in a separate previewHistory scroll block after
MessageHistory and before Composer, which pinned them together regardless of time.
Every Request now captures readonly createdAt at Confirm & Send. A discriminated
render-only timeline merges authoritative TEXT/IMAGE and local Requests by timestamp
plus stable kind-prefixed ID tie-breaker, retaining normal consecutive-message
grouping between Requests. Shared MessageRow aligns all three item kinds. Request
rows participate in scroll anchoring, but have no durable sequence and cannot
advance message read acknowledgments. No Order API/persistence was introduced.

Internal superseded is labelled Replaced, with "This request was replaced by a newer Order Request." Accepted and Expired stay distinct. Only unaccepted, unexpired
active Requests are replaced; status changes never change createdAt. Active Buyer
Accept remains gated by a future schedule; Seller/Replaced/Accepted/Expired cannot
Accept. The compact image-free cluster shows the committed schedule.

Desktop expanded Requests retain ExpandedCardPreview, ListingMedia, ListingDetails
and Verified topAction, with a 1040px maximum modal matching normal expanded-card
space, full-width card and existing equal media/terms columns. Images fit without
forced cropping. Mobile media/layout is unchanged.

Validation: TypeScript and focused ESLint pass. Schedule, interaction, workspace,
shipping amount and timeline unit tests pass, including expired-not-replaced and
status-independent chronology. At 1280, browser checks cover required independent
Pickup/Meet drafts, 17:45 reopen/confirmation/sent snapshot/perspective preservation,
Request-text-Request interleave, Replaced explanation, Seller no Accept / active
Buyer Accept, and decoded ListingMedia using a >350px desktop column. The intervening
TEXT response is fulfilled locally by the browser test; no real message write.
Additional browser checks pass date limits, confirmation ageing, expired/future
Buyer acceptance, wheel cancellation/keyboard/scroll/drag, and all three Shipping
cost modes. Zero runtime errors/application data mutations; diff check passes.
No backend/API/database changes, production access, commit or push.


## Explicit Request replacement workflow and invariants

Replacement/send/accept/expiry decisions live in lib/order-interaction-preview.ts.
getPreviewRequestSendGate identifies an actionable Active request in the exact
Buyer + Seller + Listing scope and blocks sends if a same Buyer + Listing Order
is unfinished. Real conversation identity is the fallback for older isolated test
snapshots without IDs, never Listing alone. Creation captures existing participant
IDs; no additional lookup API or session mutation.

Normal confirmation remains Confirm & Send. If there is a current Active request,
that action opens the existing confirmation surface as Replace current Order
Request?, summarizing the new terms. Only Replace & Send approves a specific old
request ID. Cancel returns to the unchanged editable draft with no state transition.
The domain helper rechecks the approved ID against current state and performs one
update: old Active -> Replaced, new snapshot -> Active. New IDs/timestamps are
captured once; old snapshots, IDs, timestamps, alignment and chronology stay intact.

Active -> Replaced / Accepted / Expired are the only Request transitions.
A staging timer materializes expiry only for Active requests; Replaced stays
Replaced after its scheduled time, and Accepted stays Accepted even when the
Order is cancelled or expires. No reactivation. Unfinished reserved/paid/shipped/
delivered/protection/issue-held Orders block new requests; terminal Order statuses
allow a new snapshot without changing the old Accepted request. No new Order
states, reservation implementation or listing mutation.

The provider commits its latest local state synchronously alongside React state;
final actions recheck current state rather than captured UI state. An action ref
blocks repeated Confirm/Replace clicks, stable IDs are idempotent, and stale
replacement approval cannot overwrite an Accepted/Replaced/Expired request.
Request sending/replacing creates no Order and never reserves a Listing.

Validation: deterministic A-L replacement tests cover repeated replacement, cancel
(no transition), immutable terms, multi-buyer isolation, terminal states, unfinished
Orders, duplicate IDs/stale approvals, and both Accept/Replace orderings. At 1280,
one existing staging Seller session verifies confirmation summary, Cancel preserves
price/location/HH:mm, double Replace click creates exactly one request, interleaved
TEXT stays between old/new requests, Replaced copy and Buyer/Seller Accept rules.
TEXT is browser-fulfilled test data only; no real application data write, email or
production access. Request interaction, timeline, workspace and schedule tests,
TypeScript, focused ESLint and diff checks pass. No commit or push.


## Final qualification - APPROVED LOCAL PRODUCT LOGIC

This section supersedes earlier UI hierarchy and Buyer-only reservation-release
notes. One shared Order holds objective facts and the approved unchanged Stepper.
Workspace primary titles are Buying / Selling / Purchases / Sales; sidebar/Home
nested menu provides parent context. Mobile Orders uses the same nested navigation
as Messages, not an in-page filter. Mobile cards place View Order full-width at
the bottom. Detail prioritizes lightweight Back, listing/status and role-specific
Next Step; all perspective/debug controls are below the real content.

Central order-presentation-preview gives Buyer payment/handoff/protection/purchase
guidance and Seller payment-pending/handoff/payout-pending/sale guidance. Reservation
and protection share OrderCountdown with MM:SS and HH:MM:SS from expiry timestamps;
it performs no domain transitions. Reservation expiry is a separate one-shot
local timeout; countdown ticks do not mutate Order state. Seller payout wording
is eligibility Preview only, never a claim that real payout occurred.

Request before acceptance: Seller may Cancel Request with a reason and optional
note. Active -> Cancelled is terminal; no user-facing Withdrawn model. Muted
Cancelled/Replaced/Expired history remains readable and expandable. A cancellation
adds a separate system-style event at cancellation time; the original Request
stays at its original timestamp/position with immutable terms. New Request means
a new ID/time/snapshot, never reactivation.

Order after acceptance, before payment: Buyer or Seller may Cancel Order with a
reason and optional note. The domain rechecks reserved/unexpired eligibility.
Order -> Cancelled, reservation ends, conceptual Listing Available, no completed
payment and no refund required. The original Request remains Accepted forever.
Both role views can inspect who cancelled, reason/note and cancelledAt.
After payment: neither role has normal cancellation; use existing Report an issue.
Cancellation metadata is frozen, repeated actions produce one event, and another
Buyer negotiating the same Listing is unaffected.

## PREVIEW-ONLY CONTROLS

Requests, Orders, cancellation events, addresses and all simulation state remain
in React memory and clear on refresh/logout. DEV / PREVIEW Controls - Local only
contains perspective switching and advance-protection simulation. Payment and
carrier simulation controls remain clearly labelled development actions. They
never navigate workspaces, change Auth or execute financial/provider operations.

## DEFERRED TO FORMAL STAGING

Real persistence and cross-account synchronization; authoritative reservation
timers; real payment provider; payout provider state; real Marketplace Protection
timing; final network loading/error wiring and dependent animation/skeleton polish.
OrderListSkeleton, OrderDetailSkeleton and OrderLoadError reuse the existing
Skeleton/button language and are ready to wire to genuine backend loading. No
artificial delay or fake local loading. Messages keeps existing loading lifecycle.

Google Places/Maps is intentionally not integrated: no dependencies or API keys.
Future location schema: placeId, placeName, formattedAddress, latitude, longitude,
meetingDetails. A future Request snapshots the selected pickup/meeting place and
Detail may show a small map. No live location sharing, tracking, navigation or
route planning; implementation follows formal location schema.

Final qualification result: LOCAL PREVIEW QUALIFIED / FROZEN (2026-10-10).
Only genuine blocking bugs should change this preview before formal staging.
390 / 430 / 1280 / 1536 browser passes: sole workspace titles, nested mobile
Orders navigation, readable unchanged Progress/tabs, mobile full-width CTA,
request cancellation/terminal history/new snapshot, pre-payment Seller Order
cancellation, Accepted request preserved, chronological cancellation events,
post-payment no Cancel for either role, role-specific reservation/protection/
completion, ticking timestamp-derived countdowns and separated DEV controls.
No horizontal page overflow, runtime errors or application data writes.
Deterministic Buyer/Seller cancellation, scope isolation, duplicate-event guards,
replacement, chronology, countdown/skeleton, workspace and schedule tests pass.
TypeScript, focused ESLint and git diff --check pass. No backend/API/schema,
production changes, Google dependency/API key, commit or push.
