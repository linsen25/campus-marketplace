# UU B32 Stripe Protected Payment Acceptance

Date: 2026-11-09
Branch: `b30-staging-acceptance-20261024`
Commit baseline: `9c11796033b6ed9b2f3f3e6e917c28010f042bb4`
Supabase project: `giqdwyiupslpfhstbtqf`
Stripe Test platform: `acct_1URFfDA2nyElFLCc`
Connected account: `acct_1UZHAEA2nyuq0CM5`

This report distinguishes real Stripe reads, real browser checks, offline provider simulations, static checks, and work that remains blocked. No Stripe Live call, PaymentIntent, Charge, Refund, Transfer, Payout, database migration, or deployment was performed in this acceptance round.

## 1. Stripe environment and connected account

| Check | Result | Evidence |
| --- | --- | --- |
| Test credentials and platform account | PASS — real Stripe read | Test key resolved to `acct_1URFfDA2nyElFLCc`; connected account retrieval succeeded in the same Test environment. |
| Canonical binding metadata | PASS — real Stripe read | Connected account `uu_binding` matched canonical binding `8406b50e-65d4-4661-a45d-70e0e321bdb7`; Migration 012 reconciliation evidence remains valid. |
| Account/controller model | PASS — real Stripe read | Canadian individual connected account; application controller; Express Dashboard; Stripe collects requirements; platform pays fees and covers payment losses. |
| Live-mode isolation | PASS — static/runtime guards | B32 rejects Live key prefixes and mismatched platform/project configuration. Payment, Refund, and Transfer feature gates remain disabled. |

## 2. Seller readiness

Current authoritative Stripe state:

- `details_submitted=true`
- `charges_enabled=true`
- `transfers=active`
- `payouts_enabled=false`
- `disabled_reason=requirements.past_due`
- `currently_due` and `past_due`: `individual.verification.proof_of_liveness`
- `pending_verification=[]`

Disposition: **BLOCKED — Seller is not Ready.** UU derives readiness from fresh Stripe account data and the canonical server-owned binding. Client input cannot mark the Seller Ready. Payment preparation rechecks the connected account even when a PaymentIntent was previously bound, and does not return a reusable client secret after readiness is lost.

`charges_enabled` is recorded but is not used as the recipient gate for the selected Platform Charge + Separate Transfer model. The recipient requirements are submitted details, active transfers capability, enabled payouts, compatible country, and a usable payout destination. This prevents direct-charge capability rules from being incorrectly substituted for recipient readiness.

## 3. Photo ID and proof of liveness

| Item | Result |
| --- | --- |
| Stripe Embedded Onboarding can collect identity documents/status | PASS — official capability and real component mount |
| Test SMS code `000-000` | PASS as login/test-account SMS only; it is **not** liveness evidence |
| Test document images/file tokens | PASS for document-verification scenarios only |
| Official `proof_of_liveness` magic token or documented bypass | NOT FOUND / BLOCKED |
| Automated completion of camera/selfie flow | NOT TESTED — sensitive user interaction and not an automation target |

Stripe's current Connect testing documentation lists test DOB, address, personal-ID, document images, and document file tokens, but does not document a `proof_of_liveness` token. Identity VerificationSession test behavior is not interchangeable with a Connect requirement already assigned to this Express account. UU must not upload a real identity document to match fictional test identity data or treat an SMS code/document token as liveness.

User action:

1. In B32 Settings, open **Payments & payouts → Resolve issue**.
2. Continue only in Stripe's official embedded/hosted verification surface.
3. If Stripe supplies a documented sandbox/test path in that surface, follow it manually and return to Settings to refresh.
4. If the surface demands real identity material for the fictional Test account or cannot satisfy the requirement, stop and contact Stripe Support using the request below.

Suggested Stripe Support request:

> We are testing a Stripe Connect marketplace in Test mode/Sandbox. Platform account: `acct_1URFfDA2nyElFLCc`; existing connected account: `acct_1UZHAEA2nyuq0CM5`; country CA; individual; Express Dashboard; controller requirement collection is Stripe. The account has `details_submitted=true`, `charges_enabled=true`, transfers active, but `payouts_enabled=false` and `disabled_reason=requirements.past_due`. Both `currently_due` and `past_due` contain `individual.verification.proof_of_liveness`. Embedded Onboarding opens the official Verify your identity / Scan photo ID flow. Connect testing documentation describes test documents and SMS code `000-000`, but we cannot find a supported test method for this liveness requirement. We do not want to upload real identity documents for fictional test data, bypass KYC, or create a replacement account. Please confirm the supported Test/Sandbox procedure for satisfying or resetting this requirement on this existing account, or whether Stripe must clear/reset the test requirement.

## 4. Onboarding UI and lifecycle

| Check | Result | Evidence |
| --- | --- | --- |
| Settings route and component mount | PASS — real Chromium/B32 | Final URL remained `/home?section=settings`; Stripe Connect account-onboarding custom element and official Connect.js script mounted. |
| Account Session contention | PASS — real HTTP/browser | Initial bounded sequence `409, 409, 200` recovered; reopen returned `200`. |
| Fresh Account Session secret | PASS — code/browser regression | Initial secret is consumed once; subsequent initialization requests a new session. |
| Close/reopen/focus recovery | PASS — real browser + targeted tests | Closing retained Settings; focus reconciliation is debounced and transient popup focus errors are not persisted as account failure. |
| UU session after recovery | PASS — real HTTP | `/api/auth/session` returned `200`. |
| Popup logout behavior | PASS — code regression | Component unmount no longer calls Connect `logout()`. |
| Add information ownership | PASS — code/DOM boundary | The onboarding host contains Stripe's official custom element; UU does not inject, simulate clicks, or store identity photos/selfies. |
| Hosted identity popup/camera completion | NOT TESTED | Requires user interaction; closed Stripe UI cannot be safely inspected or automated as UU DOM. |

The observed white/blank interval was consistent with Stripe login/identity popup transitions plus Account Session lease contention. No UU CSS overlay or iframe injection was found. The recoverable UU causes (session contention, stale secret reuse, unmount logout, route loss, and focus-error persistence) are fixed and covered by regression tests.

## 5. PaymentIntent path

Model: Platform Charge + Separate Transfer.

| Security property | Result |
| --- | --- |
| Amount/currency from frozen Order economics | PASS — offline integration/static |
| Buyer, Order, attempt, Customer and PaymentMethod binding | PASS — offline integration |
| Seller destination from canonical active binding | PASS — Migration 012/static and real metadata read |
| Browser cannot select destination or amount | PASS — API rejects extra fields; provider values are server-frozen |
| Persistent idempotency key and unique provider reference | PASS — migration/static and offline integration |
| Duplicate clicks / create recovery | PASS — browser component test and offline integration |
| Reuse after Seller loses readiness | PASS — negative offline integration; client secret withheld |
| Failed pre-create preparation lease recovery | PASS — targeted regression; lease is released without changing payment state |
| Payment disabled gate | PASS — static/offline; remains disabled in B32 |
| Real Test PaymentIntent creation | **BLOCKED / NOT EXECUTED** — Seller not Ready |
| Real Test card payment | **BLOCKED / NOT EXECUTED** — no PaymentIntent created |

The PaymentIntent has no `on_behalf_of`, `transfer_data`, or application fee. The frozen Seller account is stored in immutable UU metadata and verified again during reconciliation/refund/transfer validation. This matches a platform charge retained under B31 protection before a separately authorized transfer.

## 6. Signed webhook and B31 protection

| Check | Result | Evidence |
| --- | --- | --- |
| Raw-body signature verification | PASS — offline signed-event tests/static |
| Invalid signature/body bounds | PASS — offline API/runtime tests |
| Durable inbox before asynchronous processing | PASS — offline integration/static |
| Duplicate and out-of-order events | PASS — offline integration |
| Fresh PaymentIntent retrieval before applying state | PASS — offline integration |
| Amount/currency/Buyer/Seller/Order mismatch rejection | PASS — offline integration |
| Failed/canceled/processing event does not mark Paid | PASS — offline integration |
| Browser cannot mark Paid | PASS — API/UI/static |
| B31 receipt authority and 48-hour release gate | PASS — static and existing database test evidence |
| Payment success immediately completing Order | PASS (prevented) — B31 invariants |
| Refund/Transfer/Payout execution | DISABLED / NOT EXECUTED |
| Real Stripe-delivered payment webhook | BLOCKED — no real Test PaymentIntent while Seller is unready |

Stripe documents that webhook delivery can be duplicated and is not ordered. The implementation persists event IDs, retrieves the current provider object, and applies a locked authoritative observation instead of trusting event payload order or browser state.

## 7. Fixes in this acceptance round

- Stabilized Payment Element preparation so opening the panel does not invalidate its own callback after local `blocked` state changes.
- Closing or cancelling the payment panel now releases only the local interaction block.
- Mapped fresh Seller-readiness failures to the existing `seller_payout_not_ready` Payment Guard.
- Rechecks readiness for a previously bound, unfinished PaymentIntent before returning its client secret.
- Releases a provider create lease after pre-create validation/provider failure; no Order, payment, cancellation, fulfillment, or B31 state is fabricated or changed by that recovery.
- Preserved platform-charge validation across PaymentIntent reconciliation, Refund, and Transfer consumers using frozen Seller metadata.

No new migration was created or deployed.

## 8. Test results

| Test | Result |
| --- | --- |
| TypeScript `tsc --noEmit` | PASS |
| Targeted ESLint | PASS |
| Isolated B32 production build | PASS with pre-existing autoprefixer warnings |
| PaymentIntent B21 unit/integration | PASS |
| Payment UI browser component regression | PASS (local provider mock; not real Stripe E2E) |
| Signed webhook/reconciliation B22 | PASS |
| Refund B23 safety suite | PASS (offline; no refund) |
| Transfer B24 safety suite | PASS (offline; no transfer/payout) |
| Stripe setup/readiness/webhook suite | PASS (offline provider simulation) |
| Onboarding lifecycle static suite | PASS |
| Onboarding lifecycle real B32 Chromium regression | PASS for UU lifecycle; hosted KYC completion NOT TESTED |
| Binding reconciliation suite | PASS |
| B31 protection invariants | PASS |
| Runtime worker/gate contracts | PASS |
| Real Stripe account readiness read | PASS; account remains not Ready |

## 9. Risks and release decision

### P0

- **BLOCKED:** Seller account is not Ready because Stripe still requires `individual.verification.proof_of_liveness`. Real PaymentIntent/payment/webhook E2E must not start.

### P1

- Stripe Support or an officially supported manual Test/Sandbox liveness procedure is required for the existing account.
- After readiness becomes authoritative, execute one isolated B32 desktop Test payment and mobile status/UI verification with PaymentIntent enabled temporarily, while Refund/Transfer/Payout remain disabled; then restore PaymentIntent disabled.
- Verify the real registered B32 webhook endpoint delivery and worker drain with that Test PaymentIntent.

### P2

- Resolve the existing unrelated autoprefixer `start` warnings and refresh Browserslist data in a separate maintenance change.

Decision:

- Direct exchange and Interac: unchanged from their frozen PASS evidence.
- Stripe Protected Payment internal code/preparation: **GO for continued isolated B32 engineering tests with PaymentIntent disabled**.
- Stripe Protected Payment limited-user or public use: **NO-GO** until Seller readiness and real Test PaymentIntent/webhook/B31 E2E pass.
