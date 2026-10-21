# B22 Local Qualification

Date: 2026-10-21. Status: **LOCAL VALIDATION COMPLETE — REMOTE ACCEPTANCE DEFERRED**.

## Implemented and tested locally

- Official Stripe SDK raw-body signature verification remains the only webhook
  entrance; tampered and live payloads fail closed.
- Order, account setup, connected onboarding and future membership purposes are
  isolated before consumption.
- Webhook notices persist before acknowledgement and deduplicate by existing inbox
  identity. Persistence failure produces HTTP 503.
- The worker retrieves the current PaymentIntent and never applies the event
  payload as financial proof.
- Frozen provider/Order/Attempt/customer/method/seller/amount/currency/metadata
  bindings are revalidated inside the database transaction.
- Duplicate and out-of-order notices, expired leases, recoverable payment failures,
  missing webhooks, lost create responses, cancellation races and late/invalid
  evidence have explicit safe outcomes.
- Paid/Failed transitions reuse current Order fields, locks, constraints,
  transaction events, notifications and cancellation finalization.
- B21 start identity and idempotency are unchanged. No B22 path calls refund,
  transfer or payout APIs.

## Local evidence

- `tests/order-payment-b22.cjs`: mocked Stripe retrieval, durable enqueue contract,
  event/due retry, unbound B21 recovery and no money movement.
- `tests/order-payment-b22-db.cjs`: isolated native PostgreSQL migration, purpose
  isolation, event dedupe, binding mismatch, Paid/Failed idempotency, cancellation
  race, lease expiry/recovery, active reconciliation and grants.
- Existing Stripe setup, B20, B21 and B09 focused regressions.
- Application TypeScript, focused ESLint, Prettier, `git diff --check`, and
  production build.

## Not proved locally

Mocks and isolated PostgreSQL do not prove actual Stripe event delivery, account
scope, PaymentIntent fields, Connect capability, provider timing, Staging RLS or
worker operations. No real charge, refund, transfer, payout or remote migration was
performed. These remain mandatory separate acceptance work before enabling Order
payments.
