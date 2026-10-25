# Business V1 B27 — Authoritative notifications

Status: **B27 LOCAL DEVELOPMENT COMPLETE — REMOTE ACCEPTANCE DEFERRED TO B30**

## Reused authority

B27 adds no notification table, delivery worker, recipient API, preference, or provider
state. It reuses `notification_events.source_key`, `deliver_notification`, the
authenticated inbox, current read/unread and batch actions, Realtime invalidation,
popup deduplication, and the existing email preference/outbox boundary.

Existing V2 transaction events remain authoritative for Shop and Resale Conversation,
Offer, and Order activity. TEXT/IMAGE notification projection still excludes
`marketplace_auto_reply`, so B26 system messages do not become ordinary message
alerts.

## Authoritative projections and presentation

`20261023173802_authoritative_shop_provider_notifications.sql` projects only facts
already committed by their authoritative domains. Every projected B27 event is
`INFORMATIONAL` and inbox-only.

| Event type                           | Recipient                  | Category | Safe target        | Presentation                                                                          |
| ------------------------------------ | -------------------------- | -------- | ------------------ | ------------------------------------------------------------------------------------- |
| `shop_trial_activated`               | Shop owner                 | SYSTEM   | Manage Products    | Shop trial activated; trial access is available and automatic renewal is not claimed. |
| `shop_membership_access_started`     | Shop owner                 | SYSTEM   | Manage Products    | Current membership access is available; a future renewal is not claimed.              |
| `shop_membership_access_upgraded`    | Shop owner                 | SYSTEM   | Manage Products    | Upgraded benefits are available; a future renewal is not claimed.                     |
| `shop_suspended`                     | Shop owner                 | SYSTEM   | Manage Products    | The Shop is temporarily suspended; the UU account remains active.                     |
| `shop_reopened`                      | Shop owner                 | SYSTEM   | Manage Products    | Membership access and Shop operation are active again.                                |
| `order_refund_succeeded`             | Order buyer                | ORDER    | Buyer Order        | Stripe confirmed the authorized refund.                                               |
| `order_refund_failed`                | Order buyer                | ORDER    | Buyer Order        | Stripe did not complete the authorized refund.                                        |
| `order_refund_unresolved`            | Order buyer                | ORDER    | Buyer Order        | The refund result could not be confirmed.                                             |
| `seller_transfer_succeeded`          | Order seller               | ORDER    | Seller Order       | Funds reached the Connected Account; bank payout is not claimed.                      |
| `seller_transfer_failed`             | Order seller               | ORDER    | Seller Order       | Stripe did not complete the Connected Account transfer.                               |
| `seller_transfer_unresolved`         | Order seller               | ORDER    | Seller Order       | The transfer result could not be confirmed.                                           |
| `seller_transfer_reversed`           | Order seller               | ORDER    | Seller Order       | Stripe reports a full transfer reversal; bank payout facts remain separate.           |
| `seller_transfer_partially_reversed` | Order seller               | ORDER    | Seller Order       | Stripe reports a partial transfer reversal; bank payout facts remain separate.        |
| `connected_bank_payout_paid`         | Exact payout-account owner | SYSTEM   | Payments & Payouts | Stripe currently reports the bank payout as paid.                                     |
| `connected_bank_payout_failed`       | Exact payout-account owner | SYSTEM   | Payments & Payouts | Stripe reports the bank payout as failed.                                             |
| `connected_bank_payout_canceled`     | Exact payout-account owner | SYSTEM   | Payments & Payouts | Stripe reports the bank payout as canceled.                                           |

The source key includes the immutable command, cycle, or provider operation identity
and projected fact. Replays reuse one domain event and the existing
recipient/domain uniqueness constraint prevents duplicate inbox rows. Recipients and
destinations are derived in trusted SQL. No amount, provider ID, instrument, bank
detail, raw provider payload, email address, or client-selected identity is copied.

## Navigation and preference boundaries

Shop membership/lifecycle notifications use the existing Manage Products route.
Refund and Transfer notifications navigate only with a valid UUID and a trusted
buyer/seller Order destination. Connected-account Payout notifications use the
existing Settings → Payments & Payouts focus target and never invent an Order
association. Unknown sections, invalid UUIDs, unapproved destination values, and
arbitrary URLs produce no navigation target; the notification content can still be
read.

The three existing preferences retain their meanings:

- In-app off suppresses new popups while persistence, inbox, and unread counts remain.
- Sounds off suppresses audio while notifications and popups remain.
- Email off suppresses eligible email delivery without changing persisted audit
  records.

B27 event types remain absent from `notification_email_enabled()`. Initial history,
refresh, reconnect, duplicate broadcasts, logout, and account switching continue
through the existing provider and per-user deduplication behavior. No new subscription
or Realtime channel was added.

## Deliberate exclusions

- B12 has no durable provider-billing failure/action event. SetupIntent, local
  membership commands, and simulated proof are not payment evidence.
- Grace is an evaluated interval rather than a persisted transition; B27 does not
  manufacture a scan event.
- Stripe Dispute and Operational Case participant disclosure, wording, and recipient
  policy remain unapproved. A resolved operational case is therefore not presented
  as released funds.
- B26 system chat messages remain excluded from ordinary message notifications.
- No new email type was approved.

## B30 acceptance

B30 must deploy the ordered migration chain with financial and Shop activation flags
off, then separately validate authenticated inbox/RLS, Realtime invalidation, provider
replay, email non-delivery, safe navigation, and the five browser widths against the
real Staging application. Stripe Test Mode facts require separately authorized
provider activity. No Staging, Stripe, email, or remote operation was part of B27
local qualification.
