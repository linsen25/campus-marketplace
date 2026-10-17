# Stripe Phase 1B — test-mode account setup

This record describes the current local worktree, not a production deployment.
Only staging `pcaqxezdfxofysghssyo` is permitted. This phase creates no charges,
refunds, transfers or bank payouts and does not advance an Order.

## Versions and Connect configuration

- `stripe` 23.0.0; API **2026-09-30.endive**, explicitly checked at runtime.
- `@stripe/stripe-js` 10.1.0, `@stripe/react-stripe-js` 7.0.0.
- Node runtime unchanged; `@types/node` 20.0.0 satisfies the official SDK's >=20
  peer requirement without introducing the newer Undici/DOM fetch type conflict
  into this TypeScript 4.7 application.
- Connect **Accounts v2**, `dashboard: express`, Canadian identity, CAD default,
  recipient configuration requesting `stripe_balance.stripe_transfers`.
- Express requires application fee/loss responsibility. Stripe collects KYC.
  No merchant/direct-card-acquiring capability is requested.
- The same v2 Account is read through the supported v1 compatibility endpoint
  solely to inspect its external bank destination and `payouts_enabled`.
  No parallel v1 connected account is created.

## Configuration (never commit values)

Use the local staging server's environment and restart it after configuration.
Do not modify production or copy production keys. `.env.sample` contains names
and empty placeholders only.

| Variable | Requirement |
| --- | --- |
| `APP_ENV`, Supabase public config and service-role key | Existing exact staging guards |
| `STRIPE_PROVIDER_ENABLED` | Explicit `true`; otherwise existing simulator mode remains isolated |
| `STRIPE_API_VERSION` | Exactly `2026-09-30.endive` |
| `STRIPE_SECRET_KEY` | Server-only `sk_test_…` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Matching platform's `pk_test_…` |
| `STRIPE_PLATFORM_ACCOUNT_ID` | Non-secret platform `acct_…`; verified against the secret key before setup/reconciliation |
| `STRIPE_APPLICATION_ORIGIN` | Fixed staging application origin, no path, credentials, query or fragment; HTTPS, or HTTP localhost for local testing |
| `STRIPE_WEBHOOK_SECRET` | Platform snapshot endpoint signing secret |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Connected-account snapshot endpoint signing secret |
| `STRIPE_ACCOUNT_WEBHOOK_SECRET` | Accounts v2 thin-event endpoint signing secret |
| `STRIPE_WORKER_SECRET` | Dedicated >=32-character server-only scheduler credential |

Incomplete configuration, live key prefixes, unexpected API versions and wrong
Supabase targets fail closed. The publishable key is the only key sent to the
browser. Do not log responses containing client secrets or onboarding URLs.

## Private persistence

Additive migration `202610160004_stripe_account_setup.sql`:

SHA-256 `e4b4ad0355e979f1f13a24def5e1279119377abad862384803be20f6cca50df8`.

- `stripe_bindings`: user/kind/platform/test uniqueness; separate Buyer Customer
  and Seller Account bindings, one active card, pending SetupIntent and operation,
  safe summary, synchronization time and fenced lease. No client secret, card
  number, CVC, KYC payload or full bank details are stored.
- `stripe_setup_operations`: durable creation identity, timestamps and resulting
  provider reference. Provider idempotency keys derive from these identities.
- `stripe_webhook_inbox`: unique platform/test/account-scope/event ID, type,
  owner reference, timestamps, processing lease, attempts and bounded error code.
  No raw webhook payload is retained.
- RLS enabled; no direct table grants, including service-role direct access.
  Only narrowly scoped service-role RPCs operate on these tables; they also
  require the exact staging JWT project reference. No authenticated/anonymous
  browser RPC access exists.
- Atomic binding/projection updates reuse the existing financial-capability
  writer and notification hooks. Unfinished onboarding survives safe Unset.

Creation retries reuse the same durable operation. A still-unresolved creation
older than 20 hours stops for server recovery instead of reusing a potentially
pruned Stripe idempotency key and creating a duplicate. Such a recovery must
verify the provider object's binding metadata before attaching its reference;
the public/browser endpoints cannot perform an arbitrary reference repair.

## Buyer flow

Authenticated, verified account -> POST `/api/stripe/card-setup` with `{}` ->
create/reuse Customer and pending SetupIntent -> Payment Element in the existing
`#stripe-payment-element-host` -> submit/confirm using Stripe.js -> POST
`/api/stripe/reconcile` -> server validation -> safe capability refresh.

The pinned API uses `allowed_payment_method_types: ['card']`; usage is
`on_session`. Apple/Google Pay are disabled in Element options. There is no
Express Checkout, method selector, multi-card management or custom card input.
Dark Appearance adapts the approved UU dialog without changing its outer layout.
Stripe owns billing-field requirements and card authentication.

Only authoritative successful setup, correct Customer/binding/operation metadata,
test mode, attached card and usable expiration may become Set. Replacement
failure/cancellation/required action preserves an existing usable card. The
active/default reference changes only after verification; a client callback
cannot award Set. Detached/expired cards or deleted Customers require attention.
Provider-deleted Customers require trusted operational recovery; browser setup
cannot silently replace an immutable owner binding.

## Seller flow and exact Ready predicate

POST `/api/stripe/payout-setup` with `{}` creates/reuses one v2 account and returns
a single-use Stripe-hosted onboarding URL. No local KYC/bank form exists.

Return URL: fixed application `/home?section=settings&focus=payments-payouts&stripe_return=seller`.
Returning is not proof of Ready. Settings open/focus and explicit reconciliation
fetch current Stripe state. Card redirects similarly return to Settings and
remove Stripe return/client-secret query parameters from the visible URL.

Refresh URL: `/api/stripe/connect-refresh?state=…`. It requires the authenticated
owner and a 30-minute random token whose hash is privately persisted. It rotates
the token and creates a new link. Arbitrary return URLs/account IDs are rejected.
Only HTTPS `connect.stripe.com` redirect URLs are accepted.

Ready requires ALL of:

1. Correct test-mode v2 account and binding metadata.
2. Recipient `stripe_transfers.status = active`.
3. Recipient `payouts.status = active`.
4. Compatibility account `payouts_enabled = true`.
5. No currently-due/past-due requirement summary.
6. A default CAD bank destination, not errored/verification_failed.

Account existence and `details_submitted` do not imply Ready. Direct-charge
`charges_enabled` is not required. Only generic bank summary and last4 leave the
server; no connected-account ID, transit/routing details or KYC fields do.

## Webhooks and reconciliation

Register separate test-mode destinations with their corresponding secrets:

- `/api/stripe/webhook`, platform snapshot events:
  `setup_intent.succeeded`, `setup_intent.setup_failed`, `setup_intent.canceled`,
  `payment_method.attached`, `payment_method.detached`, `payment_method.updated`,
  `payment_method.automatically_updated`, `customer.updated`, `customer.deleted`.
- `/api/stripe/connect-webhook`, connected-account snapshot events:
  `account.external_account.created`, `account.external_account.updated`,
  `account.external_account.deleted`.
- `/api/stripe/account-webhook`, Accounts v2 thin events:
  `v2.core.account.updated`,
  `v2.core.account[configuration.recipient].capability_status_updated`,
  `v2.core.account[configuration.recipient].updated`,
  `v2.core.account[requirements].updated`,
  `v2.core.account[identity].updated`, `v2.core.account[defaults].updated`.

Next body parsing is disabled. Verify the signature against the bounded raw body
before provider network/persistence work; reject live events. Persist necessary
references before 200 acknowledgement. Duplicate IDs do not create more work.

Schedule POST `/api/stripe/worker` with `Authorization: Bearer <worker secret>`.
The bounded worker claims durable records, fetches current provider state and
uses the same reconciler as Settings. It does not apply event snapshots in
arrival order. Failed/unmapped records remain pending for retry and audit;
operators must monitor them, including unknown provider owners. No event
payloads are used to decide fault or financial settlement. Projection transitions
reuse existing notification guards rather than sending provider-side duplicate
notifications.

Settings enter/focus/return and explicit POST reconciliation work independently
of webhook delivery. Processing/unknown card results can be checked without
confirming the card again. Each UI action has its own pending/error recovery.

## Simulator isolation and security

When Stripe setup is enabled, capability reads use only this platform's private
Stripe test bindings. Historical `staging_test` metadata cannot imply Stripe Set
or Ready. Test-state writes and all three server simulator payment paths fail
closed before starting an Order attempt. Simulator infrastructure is retained
for the independent, feature-disabled staging test mode.

Browser setup APIs accept no Customer/Account/PM IDs, readiness, money amounts or
user IDs. Session identity, verified Western account checks, same-origin/custom
header convention, no-store responses and sanitized errors remain authoritative.
Stripe APIs and hosts are NetworkOnly in PWA configuration; generated service
worker output is not hand-edited or regenerated in this pass.

## Qualification status

- Migration applied only to staging; deployed receipt and RPC/grant behavior
  verified with rollback-only synthetic identities. Existing Listing/Order/chat,
  users, media, Favorites and capability fingerprints stayed identical.
- Offline provider tests use mocked HTTPS/DB but real official SDK signature
  verification. Cover unknown-result idempotency, owner reuse, replacement,
  ownership/mode checks, duplicate/out-of-order/detached events, readiness and
  concurrent setup exclusion.
- API tests cover session ownership, injection, CSRF, no-store, sanitized errors,
  raw-body/size handling and worker authentication.
- Browser tests distinguish feature-disabled presentation from mocked Stripe
  controller qualification at 390/430/820/1280/1536. They are NOT proof of a real
  Stripe iframe or completed hosted onboarding.
- Actual Stripe test-mode Customer/SetupIntent/Connect creation calls are now
  qualified as detailed below. Registered webhook delivery and completed hosted
  KYC remain separate qualification items. The user has confirmed
  local staging configuration and the origin `http://localhost:3000`; provider
  qualification follows the prerequisite
  [dual payment path](DUAL_PAYMENT_PATH.md) domain qualification. All three
  signing-secret names are now configured. The user's localhost Stripe CLI
  listener intentionally shares one CLI signing secret; this is a development
  transport setup, not proof of independently registered destination secrets.
  Hosted deployment must configure each destination's actual signing secret.
  Do not bypass signature, event-shape or account-scope validation.
  Configuration confirmation alone does not prove a successful provider test.
- Existing `offer-accept-static` and `marketplace-foundations-api` fail in HEAD as
  well as the worktree (historical OrderProgress assertion and missing Meeting
  fixture respectively); unrelated product code was not modified to satisfy them.

## Deferred Phase 2

Order PaymentIntents/charging, refunds and cancellation execution, delivery
compensation transfers, sale transfers, bank payout execution/allocation,
money-movement reconciliation and provider dispute settlement are not implemented.
No existing economics, lifecycle, Agreement, handoff or Protection rule is changed.
No production access, environment-value edits, commit or push.


## Real-provider qualification update

- The real test-prefixed key authenticates and matches the configured platform.
- Real authenticated localhost/staging Customer and SetupIntent reuse pass.
- Real test-card setup and safe card projection pass.
- A real declined replacement leaves the prior usable card active; a successful
  replacement updates the single active/default binding.
- Synthetic Customer/application cleanup and unchanged canonical fingerprints
  were verified after this run. Successful SetupIntents remain Stripe test audit
  history; no Order charge/refund/transfer/payout was created.
- The initial Connect access error was followed by platform enablement. Real
  Accounts v2 recipient/Express creation, account reuse and Stripe-hosted link
  loading now pass. The provider-required `contact_email` is resolved from the
  binding user's verified server-side Auth identity, never a browser parameter.
  Unverified/missing email fails closed before account creation.
- Incomplete hosted onboarding reconciles to Needs attention, never Ready.
  Loading the hosted entry page is not evidence of completed KYC/bank setup.
  The synthetic browser run did not complete the test-phone registration step;
  the final run confirmed the official test-phone helper filled the field and
  clicked the visible Submit action without a locator timeout, then displayed
  "Having trouble signing up? Contact Support". Earlier test-driver locator
  timeouts are retained separately. This does not identify the responsible
  upstream endpoint or establish a provider outage. Ready-after-onboarding is
  not yet qualified. No direct API KYC shortcut or fake readiness was used.
- Real Payment Element geometry passed at 390/430/820/1280/1536. A separate
  1536 submission passed real Stripe.js confirmation, existing Check status
  recovery, authoritative Set projection and refresh persistence. Initial test
  failures exposed locale/field-label assumptions, Home shell remounting and
  setup/reconcile lease conflicts; their sanitized diagnostics are retained.
  No automatic product retry or lock bypass was added to qualify the run.
- A signed localhost replay of an actual provider SetupIntent event passed
  durable duplicate deduplication. This is not proof of registered destination
  or Stripe CLI delivery. An unrelated pending inbox was detected, so the live
  global worker was deliberately not drained. Worker/out-of-order convergence
  remains covered offline; this run does not claim live worker qualification.
- `scripts/dev-staging.cjs` now explicitly forwards the Stripe environment-name
  allowlist from the dedicated staging file, using empty values for missing
  variables so Next cannot inherit credentials from another dotenv file.
  No environment file is modified. The local staging server was restarted to
  load this configuration. `dev-staging-stripe.cjs` verifies the isolation.
- Earlier qualified live runs cleaned their exact synthetic staging identities and
  bindings, deleted its test Customer or closed its owned test Connect account,
  and verified unchanged canonical data/media fingerprints. No fixture journal
  remains. Stripe retains provider-side test audit history; cleanup does not
  claim to erase that history or unrelated inbox records.

## Payment dialog presentation qualification

The Card-only Payment Element explicitly uses `wallets: { applePay: 'never',
googlePay: 'never', link: 'never' }`; the existing server SetupIntent remains
restricted to Card. No provider ownership or Seller onboarding change is made.

UU owns `[data-payment-body]` as the sole form scrollport. It uses
`overflow-y: auto`, `scrollbar-gutter: stable` and scroll containment. The outer
Payment-only dialog clips overflow and retains its existing width, with a
viewport-bounded 640px height and a separate fixed action area. Its content
includes a full form skeleton (header, card number, expiry/CVC, country and
supporting copy). Narrow form reservations follow measured real Element heights;
the skeleton is not an editable replacement form. Four pixels of body padding
per side accommodate the real iframe's measured focus-outline bleed, separately
from native scrollbar reservation.

Real Stripe test-mode checks pass at 390/430 (640px viewport height) and
820/1280/1536 (900px height): loading/ready dialog and footer geometry unchanged,
body width unchanged, full scroll footprint difference <=4px, no horizontal or
competing outer scrollbar, internal mobile scrolling, native background lock,
Cancel/Escape/focus return, no visible Link text/signup fields. A real Stripe.js
test-card save, Check status recovery and refresh persistence pass.

The final presentation run's global fingerprint assertion did not pass. Read-only
journal-scoped recovery verified zero remaining synthetic Auth/Profile/bindings/
capability/notification rows; provider deletion completed before committed
application cleanup. Two concurrent non-fixture financial-capability updates
were observed, with no corresponding Listing/Order updates. These may explain
the mismatch; no claim of a fully unchanged global fingerprint is made for this
run, and no unrelated data was restored or modified. The sanitized original
failure and cleanup audit remain in ignored artifacts. No active fixture journal
remains. This qualification performs no Order money movement.

## Minimal public Seller page and onboarding profile

`/seller/[id]` uses the existing public profile UUID as a stable seller identifier;
username edits do not change its URL. It reads with the anonymous Supabase key
under existing RLS and returns only username and published, Available listing
summaries. No Auth, email, legal-name or financial fields are read. Avatars are
currently local previews rather than persisted public assets, so the existing
initial-based avatar is used. This is a public Seller foundation, not a full Store.

Accounts v2 uses `defaults.profile.business_url` and
`defaults.profile.product_description` (the equivalents of v1 business profile
fields). Prefill happens before the first hosted link. After hosted onboarding
starts, Stripe redacts Express profile fields: a returned null is not evidence
that the value was deleted or absent. The existing persisted refresh marker
prevents later attempts from overwriting seller-supplied, now-redacted values.
Already-started hosted accounts are not rewritten. The product description is:
"I sell new and pre-owned personal items through the Usual & Unusual marketplace."

`UU_PUBLIC_STAGING_ORIGIN` is optional and separate from the local
`STRIPE_APPLICATION_ORIGIN` used for return/refresh. Leave it empty until this
route is deployed on a real public staging HTTPS origin. No such origin is
currently configured. Localhost is never sent as a business URL. When configured,
the exact seller page must respond anonymously with matching server-rendered
seller identity, without redirects, before its URL is sent to Stripe.

Stripe accepts specific public business/profile URLs, subject to its website
review and completeness requirements; API acceptance is not website approval.
Public staging deployment and Stripe's actual Website review remain prerequisites
for validating the URL requirement. This pass does not deploy a site or claim
website verification, completed KYC, or Seller Ready.

References: [Accounts v2](https://docs.stripe.com/api/v2/core/accounts/create),
[business/profile URLs](https://support.stripe.com/questions/do-i-have-to-have-a-business-website-to-sign-up-for-stripe),
[website review](https://support.stripe.com/express/questions/business-website-for-account-activation-faq).
