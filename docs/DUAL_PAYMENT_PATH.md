# Dual payment paths: current V1 contract

This contract supersedes conflicting UU-only Meeting rules in earlier documents.
It describes the approved domain; qualification status is recorded separately.

## Negotiation and immutable authority

Meeting supports `uu_pay` (Pay by UU, recommended) and `external` (Pay
independently). Seller delivery and Courier support `uu_pay` only.

Listing `preferred_payment_mode` is a Seller default, not a restriction. New
Meeting Listings default to UU; Buyer or Seller may propose either mode through
Offer, Counter or Revise. Payment method participates in Changed terms. New
Offer terms carry `payment_mode` and `payment_mode_version = 1`. Accept freezes
these terms into Agreement/Order; payment mode cannot change after creation.
The Listing snapshot also captures its default preference.

Missing fields on existing Offers/Orders mean UU payment. Historical snapshots,
economics and progress are never rewritten. Existing unpaid Orders also retain
UU semantics. An existing Active Offer may be replaced by a new Counter/Revise
with explicitly negotiated mode.

## Pay by UU

Only UU payment requires Buyer Payment Method at actual payment attempt and
Seller Payout Ready at existing Seller Offer/Accept authority points. The
current versioned Buyer Protection fee remains 1% of item price, capped at
CA$5, with existing integer-cent rounding; old frozen fee versions remain intact.

- Meeting: Agreement → Payment → Meet / Inspect → Handoff → Protection → Completed.
- Seller delivery: Agreement → Payment → Delivery / Inspect → Handoff → Protection → Completed.
- Courier: Agreement → Payment → Shipped → Delivered / Received → Protection → Completed.

Existing 24-hour Protection, payout, cancellation and settlement rules remain in
force. Account setup Phase 1B does not authorize Order charging or money movement.

## Pay independently

Agreement → Meet / Inspect → Confirm exchange → Completed.

No Payment, Handoff or Protection stage exists. No Buyer Payment Method or
Seller Payout Account is required. Buyer Protection fee is zero. No Stripe
operation, QR/code authorization, UU refund, settlement authorization, protection
or payout may be created. `payment_status` is never set to Paid by external
confirmation; a separate private exchange record is authoritative.

Buyer attests: "I paid the seller directly and received the item."
Seller attests: "I received payment directly and handed over the item."

Both must first confirm the frozen Agreement. Exchange attestations require a
verified participant, server-derived role, action UUID/idempotency, immutable
audit event and server timestamp. A submitted attestation cannot be toggled off.

- Zero attestations: existing Meeting cancellation/expiry/no-show applies and
  may release inventory.
- One attestation: Order remains open and Listing held. Ordinary cancellation,
  rescheduling and automatic expiry/release cannot erase the attestation.
- Both attestations: Order Completed, Listing Sold; no UU payment or payout.
- Counterparty disagreement after one attestation: persist a narrow nonfinancial
  `disputed` state. Keep inventory held; no automatic Sold/release or financial
  adjudication. A resolution policy is outside this implementation.

Listing → Order row locks serialize confirmation, cancellation, expiry and
reporting. A completed/cancelled/expired transaction rejects contradictory actions.

Visible marker: **Paid outside UU · No UU payment protection**.
Supporting copy: "Payments made outside UU are arranged directly between buyer
and seller. UU cannot verify, reverse, refund, or provide payment protection for
external payments."

## Terminology and Stripe timing

Use **Buyer Protection fee** or **Secure Checkout & Protection**, never
"regulatory fee". Internal historical fee keys remain compatible.

The user confirmed local staging Stripe test configuration and origin
`http://localhost:3000`. Continue real Phase 1B qualification only after this
domain migration is staging-qualified, and only for UU payment. Configuration
confirmation alone is not evidence of successful provider qualification.

No production access, environment-value edits, commit or push.

## Staging qualification (2026-10-16)

Applied additive migration: `202610160005_dual_payment_paths.sql`.
SHA-256: `fd31a44d00efab4f91a02ae325024b88b4deccb1ec21b88da07b95d0a2b066ae`.
The deployed migration receipt matches the local source exactly.

- `dual-payment-staging.cjs`: rollback qualification of versioned validation,
  legacy UU fees, changed terms, independent Seller Offer/Accept without financial
  capabilities, mutual Agreement, idempotent/participant-bound attestations,
  Sold/completion, zero-confirmation cancellation/expiry, no expiry after one
  confirmation, disagreement hold and private storage grants.
- `dual-payment-concurrency.cjs`: real independent PostgreSQL/participant RPC
  transactions. Observed the contender blocked by the uncommitted holder before
  releasing a synthetic-only caught sleep barrier. Buyer/Seller concurrent
  confirmations complete; confirmation-before-cancel keeps the hold;
  cancel-before-confirm stays cancelled; dispute-before-confirm remains held.
  No deadlocks, lock timeouts or statement timeouts in the final qualified run.
- Disposable race identities use real staging Auth. Exact-scope journal recovery
  and Storage API cleanup were verified; final canonical data/media fingerprints
  match the pre-run baseline. Test SQL receipts do not claim real media uploads.
- Independent Order, Offer Counter/Revise, Listing Create/Edit and existing UU
  Agreement/handoff browser matrices cover 390/430/820/1280/1536 without overflow.
- TypeScript excludes ignored generated artifacts; focused ESLint, domain/API,
  economics, cancellation, financial capability, notifications and offline Stripe
  provider/security tests pass. No real Stripe qualification is claimed.

An older `order-flow-ui.browser.cjs` detail-polish fixture still assumes an unpaid
Order may use Next without populated mutual Agreement state. Its Next assertion
fails; the current `order-agreement-handoff.browser.cjs` supplies authoritative
Agreement state and passes at all five widths. Do not weaken Agreement authority
to satisfy the older fixture.

The three local signing-secret names are configured. Stripe account-setup
qualification is tracked separately in `STRIPE_PHASE_1B.md`; configuration alone
does not qualify hosted onboarding or a real iframe submission. There are no
unresolved payment-mode business decisions. No production, manual-data or
environment-value changes, commit or push occurred.
