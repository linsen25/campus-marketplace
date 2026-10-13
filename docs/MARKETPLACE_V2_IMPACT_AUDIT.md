# Marketplace V2 repository impact and conflict audit

> Historical implementation-impact audit. The [current Offer/Agreement revision](V2_OFFER_AGREEMENT_REVISION.md)
> supersedes conflicting future Active scope, Counter/replacement, withdrawal and
> fee assumptions in this earlier audit; historical evidence is retained.

## V2-D2A implementation update (2026-10-12)

V2-D2A On Campus Buyer inspection and explicit staging payment is implemented
and hosted-qualified only on western-marketplace-staging (`pcaqxezdfxofysghssyo`).
008/009/010 additive migrations are applied once; accepted C2 snapshots stay immutable.
Inspection never charges. New payment checks the actual Buyer and authoritative Set
capability; a private intent enters Processing before trusted simulator resolution.
Processing/Paid block ordinary Cancel, no-show release and meetup changes. Failed
remains retry/cancel/expiry compatible; inspection alone does not block expiry.
Paid remains Open / Listing Pending / payout Not eligible / fulfillment pending.

Twenty overlapping races passed without deadlocks, timeouts or invariant failures.
Buyer/Seller private updates 5/5, outsider 0 with polling disabled; fresh UI Pay, restart
reconciliation, ten states at four widths, D1/V1/Delivery regressions and optimized
staging build passed. Synthetic fixtures are cleaned and manual/Nike/media
fingerprints unchanged. [Full authority, hashes and 51-item closure](ORDER_CAMPUS_PAYMENT_V2_STAGING.md).
Production and `.env.local` untouched; no real charges/emails, commit/push or hosted
deployment. No QR/6-digit handoff, Protection, Completion/Sold, payout release,
Delivery progression or Notifications. Stop before D2B implementation; D2B is ready
for planning only. Before V2-G, remind the user to create a stable Git checkpoint.
Earlier D1/C2 statements below are historical phase scope.


## V2-D1 implementation update (2026-10-12)

V2-D1 On Campus scheduling / mutual rescheduling / +60m no-show is complete
on staging only. All three additive migrations are applied and immutable. Hosted
qualification, 14 true-concurrency runs, historical FK retention, V1/Delivery
regressions and 390/430/1280/1536 authenticated Realtime browser checks passed.
Synthetic data is cleaned; canonical/manual/media fingerprints are unchanged.
[Technical record](ORDER_MEETUP_V2_STAGING.md). C2 snapshots and winner authority
remain intact. No D2 Payment/inspection/handoff/Protection or Notifications.
Production/manual history untouched; no commit/push. Stop before G for a stable
Git checkpoint.


## V2-C2 implementation update (2026-10-12)

C2 was applied only to staging as `202610120004_offer_accept.sql`.
Recipient-only Accept, explicit V2 Order protocol, immutable snapshots/private
media binding, one Listing winner/Pending, competing V2 Closed and safe unpaid
cancellation are implemented. Hosted qualification, 13 true-concurrency runs, three-session Realtime and
390/430/1280/1536 browser qualification passed. Canonical/manual fingerprints
are unchanged and synthetic fixtures are cleaned. See
[the C2 technical record](OFFER_ACCEPT_V2_STAGING.md).
Earlier B/C1 scope statements below describe those phases, not current C2 scope.
Production and manual history are untouched; no commit/push. D/E/F/Notifications
remain out of scope. Before V2-G, stop for a stable Git checkpoint.


## V2-C1 private snapshot media foundation (2026-10-12)

**MEDIA RETENTION FOUNDATION COMPLETE / STAGING QUALIFIED.** Only additive
migration `202610120003_order_snapshot_media.sql` was applied to staging
`pcaqxezdfxofysghssyo`. Private immutable copies, authoritative preparation,
byte verification, complete-batch binding, leased orphan cleanup and participant
signed reads passed hosted tests, including four independent overlapping
transaction cases with both winner orders and zero deadlocks/lock timeouts.
[Technical implementation and qualification](ORDER_SNAPSHOT_MEDIA_V2_STAGING.md).
Canonical/manual fingerprints are unchanged; synthetic fixtures are removed.
Public Listing and private chat media behavior remain intact. Production was not
accessed; no commit/push. Full V2 Accept, Listing winner/Pending, timers and
Notifications are **not implemented by C1**. V2-C may resume only as a subsequent
task; do not resume automatically. Keep the stable checkpoint requirement before
V2-G.

## Current V2-B staging implementation (2026-10-12)

Final On Campus/Delivery Offer terms migration `202610120002` applied only to
staging `pcaqxezdfxofysghssyo`; Offer UX is COMPLETE / QUALIFIED with final two-session browser
qualification passed. [Implementation and evidence](OFFER_DOMAIN_V2_STAGING.md).
Listing Make Offer reuses exact conversation identity. Messages supports both
roles' initial/Counter/Revision and sender-only Withdraw, with authoritative
history/Realtime refresh, payout gating and stale-mutation recovery. V1 history
remains semantically Order Request, with Active compatibility conflict handling.
No V2 Accept, Order creation, inventory mutation, payment/timer, Protection or
Notifications implementation. Production and manual/Nike histories untouched.
Four responsive widths, native modal/reduced-motion, real IMAGE, refresh persistence
and forced stale-refetch recovery passed. Seven synthetic Offers were removed;
canonical/manual history fingerprint unchanged. Zero Orders / inventory mutation.
V2-C Accept / Listing winner foundation is ready for implementation planning only.
No commit/push. Before future V2-G Notifications, require a stable code checkpoint.

Older phase records below are historical; their "UI remains V1 / B not started"
statements describe the preceding checkpoints, not the current implementation.


Revised 2026-10-11; this revision uses static local documentation inspection only. Authority:
[V2 product contract](MARKETPLACE_V2_PRODUCT_CONTRACT.md) and
[Notifications design](NOTIFICATIONS_V2_PRODUCT_DESIGN.md).
**Current user-facing staging remains V1. V2-A1 protocol isolation is implemented;
V2-A2 backend mutations are implemented on staging; V2-B UI is not started.** The original documentation revision did not query hosted state; current A1/A2
implementation verification is recorded separately above and in the technical record; the [Offer authority audit](OFFER_DOMAIN_V2_STAGING.md)
retains its earlier staging read-only findings. Applied-phase statements below are existing repository
records, not a new deployment verification. No source/UI/backend/schema/RPC or
data changes are part of this task.

## Current A2 implementation checkpoint (2026-10-12)

The original classification below remains the future product impact plan. Current
[A2 technical record](OFFER_DOMAIN_V2_STAGING.md) records separate V2 RPC/API/DTO,
Buyer/Seller Create/Counter, same-sender replacement, sender-only Withdraw,
capability locking, command authority, sender-aware events and V1 isolation.
Migration 202610120001 is applied only to staging. A2 qualification complete:
13 observed concurrent cases, zero deadlock/timeout/invariant failures, both-user
private invalidation, no outsider leakage, clean synthetic fixtures and exact
canonical-history fingerprints. V2-B UI and V2-C Accept remain separate future work.
No Notifications, Orders, Pending inventory, fulfillment or new timers added.

## Classification and source-backed subsystem map

KEEP retains the approved concept/foundation, not permission to assume every
future state exists. ADAPT changes integration/authority; REPLACE changes the
target workflow; REMOVE removes a target path, never historical rows; NEW denotes
missing V2 capability. Links identify current implementation evidence.

| Subsystem | Class | Current repository evidence and V2 impact |
| --- | --- | --- |
| Conversation identity | KEEP | [TEXT migration](../supabase/migrations/202610070001_messages_text.sql): Listing origin + Buyer + Seller uniqueness/snapshots. Keep per-Listing relationships; never merge same-contact conversations. |
| Listing page entry | ADAPT | [Listing page](../pages/listings/[id].tsx), [listing cards](../components/listings/published-listing-card.tsx): add future Make Offer beside Message Seller, opening exact conversation; no picker. |
| Seller-only Request form | REPLACE / ADAPT | [Editor/card](../components/home/order-request-preview.tsx), [Messages integration](../components/home/messages-chat.tsx): currently realSeller-only Send Order Request. Reuse approved surface, calendar/time wheel and confirmation; make terms and origin bidirectional, On Campus/Delivery-specific. |
| Request/Offer timeline | ADAPT | [MessageHistory](../components/home/message-history.tsx), [timeline projection](../lib/message-timeline-preview.ts), [status presentation](../lib/request-card-status.ts): current Request alignment assumes Seller. Future immutable sender drives normal alignment; retain old chronology, compact/expanded/full-report hierarchy; add Closed and sender/counter wording. |
| Request mutation RPC/API | ADAPT | [Phase 1 migration](../supabase/migrations/202610100001_order_requests.sql), [Phase C function update](../supabase/migrations/202610110001_order_payout_gate.sql), [service](../lib/server/order-request-service.ts), [API](../pages/api/order-requests/[[...segments]].ts): seller checks and Seller note/snapshots currently dominate. Need participant sender/recipient, symmetric replacement, sender-only withdrawal and idempotent auth-derived authority. Internal names may remain. |
| One Active per conversation | KEEP / ADAPT | `order_requests_one_active` partial unique index uses Listing/Buyer/Seller origins. Preserve invariant while replacing sender-specific mutation guards; concurrency must cover both senders. |
| Seller payout gate | ADAPT | [Phase C](../supabase/migrations/202610110001_order_payout_gate.sql) checks Seller create/replace and Buyer Accept. Add Seller acceptance of Buyer Offer; Buyer proposal may be received without Seller Ready; all Order creation rechecks Seller Ready. |
| Accept RPC/API | ADAPT | [Accept migration](../supabase/migrations/202610100002_order_accept.sql), [latest payout gate functions](../supabase/migrations/202610110001_order_payout_gate.sql), [Orders service](../lib/server/orders-service.ts), [Orders API](../pages/api/orders/[[...segments]].ts): Buyer-only acceptance becomes recipient-only; authenticated Seller remains Listing Seller, regardless of Offer origin. Preserve exact ID/idempotency and atomic Order creation. |
| Listing winner/inventory | KEEP / ADAPT | Accept migration: `orders_listing_hold` partial unique index, Listing `reserved_order_id` pairing and locks already protect holds. Future every accepted V2 model makes the Listing Pending and holds inventory; close competing Active Offers atomically and keep historical losers. Existing no-hold quote exception is not V2. |
| Pickup | REPLACE | [Visual terms](../lib/order-visual-preview.ts), editor, migrations: legacy primary method becomes V2 On Campus for new Offers; legacy snapshots stay Pickup. |
| Meet | REPLACE | Same sources: fold primary Meet into On Campus, preserving inspect-before-payment target and historical Meet terms, not bulk relabeling old Orders. |
| Shipping | ADAPT / REPLACE | Same sources: new top-level Delivery with Seller delivery/Courier subtype; known fee before acceptance, protected courier tracking. Legacy Shipping remains renderable. |
| Shipping-cost-pending | REMOVE (target only) | [Accept migration](../supabase/migrations/202610100002_order_accept.sql), [financial state](../supabase/migrations/202610110002_order_financial_state.sql), Payment/Progress: current accepted unknown-fee Order has no hold/deadline/payable total. V2 has no such accepted Order or later quote workflow; old snapshots cannot be fabricated into finalized Delivery. |
| 30-minute reservation | ADAPT | Current schema requires finalized reservation expiry = started + 30 minutes and lazy settlement uses it. Delivery initializes it by accepter direction (immediate Buyer Accept or after a 12h checkout claim); On Campus uses meetup + 60m no-show grace. Do not clear/change old deadlines or let client time decide a winner. |
| Scheduling/location | KEEP / ADAPT | [Schedule validation](../lib/order-schedule-preview.ts), [DayPicker field](../components/home/order-schedule-field.tsx), [wheel](../components/home/order-time-wheel-picker.tsx): current one-hour send lead, 30-day horizon, 15-minute steps are compatible baselines. Confirmed rescheduling changes only meetup location/date/time/note; preserve old schedule until confirmation and retain history. On Campus Accept still checks future time. Fixed conversation Listing and formal location snapshots remain; no Maps implementation authorized. |
| Order schema / DTO | ADAPT | Accept migration and [Order types](../types/order.ts): currently version-1 terms, three methods, nullable Shipping money, deadline/lifecycle constraints. Need versioned V2 terms, fulfillment-specific timing and actor provenance; preserve Request/Order separation and unique Order identity. |
| Buyer Payment state | KEEP / ADAPT | [Phase D](../supabase/migrations/202610110002_order_financial_state.sql), [financial service](../lib/server/order-financial-service.ts): Pending/Processing/Paid/Failed/Refunded separation remains; current simulator requires finalized held unexpired reservation. On Campus future inspection-stage eligibility differs. Simulator is not provider integration. |
| Seller Payout state | KEEP | Same financial migration and [capability service](../lib/server/financial-capabilities-service.ts): preserve state/privacy separation and zero Seller fee; actual payout rails, completion and issue handling remain future. |
| Settings financial capabilities | KEEP | [Settings](../components/home/financial-settings.tsx), [hook](../hooks/use-financial-capabilities.ts), [capability migration](../supabase/migrations/202610100003_financial_capabilities.sql): reuse account-level Payment/Payout status, no Order-specific cards; preserve staging test-state isolation. |
| Payment UI | ADAPT | [Formal Payment](../components/home/formal-order-payment.tsx), [payment gates](../lib/order-payment-ui.ts): role privacy/components remain; On Campus awaits inspection instead of immediate payment countdown, Delivery remains pay-first. Buyer method required at payment only. |
| Progress / Next Step | REPLACE / ADAPT | [derivation](../lib/order-progress-ui.ts), [formal detail](../components/home/formal-order-detail.tsx), [Stepper](../components/home/order-progress.tsx): reuse renderer; replace Pickup/Meet payment-first and Shipping quote sequences with four role/model mappings. No preview progression becomes authority. |
| Order cancellation | KEEP / ADAPT | [cancellation migration](../supabase/migrations/202610110003_order_cancellation.sql), [dialog](../components/home/order-cancellation.tsx): retain unpaid role authorization, reasons, events/idempotency/report. Rework deadline branch for schedule-driven On Campus; retain cancellation/payment/expiry serialization. Paid refund flow is future, not current Cancel. |
| Orders Active / History | KEEP | [FormalOrders](../components/home/formal-orders.tsx), [list helper](../lib/order-list-presentation.ts): retain Active default, terminal History, exact IDs, authoritative sorting/back context and no clock-fabricated terminal outcome. |
| Terminal Request/Order presentation | KEEP / ADAPT | [Request status](../lib/request-card-status.ts), editor/card, formal detail: accepted historical fact plus current outcome; full cancellation report only in Order View details. V2 wording becomes Offer, legacy records remain identifiable. |
| Notifications primary destination/feed | NEW | [sidebar](../components/home/animated-sidebar-demo.tsx) has no persistent Notifications destination; no dedicated feed/read API/schema found. Build owner-scoped unified feed, Bell and precise targets later. React Bits reference is not installed. |
| Favorites Price Drop | NEW / KEEP | [Favorites API](../pages/api/favorites/[[...segments]].ts), [repository](../lib/server/supabase-listings-repository.ts): real favorite membership and Listing price updates exist; no persisted Price Drop notification producer found. Keep membership, add authoritative decrease event/recipient delivery and coalesce repeated drops into one unread recipient/Listing notification; after read, a meaningful later drop may create a new item. |
| Realtime | KEEP / ADAPT | [client](../lib/messages-realtime.ts), [bridge](../pages/api/messages/realtime-session.ts), [broadcast migration](../supabase/migrations/202610080001_messages_realtime.sql): private user channel + invalidation/refetch stays. Offer/Order changes and future feed invalidation need correct event wiring; broadcast hints are not stored notifications/read state. |
| Email | NEW later | [Auth cleanup record](AUTH_UX_CLEANUP.md): real UWO/custom SMTP deferred. Add optional channel off the same domain/notification event later; do not claim present email delivery or alter Auth configuration. |
| Demo fixtures and tests | ADAPT | [seed workflow](../scripts/staging-demo.cjs), [demo docs](STAGING_DEMO_DATA.md), `tests/order-requests-*`, `order-accept-*`, `order-payment-ui*`, `order-progress-ui*`, `order-cancellation*`, `order-terminal*`: retain isolated stage guards/users/listings; introduce explicitly versioned V2 fixtures and recipient/winner/timing matrices without consuming manual samples. |
| Transaction reset tooling | ADAPT | [reset script](../scripts/staging-demo-reset-transactions.cjs): current FK/trigger/event/capability graph assumptions are V1. Future V2 review must include new Offer/notification/channel references and protect unrelated users/history/Storage. Do not run reset here. |
| Frozen preview and V1 docs | KEEP historical / ADAPT references | [preview record](ORDERS_PAYMENT_UI_PREVIEW.md) and current V1 records remain evidence, not target authority. No preview role/manual timers/fake Pay should be imported into formal V2. Source constraints/tests remain unchanged until authorized. |

## Completed phase mapping

| Existing phase | V2 disposition |
| --- | --- |
| A: Financial capabilities | KEEP account-level, provider-independent model |
| B: Settings Payments & payouts | KEEP role-capable same-account setup/status |
| C: Seller payout gate | ADAPT Seller Offer send and Seller-side acceptance/Order creation; all Accept recheck |
| D: Payment/Payout foundation | KEEP separation; ADAPT fulfillment-specific eligibility/timing |
| E: role-specific Payment UI | ADAPT On Campus inspection-first vs Delivery payment-first |
| F: Progress/Next Step | REPLACE/ADAPT derivation, KEEP shared visual renderer |
| Pre-payment cancellation | KEEP/ADAPT deadline and authorization branches, preserve race evidence |
| Active/History + terminal presentation | KEEP approved hierarchy/navigation |
| Shipping-cost-pending | REMOVE from new V2 target, preserve legacy data |
| Buyer Offer origin | NEW |
| Notifications / Price Drop | NEW |
| Email channel | NEW later; deferred |

## Future migration risks, not migrations

1. **Actor/provenance:** immutable sender/recipient and role mapping; authenticated
   actor cannot be supplied by browser. Existing Buyer/Seller identities still
   designate Listing relationship. Preserve command idempotency and event attribution.
2. **Offer lifecycle/uniqueness:** add Withdrawn/Closed and symmetric transitions without
   invalidating legacy Active/Accepted records or duplicate proposals. Existing
   one-Active index can be retained/evolved; no destructive rename is prescribed.
3. **Inventory:** cross-conversation close/accept races, single owning Order,
   consistent Listing pointer and event cardinality. Lock ordering must include
   capability/Listing/conversation/Offer/Order/event dependencies; test actual
   concurrent transactions and no deadlocks, not just ordered calls.
4. **Terms/versioning:** separate legacy Pickup/Meet/Shipping snapshots from new
   On Campus/Delivery fields, sender note and subtype/known fee. Avoid reinterpretation
   through a UI label substitution. Historical accepted unknown-fee Orders stay legacy.
5. **Timing guards:** existing exact-30-minute checks, prepare triggers, payment
   eligibility and lazy expiry settlement cannot be reused unchanged for On Campus.
   Delivery uses direction-aware immediate 30m or 12h claim then one-time 30m; On Campus requires confirmed schedule revision and meetup + 60m no-show authority.
6. **Notifications:** persistent owner/read state, domain-event linkage, delivery
   idempotency and later email channel bookkeeping; decide RLS/grants and safe DTOs
   in an authorized design phase. Existing private broadcast authorization is not
   sufficient notification-table security.
7. **Financial/provider boundaries:** immutable amounts/versioned pricing,
   payment/refund reconciliation and payout privacy must survive changes; no fake
   provider readiness/refund/receipt/protection may be backfilled.

Prefer additive/versioned evolution and compatibility rendering. Preserve V1 IDs,
Accepted Requests, Orders, cancellation actor/reason/time, expiry settlements,
snapshots, events and original deadlines. Never convert old rows into invented
Buyer Offers or V2 transactions. No automatic production migration/backfill is
approved. Future rollout needs its own preflight, backups, stage verification,
dry-run, migration allowlist and explicit authorization.

## Revised impact classification

All rows below describe future implementation, not existing staging capabilities.

| Area | Class | Required change / authority boundary | Owner |
| --- | --- | --- | --- |
| V1/V2 protocol | NEW / ADAPT | Explicit version isolation; legacy mutation guards, sender/recipient and safe backfill, shared Active exclusivity. Existing V1 Buyer-only Accept must not execute Buyer-origin V2 Offers. | A1 |
| Offer lifecycle | ADAPT | New V2 Withdrawn, not Cancelled; symmetric create/counter/withdraw, immutable snapshots and idempotent events; retain V1 cancellation history. | A2 |
| Listing availability | ADAPT / REPLACE | Replace V2 reserved presentation with Available/Pending/Sold; Accept -> Pending, unpaid cancellation/expiry -> Available, Completed -> Sold. Do not convert legacy rows/deadlines. | C, D/E, J |
| Acceptance evidence | NEW / ADAPT | Atomically freeze immutable Offer + Listing evidence including photos/condition/description/accessories and asking price; preserve media independently of later live edits/deletion. | C |
| Listing material revision | NEW | Server-backed material revision/version detects relevant edits, canAccept=false without Stale status; asking price below Offer amount blocks acceptance; price increase alone need not block. | C; B exposes eligibility |
| Delivery timer initialization | REPLACE | Buyer Accept -> immediate 30m; Seller Accept -> 12h claim then once-only 30m when Buyer intentionally starts checkout. Refresh/repeated checkout cannot extend. | E; C integrates |
| Checkout claim | NEW | 12h from Seller acceptance, Listing Pending, Buyer awareness; no checkout -> Expired/release; no payment/Delivery. Not pre-Accept Offer age. | E |
| Meetup schedule revision | NEW / ADAPT | Propose/confirm; only location/date/time/note; old deadline remains until confirmation; original accepted terms and schedule audit preserved. | D |
| On Campus no-show | REPLACE | Meetup + 60m grace, unpaid/no handoff/no confirmed replacement -> server expiry eligibility. No Accept + 30m and no paid-order unpaid expiry. | D |
| Physical handoff | ADAPT / NEW | Paid Buyer-held QR/6-digit credential; Seller verifies, cannot self-confirm. On Campus and Seller delivery only; secure server-scoped verification. | D/E |
| Courier receipt | KEEP / ADAPT | Trusted carrier Delivered / Buyer Confirm Received, never Seller Shipped alone or primary meetup code. | E |
| Protection boundary/policy | KEEP / ADAPT / NEW | 24h begins after trusted paid handoff/receipt; coverage/exclusions are future policy direction, not current guarantee. Adjudication/refund/returns must close before real-money guarantee marketing. | D/E evidence; J hardening |
| Notifications priority | ADAPT / NEW | One newest-first feed, Action required / Informational emphasis; checkout ready, claim/deadline, meetup/reschedule, availability-again; no category tabs. | G |
| Price Drop dedupe | NEW | Atomic recipient/Listing unread coalescing of original/latest price; read/drop and event-retry races; anti-spam time threshold parameter. | H |
| Test/reset fixture graph | ADAPT | Protocol-aware guards/reset dependencies; new schedule/claim/snapshot/credential/notification references; only isolated fixtures, protect Nike/manual history. No reseed/reset now. | Each phase |
| Trust/safety | NEW later | Completed-Order reviews, selected profile signals and educational off-platform warnings, not blanket chat blocking. | I |
| Optional email | KEEP direction / NEW later | Same domain events -> in-app first -> optional email; consent/infrastructure separately authorized, not a second business engine. | Separate later scope |

## Recommended implementation sequence (not executed)

| Phase | Bounded deliverable and exit dependency |
| --- | --- |
| V2-A1 | Protocol/version isolation, V1/V2 authority separation, sender/recipient foundation, validated legacy backfill/compatibility, V1 mutation guards, cross-protocol Active exclusivity only |
| V2-A2 | Bidirectional create/counter/withdraw, send-direction payout gate, shared proposal history/events and true concurrency/idempotency/security tests after A1 |
| V2-B | Offer UI / Listing Make Offer / Messages; safe eligibility and sender-alignment projection; no V2 Accept before authority is ready |
| V2-C | Recipient-only atomic Accept, one Listing winner, competing Closed, Listing Pending, immutable Listing/Offer evidence and Listing-revision/price eligibility |
| V2-D | On Campus schedule/reschedule, 60m no-show grace, inspect/pay/verified-handoff flow; preserve accepted history and test schedule/expiry/payment races |
| V2-E | Delivery known fee/subtypes, direction-aware 12h claim/once-only 30m payment, address privacy and fulfillment/receipt evidence |
| V2-F | Role/model-specific Order Progress, Payment, Next Step and confirmation UI; show accepted direction/claim state without old universal clocks |
| V2-G | Notifications owner persistence/read API, priority-weighted unified feed, Bell, checkout/deadline/meetup/reschedule/availability event integration |
| V2-H | Favorites price decreases, unread coalescing/read-drop race/dedupe and exact Listing targets |
| V2-I | Selected trust/safety enhancements after their own decisions; no implicit email/provider integration |
| V2-J | Protection/dispute/refund/completion hardening, coverage/evidence/return policy closure and payout safety before real-money guarantee claims |

A1 does **not** implement fulfillment/timers, 12h checkout, Pending, accepted
snapshots, rescheduling, handoff, Notifications or disputes. A2 owns symmetric
mutations. A1 can isolate protocol authority while C/D/E are absent; keep V2
Accept unavailable until recipient/winner and the selected model's backend
semantics are integrated. C must not activate old universal timers by default.
G can provide awareness only for supported facts; it does not start/reset clocks.
Each phase needs separate authorization. Provider/payment execution and optional
email infrastructure remain separate boundaries, not automatically included in
D/E/I or the staging simulator.

## Static documentation conflict audit

Searches covered repository Markdown for Seller-only Request/Buyer-only Accept,
Pickup/Meet/Shipping, shipping-cost-pending, universal/fixed-cost 30-minute timing,
payment-first progress and Notifications references. Conflicts are retained as
accurate V1 statements with a **top-level CURRENT STAGING V1 / historical
implementation reference** notice linking the V2 authority. No bulk history rewrite.

| File | Conflicting or potentially stale rule | Resolution / remaining ambiguity |
| --- | --- | --- |
| [ORDER_PAYMENT_PRODUCT_DESIGN](ORDER_PAYMENT_PRODUCT_DESIGN.md) | Former future authority; Seller Requests, three flows, quote-after-Accept, payment-first in-person, old G/H roadmap | Supersession notice; V2 owns future target, lower dated records remain V1. No core ambiguity. |
| [ORDERS_BACKEND_STAGING_DESIGN](ORDERS_BACKEND_STAGING_DESIGN.md) | Seller mutations, Buyer Accept, exact timer/schema proposal, nullable shipping | Historical/current V1 notice; additive V2 design required, not executed. |
| [ORDERS_ACCEPT_STAGING](ORDERS_ACCEPT_STAGING.md) | Buyer-only Accept and finalized 30-minute / shipping-pending exception | Notice; V1 evidence retained, recipient/model-specific redesign in V2-A1/A2/C/D/E. |
| [ORDER_FINANCIAL_STATE_STAGING](ORDER_FINANCIAL_STATE_STAGING.md) | Fixed reservation-bound simulator and Phase F old fulfillment mappings | Notice; financial separation KEEP, timer/eligibility/progress ADAPT. |
| [FINANCIAL_CAPABILITIES_STAGING](FINANCIAL_CAPABILITIES_STAGING.md) | Phase C Seller Request-only gate paths | Notice; A/B KEEP, C recipient-aware adaptation. |
| [ORDER_CANCELLATION_STAGING](ORDER_CANCELLATION_STAGING.md) | Unpaid cancellation deadline rules tied to V1 reservation | Notice; keep audited behavior, adapt On Campus timing later. |
| [ORDERS_PAYMENT_UI_PREVIEW](ORDERS_PAYMENT_UI_PREVIEW.md) | Frozen Seller Requests, three methods, local simulation | Historical preview notice; never target or formal authority. |
| [FORMAL_ORDER_DETAIL_PARITY](FORMAL_ORDER_DETAIL_PARITY.md) | V1 terms/timer and former product-authority reference | Notice; retain approved visual structure, V2 supersedes future milestones. |
| [FORMAL_UI_RULES](FORMAL_UI_RULES.md) | Points to old closed contract for future behavior | Notice; loading/feature-visibility rules KEEP; V2 owns future domain. |
| [FORMAL_UI_REGRESSION_RECOVERY](FORMAL_UI_REGRESSION_RECOVERY.md) | Restores frozen V1 Request/Order parity | Historical notice; visual recovery remains evidence, not V2 lifecycle rules. |
| [STAGING_DEMO_DATA](STAGING_DEMO_DATA.md) | V1 seed/reset graph and current schema assumptions | Notice; commands not executed; future fixture/reset audit required. |
| [HOMEPAGE_DESIGN](HOMEPAGE_DESIGN.md) | Historical protection duration/payment-before-all-fulfillment copy | Notice; V2 24h and On Campus inspect/pay/handoff supersede future trust copy. UI unchanged here. |
| [PROJECT_STATUS](PROJECT_STATUS.md) | Current Phase A-F/current V1 status mixed with past future direction | New V2 target banner; current staging explicitly V1, implementation not started. |
| [PROJECT_HANDOFF](PROJECT_HANDOFF.md) | Old next phases / Request / quote/Progress assumptions | New mandatory V2 checkpoint banner; no old V1 expansion without checking target. |
| Messages/Realtime design and phase records | Existing use of broadcast 'notifications'/invalidation signals | Not a feed or prohibition on a Notifications destination. KEEP signals; V2 notifications design explicitly distinguishes persistence. No conflicting no-feed rule found. |
| Auth/setup/listing foundations and unrelated historical reports | Current Auth delivery deferred; favorites/schema status | Retained; no V2 conflicting target authority found. No SMTP or price-drop claims added. |

Existing SQL/source/tests still encode V1 and are intentionally unmodified; those
are implementation impact, not unresolved documentation contradictions. Supersession
notes prevent future sessions from mistaking them for V2 authorization.

## Revision conflict audit and closure

Future V2 conflicts corrected in this revision: mixed Cancelled/Withdrawn Offer
language; universal immediate Delivery 30m Accept timer; unspecified On Campus
no-show grace; schedule-change agreement left as a future decision; missing
Pending/accepted evidence/material-edit and price eligibility; unspecified
physical Buyer credential; dedupe left wholly undecided; old A/I/J phase ownership.
The contract, Notifications design, Offer authority audit and status/handoff now
agree on the revised rules and A1/A2 separation.

Existing V1 docs in the table above remain **CURRENT STAGING V1 / historical
implementation reference**. Seller-only Requests, Buyer-only Accept, Pickup/Meet/
Shipping, V1 reservation timers, preview code and legacy Cancelled Request history
are evidence, not stale V2 instructions. They were not mechanically rewritten.
V1 source/SQL/tests remain unchanged. The Offer audit's unsafe legacy acceptance
findings remain valid; isolation is A1 work, not a claim of a working fix.

Locked values are 60m On Campus grace, 12h Seller-accepted Buyer Delivery checkout
claim and one-time 30m Buyer-present/started checkout payment. Rescheduling
agreement/allowed fields, Pending, accepted evidence, material/price eligibility,
Buyer-held handoff and unread Price Drop coalescing are closed product rules.
Exact components/schema/cryptography/carrier integration, pagination/Bell cadence
and anti-spam threshold are implementation parameters. General Offer-age expiry,
paid cancellation/refund/returns, dispute evidence thresholds, reviews/reveal,
Offers welcome/Price firm and email consent remain future product decisions.
These are later-feature prerequisites, **not protocol-level blockers for A1**.

This revision is documentation only: no browser/app test, hosted query, data
mutation, SQL/migration/RPC, dependency install, production access, commit or push.
Validation uses local link/terminology/timer/lifecycle/phase searches, non-document
file hashes and git diff checks. Earlier audit verification counts are historical
and are not presented as results of this revision.

Revision validation: six updated documents, **197 valid local links**, zero broken
targets; decision/lifecycle/timer/phase consistency checks pass. All **650
non-Markdown Git-visible files** have identical before/after paths and SHA-256
hashes (aggregate `4beefd0b5d1638124d288d5a3325616177c3728ce52ace04194697fe8f0e7e6d`).
Thus source, SQL/migrations and dependency files are unchanged from the starting
working tree, which already contained earlier work. `git diff --check` passes;
the Git index remains empty. No implementation tests were run for this
documentation-only revision.

**MARKETPLACE V2 PRODUCT CONTRACT REVISED AND RE-CLOSED.**
**V2-A1 IS UNBLOCKED FOR IMPLEMENTATION.** V2-A remains paused; A1 is planned,
not started. Current staging remains V1.

## A1 implementation checkpoint

See [Offer protocol record](OFFER_DOMAIN_V2_STAGING.md): one additive staging
migration adds explicit immutable version and sender/recipient, validated V1
backfill, legacy mutation/Accept guards, shared Active exclusivity and V1-only
read/event/expiry projection. No V2 Accept, normal bidirectional mutation or UI.
The earlier revision's implementation-not-started statements describe its dated
checkpoint; they do not override this applied A1 status. A2 remains unstarted.

## Binding future product-quality references (deferred, not removed)

These are approved design inspirations, not claims of identical implementation:
Kijiji direction: low-friction Make Offer, local negotiation, campus inspection
before payment and simple Listing-to-Message/Offer flow. eBay direction: structured
Offer/Counter lifecycle, immutable negotiation, one authoritative winner, accepted
terms/evidence and trusted Buyer-held QR/6-digit physical handoff proof. Facebook
Marketplace direction: low-friction messaging, easy Listing-to-chat, visible
profile trust context and lightweight local marketplace feel.

Campus differentiation remains Buyer AND Seller Offers, Western-specific flow,
future Completed-Order-backed reviews, On Campus inspect/pay/verified handoff,
Delivery pay-before-fulfillment and authoritative payment/inventory. Messages owns
human negotiation; Notifications owns system awareness. None is optional because
A1 does not implement it. Existing revised timers/evidence/privacy/Protection
rules and future Bell/Price Drop/trust requirements remain binding for later phases.
