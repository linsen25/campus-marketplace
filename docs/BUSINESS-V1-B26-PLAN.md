# UU Business V1 — B26 Shop transaction integration

Status: **B26-A/B LOCAL IMPLEMENTATION COMPLETE — REMOTE ACCEPTANCE DEFERRED TO B30**

## Official scope and reuse

B26 qualifies a real Shop product through the existing Conversation, Offer, Order,
payment, fulfillment, Protection, cancellation and history stack. It does not add a
Shop-specific transaction table or state machine. B26 reuses:

- `listings.listing_channel` and the one-Shop-per-owner relationship;
- B12 `shop_entitlements` and the B14 Shop product lifecycle;
- the B07/B08/B09 V2 Conversation, Offer revision and Order authorities;
- the existing frozen Message and Order Shop provenance;
- B21–B25 payment, refund, transfer, payout, dispute and recovery boundaries.

## B26-A implementation

`20261023015435_shop_transaction_admission.sql` keeps the three B14 INSERT
triggers installed and replaces only their private guard implementation. A private
singleton configuration row defaults to `enabled=false`. It has RLS enabled, no
policies and no table privilege for `PUBLIC`, `anon`, `authenticated` or
`service_role`. There is no browser, API or RPC activation path.

When locally activated by a database owner for isolated qualification, every new
Shop Conversation, Offer revision and Order insert must pass the same trigger. The
trigger locks and validates in this order:

1. actual Listing;
2. private admission row;
3. Shop owned by the Listing seller;
4. seller membership serialization row;
5. current B12 entitlement evaluated after the locks.

The Listing must be published, available and unreserved. Buyer, seller and original
Listing identity come from the inserted shared-domain record and must match the
locked Listing; `auth.uid()` must be a verified transaction participant and cannot
be the Shop owner acting as buyer. The entitlement must report
`canOperateShop=true`. This preserves Trial/Active/Grace behavior and rejects
Suspended/no-membership Shops using the existing contract.

The app adds only a presentation gate,
`NEXT_PUBLIC_SHOP_TRANSACTIONS_ENABLED=false`. When both later activation steps are
approved, existing Message Seller and Make Offer controls are reused on Shop product
cards. This flag never authorizes a transaction; a forged client value still reaches
the default-closed database guard. Shop-product Favorites remain outside this change.

## Provenance and financial boundaries

- Conversation creation continues to freeze channel and Shop name through
  `protect_conversation_identity`.
- Offer rows retain the authoritative Listing, buyer and seller origins.
- Accept continues to lock the shared Listing, bind immutable media, create one V2
  Order and freeze `listingChannel`/`shopName` in `listing_snapshot`.
- Shop rename, later unpublish, Sold or membership expiry does not rewrite history.
- Existing Conversations and Orders are not blocked by the INSERT-only admission
  guard. Reusing an existing Conversation remains possible after admission closes.
- External Orders create no Stripe PaymentAttempt and use the established two-party
  agreement/exchange flow.
- `uu_pay` still requires the existing payout-readiness and B21/B22 evidence. B26-A
  cannot mark Paid and does not enable Payment, Refund, Transfer or Payout flags.
- Resale bypasses this Shop-only branch and retains its existing behavior.

## Local qualification

The isolated PostgreSQL suite covers default denial, controlled positive
Conversation/Offer revision/Accept, idempotent retries, one-Order inventory hold,
frozen provenance/economics, Shop rename, admission close, historical Order
completion, missing membership, direct ACL denial, external zero-Stripe behavior,
`uu_pay` payout-readiness rejection, Resale independence and concurrent admission
closure. A second native-session race holds the membership row while Grace expires;
the waiting contact is rejected after the lock is released and no Conversation
leaks. Static tests prove the original trigger names remain and the UI reuses the
existing controls.

## B26-B implementation

`20261023030000_shop_suspension_lifecycle.sql` reuses B12's authoritative
`shop_entitlements` result and records one immutable lifecycle cycle per real
`accessCycleId` and exact Grace end. Trial, Active and the complete 120-hour Grace
remain operating states. Only Suspended activates these effects:

- unfinished Shop Offers enter the existing audited `closed` state; Listing,
  Conversation and Offer locks follow the Accept lock order, and a final recheck
  preserves any Order that won the race;
- Buyers may continue TEXT and IMAGE consultation messages, while the suspended
  Seller is fenced at IMAGE reservation, verified-byte receipt and final Message
  insertion;
- both parties retain messaging in a Shop Conversation that already has a V2 Order;
  Resale Conversations bypass every lifecycle check;
- existing UU System provenance emits the approved suspension notice, at most one
  rolling 24-hour reminder, and one reopening notice per cycle and Conversation;
- reactivation creates a new B12 access cycle. Old Offers remain terminal and
  historical Conversations, Orders, Protection and economics stay unchanged.

The private evidence tables use RLS and grant no direct table access. A bounded
service-role RPC is the sole scan entry. The existing Stripe Worker invokes the
coordinator as an independently settled step behind
`SHOP_SUSPENSION_LIFECYCLE_ENABLED=false`; no cron or remote activation is added.
Membership authority failures fail closed. UI and Message interaction design remain
unchanged.

## B26-B local qualification

The isolated PostgreSQL suite proves the exact 120-hour boundary, Offer audit
retention, Buyer/Seller/Order/Resale message matrix, pending Seller IMAGE receipt
fence, notice/reminder/reopen idempotency, old-cycle isolation and default-closed
B26-A admission. Native parallel sessions verify membership expiry against first
contact and Offer Accept; no Conversation or Order leaks after expiry. Static/server
tests verify private ACLs, fixed system copy, lock ordering, the default-off
coordinator, bounded RPC inputs and Worker isolation.

## B30 acceptance

B30 must separately deploy the migration chain, verify that admission and lifecycle
processing remain off, then use explicitly authorized Staging activation and
temporary accounts to test ordinary authenticated API/RLS behavior, simultaneous
first contact/Accept, actual scheduled expiry/recovery, TEXT/IMAGE and system-message
Realtime delivery, Shop rename/history, external fulfillment and Stripe Test Mode
`uu_pay`. App presentation, database admission and lifecycle processing must be
activated and rolled back independently. Production activation requires a separate
decision.
