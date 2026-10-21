# B21 Idempotent Order Payment Start — Local Plan

Date: 2026-10-20. Status: **LOCAL IMPLEMENTATION COMPLETE — PROVIDER AND B22 ACCEPTANCE BLOCKED**.
No Stripe, Staging or Production request was made. The Order-payment execution gate
remains disabled by default and no payment behavior has been enabled.

## Official scope and exit

The authoritative B21/P1 task is:

> Implement idempotent `uu_pay` charge/session start and Buyer confirmation
> integration, gated off until reconciliation is qualified.

B21 depends on the completed B20 contract. Its schema allowance is limited to the
missing durable Order-attempt/provider reference/operation identity. Acceptance
requires the correct Buyer, both Agreement confirmations, payment readiness,
transaction eligibility, same-command recovery, and safe recovery when the provider
may have created an object but the response was lost. The exit condition is exactly
one logical payment operation per attempt, with no browser path that can mark an
Order Paid.

B21 does not include:

- signed payment-event consumption or authoritative Paid/Failed application (B22);
- refund execution (B23);
- seller transfer or bank payout (B24);
- disputes, contradictory evidence or operational recovery (B25);
- Shop subscription billing, which remains a separate B12 adapter;
- opening the three B14 Shop transaction-initiation guards; or
- real Shop purchase qualification (B26).

## Reusable authority and current limits

| Existing source                                      | Reuse                                                                                                                                                           | Current limit                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `lib/server/payment-provider-boundary.ts`            | Stripe-only operation identity, Order versus membership purpose, frozen-economics evidence binding, unknown/retry and cancellation decisions                    | Pure B20 contract; no runtime adapter or persistence                                                               |
| `marketplace_private.campus_payment_attempts`        | Existing attempt ID, Buyer command uniqueness, one processing/one paid attempt per Order                                                                        | No provider, mode, platform, operation key, customer, method or PaymentIntent reference                            |
| `marketplace_start_order_payment`                    | Verified Buyer, Agreement, external exclusion, Listing→Order lock order, delivery checkout, frozen V2 money, payment-method readiness and browser-restart reuse | Creates a simulator-era attempt/event and knows nothing about a provider operation                                 |
| `/api/orders/:id/payment/start`, `orders-service.ts` | Existing authenticated same-origin bounded action; accepts only `clientActionId`                                                                                | Stripe mode currently fails closed; otherwise invokes the trusted staging simulator                                |
| `OrderCampusPayment` and `mutateCampusOrder`         | Existing Pay/Refresh interaction, stable command UUID during recovery, no client-supplied status                                                                | Copy says staging/test; no Stripe confirmation or SCA handling; client response must never become payment evidence |
| `stripe_bindings` and Stripe setup service           | Verified test platform, Stripe Customer, attached PaymentMethod, SetupIntent, explicit environment checks and owner binding                                     | Setup only; `usage: on_session`; not an Order PaymentIntent or charge authority                                    |
| `stripe_webhook_inbox`                               | Signature-first receipt, event dedupe and lease pattern                                                                                                         | Explicitly setup-only. B21 must not add financial events to its allowlist or consumer                              |
| existing cancellation/settlement authority           | Cancellation intent, locked Order/Listing reconciliation and immutable disposition amounts                                                                      | Authorizes later disposition only; performs no provider refund or transfer                                         |
| B12 membership authority                             | Separate membership command idempotency and entitlement lifecycle                                                                                               | Its proof string is not Stripe payment proof and cannot share Order attempts                                       |

Mocks, the simulator, an accepted Offer, SetupIntent success, an HTTP 200 and the
browser's Stripe result are not trusted payment evidence.

## Minimum durable design

Use a single forward migration to extend the existing private
`campus_payment_attempts` record. Do not create another payment ledger or another
Order state machine. The final names should be confirmed during implementation,
but the minimum information is:

- provider (`stripe`), test/live mode, platform account and purpose
  (`marketplace_order`);
- immutable provider operation UUID and idempotency key;
- frozen Stripe Customer and PaymentMethod references resolved from the Buyer's
  authoritative `stripe_bindings` row;
- nullable PaymentIntent reference, bound after a successful or recovered create;
- bounded claim lease/token and create-started/bound timestamps.

All provider columns remain null as one valid group for historical attempts. No
backfill or historical rewrite is permitted. New Stripe attempts require the full
identity group, except that the PaymentIntent reference remains null until it is
known. Unique constraints should cover the scoped operation/idempotency identity
and the non-null provider reference. The private table remains unavailable to
`anon`, `authenticated` and direct `service_role` table access.

Add one narrow service-role RPC, following the existing Stripe setup lease pattern,
with bounded actions such as `claim`, `bind`, `release` and `read`. It must:

1. verify the explicit trusted environment/project;
2. lock the attempt and then re-read the authoritative Order using the existing
   lock order;
3. reject external payment mode, wrong Buyer, wrong platform/mode, missing
   Agreement/readiness, stale inventory and cancellation-ineligible starts;
4. derive amount/currency from frozen Order economics and customer/method from the
   Buyer's current Stripe binding;
5. freeze those provider identities before the network call;
6. return the same operation and idempotency identity after timeout or lease expiry;
7. bind only the expected Stripe object under the active lease; and
8. never set Order `payment_status` to Paid or Failed.

The current authenticated start RPC should continue to own attempt creation and
business eligibility. Its new-attempt event metadata should become provider-neutral
rather than claiming `staging_simulator`; historical events remain unchanged. The
existing simulator route stays separate and remains unavailable whenever real
provider mode is selected.

## Provider and API sequence

The smallest runtime design, after the blockers below are approved, is:

1. Buyer uses the existing Pay action with its existing command UUID.
2. The existing API authenticates the Buyer and calls the existing start RPC.
3. The server claims the same attempt's immutable provider operation.
4. A server-only Stripe Order adapter builds the request exclusively from the RPC
   projection and B20 `OrderPaymentOperationRequest`.
5. Stripe create is called with the stored idempotency key. A lost response is
   `UNKNOWN`; retry repeats the same request/key and never creates a fresh attempt.
6. The returned PaymentIntent is checked for platform, test/live mode, customer,
   amount, currency, purpose/Order/attempt metadata and then bound under the lease.
7. Only the authenticated Buyer receives the minimum client secret required for
   Stripe.js confirmation. Secrets are not logged or persisted in application
   tables.
8. Stripe.js confirmation output only requests an authoritative refresh. It cannot
   update the Order or supply a success boolean.
9. B22 retrieves the bound object and applies verified terminal evidence. Until B22
   is deployed and qualified, the real B21 execution gate remains off.

If cancellation begins before the client secret is returned, the server must stop
the confirmation response and retain the provider operation for reconciliation.
If cancellation races after the response, B22 must retain any late successful
evidence and pass it to the existing cancellation/settlement boundary. B21 performs
no automatic refund and never reopens a cancelled Order.

The existing `/api/orders/:id/payment/start` route is sufficient; no second public
payment-start endpoint is justified. Its response may add a narrowly projected
confirmation payload only in real provider mode. Existing Order refresh remains the
only source of displayed domain state.

## Likely implementation files

Minimum expected changes after separate approval:

- one new forward migration extending `campus_payment_attempts`, replacing the
  latest start RPC definition, and adding the private trusted claim/bind RPC;
- `lib/server/payment-provider-boundary.ts` only if implementation reveals a
  contract detail that cannot fit the approved B20 types;
- a small server-only `lib/server/stripe-order-payment.ts` adapter;
- `lib/server/orders-service.ts` and `lib/orders-api.ts` for the existing route;
- `components/home/order-campus-payment.tsx` for confirmation orchestration only;
- focused B21 SQL, API, adapter and browser tests;
- environment documentation for a default-off Order-payment execution gate.

Avoid refactoring the working setup service merely to share a few Stripe client
construction lines. If a shared runtime helper is demonstrably smaller and keeps
setup behavior byte-for-byte equivalent, it may be proposed during implementation;
it is not required by this plan.

## UI approval boundary

The existing visible actions say `Pay (staging test)` and `Retry test payment`.
Real Buyer confirmation cannot truthfully retain that wording, and SCA may require
Stripe.js modal or redirect behavior. Before B21 implementation changes the
component, obtain a narrow UI exception for:

- real-mode Pay/Retry copy while retaining the exact current layout/style;
- invoking Stripe.js from the existing button;
- provider-controlled SCA/3DS modal or redirect and return handling; and
- the existing error/Refresh area showing safe confirmation/recovery failures.

No new field, panel, card form or layout change is currently proposed. If the
installed Stripe version requires a visible Payment Element for the selected flow,
stop and request a separate UI decision rather than reusing the Settings SetupIntent
element as an Order checkout.

## Financial and provider blockers

The following must be explicitly approved before any PaymentIntent create/confirm
call is implemented or tested:

1. **Connect funds flow and merchant responsibility.** Confirm platform charge plus
   later separate transfer, or another supported model. Current recipient onboarding
   and `fees_collector=application` / `losses_collector=application` do not themselves
   approve the platform's financial liability.
2. **Capture timing.** A long fulfillment/Protection period cannot be assumed to fit
   a card authorization window. Automatic capture with later protected transfer is
   only a candidate, not an approved rule.
3. **Frozen allocation.** Confirm that Stripe charges frozen Buyer total and later
   transfers frozen Seller gross, with the existing service fee retained, without
   adding provider costs or tax to frozen Order economics.
4. **Refund/dispute liability.** Provider fee treatment, partial/full refund funding,
   chargebacks, disputes and negative balances remain B23/B25 policy decisions.
5. **Provider prerequisites.** Confirm the approved account/region/capabilities,
   installed Stripe API behavior, saved-card/SCA flow, statement/receipt behavior,
   minimum amounts and any security-email side effects using current official Stripe
   documentation before implementation. This planning task did not contact Stripe.

Before those decisions, a later implementation may safely prepare the nullable
schema, immutable operation identity, lease RPC, pure request validation and
default-off mocked integration. It must not create a PaymentIntent, return a client
secret, enable the Pay path or claim B21 acceptance. Full B21 completion requires
the approved funds flow plus B22-qualified reconciliation.

## Focused qualification plan

Local PostgreSQL tests:

- legacy attempts remain valid and byte-for-byte historical Order facts are
  unchanged;
- wrong Buyer, external mode, missing Agreements/readiness, stale inventory and
  cancelled Order fail before provider work;
- repeated command and concurrent starts return one attempt/operation/key;
- browser restart and expired lease recover the same identity;
- bind rejects wrong platform/mode/customer/method/amount/currency/reference;
- lost create response reclaims the same operation and never authorizes a second;
- direct/cross-account table and RPC access is denied;
- B14 guards and setup-only inbox definitions remain unchanged.

Mocked server/API tests:

- provider request uses only server-derived frozen values;
- client amount, customer, status and provider-reference injection is ignored or
  rejected;
- create timeout, 5xx and response loss remain UNKNOWN with the same idempotency key;
- create success still cannot mark Paid;
- cancellation before/after create does not trigger a new charge or overwrite state;
- membership/setup events cannot bind to an Order attempt;
- simulator remains isolated when provider mode is active.

Browser tests, after the UI exception:

- existing Pay action starts once and blocks double clicks;
- required-action, redirect return, timeout and refresh preserve the same attempt;
- browser-reported success never renders Paid before authoritative Order refresh;
- existing Meeting/Delivery, Resale and responsive UI remain unchanged.

Run TypeScript, focused ESLint/Prettier, `git diff --check`, relevant B09/B20
regressions and an isolated production build. Real Stripe test-mode execution,
webhook/reconciliation, cancellation races and cross-session acceptance require
separate authorization and cannot be claimed by mocks.

## Security review recommendation

A targeted GPT-6.1 High review is recommended before implementation approval, after
the funds-flow decisions are recorded. It should review only the migration/RPC lease
contract, immutable Stripe request, client-secret boundary, SCA path and the B21/B22
gate. A second broad payment audit is unnecessary.

## Implemented local result

The approved implementation uses Connect Separate Charges and Transfers and keeps
the existing `/api/orders/:id/payment/start` entry. Migration
`202610200002_order_payment_intent_start.sql` extends the existing private
`campus_payment_attempts` table; it does not create another ledger or payment state
machine. Historical attempts remain valid with an all-null provider group.

For a new Stripe-backed attempt, the trusted service RPC freezes the test platform,
operation UUID, idempotency key, Buyer Customer/PaymentMethod, Seller connected
account, frozen Buyer total, CAD currency and stable Order transfer group. A fenced
120-second lease serializes create work without keeping a database transaction open
during Stripe HTTPS. A response loss, expired lease or database bind failure retains
the same attempt, parameters and idempotency key. An unresolved create older than 20
hours is stopped for reconciliation rather than recreated.

The PaymentIntent uses Stripe 23's `allowed_payment_method_types: ['card']`, automatic
capture and confirmation, `confirm: false`, the verified saved PaymentMethod, Seller
`on_behalf_of`, and `uu_order_<order UUID>` transfer group. It contains no destination
transfer or application fee, and B21 calls no Transfer, Refund or Payout API. Before
create, the adapter re-reads the PaymentMethod and connected account in test mode and
checks Customer ownership, card validity, charge/card capability and region. The
`STRIPE_ORDER_PAYMENTS_ENABLED` gate must also be exactly `true`.

The existing Buyer button calls Stripe.js `confirmCardPayment` and then refreshes the
authoritative Order. Browser success never writes or projects Paid. Provider statuses
that should not be confirmed again return `reconcile`; B22 must retrieve and apply
trusted terminal evidence. The simulator remains isolated in Stripe provider mode.

Local qualification covers the parameter allowlist, default-off behavior, binding and
provider mismatches, timeout/unknown handling, bind-failure recovery, bound-intent
reuse, client confirmation, duplicate-click prevention, and an isolated PostgreSQL
lease test with two overlapping transactions. Existing B20, Stripe setup, Order API
and transaction static regressions pass.

Real execution remains blocked on formal Seller Merchant-of-Record and terms/receipt
alignment, supported Connect account/region behavior, RPAA and liability review, and
B22 deployment/qualification. Current recipient onboarding may not supply B21's
required charge capability; the adapter therefore refuses creation. Real Stripe test
creation, SCA, cancellation races and signed-event reconciliation were not performed.
