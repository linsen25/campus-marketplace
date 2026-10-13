# Notifications V2 product design

Revised target, 2026-10-11. **NOT IMPLEMENTED.** Authority:
[Marketplace V2 contract](MARKETPLACE_V2_PRODUCT_CONTRACT.md). Current staging
still runs V1; existing Realtime broadcast invalidation is not a persistent
Notifications feed. No UI, APIs, storage, emails or dependencies change here.

## Purpose, destination and boundaries

Messages = human-to-human chat and Offer negotiation; chronological rich Offers
remain beside TEXT/IMAGE. Notifications = system awareness of domain events.
Do not convert every lifecycle alert or Price Drop into chat TEXT. A domain event
may reference its original Offer and produce a system notification without
duplicating the transaction or replacing its audit record.

Notifications is a primary destination near Messages/Orders according to the
existing sidebar hierarchy, not a Messages sub-tab. First version has **one unified
chronological feed, newest first**. No Offers, Price drops, Orders or Payments
category tabs. Exact primary position follows existing navigation conventions.

## Bell Toggle direction and accessibility

React Bits **Bell Toggle** is the preferred bell/motion reference, not an installed
component or a licensing claim. Future work must inspect source/license compatibility,
fit existing icon sizes/styles, support keyboard activation and accessible naming,
show read/unread without relying only on color and honor reduced motion. Bell is
navigation, not an on/off permission to receive events. Normal state when all read;
unread dot/count when needed. Motion only for purposeful new/unread changes, never
continuous distracting looping. Animation timing remains an implementation parameter.

Feed items need visible focus, readable safe summaries and a precise accessible
destination. Navigation/read failure should remain recoverable, not silently discard
the notification. Existing typography, spacing and mobile navigation patterns apply.

## Conceptual record and read state

Conceptual fields: ID, recipient, event type, concise title/body, authoritative
created timestamp, read/unread state, typed exact destination and safe rendering
metadata. Future delivery-channel state may be associated separately. This is not
a schema/migration specification. Event identity should support idempotent delivery
without multiple records for a retried transition; detailed keys/pagination are
later engineering decisions.

Include presentation priority **Action required** or **Informational** in the
conceptual record. Both remain in the same newest-first feed; stronger action
emphasis is not a category tab, separate inbox or alternate lifecycle authority.
Current authoritative eligibility is rechecked when acting on an old alert.

Authenticated users see and update read state only for their own records. Opening/
clicking the relevant notification can mark it read; refresh preserves state.
Bell reflects authoritative unread state. Do not mark unrelated items read merely
because the page mounted. Mark all as read is optional later, not required initially.
No complex category/preferences system is required for the first in-app release.

## Event taxonomy and precise navigation

Every event is a target, not a claim of a working backend transition. Notify only
from authoritative facts and to appropriate affected participants/account owners.
Avoid self-alert duplication or redundant Offer accepted/Order created alerts via
later delivery policy, while retaining the underlying domain/audit events.

| Family | Target events | Destination |
| --- | --- | --- |
| Offer | New Offer received; Counter Offer received | Exact conversation + Offer (Counter at least exact conversation) |
| Offer | Accepted | Exact created Order |
| Offer | Replaced where awareness useful; Withdrawn; Expired; Closed because Listing unavailable | Exact conversation + original Offer |
| Listing | Price Drop for Favorited Listing; Listing unavailable where appropriate; Pending Listing available again for previously interested users | Exact Listing; recoverable unavailable context if removed; no automatic Offer resurrection |
| Order | Created; Cancelled; Expired | Exact Order, terminal View details when applicable |
| Payment | Complete Payment; started 30m payment deadline approaching | Exact Delivery Order Payment |
| Payment | Confirmed; Failed where applicable; future Refund update | Exact Order Payment, owner-safe financial summary |
| On Campus | Meetup soon; new meetup proposed awaiting other participant confirmation; reschedule confirmed; inspect-and-pay awareness | Exact On Campus Order + schedule context |
| Delivery | Checkout available when Seller accepts Buyer-origin Offer; 12h claim awareness/reminder | Exact Delivery Order checkout; mount/navigation alone must not start the 30m timer |
| Delivery | Delivery/Shipping started; supported tracking update; Delivered; Buyer receipt confirmation | Exact Delivery Order/fulfillment context |
| Protection | Started; Ending; Issue reported; Issue updated/resolved | Exact Order protection/issue context |
| Payout | Eligible; Processing; Paid; Needs attention | Seller's exact Order payout context / own setup where required |

An actionable alert must not send users to a generic homepage when its exact
entity is known. Destination authorization is rechecked on navigation; possession
of notification metadata does not grant access. Entity deletion/unavailability
must fail safely rather than reveal another participant's data.

**Action required:** Counter Offer, checkout ready, complete payment, payment
deadline approaching, meetup soon, reschedule confirmation, Confirm Received,
Seller payout setup required before sending/accepting and issue requiring response.
**Informational:** Price Drop, payment confirmed, Order Cancelled/Expired, Offer
Closed, payout paid, Protection started and Listing available again. Other events
receive priority according to the recipient's actual required action; new Offer
and setup awareness must not bypass capability/authorization checks.

Delivery direction is essential: Buyer accepts Seller Offer -> 30m begins at
Accept; Seller accepts Buyer Offer -> checkout-ready notification and 12h claim
from server Accept, then 30m once Buyer intentionally starts checkout. Notification
delivery/read time never changes deadlines. On Campus uses meetup + 60m no-show
grace, not Accept + 30m. An unconfirmed reschedule never resets the old deadline;
confirmation changes authoritative schedule and produces preserved-history events.
Reminder cadence/channel scheduling remains an implementation parameter.

## Price Drop

When Seller lowers a Listing's authoritative price, users who Favorited that
Listing can receive **Price dropped - [Listing] is now CA$450**, targeting that
exact Listing. It is a Notifications event, not Messages chat. Price increases
do not notify unless separately approved. Do not fabricate alerts from browser
sort/filter activity.

For each recipient/Listing, repeated decreases **coalesce into the existing
unread Price Drop**. CA$500 -> CA$480 -> CA$450 before read produces one unread
record showing original CA$500 and latest CA$450. Do not create another unread
record or increment unread counts for a coalesced drop. Preserve authoritative
source-event linkage and idempotency even when one notification summarizes several
decreases. Once read, a later meaningful decrease may create a new item; exact
anti-spam time threshold remains an implementation parameter. Concurrent read/drop
and repeated delivery require atomic owner-scoped dedupe tests. Audience must
derive from real Favorites, not browser activity. No numeric threshold is invented.

## Privacy and safe payloads

Use product summaries such as **Payment confirmed**. Do not copy card brand/last4
or provider IDs into the other participant's notification. Buyer must not receive
Seller payout institution/last4/provider IDs; Seller must not receive Buyer payment
method metadata. No credentials, tokens, privileged keys, raw addresses or private
image URLs in general feed payloads. Financial owner-only display, if ever expanded,
needs its own approved contract. Safe metadata is not arbitrary provider payload.

Delivery address remains a protected accepted-Order fulfillment field, with Seller
visibility only after confirmed payment when appropriate; an email or notification
must not become a privacy bypass. Public/lock-screen/email previews should use
minimal text and authenticated targets, not complete private transaction content.

## Delivery channels and future email

Single business event -> Notification record/event -> **in-app first** -> optional
email later. Email must not independently decide Offer acceptance, price decreases
or deadlines. Persisted delivery/idempotency mechanisms can prevent repeated sends;
channel failure must not repeat a transaction transition or lose the in-app record.

Future email candidates: new Offer, Offer accepted, checkout ready, Delivery deadline, meetup
reminder, Price Drop, Order cancelled, issue/Protection update. Exact preferences,
opt-in policy, retry limits and provider choice belong to later scope. Preference
UI mechanics are parameters; the actual consent/delivery policy is a future product
decision. Real UWO delivery/custom SMTP remains **DEFERRED**, not verified by this
contract. No Auth email, SMTP or notification delivery is configured or exercised.

## Explicitly absent today

No primary Notifications UI/Bell, notification persistence/read API, Price Drop
events, reminder workers, email delivery or React Bits integration is implemented
by this task. V1 `messages_changed` broadcasts remain invalidation hints to refetch
authorized data, not notification records. Implementation phases V2-G/H/I are
outlined in the [impact audit](MARKETPLACE_V2_IMPACT_AUDIT.md): V2-G Notifications,
V2-H Price Drop, V2-I selected trust/safety; optional email requires separately
authorized infrastructure/consent and is not silently included in V2-I.
