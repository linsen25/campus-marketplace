# UU Business V1 鈥?B25 Dispute and Operational Recovery Plan

Status: **B25-A/B/C LOCAL IMPLEMENTATION COMPLETE 鈥?REMOTE ACCEPTANCE DEFERRED**
Date: 2026-10-22

## Boundaries

- **B25-A** records verified Stripe payment-dispute facts, preserves provider
  operational exceptions and places a fail-closed hold on new Seller Transfer
  preparation or claims. It does not decide liability or move money.
- **B25-B** provides the private operational-case index, minimal evidence
  references, immutable system audit and a server-only read/sync boundary. Human
  review transitions remain deliberately disabled until an operational actor and
  authorization policy are approved.
- **B25-C** adds bounded recovery-run fencing, crash audit, isolated Worker steps,
  case rescan and a private persisted summary. Real Stripe Test Mode/Staging
  qualification remains deferred to B28/B30.

UU internal Protection cases, Stripe charge disputes and provider operational
exceptions remain separate. A Stripe `won` or `lost` status is evidence only and
does not resolve an internal case, release money or clear the B25-A hold.

## Local implementation

Migration `20261022194401_stripe_dispute_observations.sql` adds one private,
RLS-enabled observation table keyed by platform, Test Mode and `du_...` identity.
It freezes the Charge, PaymentIntent, PaymentAttempt/Order attribution, dispute
amount, Charge amount, separately observed Charge refund amount, currency, reason
and reconciliation classification. Mutable observations are limited to current
provider status, evidence deadline/submission facts, bounded Balance Transaction
summaries, separately calculated withdrawal/reinstatement amounts, the sticky
financial hold and the Transfer snapshot seen at observation time.

`marketplace_stripe_dispute_events` is a service-role-only, staging-guarded,
`SECURITY DEFINER` RPC. Signed platform webhook events are deduplicated in the
existing Stripe inbox and only wake work. The worker retrieves the current Dispute,
Charge and PaymentIntent and validates Test Mode, CAD, object bindings, metadata and
amount bounds before applying a fenced observation. Unknown PaymentIntents remain
`unattributed`; conflicting metadata remains `conflict`; neither is guessed from an
amount or timestamp.

The existing worker drains dispute observations before Refund and Transfer work.
The database trigger blocks new Transfer operation inserts and new Transfer leases
for an attributed held Order. Its lock path preserves Inbox -> Listing -> Order ->
PaymentAttempt -> Transfer. If Dispute observation races Transfer preparation,
either preparation sees the hold or a committed prepared operation is fenced at
`claim_due`. Existing Transfer success/reversal facts remain unchanged.

No generic accounting ledger or second Order/dispute state machine was added.
Existing B21鈥揃24 exception fields remain authoritative for their own provider
operations. B25-A intentionally does not block an already authorized buyer Refund:
that would require a new liability rule and could prevent returning buyer funds.

## B25-B local foundation

Migration `20261022202042_operational_case_foundation.sql` adds three private,
RLS-enabled structures: an idempotent case index, append-only minimal evidence
references and append-only audit history. It derives cases only from trusted UU
Protection, Stripe Dispute, Payment, Refund, Transfer and Connected Payout records.
Distinct source types remain distinct even when they refer to the same Order, and
unattributed Stripe disputes remain unattributed.

Source triggers create or refresh one case per trusted source identity. A refresh
updates only the current risk, deadline, hold/release projection and source status;
it cannot rewrite frozen source binding or resolve a review. Provider recovery is
recorded without silently deleting the earlier case or treating an operational
status as financial authority. Evidence stores UUID references and observation
times only; it does not copy messages, addresses, card/bank data or raw Stripe
payloads.

`marketplace_operational_cases` is staging-guarded, `SECURITY DEFINER` and
service-role-only. It supports trusted `sync` and minimal `read`. Its reserved
`review` action validates input/version and then fails closed because no approved
human Operations identity exists. `lib/server/operational-cases.ts` exposes the
same server-only boundary and deliberately provides no browser route or review
write path. Case status never completes/cancels an Order, clears Protection,
creates a Refund/Transfer/Reversal/Payout, or changes existing financial evidence.

## Provider adapter

`stripe-order-dispute.ts` is default-off behind
`STRIPE_ORDER_DISPUTE_OBSERVATION_ENABLED`. It accepts only the five supported
`charge.dispute.*` hints, then performs trusted server retrieval. Persisted Balance
Transaction data is a bounded non-sensitive summary; raw provider payloads, card
data and secrets are not stored. There is no call to submit evidence, close a
dispute, create a Refund, create/reverse a Transfer or create/cancel a Payout.

## Local verification

- Fake Stripe coverage: opened/updated/closed, `needs_response`, `under_review`,
  `won`, `lost`, partial dispute amount, independent refund/withdrawal/reinstatement
  facts, replay, provider mismatches, default-off behavior and absence of mutation
  APIs.
- Native PostgreSQL coverage: migration-chain application, ACL/RLS, attributed and
  unattributed observations, sticky holds, Transfer snapshot preservation,
  provider-terminal replay, dual-session Dispute/Transfer race, lease fencing and
  no mutation of Orders, Refunds, Transfers or Protection cases.
- Existing B23 and B24 adapter/database regressions remain part of qualification.

## B25-C recovery scope

B25-C reuses the existing Worker and each B21鈥揃25 operation's own bounded claim,
lease, idempotency identity and Provider reconciliation. Migration
`20261023010212_operational_recovery_audit.sql` adds one private recovery-run audit
table and a service-role-only RPC. A five-minute global run lease prevents duplicate
workers; an expired run is preserved as `crashed`, and a stale token cannot finish a
replacement run. Completion stores only bounded step counts and sanitized error
codes. It is operational audit, not a financial ledger.

The RPC performs a maximum-50 case sweep and a read-only summary of unresolved
cases, blocked Orders, overdue Payment/Refund/Transfer records and pending financial
Inbox events. It does not retrieve Stripe objects or write financial source rows.
Stale unbound Payment creation after the existing 20-hour safe recovery window, and
bound Payment reconciliation after ten attempts, become stable manual-review cases;
the same attempt and idempotency identity remain frozen.

Financial Inbox events that reach ten failed claims stop retrying. Their stable
event/account/object identity is copied into the private, immutable
`operational_provider_event_exceptions` projection and a separate unattributed
operational case. The Inbox row is closed with `retry_exhausted`; it is not guessed
onto an Order. SetupIntent/account-setup events are explicitly excluded.

`stripe-operational-recovery.ts` runs the existing Setup, Payment, Dispute, Refund,
Transfer and Connected Payout drains in their established order and finite batches.
Each step is isolated, so one provider family cannot starve the rest. Errors are
reduced to an allowlisted code. The new
`STRIPE_OPERATIONAL_RECOVERY_ENABLED` flag defaults to false and controls only the
run fence/audit/sweep; it does not enable Payment, Refund, Transfer, Dispute or
Payout capabilities. Reconcile paths retain their existing rule that they cannot
create a new Provider object.

Automatic recovery remains limited to current trusted reads, expired-lease reclaim,
same-operation retries inside existing attempt limits and case refresh. Binding
conflicts, exhausted retries, unknown provider outcomes, Dispute losses, negative
balance responsibility and inconsistent Refund/Transfer evidence stop at a stable
case. No case status releases Protection or initiates money movement.

## Unresolved policy and acceptance

B25-B cannot safely enable operational write powers until the product approves the
actor identity, least-privilege authorization, evidence submission authority,
liability allocation, hold-release criteria, negative-balance treatment and whether
any provider action requires dual approval. B25-A therefore keeps attributed holds
sticky even after provider `won`/`lost`.

Real webhook endpoints/subscriptions, worker scheduling, Stripe Test Mode object
retrieval, Connect account event visibility, dispute Balance Transaction semantics
and Canadian/Merchant-of-Record responsibility are unverified. All financial and
observation switches remain off; no remote migration or provider operation has run.
See [B25 Operations Runbook](BUSINESS-V1-B25-OPERATIONS-RUNBOOK.md) for the exact
automatic recovery and blocked-action boundary.
