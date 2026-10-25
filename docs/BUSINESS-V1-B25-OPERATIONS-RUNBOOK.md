# UU Business V1 鈥?B25 Operational Recovery Runbook

Status: **LOCAL CONTRACT ONLY 鈥?STAGING/STRIPE TEST MODE NOT QUALIFIED**
Date: 2026-10-22

## Safety boundary

The authenticated Stripe Worker, source operation rows, Provider Inbox,
Operational Cases and immutable audit are the only recovery authorities. Browser
claims, case labels and user statements are never financial evidence. Recovery may
read current Provider state and resume the same fenced operation; it cannot invent a
new operation ID, idempotency key, amount, destination or result.

All financial flags remain independent. `STRIPE_OPERATIONAL_RECOVERY_ENABLED` only
enables the global run fence, audit, case sweep and summary. It does not enable a
Payment, Refund, Transfer, Payout or Dispute action.

## Incident procedures

### Worker stopped or crashed

1. Check the latest private `operational_recovery_runs` row and its sanitized step
   results.
2. A live five-minute lease means another Worker owns the run. Do not bypass it.
3. The next authorized run marks an expired lease `crashed` and receives a new
   token. Old tokens are rejected.
4. Check the private summary for overdue operations and pending provider events.

Automatic: expired-lease reclaim and the existing bounded claims.
BLOCKED: manually changing leases, marking a financial result, or starting a second
scheduler.

### Webhook lost, duplicated or out of order

Duplicate Inbox identities are idempotent. Webhooks are hints; each consumer reads
the current Stripe object before applying evidence. Due Payment, Refund and Transfer
operations can reconcile without event ordering. Payout and Dispute observations
require their signed account/event channel and current-object retrieval.

After ten failed financial-event claims, automatic retries stop. The event becomes a
private Provider Event Exception and a separate unattributed operational case. A new
event with a different Stripe event identity can still provide fresh evidence.

Automatic: bounded replay, retry with the same event/operation identity, stale-event
rejection and retry-exhaustion case creation.
BLOCKED: fabricating an event, changing its account scope, or accepting event JSON as
final financial proof.

### Stripe charged but local Payment is missing

Use the existing B21 operation UUID/idempotency key and B22 reconciliation. An
unbound create response is recoverable only inside the existing 20-hour window.
After that window, or after ten bound reconciliation attempts, the same attempt is
indexed as a manual-review case. Never create a replacement PaymentIntent merely
because the response was lost.

### Refund result unknown

Keep the original Refund operation and idempotency key. A `reconcile` claim may only
list/retrieve and verify the matching Refund; it cannot create one. Provider timeout,
5xx or 429 remains unknown and follows the existing bounded backoff. Binding mismatch
or exhausted retry becomes an operational case.

BLOCKED: a second Refund, caller-selected amount, or treating no response as failure.

### Transfer occurred and an Order later has a Dispute

Preserve the confirmed Transfer fact and create/refresh the distinct Stripe Dispute
case. B25-A blocks new Transfer preparation/claims for proven active disputes. A
Dispute does not rewrite an executed Transfer or Payout.

BLOCKED: automatic Transfer Reversal, Seller debt allocation, Protection resolution
or future-income deduction.

### Connected Payout failed

Preserve the independent successful Transfer. Re-read the Payout only in its signed
Connected Account scope and refresh the Payout case. Do not assign the Payout to one
Order by amount or timing.

BLOCKED: creating/canceling a Payout, changing bank details or schedules, or marking
an Order paid out.

### Stripe Dispute lost

Record the current Dispute, Charge, PaymentIntent and bounded balance-transaction
facts. Keep Stripe status separate from UU Protection and operational review status.

BLOCKED: automatic liability assignment, Refund, Transfer Reversal, evidence
submission/closure, Protection release or Seller recovery.

### Connected Account negative balance

No approved negative-balance collection policy or trustworthy general balance
observation exists. Record only a verified provider exception when available and
escalate it. Do not infer a loss from a failed Payout.

BLOCKED: debiting a Seller, withholding future proceeds, bank collection or assigning
the loss to Buyer, Seller or UU.

## What can recover automatically

- signed Inbox replay and duplicate suppression;
- current-object read and binding verification;
- expired source lease reclaim through its existing claim RPC;
- retry of a read-only reconciliation with the same operation identity;
- bounded backoff for provider/network unavailability;
- case creation/refresh from trusted source rows;
- recovery-run crash detection, step isolation and sanitized summary.

## What requires approved human authority

- resolving or changing operational review status;
- clearing any financial or Protection hold;
- choosing liability for chargebacks, fees or negative balances;
- forcing Refund, Transfer, Reversal, Payout or Dispute actions;
- overriding a binding conflict or frozen economic value;
- deciding whether evidence may be submitted to Stripe.

No approved human Operations identity exists yet. The reserved review RPC therefore
fails closed even for a service-role request carrying a claimed actor ID.

## Evidence checks

For an incident, correlate only stable IDs: Order, PaymentAttempt, operation, Inbox
event, Operational Case and Provider object reference. Verify the source row's
attempt count, lease expiry, next reconciliation time, provider observation time,
sanitized error code, hold projection and append-only case/run audit. Do not copy raw
Stripe payloads, card/bank data, addresses or Messages into the case index.

The private summary reports unresolved/manual cases, blocked Orders, due financial
operations, pending financial Inbox events and the latest run. It is operational
evidence from persisted records; it is not proof that Stripe delivery, a bank Payout
or remote scheduling works.

## Deployment qualification still required

B28/B30 must verify explicit Staging identity, migration order, webhook endpoints,
Vercel scheduling, Worker secret rotation, Stripe Test Mode account scopes, crash and
429/5xx exercises, Accounts v2/Canadian Connect visibility, alerting and runbook
access control. Production and real money remain prohibited until those checks and
the outstanding commercial policies are separately approved.
