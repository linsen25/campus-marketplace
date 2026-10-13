# Marketplace V2: authoritative target product contract

Revised and re-closed 2026-10-11. **TARGET PRODUCT V2; IMPLEMENTATION NOT STARTED.**
Current staging remains V1. This document supersedes conflicting future product
rules in [the V1 contract](ORDER_PAYMENT_PRODUCT_DESIGN.md), not its historical
implementation records. No implementation, migration, data operation, provider
integration or deployment is authorized by this documentation task.

Read with [Notifications design](NOTIFICATIONS_V2_PRODUCT_DESIGN.md) and the
[repository impact/conflict audit](MARKETPLACE_V2_IMPACT_AUDIT.md).

## 1. Locked domain and terminology

The product domain is **bidirectional Offers**, not Seller-only Order Requests.
Buyer can Make Offer / Counter Offer; Seller can Send Offer / Counter Offer.
Both use the same terms model and lifecycle. Existing internal names such as
`order_requests` may remain behind compatibility mappings; a physical rename is
not required to change product terminology.

Conversation identity remains Buyer + Seller + Listing. Every Offer belongs to
that exact conversation and fixed Listing; there is no Listing picker. Buyer
Listing actions eventually include Message Seller and Make Offer. Make Offer
may create/open the exact conversation if none exists. Different Listings remain
different conversations even for the same participants.

Offer sender is immutable authenticated historical metadata, distinct from the
Listing's Seller. The other participant is the recipient. Only that recipient
can Accept; sender cannot Accept their own Offer. No preview perspective can
grant authority. A proposal alone creates neither an Order nor inventory ownership.

## 2. Offer lifecycle and replacement

| Offer state | Meaning |
| --- | --- |
| Active | Current proposal; authoritative eligibility must also permit acceptance |
| Replaced | A newer Offer from either participant superseded it |
| Accepted | Recipient accepted successfully and an Order was created |
| Withdrawn | Sender voluntarily withdrew their Active proposal before acceptance |
| Expired | Its authoritative agreed timing passed before acceptance |
| Closed | Another transaction won/reserved the Listing; this proposal is no longer executable |

At most **one Active Offer per conversation**. Buyer Offer A -> Seller Counter B
-> Buyer Counter C is symmetric: A and B become Replaced, C becomes Active.
Terms and sender remain immutable; old cards remain at their original timeline
positions. New proposals have new IDs/timestamps. Withdrawal and Closed are not
interchangeable. Accepted remains Accepted when its linked Order later expires,
cancels, completes or refunds; Offer and Order are separate lifecycles.

The exact new V2 Offer lifecycle is **Active / Replaced / Accepted / Withdrawn /
Expired / Closed**. Cancelled is an Order state, not a new V2 Offer state. Legacy
V1 cancelled Requests retain their persisted historical meaning.

On Campus proposals require an agreed location/date/time; Accept requires that
meetup time still be future under server time. Unaccepted proposals expire when
that time passes. There is no generic 30-minute Offer lifetime. Delivery proposals
have no numeric age expiry approved in this revision: replacement, acceptance,
withdrawal, Listing unavailability/Closed or a separately approved authoritative
rule ends eligibility. General pre-acceptance Offer-age expiry (such as 24h/48h)
is a future product decision; the post-acceptance 12-hour checkout claim is separate.
Meetup lead-time/calendar mechanics are implementation parameters; retain safe
existing scheduling validation where compatible, without importing V1 payment timing.

## 3. Atomic acceptance and one Listing winner

Separate Buyers may negotiate in separate conversations for the same Listing.
Those Active proposals do not reserve inventory. At most one active/winning Order
may own a Listing. A successful acceptance must atomically:

1. Validate authenticated recipient, Active/unexpired Offer, immutable participant
   and Listing relationship, complete fulfillment-specific terms, Seller payout
   Ready, Listing eligibility and absence of another inventory/race winner.
2. Mark that Offer Accepted, create exactly one Order from its terms, establish
   Listing ownership with availability **Pending**, freeze immutable Listing and
   Offer evidence, and record the authoritative transaction event.
3. Make competing Active Offers for that Listing non-executable / Closed, with
   Listing no longer available presentation. They are not user-cancelled or deleted.

Idempotency, locks, uniqueness and server-authoritative race handling are required;
UI disabling alone is insufficient. Concurrent acceptance/replacement/withdrawal,
cross-Buyer acceptance, cancellation/payment/expiry and capability changes require
explicit future tests. Release never rewrites an Accepted Offer or automatically
manufactures Active proposals from historical Closed/Replaced records.

### Listing availability and accepted evidence

**Available -> Pending -> Sold**: Available means no accepted active Order owns
the Listing. Pending means an accepted active Order owns/reserves it while the
transaction is incomplete. Accept + Order creation makes Available -> Pending,
not Sold. Cancelled/Expired Order before completion releases its own Listing to
Available; successful Completed Order makes Pending -> Sold. Payment Paid alone
does not mean Completed or Sold. Competing executable Offers become Closed,
never resurrected if the winner fails. Interested users may later be notified
when Pending returns to Available and send a new Offer. Other users may see
appropriate Pending/history context under a later visibility policy but cannot
create a second winning Order. Optional Notify me if available UI is future work.

At successful Accept/Order creation, freeze transaction-relevant Listing evidence:
ID, title, category/identifying metadata, condition, description, included items/
accessories, relevant photos, asking price at acceptance, Seller identity reference
and other material description fields. Historical photo evidence must survive
permitted live Listing/media changes; a mutable reference alone is insufficient.
Physical snapshot storage is an implementation parameter. Order Detail uses the
accepted immutable evidence, not substituted live content. Later Listing edits
never change accepted Offer terms, Order snapshots or historical evidence.

### Active Offer eligibility after Listing changes

Material changes to condition, description, included accessories, relevant photos
or item identity/specification block blind acceptance of an older Offer. The Offer
can remain Active with **canAccept = false**; do not add a Stale lifecycle state.
Authority should use Listing material revision/version identity, not fragile client
text comparisons. A new/revised Offer restores eligible agreed terms where needed;
never edit the old proposal in place.

A price increase alone need not invalidate a lower negotiated Offer: asking
CA$500 -> CA$550 can still honor an agreed CA$450 proposal. If **current asking
price < Active Offer item price**, Accept is blocked until refreshed/reconfirmed
terms are captured in a new Offer. Asking CA$500 -> CA$400 must not let the Buyer
accidentally accept/pay a stale CA$450 proposal. Do not silently change its price.

## 4. Account capability gates and privacy

Keep account-level Payment method **Unset / Set / Needs attention** and Payout
account **Unset / Ready / Needs attention** in Settings -> Payments & payouts.
The same user may buy and sell. No Order-specific card storage.

| Action | Seller payout requirement |
| --- | --- |
| Create Listing, chat, negotiate, receive/view Buyer Offer | May proceed without Ready |
| Seller sends initial/counter Offer | Ready required |
| Seller accepts Buyer Offer | Ready required before Order creation |
| Buyer accepts Seller Offer | Server rechecks the Listing Seller is Ready |

Buyer does not need a Payment method to browse, message, send/counter or Accept.
**Set is required only when actual Buyer payment is attempted.** Receipt of a
Buyer Offer while Seller payout is Unset does not authorize Seller acceptance.
Buyer never receives Seller payout institution/last4/provider identifiers; Seller
never receives Buyer card/payment-method metadata. A safe readiness explanation
must not leak the underlying financial account. Readiness is not payment success.

## 5. Exactly two fulfillment models

| Rule | On Campus | Delivery |
| --- | --- | --- |
| Offer terms | Item price, meetup location/date/time, optional note | Item price, agreed Delivery fee, Delivery method, optional terms/note |
| Accept result | Order + Listing Pending + Payment Pending; wait for meetup | Order + Listing Pending + Payment Pending; checkout timing depends on accepter |
| Payment timing | Meet -> Buyer inspect -> Buyer pay -> confirmed payment -> final handoff | Buyer pay -> authoritative confirmation -> deliver/ship |
| Payment deadline | **No Accept + 30-minute payment deadline** | Buyer accepts Seller Offer: 30m immediately. Seller accepts Buyer Offer: 12h claim, then one-time 30m checkout window |
| Expiry model | Authoritative meetup + 60m grace if unpaid, no handoff and no confirmed replacement schedule | No checkout within 12h, or unpaid at started 30m deadline -> Expired; Listing Available |
| Delivery fee | None | Known before Accept; CA$0 or positive agreed amount |

Pickup and Meet cease to be separate primary V2 flows. On Campus and Delivery
are the only top-level choices; fields switch with fulfillment rather than
showing every field together. The same form is available to both participants.

### On Campus: inspect first, then pay, then surrender possession

Offer Accepted -> Order -> Listing Pending -> agreed meetup -> meet -> Buyer
inspects -> satisfied Buyer pays in-app -> Seller sees authoritative Payment
confirmed -> trusted physical handoff -> Marketplace Protection -> successful
completion -> Listing Sold and payout eligibility. Inspection is not final handoff. Seller must not surrender
final possession before payment confirmation; Buyer need not pay the evening
before tomorrow's meetup merely because acceptance happened then.

Pending payment persists while awaiting meetup; no payment is collected by Accept.
Expiry is tied to meetup/no-show semantics, never a universal acceptance timer.
The initial no-show rule is **authoritative scheduled meetup + 60-minute grace**.
After that deadline, an Order still unpaid, without completed handoff and without
a mutually confirmed replacement schedule is eligible for authoritative Expired
settlement; its Listing returns to Available. Example: 3:30 PM meetup -> 4:30 PM
grace end. Paid Orders must not expire through this unpaid/no-show shortcut.
Frontend clocks are display only.

Either participant may **Propose new meetup** for an accepted On Campus Order;
the other must confirm. Only confirmation makes the replacement schedule
authoritative. An unconfirmed proposal leaves the existing schedule/deadline in
effect. Change only location, date, time and meetup note. Item, agreed item price,
fulfillment model, Delivery fee and other economic terms cannot change through
rescheduling; those require a new Offer through the appropriate transaction flow.
Do not edit the accepted Offer snapshot. Preserve previous/proposed schedules,
proposer, confirmer and authoritative confirmation timestamp. Race validation
and exact schedule-change storage/components belong to implementation.

Target confirmation meaning: accepting creates an Order and reserves the Listing
for the agreed meetup; you inspect before payment and **are not charged yet**.
Recipient-Seller copy must retain Buyer/Seller identities rather than say the
Seller is charged or the Listing is reserved for the Seller.

### Delivery: agreed fee, pay first

Delivery cost must be agreed before acceptance. **Shipping-cost-pending Orders and
the post-Accept quote negotiation workflow are removed from target V2.** Different
fees require a Counter Offer before Accept, not an accepted Order with unknown total.

Delivery method is a subtype: **Seller delivery** or **Courier / shipping**.
Snapshot that choice and agreed service/terms; neither creates a third top-level
flow. Delivery begins only after authoritative payment confirmation.

**Seller Offer -> Buyer Accept:** the Buyer is present. Create Order, Listing
Pending and Payment Pending; start the server 30-minute payment window immediately.

**Buyer Offer -> Seller Accept:** the Buyer may be offline. Create Order and
Listing Pending in the conceptual **Awaiting buyer checkout** state; notify the
Buyer and start a **12-hour checkout claim from authoritative Seller acceptance**.
Do not start the 30-minute payment clock yet. No checkout within 12h makes the
Order Expired and Listing Available; no payment or Delivery has occurred.

When Buyer intentionally starts checkout within that claim window, start the
authoritative **30-minute payment window once**. Page mount, leaving/reopening,
payment-method setup and repeated Continue to payment cannot restart or extend it.
The claim must begin before the 12h deadline; the started payment window has its
own 30m deadline, not an invented minimum of the two. If unpaid at that deadline,
Order becomes Expired and Listing Available. Server race/idempotency checks own
these transitions. The 12h period is post-acceptance, not Offer-age expiry.
Paid Orders are not expired by an unpaid-payment timer. Client countdown is display
only; refresh/payment-method setup does not extend the server deadline.

Buyer provides required address in the accepted Delivery Order flow. Address is
not public Listing data or Offer/chat-card terms. Seller receives it only when
appropriate for fulfillment, and not before authoritative payment confirmation.
Protected courier Delivery requires tracking; Seller's Shipped flag alone does
not start Protection. Trusted carrier Delivered **or** explicit Buyer Confirm
Received supplies receipt. Seller delivery requires trusted handoff/receipt
confirmation using the Buyer-held credential described below.

Target confirmation is direction-aware: Buyer Accept starts 30m payment;
Seller Accept starts 12h Awaiting buyer checkout, followed by 30m only when Buyer
starts checkout. Accept itself never charges Buyer.

## 6. Immutable money and separate financial lifecycles

Offer snapshots agreed item price and, for Delivery, known Delivery fee. Marketplace
calculates Buyer service fee from accepted terms and versioned platform pricing;
Seller cannot enter that fee. Existing pricing rules are retained pending separate
authorization, not silently repriced by this redesign.

Seller platform fee = **CA$0**. Item earnings = agreed item price. Delivery fee is
separate Seller reimbursement. Example: CA$80 item + CA$10 Delivery -> CA$90
expected Seller payout. Buyer service fee is not Seller revenue; Buyer total is
item + Delivery fee + Buyer service fee. Processing costs are platform economics
and are not silently deducted from displayed Seller earnings/reimbursement.

Buyer Payment: Pending, Processing, Paid, Failed, Refunded.
Seller Payout: Not eligible, Pending, On hold, Eligible, Processing, Paid, Failed.
**Payment Paid != Order Completed != Payout Paid.** No escrow claim unless a
selected future provider actually supports that legal/payment mechanism.

## 7. Cancellation, Protection and completion boundaries

Before authoritative payment succeeds, Buyer or Seller can Cancel Order with
reason. Both fulfillment models support this; release Listing only if this Order
owns the reservation. Offer stays Accepted; Order becomes Cancelled. Preserve
audited reason/note/actor/time, idempotency and serialized cancellation races.

After Paid but before fulfillment, the target is Buyer request cancellation,
Seller approve/decline where appropriate, and Seller Cancel & refund when unable
to fulfill. **Not currently implemented.** No direct unpaid-cancel shortcut or
fake refund may stand in for the future authoritative refund lifecycle.

After relevant fulfillment begins (On Campus confirmed handoff; courier material
shipment/tracking boundary; Seller delivery handoff/delivery confirmation), normal
Cancel is no longer primary. Use issue / return / refund / Protection workflows.
Exact post-payment refund eligibility and shipment boundary are future policies.

For **On Campus and Seller delivery**, after authoritative Payment Paid, Buyer
can display a **QR and/or 6-digit handoff code**. No usable credential while
Payment Pending. Seller scans/verifies/enters that Buyer-held credential; successful
server verification confirms physical handoff. Seller cannot independently mark
handoff complete without it. Order-scoped, single-use credential security and exact
cryptography/QR implementation belong to later implementation, not client preview.

For **Courier / shipping**, trusted carrier Delivered **or Buyer explicit Confirm
Received** supplies receipt; physical meetup code is not the primary evidence.
Seller Shipped alone is insufficient. Exact carrier validation is later work.

Protection is **24 hours**, starting only after paid, credential-verified physical
handoff for On Campus/Seller delivery, or trusted courier/Buyer-confirmed receipt.
Payment alone and a Seller assertion of handoff/Shipped alone do not start it.
An open blocking issue prevents completion and holds payout; timer end does not
resolve the issue. Resolution is later server-audited authority.

Completed = fulfillment completed + Protection successfully ended + no blocking
issue. Completion does not wait for bank payout; Completed + Payout Processing
is valid. Retain server-generated/verified, Order-scoped single-use handoff-code
security where applicable; code design is not a client preview authority. Retain
late-payment reconciliation: an already Expired/released Order is not revived or
allowed to steal a new winner's inventory; trusted reconciliation/refund handles
late provider success without rewriting historical Offer/Order facts.

Target coverage direction includes item not received, wrong item, materially not
as described, materially missing agreed included items, significant hidden defects
not reasonably discoverable in normal handoff inspection, and documented
transaction-integrity failures. Normally excluded: Buyer remorse, disclosed defects,
obvious condition accepted at inspection, damage after handoff, off-platform
payment/transactions and terms never included in the accepted Offer/snapshot.
These are future policy directions, **not implemented or marketed guarantees**.
Adjudication, evidence thresholds, refund authority, return logistics and provider
handling require closure before real-money Protection can be marketed as fully
enforceable. They do not block V2-A1 protocol isolation.

## 8. Role-specific UI and information hierarchy

| Viewer | Target progression |
| --- | --- |
| On Campus Buyer | Offer accepted -> Meet & inspect -> Payment -> Handoff confirmed -> Protection -> Completed |
| On Campus Seller | Offer accepted -> Meet buyer / inspection -> Buyer payment -> Handoff confirmed -> Payout on hold -> Payout |
| Delivery Buyer | Offer accepted -> Checkout claim if Seller accepted -> Payment -> Delivery -> Received -> Protection -> Completed |
| Delivery Seller | Offer accepted -> Await Buyer checkout/payment where applicable -> Deliver / Ship item -> Delivered / Protection -> Payout |

Next Step and Payment presentation derive from authoritative role, fulfillment
and persisted state. Seller is never payer; On Campus must not open with immediate
payment urgency. Exact labels can be polished later without reversing timing.

Messages contains human chat plus chronological rich Offer cards alongside
TEXT/IMAGE; sender/current-viewer alignment remains the normal message rule.
Cards identify Buyer offer / Seller offer / Counter offer without separate state
machines. Official-origin Verified, if retained, means only an official Marketplace
transaction artifact, never verified Seller/item/safety/payment.

Keep Orders -> Purchases / Sales -> **Active | History**, default Active.
Unresolved nonterminal work remains Active; Expired, Cancelled, Completed, Refunded
remain History. Preserve exact Order-ID navigation, terminal sorting and list-origin
back context. Messages owns Offer history; Orders owns accepted transactions.

Keep four presentation levels: list bucket; compact Offer current outcome;
expanded Offer status + linked Order outcome + agreed terms; full Order View
details terminal report. Cancellation/refund reports belong only to full detail.
Accepted Offer remains Accepted beneath a linked Order expired/cancelled outcome.
Keep compact cards, approved responsive surfaces and concise desktop no-scroll
expanded terms. Preserve mobile's single content scroll and normal accessibility.

## 9. Notifications and future email

Notifications is a new **primary destination**, separate from Messages, with one
newest-first unified feed, no Offers/Price drops/Orders/Payments category tabs.
Rich Offers remain in Messages; system awareness belongs to Notifications, not
synthetic chat TEXT. Use exact conversation/Offer, Order or Listing targets.

Within that newest-first feed, **Action required** receives stronger emphasis
than **Informational**; priority does not create category tabs or reorder chronology.
Action examples: Counter Offer, Delivery checkout ready/12h claim, complete payment,
payment deadline, meetup soon, reschedule proposal awaiting confirmation, Confirm
Received, Seller payout setup required and issue response. Informational examples:
Price Drop, payment confirmed, Order Cancelled/Expired, Offer Closed, payout paid,
Protection started and Listing available again.

Preferred icon/motion reference is **React Bits Bell Toggle**. This is a design
reference only: future license/source review, existing sizing, keyboard/read-state
accessibility, reduced motion and purposeful non-looping unread feedback are
required. No dependency/code/icon has been installed or copied.

Favorite + Seller price decrease -> Price Drop notification -> exact Listing.
Not a chat entry; price increases do not notify absent later approval. Use safe
role-appropriate text, not cross-user financial metadata. Persist owner-scoped
read state, preserve it on refresh, and expose unread feedback on Bell.

Coalesce repeated drops for the same recipient/Listing into its existing unread
Price Drop: CA$500 -> CA$480 -> CA$450 before reading remains one unread item,
showing original CA$500 and latest CA$450. After it is read, a later meaningful
drop may create a new notification. Exact anti-spam time threshold is an
implementation parameter; event retries must not create duplicates.

Domain event -> Notification record/event -> in-app delivery first -> optional
email channel later. Do not duplicate business logic into email-only events.
Real UWO/custom SMTP and notification email delivery remain deferred. Detailed
event taxonomy, privacy and unread model are in the Notifications design.

## 10. Supersession, compatibility and closure

| V1 rule | Target V2 replacement |
| --- | --- |
| Seller-only Request; Buyer-only Accept | Both send/counter; only immutable recipient accepts |
| Pickup / Meet / Shipping | On Campus / Delivery; Seller delivery/Courier are subtypes |
| Fixed-cost Accept -> 30-minute payment reservation | Delivery Buyer Accept: immediate 30m; Seller Accept: 12h checkout claim then once-only 30m. On Campus: meetup + 60m grace |
| Shipping pending -> accepted quote workflow | Known Delivery fee before Accept; Counter Offer for changes |
| Seller Ready before Request send only + Buyer Accept recheck | Seller Offer send and Seller acceptance plus all Accept rechecks |
| Payment before in-person inspection milestone | On Campus inspection precedes payment; final handoff follows confirmed payment |
| System alerts absent from primary navigation | Primary Notifications unified feed; human negotiation remains Messages |

Preserve all existing V1 historical Accepted Requests, Orders, cancellations,
expiry records, snapshots, identifiers and audit events. Do not backdate or
rewrite them into fake V2 Offers. Future additive versioning/compatibility rendering
must distinguish legacy records; do not reinterpret old deadlines retroactively.

Implementation sequence and migration risks are in the impact audit. Each phase
requires separate authorization; current V1 feature expansion must first consult
this contract. No provider integration or future transaction action is implied
by documenting a target.

## 11. Concise locked decision table

| Decision | Target rule |
| --- | --- |
| Offer sender / withdrawal | Buyer or Seller; sender-only Withdrawn |
| Offer lifecycle | Active / Replaced / Accepted / Withdrawn / Expired / Closed |
| Proposal / inventory | One Active per conversation; one winning Order per Listing; competing Offers Closed |
| Fulfillment | On Campus / Delivery; Delivery subtypes Seller delivery / Courier |
| On Campus payment / Accept timer | Inspect at meetup, then pay; no Accept-based payment timer |
| On Campus no-show | Authoritative meetup + 60m grace; unpaid/no handoff/no confirmed replacement -> expiry eligibility |
| Reschedule | Other participant confirms location/date/time/note; existing schedule until confirmed; economic terms immutable |
| Delivery Buyer accepts Seller Offer | Immediate authoritative 30m payment window |
| Delivery Seller accepts Buyer Offer | 12h checkout claim from Accept, then one-time 30m when Buyer intentionally starts checkout |
| Listing after Accept / terminal outcome | Pending; Cancelled/Expired before completion -> Available; Completed -> Sold |
| Accepted evidence | Immutable Offer + Listing snapshot; live edits cannot rewrite history |
| Active Offer material edit | Remains Active but canAccept=false until new/revised terms where required |
| Lower public price | Asking price below Offer item price blocks Accept; no silent price mutation |
| Physical handoff | Paid Buyer-held QR/6-digit credential, Seller verifies |
| Courier receipt evidence | Trusted carrier Delivered / Buyer Confirm Received, not Seller Shipped alone |
| Protection | 24h after trusted paid handoff/receipt; future policy coverage, not current guarantee |
| Notifications | One newest-first priority-weighted feed; Action required / Informational |
| Price Drop | One unread recipient/Listing item coalesces original/latest price; meaningful later drop after read may create new item |

## 12. Parameters, future decisions and bounded next phase

**IMPLEMENTATION PARAMETERS:** exact UI wording, reschedule layout, secure QR/code
implementation, snapshot physical schema, Listing revision representation,
notification pagination, Bell animation, reminder cadence, Price Drop anti-spam
time threshold, carrier integration, address transport and provider integration.
These do not reopen locked 60m/12h/30m timing or reschedule agreement. Existing
V1 send validation (one-hour lead, 30-day horizon, 15-minute steps) remains a
compatible form baseline unless separately revised; Accept requires a future
meetup, not another one-hour lead.

**FUTURE PRODUCT DECISIONS:** general pre-acceptance Offer-age expiry, paid
cancellation/refund policy, returns/logistics, detailed dispute evidence thresholds,
trusted shipment boundary, rating/review reveal policy, Offers welcome / Price
firm details and email preferences/consent. No numerical Offer-age or quick-offer
percentage is approved. Future Make Offer presets may offer asking/custom amounts
and a reasonable discount once approved.

Future trust direction: reviews tied to authoritative Completed Orders, preferably
one review per participant per Completed Order; blind/delayed reveal may be
evaluated to reduce retaliation. Potential signals are Western email verification,
completed transaction count, rating, response rate/time and account tenure. Future
Messages safety hints may educate about off-platform payment, screenshots and
suspicious external-payment/contact instructions, without blindly blocking normal
chat. Core safety: do not hand over until the authoritative Order shows Payment
confirmed. None is implemented or blocks V2-A1.

**V2-A remains paused; V2-A1 is next:** protocol/version isolation, V1/V2 authority
separation, sender/recipient foundation, legacy backfill/compatibility, V1 mutation
guards and cross-protocol Active exclusivity only. It does not implement new
fulfillment/timers, Pending, snapshots, rescheduling, handoff, Notifications or
Protection disputes. Bidirectional mutations belong to V2-A2. Later dependencies
are in the impact audit; implementation needs separate authorization.

**MARKETPLACE V2 PRODUCT CONTRACT REVISED AND RE-CLOSED.**
**V2-A1 IS UNBLOCKED FOR IMPLEMENTATION.** No unresolved protocol-level product
decision blocks that bounded isolation phase. This does not claim the unsafe V1
compatibility paths are already fixed, authorize implementation in this task or
authorize V2 acceptance before model-specific backend authority is ready.
