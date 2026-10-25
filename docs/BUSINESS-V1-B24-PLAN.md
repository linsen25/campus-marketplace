# B24 Seller Transfer and Bank Payout Plan

Date: 2026-10-22. B24-A status: **LOCAL DATABASE FOUNDATION COMPLETE**.
B24-B status: **LOCAL EXECUTOR AND RECONCILIATION COMPLETE — REAL STRIPE ACCEPTANCE DEFERRED**.
B24-C status: **LOCAL CONNECTED PAYOUT OBSERVATION COMPLETE — REAL STRIPE
ACCEPTANCE DEFERRED**.

## Scope and authority

B24 keeps three facts separate:

- a seller **Transfer** moves an authorized amount from the UU platform Stripe
  balance to the seller's frozen Connect account;
- a Stripe **bank Payout** moves funds from that connected balance to a bank and is
  not proof that a Transfer succeeded or vice versa;
- Order eligibility is authorization to prepare an operation, not provider evidence
  that either movement occurred.

The existing Order state machine remains authoritative. A normal sale is eligible
only after trusted Stripe payment, completed unchallenged Protection and the existing
`payout_status='eligible'` transition. Its frozen amount is
`v2_order_economics.seller_gross_cents`; the existing seller platform fee is zero.
A cancelled Order may prepare only the separately named
`delivery_compensation` amount from a finalized Settlement Authorization. It never
turns compensation into sale proceeds.

For cancelled Orders, `buyer_release_cents + seller_delivery_compensation_cents`
must equal the secured Stripe payment. When Buyer release is positive, the exact
B23 refund operation must already have a trusted `succeeded` result before the
seller compensation can be prepared. This establishes conservation and prevents a
refund/Transfer race from spending the same secured amount twice. A zero Buyer
release requires no Refund operation. Normal completed sales reject any cancellation,
Settlement Authorization or Refund operation.

## B24-A persistence contract

Migration `20261022041410_order_seller_transfer_operations.sql` adds the private
`marketplace_private.order_transfer_operations` table. One immutable row per Order
freezes:

- Order, paid PaymentAttempt and Seller;
- `sale_proceeds` versus `delivery_compensation` and its authority timestamp;
- Stripe test platform, original PaymentIntent, frozen Connect destination and
  transfer group;
- CAD amount, operation UUID and persistent idempotency key;
- future Transfer reference, provider observation state and a fenced worker lease.

The table is not a ledger or another Order state machine. RLS is enabled and direct
access is revoked from public, anonymous, authenticated and service-role clients.
The service-role-only `marketplace_order_transfer_operation` RPC invokes the existing
Staging guard and supports:

- `prepare`: lock Listing -> Order -> paid PaymentAttempt, then the applicable
  Protection/Settlement, Refund, Connect binding and Transfer row; revalidate all
  frozen authority and create/reuse one operation;
- `claim_due`: claim one due operation for future execution/reconciliation with a
  180-second fenced lease and `FOR UPDATE SKIP LOCKED`;
- `read`: return the current operation, optionally proving a live lease token.

No B24-A path writes `succeeded`, changes an Order, or calls Stripe. The server type
`SellerTransferOperation` preserves the distinction between transfer kind,
destination, provider reference and bank payout.

## B24-B executor and reconciliation

Migration `20261022073253_order_transfer_observations.sql` adds one-time immutable
source Charge binding, provider evidence fields, a fenced result RPC, purpose-isolated
Transfer notices in the existing Stripe inbox, and bounded discovery. A signed event
only wakes an operation; the worker retrieves the current Transfer before applying a
result. Reversal notices move a previously successful operation back to reconciliation
without treating the notice itself as financial proof.

`stripe-order-transfer.ts` validates the original PaymentIntent and captured Charge,
Connect transfer capability, destination, dispute/refund state, frozen amount,
`source_transaction`, transfer group, metadata and Test Mode. A first `execute` claim
may create exactly one Transfer using the frozen idempotency key. A `reconcile` claim
only retrieves and verifies existing Transfers. Unknown create outcomes remain
reconciling; binding conflicts and partial/full reversals fail closed. PostgreSQL row
locks are never held during Stripe HTTPS.

Both `STRIPE_ORDER_TRANSFERS_ENABLED=true` and the separate
`STRIPE_ORDER_TRANSFERS_CREATE_APPROVED=true` attestation are required. Neither is
configured by this work. The second gate must remain unavailable until the business
and compliance decisions below are approved. Refund work runs before Transfer work in
the existing authenticated worker. No second scheduler or financial state machine was
created.

Stripe documents that `source_transaction` ties a Transfer to a Charge and that a
Charge refund does not automatically reverse its Transfers. The executor therefore
checks current Charge refund/dispute evidence and B24-A/B23 conservation before every
create or reconcile. A confirmed `tr_...` proves a Stripe Transfer only.

## B24-C connected-account Payout observation

Migration `20261022110000_connected_payout_observations.sql` adds a private,
RLS-protected account-level observation keyed by Stripe platform, Test Mode,
connected account and `po_...` identity. It stores amount/currency, automatic versus
manual, provider and reconciliation statuses, provider timestamps, Balance
Transaction references and a bounded failure code. It stores no bank account payload,
Order ID or Transfer ID and exposes no browser RPC.

Signed connected-account `payout.*` events are purpose-isolated in the existing
Webhook Inbox and act only as wake-up notices. With
`STRIPE_CONNECTED_PAYOUT_OBSERVATION_ENABLED=true`, the existing authenticated
worker claims a fenced lease and retrieves the current Payout using the signed
connected-account scope. It applies constrained transitions, including Stripe's
documented `paid -> failed` case, while stale states cannot overwrite a terminal
failure. Replays, event reordering and worker restarts remain idempotent.

The observer never calls Payout create, cancel or reverse. A confirmed bank Payout
does not change an Order or the independent Transfer result. Even with a Payout
Balance Transaction, the observation stays `unattributed`: B24-C does not infer
funding from equal amounts or timing. Complete source allocation remains deferred
unless Stripe provides verifiable account-level evidence and the product approves an
allocation contract.

Real money movement remains blocked until Merchant of Record, Canadian Connect
availability, platform/connected-account fee and loss responsibility, refunds after
Transfer, disputes/chargebacks, negative balances and operational recovery are
approved and verified against the actual Stripe account configuration. Existing
Accounts v2 onboarding is reused and unchanged.

## Local qualification

`tests/order-transfer-b24-db.cjs` applies the B21, B22, B23-A/B and B24-A migrations
to an isolated native PostgreSQL instance. It covers ACL/RLS, completed Protection,
open cases, external/unpaid Orders, Connect readiness and destination mismatch,
full and partial Buyer refunds, zero release, amount conservation, immutable source
records, repeated/concurrent prepare, competing worker claims and stale lease tokens.
`tests/order-transfer-b24.cjs` uses a fake Stripe transport for create/retrieve,
timeout recovery, provider mismatch, recipient readiness, conservation, reversal and
event routing. The PostgreSQL suite also applies B24-B, verifies fenced result writes,
immutable Charge/Transfer references and reversal recovery. No Supabase, Stripe,
Staging or Production endpoint is contacted.

`tests/connected-payout-b24.cjs` uses a fake connected-account Stripe transport for
scoped retrieval, all supported event types, state observations, provider mismatch,
bounded retry and the absence of any Payout mutation API. The PostgreSQL suite also
applies B24-C and verifies private ACL/RLS, fenced leases, ordered state transitions,
the trusted paid-to-failed transition and that Payout observation does not mutate
Transfer facts. Real connected webhook delivery, Accounts v2 Payout read permission,
Canadian Connect behavior and Balance Transaction visibility remain Staging/Stripe
Test Mode acceptance work.
