# B20 — Order provider operation mapping plan

2026-10-20. **LOCAL PLANNING ONLY.** Current local source inspection; no provider,
Staging or Production calls. This document proposes boundaries, not approved
charging rules, deployed behavior or runtime qualification.

## Official task and exit

The authoritative B20/P0 definition in `BUSINESS-V1-TASK-BREAKDOWN.md` is:
“Specify concrete provider operation mapping to existing frozen economics/attempt/
settlement authorizations. Confirm actual SDK/docs in implementation task.”

Dependencies: B01/B07/B08 and existing server-only Stripe setup; reuse B09's
payment/fulfillment/cancellation authority. Inventory provider references, unique
attempts and operation-audit gaps. Exit: exact create/success/failure/unknown/retry
mapping, server-derived amount/currency/destination, no provider calls for external,
no changed fees or timing. B20 is **not** the implementation of B21–B25.

| Task | Responsibility retained                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| B20  | Financial operation contract, evidence/state mapping, gap inventory and focused local contract qualification after separate approval |
| B21  | Idempotent UU Pay charge/session start and Buyer confirmation; gated until reconciliation is qualified                               |
| B22  | Signed Order payment events, durable reconciliation and trusted state application                                                    |
| B23  | Provider refund execution/reconciliation from existing authorizations                                                                |
| B24  | Eligible seller transfers and distinct bank-payout lifecycle                                                                         |
| B25  | Privileged dispute/operational recovery within existing case powers                                                                  |
| B26  | New real Shop transaction qualification; B14 guards stay closed until separately authorized                                          |

Shop subscription collection is a separate B12 provider-adapter dependency, not
silently assigned to B20 or a new B-number. B10 §18 leaves provider/compliance
execution separately approvable. Recommendation/ranking is also excluded.

## Reusable foundations and actual status

| Source                                                                                                                                        | Reuse / evidence                                                                                                                                                            | Limit                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/server/marketplace-auth.ts`, `lib/supabase/server.ts`                                                                                    | Real verified-user session, same-origin write check, cookie client, private/no-store responses                                                                              | This round does not authenticate remotely                                                                                                                   |
| `lib/server/orders-service.ts`, `pages/api/orders/[[...segments]].ts`                                                                         | Existing authenticated bounded Order actions; `/api/orders/:id/payment/start` dispatch, UUID and field guards                                                               | `campusAction` blocks payment when Stripe setup enabled; otherwise its success resolution is a **staging simulator**, not a charge                          |
| `lib/server/order-financial-service.ts`, `pages/api/orders/[orderId]/simulate-payment-success.ts`                                             | Explicit trusted simulator and Stripe-mode exclusion                                                                                                                        | Never reuse simulated success as provider proof                                                                                                             |
| `lib/server/payment-provider-boundary.ts`                                                                                                     | Existing small frozen-economics/attempt/provider interface                                                                                                                  | Contracts only; no concrete Order provider executor; `executePayout` must be clarified into transfer versus bank payout                                     |
| `lib/server/stripe-environment.ts`, `stripe-setup.ts`                                                                                         | Real server SDK integration: Stripe 23.0.0, pinned API `2026-09-30.endive`, explicit test/Staging/platform checks, SetupIntent, Accounts v2 recipient onboarding/readiness  | Setup/readiness only; no current Order PaymentIntent/charge/refund/transfer executor. Actual provider availability not checked here                         |
| `pages/api/stripe/[action].ts`, `webhook.ts`, `connect-webhook.ts`, `account-webhook.ts`, `worker.ts`; `lib/server/stripe-webhook-handler.ts` | Raw-body signature verification, channel/account/test validation, bounded body, durable enqueue then authenticated lease-based drain                                        | Current allowlists/consumer handle **account setup**, not payment/subscription settlement                                                                   |
| `202610160004_stripe_account_setup.sql`                                                                                                       | Private `stripe_bindings`, `stripe_setup_operations`, `stripe_webhook_inbox`, scoped event dedupe and fenced leases                                                         | Binding kinds only payment_method/payout_account; setup operation kinds only owner/setup. Do not force Order operations into these rows                     |
| `202610120008_order_campus_payment.sql`, `202610130003_delivery_checkout_payment.sql`                                                         | `campus_payment_attempts`: buyer/action UUID, one processing and one paid attempt per Order; `marketplace_start_order_payment`, compatibility campus wrapper, stable resume | Durable attempts exist, but provider object/account/mode/reference/evidence are missing                                                                     |
| `202610140002_order_cancellation_settlement.sql`                                                                                              | `order_cancellation_intents`, immutable settlement amounts, `order_flow_commands`, trusted simulator resolver, Listing→Order locks and late-payment cancellation handling   | Cancellation response explicitly says `provider_not_integrated`. Authorization is not executed refund/transfer; boolean resolver is not production evidence |
| `202610150003_order_agreement_handoff_v2.sql`, `202610160005_dual_payment_paths.sql`                                                          | Both Agreement confirmations; immutable versioned economics; UU/external separation, handoff/Protection/expiry/cancellation guards                                          | No fee recalculation, historical snapshot rewrite or timer changes permitted                                                                                |
| `202610190003_shop_membership_authority.sql`; `lib/server/shop-membership-repository.ts`, `pages/api/shop/membership.ts`                      | Real private membership/terms/command dedupe, Trial and effective Plus/Pro/Grace/Suspended authority; internal trusted-proof purchase/upgrade boundary                      | Internal proof is **not** a Stripe verifier. No public paid purchase adapter. Membership GET does not create subscription billing                           |
| `components/home/order-campus-payment.tsx`, `formal-order-payment.tsx`, `lib/order-payment-ui.ts`                                             | Existing Buyer action, readiness, UUID retry, authoritative refresh and explicitly staging-only simulation UI                                                               | Setup Element is not an Order checkout. Real confirmation/3DS cannot be assumed wired                                                                       |
| `components/pricing-card.tsx`, `components/shops/shop-pricing-dialog.tsx`, `shop-pro-pricing.tsx`                                             | Approved pricing presentation, local selection, existing modal infrastructure                                                                                               | Current Continue is shell/no-op; plan selection, badge and SetupIntent success grant no membership                                                          |

Implementation exists where stated; **none of these rows is a new remote PASS**.
Tests/fixtures are evidence of isolated behavior, not money movement. Historical
audit documents are reused rather than rerunning their full investigation.

## Smallest proposed B20 implementation

After separate approval, refine the **existing** provider boundary into typed
Order-only operation/evidence contracts and pure validation/mapping helpers.
No SDK money call, API activation, webhook expansion or resolver enablement in
this B20 slice. No new public endpoint, database object, migration, UI change,
worker or cron is presently required for B20 itself.

Likely files:

- Modify `lib/server/payment-provider-boundary.ts` rather than introducing a
  second payment service/state machine: distinguish payment observation,
  authorization-backed refund, seller transfer and bank-payout observation.
- Add at most `lib/server/order-provider-contract.ts` if pure validation/mapping
  would make the existing interface unreadable; otherwise keep it in that file.
- Add `tests/order-provider-b20.cjs` for pure contract cases. Reuse existing
  `tests/order-financial.cjs`, `order-domain-api.cjs`, `stripe-setup.cjs`,
  `stripe-setup-api.cjs`, `transactions-b09-*`, `dual-payment*` and
  `shop-membership-b12-*` fixtures/harnesses when relevant.
- No B20 changes to `orders-service`, the simulator, setup routes, membership
  commands or UI. Any actual adapter, persistence or trusted resolver change
  belongs to its later separately approved task.

Proposed sequence: approve funds-flow/evidence contract → narrow local type/mapping
implementation and mocked observations → focused contract/regression validation →
security review → B21/B22 design approval before any real sandbox operation.
Do not implement a fake adapter that reports provider success to make B20 look live.

## Candidate provider mapping — proposal, not execution approval

Stripe is the smallest **candidate** because setup already uses it, not a newly
approved provider selection. A platform PaymentIntent with capture followed by a
separate authorized post-Protection transfer appears compatible with current
recipient-only Accounts v2 setup and delayed seller release. This requires actual
versioned Stripe documentation, account/capability, regional and liability review
before acceptance. Do not claim this funds-flow configuration is already supported.
Do not silently use a destination charge that releases funds at purchase, or assume
a card authorization can remain uncaptured throughout fulfillment/Protection.

| Domain operation          | Candidate provider object/action                                                      | Trusted authority / later task                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Buyer payment             | Order-scoped PaymentIntent create/confirm/retrieve                                    | Existing attempt and frozen V2 economics; B21/B22, not SetupIntent                                            |
| Cancellation refund       | Refund tied to the actual captured charge                                             | Existing `order_settlement_authorizations.buyer_release_cents` and original provider binding; B23             |
| Delivery compensation     | Separate authorized transfer, when the frozen disposition permits it                  | Existing seller compensation amount; B24, not a fabricated sale payout                                        |
| Completed sale release    | Transfer to the immutable verified seller destination after current eligibility/holds | Existing completed/Protection/case authority and frozen seller economics; B24                                 |
| Seller bank payout        | Connected-account payout observation/execution only if separately authorized          | Transfer success is not bank payout success; B24 must define allocation without guessing one payout per Order |
| Shop membership           | Separate billing intent/subscription adapter and verified billing event               | B10 terms and existing B12 commands; never Order payment rows or UU Buyer Protection fee                      |
| Meeting external exchange | **No provider operation**                                                             | Existing two-party exchange authority; never Paid/refund/payout                                               |

Amounts are integer cents in the frozen record's currency, with safe aggregate
limits. Buyer total includes the **historically frozen** applicable components;
do not recompute the latest fee, add tax/provider costs, change seller share or
use browser totals. Resolve customer/payment method from the Buyer setup binding,
seller destination from verified recipient identity; freeze operation identity
so retry cannot redirect funds after account changes. Missing/mismatched binding,
mode/platform/currency/destination or unsupported legacy economics fails closed.

### Required observation/transition contract

This table defines the proposed contract for later executors; no transitions are
implemented by this planning task. Provider-specific status details must be checked
against the installed SDK and official versioned documentation before implementation.

| Evidence / event                                                  | Existing Order state and required behavior                                                                        | Retry / authority                                                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Create accepted Offer/Order only                                  | Pending; inventory reservation is not payment                                                                     | Existing accept idempotency; no provider operation                                                               |
| Eligible UU Buyer starts payment                                  | Both Agreement confirmations, actual readiness, open/held/current state; reuse/create existing processing attempt | Server validates immutable Order/UUID; same logical attempt survives browser restart                             |
| Provider object created, needs confirmation/action, or processing | Domain remains processing; never Paid on HTTP 200 or returned client secret                                       | Reuse bound object, same operation key; Buyer action only through approved confirmation integration              |
| Request timeout, lost create response or 5xx                      | Outcome **unknown**; retain processing and reservation/cancellation protection                                    | Reconcile by durable bound reference/key; no new attempt or fresh key while charge possibility is unresolved     |
| Verified terminal no-charge failure/cancellation                  | Apply Failed only after trusted evidence matches attempt and current authority                                    | B22 locked/idempotent apply; later user retry may start a new attempt only after old failure is durable          |
| Provider requires a new method/action                             | Not sufficient proof of no money movement by itself                                                               | Retrieve/reconcile prior attempts/charges and define exact B21/B22 state mapping; no boolean shortcut            |
| Verified captured success                                         | Paid only after matching account/mode/object/amount/currency/customer/attempt evidence                            | B22 applies once under existing locks; authoritative Order refresh renders result                                |
| Duplicate/replayed webhook or repeated reconciliation             | Return existing result, no second transition/notification                                                         | Scoped event dedupe plus operation/evidence uniqueness and fencing                                               |
| Out-of-order failure after verified success                       | Cannot downgrade Paid or create a new charge                                                                      | Reconcile current object; contradictory facts held for operational review                                        |
| Late success while cancellation is pending                        | Do not discard money evidence or reopen a payment                                                                 | B22 records capture then reuses existing cancellation/settlement authority; B23 executes authorized refund later |
| Success for stale, already-terminal or mismatched attempt         | Do not force current Order to Paid or rewrite history                                                             | Durable exception/evidence for B25 review; no automatic invented compensation/refund                             |
| Refund/transfer created or transport unknown                      | Authorized/pending/unknown, **not executed**                                                                      | B23/B24 same operation/ref; terminal provider confirmation only once                                             |
| Verified refund/transfer success/failure                          | Record that operation's result, preserving frozen allocations                                                     | B23/B24 partial failure remains reconcilable; authorization is never provider proof                              |

Actual provider observations and domain state are separate: existing attempt status
has only processing/paid/failed. Do not add provider transient states to the Order
state machine merely for transport convenience. Unknown, action-required and replay
metadata belong to the minimal durable provider operation binding proposed below.

## Later persistence/API gaps — inventory, not B20 migrations

- **B21:** reuse `campus_payment_attempts`; add only proven missing private durable
  provider binding/operation data (attempt FK, provider/platform/mode, immutable
  object ref/key, expected economics/destination identity, timestamps and fenced
  resolution). Prefer narrow extension or one scoped operation table after design
  review. One processing/paid attempt constraints and existing lock order remain.
  PaymentIntent metadata is correlation, not authority or the only durable record.
- **B22:** existing setup inbox has a reusable event-key/lease/retry pattern, but
  its consumer resolves setup bindings and has setup-only allowlists/error codes.
  Evaluate a purpose discriminator and purpose-filtered claim/dispatch before any
  new inbox. If isolation cannot be proved, justify one Order-scoped inbox rather
  than corrupting setup semantics. Do not create another generic event platform,
  worker or cron by default. Raw signature/channel/account/test verification must
  precede durable financial processing; ack only after durable acceptance.
- **B22:** add a least-privilege trusted evidence-application boundary as needed;
  never expose existing `p_success boolean` simulator as the financial verifier.
  Signed webhook/retrieved provider object, immutable binding and locked domain
  preconditions are all necessary. Provider calls occur outside DB locks; commit
  only after lease fencing and state recheck. No distributed transaction is assumed.
- **B23/B24:** bind each provider refund/transfer operation to its existing immutable
  authorization/eligible completed Order; operation identity also includes kind,
  amount, currency, destination and provider scope. Reuse a narrowly suitable
  operation binding rather than create parallel Orders or an accounting ledger.
- SDK retries do not replace database dedupe. Reuse the setup pattern's explicit
  “unresolved beyond provider idempotency retention → stop/reconcile” behavior;
  the current setup 20-hour safety threshold is not automatically an approved
  universal payment policy. Confirm operation-specific provider guarantees first.
- **UI:** zero B20 changes. A later real PaymentIntent confirmation/SCA/3DS step
  may require an explicit UI V1 exception. Existing SetupIntent iframe or staging
  payment control is not permission to change checkout interaction silently.

## Subscription separation and safety

B10 fixed prices/modes, explicit auto-renew consent, no-card/no-auto-charge Trial,
upgrade/expiry/grace and proof dedupe remain B12 authority. A settings PaymentMethod
or a Marketplace Order charge cannot grant a term, convert Trial into auto-renew,
or imply billing consent. Paid membership events require a separately approved
billing adapter, scoped operation proofs and verified reconciliation. Do not reuse
an Order event as membership proof or mix membership amounts with seller transfers.
No membership purchase/refund policy is invented by this plan.

Secrets, service-role credentials, signing secrets, raw tokens and full payment
details stay server-side and out of logs/DTOs. Bind original customer/recipient to
authenticated identities; reject forged order/owner/reference/amount/destination.
UI may receive only the minimum short-lived confirmation material needed by a
future approved SDK flow, never credentials or arbitrary connected-account data.
Preserve private schema ACL/RLS, immutable audit, currency/amount conservation,
Listing→Order lock discipline, cancellation holds and B14 guards. Keep setup,
Order payment and membership feature gates distinct. Stripe-enabled real Order
execution must remain off until B21/B22 qualify it; simulator must stay unavailable
in real-provider mode.

## Decisions and review before implementation

Only material decisions, not a new broad audit:

1. Confirm Stripe as the Order-payment provider and approve the funds-flow candidate
   versus another explicitly reviewed model. Confirm platform/recipient capabilities,
   region/currency, capture versus transfer responsibilities and chargeback/liability
   handling. Current Accounts v2 defaults assign fee/loss responsibility to the
   application; this is existing setup configuration, not new consent to real liability.
2. Accept the proposed B20 **contract-only local implementation** boundary and
   unknown/action-required/stale-success mapping. Exact trusted apply/operation
   schema belongs to B21/B22 approval; no schema is proposed for B20 itself.
3. Before charging: resolve any genuinely outstanding provider minimum, tax/legal
   and provider-fee/negative-balance responsibility that existing frozen business
   rules do not define. Do not silently surcharge or rewrite fees. These do not
   block documenting B20 but block unapproved real execution.
4. Real Buyer confirmation may require UI approval later. Provider configuration,
   webhook destinations/separate-purpose signing validation, accounts and test-only
   secrets require separate authorized inspection/operations; no values are needed
   in chat. Current remote readiness is **NOT VERIFIED** in this local plan.

**GPT-6.1 High review recommended before implementation** of the financial contract
and required before enabling money movement: review charge model, unknown create
recovery/key expiry, late success/cancellation races, privileged evidence grants,
event-purpose isolation and refund/transfer conservation. This is a recommendation;
no agent/model review was invoked or falsely claimed complete in this round.

## Focused future local qualification

Pure contract/mocked SDK observations: forged owner/amount/destination/provider
scope, external zero calls, accepted-unpaid zero success, frozen fees, zero/NULL,
unsupported currency, action-required versus failure, timeout-after-create and
expired key, duplicate/out-of-order events, stale success, cancellation races,
lease expiry and two concurrent attempts. Assert setup/Order/membership isolation,
no UI or historical mutation, no accidental fake success. Existing native B09 and
B12 regressions qualify reused authority; B21/B22 later test real migration/locks
in isolated PostgreSQL. Run focused API/type/lint/format checks only once code is
separately authorized. No tests/provider calls were run during this planning round.

Planning exit met: official scope/dependencies, reusable foundations, missing
bindings/evidence, concrete proposed operations and state/retry table are recorded.
Implementation, provider selection/funds-flow acceptance, deployment, runtime money
tests and all B21–B25 execution remain unapproved and unimplemented by this task.
Only this plan and the task-breakdown planning status are changed. No remote calls,
migrations, application/UI edits, credentials changes, Git operations or B14 opening.

**B20 PLANNING COMPLETE — IMPLEMENTATION NOT STARTED**
