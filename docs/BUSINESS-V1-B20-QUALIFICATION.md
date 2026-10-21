# B20 Payment Provider Boundary — Local Qualification

Date: 2026-10-20. Status: **LOCAL IMPLEMENTATION COMPLETE**. This qualification
is local and contract-only. It does not prove Stripe capability, create a payment,
change an Order, or authorize B21–B25 execution.

## Implemented boundary

B20 refines the existing server-only provider boundary rather than adding a second
payment service or state machine. Stripe is the sole planned Business V1 provider.
The implementation defines:

- immutable provider operation identity: provider, test/live mode, platform
  account, purpose, operation ID and idempotency key;
- separate Order and Shop membership request types, with account setup also kept
  as a distinct purpose;
- explicit provider operation outcomes: `SUCCESS`, `FAILURE`, `UNKNOWN` and
  `RECONCILIATION_REQUIRED`;
- signed Stripe webhook notices that request reconciliation, while only an
  authoritative server-side Stripe object retrieval can carry terminal evidence;
- complete Order evidence binding to the existing attempt, Order, customer,
  platform, mode, provider object, frozen total and currency;
- pure decisions for evidence application, retry/reconciliation, duplicate and
  conflicting terminal observations, and payment/cancellation races.

The boundary does not expose refund, transfer or bank-payout execution methods.
Those operations require the existing immutable settlement authorizations plus
the separately approved B23/B24 contracts and persistence.

## Trust and state rules

Only matching `server_verified` evidence from an authoritative Stripe object
retrieval can return `apply_paid` or `apply_failed`. A valid signed webhook is a
reconciliation notice, not by itself terminal payment proof. Client claims, the
staging simulator and Offer acceptance always return `reject`; an HTTP/provider
operation result alone is not payment evidence.
Membership evidence cannot satisfy an Order expectation. Any mismatch in purpose,
mode, platform account, operation, provider object, Order, attempt, customer,
amount or currency fails closed.

`UNKNOWN` and `RECONCILIATION_REQUIRED` retain the same attempt and require lookup
of the original provider operation. A missing response reuses the original attempt
and idempotency key. A changed operation identity, idempotency key or provider
reference is rejected. Even a successful create/transport result requires trusted
payment reconciliation before an Order can become Paid.

A verified late success while cancellation is pending or already recorded is
retained for the existing cancellation/settlement authority; it does not reopen or
silently overwrite the Order. Duplicate evidence is idempotent. Conflicting
terminal evidence and evidence for an already-terminal Order are routed to review.
No helper performs a refund, capture, transfer, payout or historical rewrite.

External exchanges return `false` from the provider-use boundary and therefore
have no Stripe operation. The staging simulator remains separately guarded and is
not upgraded into provider evidence. The three B14 Shop transaction-initiation
guards remain unchanged and are covered by a focused source assertion.

## Files and complexity

- `lib/server/payment-provider-boundary.ts`: replaced the loose status-string
  placeholder with typed contracts and pure decision helpers.
- `tests/order-provider-b20.cjs`: isolated contract and unchanged-authority
  regression coverage.
- `docs/BUSINESS-V1-B20-QUALIFICATION.md`: this evidence record.
- `docs/BUSINESS-V1-TASK-BREAKDOWN.md`: B20 local milestone only.

No API, migration, database table, UI, worker, queue, cron or runtime provider
adapter was added. Existing Order, Resale, membership, Stripe setup, webhook inbox
and cancellation code was not modified.

## Local evidence

PASS:

- `node tests/order-provider-b20.cjs`
  - rejects client/simulator/Offer success claims;
  - verifies all immutable binding dimensions;
  - separates membership and Order purposes;
  - maps failure/unknown/reconciliation and timeout followed by late success;
  - preserves attempt/reference/idempotency identity and rejects a fresh charge
    identity;
  - handles duplicate/conflicting terminal results and cancellation races;
  - keeps external mode outside the provider;
  - confirms simulator separation and all three B14 guards.
- `node tests/order-financial.cjs`
- `node tests/order-domain-api.cjs`
- `node tests/dual-payment.cjs`
- `node tests/transactions-b09-static.cjs`
- `node tests/offer-accept-static.cjs`
- application TypeScript: PASS.
- focused ESLint and Prettier: PASS after local formatting.
- `git diff --check`: recorded in the final validation run.
- safe isolated production build: recorded in the final validation run.

No remote, provider or financial runtime test was performed.

## Deferred work and decisions

B21 must persist the stable attempt/provider object binding and implement charge
start without allowing the browser to mark Paid. B22 must verify real Stripe
events/retrieval, durably deduplicate and fence application, reconcile without a
Buyer retry, and apply the existing locked Order transition exactly once. B23,
B24 and B25 retain refunds, transfers versus bank payouts, disputes and operational
recovery.

The concrete Stripe Connect funds flow, regional/capability support, merchant and
negative-balance responsibility, provider fees, refund fee treatment, disputes and
chargebacks remain unresolved. B20 does not assume or encode those choices. Any
SCA/3DS interaction exception also requires separate UI approval. Real payments
are not ready or enabled.
