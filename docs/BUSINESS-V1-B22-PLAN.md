# B22 Verified Order Payment Events & Reconciliation

Date: 2026-10-21. Status: **LOCAL IMPLEMENTATION COMPLETE — REAL STRIPE AND STAGING ACCEPTANCE DEFERRED**.

## Scope and reused authority

B22 consumes verified Stripe Order PaymentIntent notices, retrieves the current
PaymentIntent from Stripe, validates it against B21's frozen attempt binding, and
applies the existing locked Order payment transition exactly once. It reuses:

- the raw-body Stripe webhook handler and channel-specific signing secret;
- `stripe_webhook_inbox` for durable event identity, dedupe and leases;
- B21 `campus_payment_attempts`, provider identity, frozen amount and stable
  PaymentIntent reference;
- the Listing -> Order -> Attempt lock order and existing Order/Listing triggers;
- the current cancellation finalizer and settlement authorization boundary;
- the authenticated worker route and shared Stripe runtime.

It does not add another Order state machine or payment ledger. It does not execute
a Refund, Transfer, bank Payout, application fee or settlement operation.

## Event and reconciliation flow

Only four platform-channel notices are accepted for Order routing:
`payment_intent.succeeded`, `payment_intent.payment_failed`,
`payment_intent.processing`, and `payment_intent.canceled`. The raw request is
signature-verified first. Live events, connected-account events, malformed objects
and non-Order `uu_kind` values are rejected or ignored before persistence. Signed
metadata routes the event but is never terminal payment proof.

The inbox now has a purpose discriminator. Existing setup rows remain
`account_setup`; Order notices are `marketplace_order`. The setup claim RPC can
only lease setup rows and the B22 RPC can only lease Order rows. A persistence
failure escapes the verifier and produces a non-2xx response so Stripe can retry.

The worker claims a notice, retrieves its bound PaymentIntent with the server SDK,
and supplies the retrieved facts to a service-role-only RPC. The RPC locks the
Listing, Order and Attempt and compares provider reference, test mode, platform,
Order, Attempt, amount, CAD currency, Customer, PaymentMethod, Seller account,
transfer group and purpose/environment metadata. Mismatch is persisted as an
exception and cannot update the Order.

Webhook order is irrelevant: each notice causes retrieval of current provider
state. Different event IDs for one PaymentIntent are durable but only the legal
current transition can apply. A succeeded automatic-capture PaymentIntent also
requires `amount_received` to equal the frozen total. A canceled PaymentIntent
requires zero received funds. `payment_failed` with a recoverable current status
keeps the same attempt pending; it is not treated as final failure.

Bound processing attempts are periodically claimed for active provider retrieval,
covering lost webhooks. Unbound B21 attempts whose create response was lost are
offered back to the B21 adapter after its lease expires, preserving the original
attempt, request parameters and Stripe idempotency key. Provider/DB calls remain
separated by leases and no database lock is held across HTTPS.

## Outcome rules

- `succeeded` with complete binding: apply Paid once through the existing locked
  Order fields and trigger side effects.
- `canceled` with zero funds: apply Failed once and retain the existing inventory.
- `processing`, `requires_action`, `requires_confirmation`, or
  `requires_payment_method`: keep processing and schedule reconciliation.
- `requires_capture`: exception because B21 requires automatic capture.
- binding/amount/environment mismatch: fail closed and retain an operational
  exception.
- success racing a pending cancellation: record Paid evidence, invoke the existing
  cancellation finalizer, retain the authorized refund disposition for B23, and
  flag `paid_after_cancellation_requested`. No refund executes in B22.
- success for an already terminal incompatible Order: retain `late_success` or
  `terminal_conflict`; never reopen the Order.

The browser remains read-only for outcomes. Stripe.js confirmation still only
causes an authoritative Order refresh.

## Files and deployment boundary

Runtime changes are limited to the Stripe verifier/worker and a dedicated B22
adapter. Migration `202610210001_order_payment_reconciliation.sql` extends the
existing inbox and attempt records and adds one service-role RPC. It also attributes
the existing immutable `payment_paid` transaction event to `stripe` when the
authoritative attempt is a Stripe attempt.

The migration is local only. `STRIPE_ORDER_PAYMENTS_ENABLED` remains default-off.
No Stripe, Staging or Production operation was performed.

## Deferred work

- Real Stripe signature delivery, PaymentIntent retrieval and event ordering.
- Staging migration/security/runtime acceptance.
- B23 actual refunds from existing authorizations.
- B24 seller Transfer and bank payout execution/reconciliation.
- B25 disputes, chargebacks, negative balances and operational exception handling.
- Merchant-of-record, Connect capability/region, fees, RPAA and terms approval.
