# B23 Refund Plan

Date: 2026-10-21. B23-A status: **LOCAL DATABASE FOUNDATION COMPLETE**.
B23-B status: **LOCAL REFUND EXECUTOR COMPLETE — REAL STRIPE ACCEPTANCE DEFERRED**.
B23-C status: **LOCAL WEBHOOK AND WORKER INTEGRATION COMPLETE — REMOTE ACCEPTANCE DEFERRED**.

## Frozen B23-A contract

`marketplace_private.order_refund_operations` records one durable Stripe refund
operation per Order. It is an execution record, not another Order state machine or
accounting ledger. The database derives the refund amount exclusively from
`order_settlement_authorizations.buyer_release_cents`; callers provide no amount,
currency, seller, PaymentIntent or destination.

Preparation requires a finalized cancellation, a cancelled V2 `uu_pay` Order, its
frozen V2 economics, and the unique paid Stripe attempt. The attempt must contain a
fresh B22 `succeeded` observation with either a normal `applied` result or the single
accepted cancellation-race exception `paid_after_cancellation_requested`. Every
other B22 exception fails closed. Zero buyer release returns `required=false` and
creates no provider operation. Seller delivery compensation and sale payout fields
are never copied or changed.

The operation freezes the original Attempt, PaymentIntent, platform, test mode,
amount, CAD currency, operation UUID and idempotency key. A trigger prevents those
fields from changing. The table has RLS enabled and no direct privileges for public,
anonymous, authenticated or service-role clients.

## RPC and B23-B handoff

`marketplace_order_refund_operation(action, order, platform, token)` is service-role
only and always invokes the existing Staging guard.

- `prepare` locks Listing -> Order -> paid Attempt -> Settlement Authorization ->
  Refund Operation and creates or returns the one fixed operation.
- `claim_due` returns one due operation under a 180-second fenced lease using
  `FOR UPDATE SKIP LOCKED`. `claim_kind=execute` means the first provider request;
  after an expired in-flight lease it returns `claim_kind=reconcile`.
- `read` returns current state. When a token is supplied it rejects an expired or
  superseded lease.

B23-B consumes the returned snake-case fields directly: `id`, `order_id`,
`payment_attempt_id`, `provider`, `provider_mode`, `provider_platform`,
`payment_intent_ref`, `amount_cents`, `currency`, `operation_id`,
`idempotency_key`, `refund_ref`, `state`, `provider_status`,
`request_started_at`, `lease`, `lease_until`, `next_reconcile_at`, `attempts`,
`last_error_code`, `created_at`, `updated_at`, `required`, and `claim_kind`.

Migration `202610210003_order_refund_observations.sql` adds the separate fenced
`marketplace_order_refund_result` RPC. `apply` binds one verified `re_...` reference
and maps Stripe pending/succeeded/failed/canceled/requires_action without changing
Order or Settlement records. `defer` clears the lease and distinguishes transient
provider failure, unknown outcome and binding conflict. Repeated identical terminal
observations are idempotent while the lease is valid; expired leases and conflicting
terminal observations fail closed.

`stripe-order-refund.ts` implements the default-off local executor. It retrieves and
revalidates the original PaymentIntent, completely enumerates Refunds before first
execution, reuses an exact operation match, rejects unrelated Refunds, and calls
`refunds.create` only for a first `execute` claim. A `reconcile` claim never creates
a Refund. Requests use the frozen amount, PaymentIntent, metadata and idempotency key
on the platform account; no reverse-transfer, application-fee refund, Transfer or
Payout option exists.

## B23-C event and worker integration

Migration `202610210004_order_refund_event_integration.sql` adds the isolated
`marketplace_order_refund` inbox purpose, a service-role-only fenced event RPC, and
a bounded candidate query. Signed `refund.created`, `refund.updated` and
`refund.failed` notices are stored in the existing Stripe inbox. Their payload is a
routing hint only. The worker retrieves the current Refund, validates its UU
metadata, and transactionally wakes the matching immutable refund operation. B23-B
then retrieves the Refund and original PaymentIntent again before applying an
observation.

The candidate query returns at most 20 positive Buyer-release authorizations with a
finalized cancellation and trusted B22 paid evidence. It grants no financial
authority: the worker calls the existing `prepare` action for every candidate, so
the original lock order and complete eligibility checks remain authoritative.

The existing `/api/stripe/worker` retains its Bearer authentication and processes
Setup, B22 payments, Refund events, candidate discovery, and B23-B refund work in
that order. `STRIPE_ORDER_REFUNDS_ENABLED` remains default-off; while disabled the
webhook may durably enqueue notices, but the worker does not prepare operations,
claim events or consume a first execute lease.

No repository configuration currently schedules authenticated POST requests to
`/api/stripe/worker`. A reliable scheduler using the existing server-only
`STRIPE_WORKER_SECRET` is therefore a **Staging acceptance blocker**. The minimum
deployment integration is to reuse the platform scheduler already intended by
`STRIPE_PHASE_1B.md`; no second Worker endpoint or cron framework is needed.

Staging must deploy migrations in order: `202610200002`, `202610210001`,
`202610210002`, `202610210003`, then `202610210004`. Stripe Platform webhook
configuration must subscribe the existing endpoint to the three Refund event types.
Remote schema deployment, webhook configuration, scheduler activation and real
Stripe test-mode payment/refund acceptance remain separately authorized work. No
real Refund, Transfer or Payout was executed in B23-A/B/C.

The final local pre-Staging lock-order and replay qualification is recorded in
`BUSINESS-V1-B21-B23-PRE-STAGING-QUALIFICATION.md`. B21, B22 and B23 now share the
Listing -> Order -> PaymentAttempt financial lock prefix; B22 preserves the original
`paid_after_cancellation_requested` exception and evidence across due and Webhook
replays.
