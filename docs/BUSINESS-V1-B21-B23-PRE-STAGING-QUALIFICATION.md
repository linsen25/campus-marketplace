# B21-B23 Pre-Staging Financial Qualification

Date: 2026-10-21. Target when separately authorized: Staging
`pcaqxezdfxofysghssyo`. This qualification was local only.

## Corrected findings

`marketplace_order_payment_provider` previously locked PaymentAttempt before
Listing and Order. B22 `apply_event` / `apply_due` did the same before re-locking
the rows in the opposite order. B23 already used Listing -> Order -> PaymentAttempt,
so concurrent work on one Order could form a deadlock cycle.

B21 now locates identity without a row lock, then locks Listing -> Order ->
PaymentAttempt and revalidates Attempt ownership and Order binding. B22 event apply
uses Inbox Event -> Listing -> Order -> PaymentAttempt; due apply uses Listing ->
Order -> PaymentAttempt. Both revalidate the current fenced lease after the final
financial row lock. B23 event wake uses Refund Inbox Event -> Listing -> Order ->
RefundOperation and never acquires PaymentAttempt after RefundOperation.

B22 duplicate success previously assigned a null exception and could overwrite an
existing `paid_after_cancellation_requested`. A matching repeat observation now
preserves the exception state, code and original evidence ID. It does not repeat the
Paid transition or cancellation finalization. Binding, amount and contradictory
terminal checks still run first and fail closed.

## Migration-chain qualification

The isolated PostgreSQL suite applies, in order:

1. `202610200002_order_payment_intent_start.sql`
2. `202610210001_order_payment_reconciliation.sql`
3. `202610210002_order_refund_operations.sql`
4. `202610210003_order_refund_observations.sql`
5. `202610210004_order_refund_event_integration.sql`

The chain accepts legacy PaymentAttempts with every provider field null and legacy
Stripe inbox rows through the `account_setup` default. Existing Orders,
PaymentAttempts and Settlement Authorizations are not rewritten. Candidate discovery
requires verified Stripe provider evidence and therefore excludes historic simulator
payments, external Orders and zero Buyer release. Purpose checks isolate Setup,
PaymentIntent and Refund events. Private refund tables retain RLS and no direct
public, anonymous, authenticated or service-role table privileges; financial RPCs
are executable only by service role and retain the Staging guard.

The concurrent native PostgreSQL test holds the shared Listing row, starts B21
provider read, B22 payment observation and B23 refund claim in separate sessions,
then releases the blocker. All complete within bounded lock/statement timeouts with
no deadlock and unchanged refund authorization. The cancellation-race replay test
executes initial late success, due reconciliation and duplicate Webhook observation;
the original exception/evidence and single Settlement Authorization survive.

## Deferred remote acceptance

No migration or application code was deployed. Staging still requires the five
migrations, existing Platform webhook subscription to the approved payment/refund
events, reliable authenticated scheduling of `/api/stripe/worker`, and Stripe
test-mode end-to-end payment/refund acceptance. Provider money movement remains
disabled by default.
