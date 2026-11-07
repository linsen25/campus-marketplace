# Business V1 B31 — Transaction Protection & Payment Integration

## Local implementation scope

B31 reuses the existing PaymentIntent reconciliation, refund operations,
transfer operations, webhook inbox, dispute observations and transaction due
worker. No second order, payment or queue system is introduced.

The new forward-only migration `202611060001_b31_buyer_receipt_protection.sql`
records buyer receipt on the existing `order_protection` row and sets
`release_eligible_at = buyer_confirmed_at + 48 hours`. Legacy handoff
observations may remain as a 24-hour pre-receipt observation for compatibility,
but they cannot settle or authorize a seller transfer; the release clock starts
only when the buyer receipt command is accepted. The due worker may settle an
order only after the server-side release gate, and a database trigger rejects a
sale-proceeds transfer before that gate. Receipt and transfer operations are
idempotent and lock the order/listing boundary.

## Safety boundaries

Payment, refund, transfer, payout, recovery and Shop transaction feature flags
remain unchanged and disabled in the current environment. Stripe provider
calls are not made by the migration or local tests. A Stripe Transfer is not a
bank payout and UU does not represent the flow as legal escrow.

Refund requests, open protection cases, unknown provider outcomes and missing
trusted reconciliation continue to block release through the existing B22–B25
checks. A post-transfer refund/reversal remains an operational risk requiring
the existing B24/B25 recovery and manual responsibility policy.

## Validation status

The B31 static invariant test is local and provider-free. Full PostgreSQL
runtime validation (48-hour boundary, duplicate receipt, transfer/refund race,
RLS and trigger execution) requires the disposable Supabase CI environment;
the Windows local PostgreSQL runner is not used. Real Stripe Test Mode,
webhook delivery, connected-account payout timing, and staging browser flows
remain **NOT VERIFIED** and must be authorized separately.

The database qualification workflow now builds an explicit temporary migration
workspace containing migrations through 010 plus B31 `202611060001`; it asserts
that `202610260011` is absent before startup and before catalog checks. The
workflow and B31 SQL assertions are prepared locally but have not been pushed
or executed in GitHub Actions during this task.

The product decision for a buyer who never confirms receipt remains manual
handling/reminder only; this implementation does not auto-confirm or auto-pay.
