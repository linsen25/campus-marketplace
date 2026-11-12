# UU Resale V3 — B32 Release Candidate Report

## Current bounded browser continuation — 2026-11-09

## Interac receipt and historical reads — latest result (2026-11-09)

This section supersedes earlier Interac acceptance results below.
**Current result: local fix PASS; B32 full Interac browser E2E BLOCKED pending
the reviewed migration. No new migration was applied remotely.**

### Product rule and verified root causes

The product's explicit Buyer payment report -> Seller receipt confirmation ->
participant-confirmed completion requirement makes Seller Receipt a required
Interac completion precondition. Agreement remains independently confirmed by
both parties; visiting a step or clicking Continue is not completion evidence.
The deployed shared external-exchange RPC currently completes after both
handover attestations without reading Interac receipts. This is the missing
server invariant, not a reason to claim bank verification or Stripe Paid.

For both historical orders `e03c06c5-dcef-4229-afe9-0ea66e343060` and
`a294b358-7834-44dc-81f0-c70ec4598df2`, real Buyer/Seller Auth sessions
reproduced RPC `marketplace_interac_payment_state` HTTP 403, SQLSTATE 42501,
message `Interac order participant required.`.
Read-only B32 Catalog inspection confirms the reader invokes
`marketplace_private.interac_order_participant`, whose eligibility requires
open lifecycle and holds_listing. The actors are the correct participants;
terminal eligibility is incorrectly reused for history authorization.
Both old orders remain completed, payment pending, payout not_eligible,
Buyer report recorded, Seller receipt NULL. Nothing was backfilled or reopened.

### Changes prepared, not deployed

`supabase/migrations/20261109083118_interac_receipt_completion_history.sql`

- Changes only Interac history read authorization: verified Auth participant,
  V2 order, exact Interac mode. History can be read after completion,
  cancellation or expiry. Missing historical receipts stay missing.
- Report/receipt write RPCs and the old private helper remain unchanged:
  terminal writes remain denied.
- Adds a receipt precondition before new exchange attestations within the
  existing participant/state/Agreement/Listing->Order lock chain.
- Adds a private trigger as defense in depth before NEW Interac completion;
  requires both attestation timestamps and pending/non-Stripe financial state.
- Asserts the reviewed function baseline, Owner/ACL/SECURITY DEFINER;
  uses an empty fixed history-reader search_path and qualified objects.
  No PUBLIC/anon grants or direct table access are added.
- Existing completed records and Direct/uu_pay/Delivery financial paths
  are not rewritten.

SHA-256:
`420ddae07c08e139b9394fbe17a6f14582349b4a834c7c00b2f37d5f0b6989cb`.

UI changes in `components/home/order-current-step.tsx`: payment report and
receipt controls are available during Agreement too; exchange is disabled
until authoritative receipt data exists; existing precise Interac request
fields are retained; terminal missing-report/receipt copy is factual.
`lib/server/order-domain-service.ts` maps the exact new receipt precondition
error to a safe readable 409 without exposing arbitrary database errors.
No UI-derived Ready/Paid/Completed state is written.

### New independent real browser evidence

The two new Listings were published through legal APIs as **Fixture Setup**;
that publication is not claimed as a browser Listing-creation test.
All Conversation, Offer, Accept, payment report, receipt and Agreement
mutations were real authenticated browser UI actions with real B32 APIs.
The runner deliberately stops before exchange completion until the new
server invariant and historical reader are deployed.

| Scenario        | Listing / Offer / Order                                                                                                                    | Actual browser result                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop Interac | Listing `ddd73227-14a9-452e-ac59-4d151e89551f`; Offer `1433a09e-5926-4314-aecc-f141049f31d5`; Order `4b4de7fb-efe2-41c4-b092-8da111085043` | Report 200, Seller receipt 200, both Agreements 200; both refreshed UIs show Receipt confirmed by seller. Open-order steps PASS; full completion/history BLOCKED. |
| Mobile Interac  | Listing `9e24cb9b-fd95-4304-b5a9-e4828f19ce19`; Offer `93741eab-3382-400d-8a7c-fce41675bfd0`; Order `1596f92f-1a59-4baf-bf50-160031686a71` | Report 200, Seller receipt 200, both Agreements 200; both refreshed UIs show Receipt confirmed by seller. Open-order steps PASS; full completion/history BLOCKED. |

Read-only remote database verification confirms both new orders are open,
payment pending, payment_paid_at NULL, payout not_eligible; both report and
receipt timestamps are populated, and both exchange confirmations remain
NULL. No PaymentIntent request or financial operation was executed.
Browser runtime error arrays are empty. Screenshots, redacted network events
and saved state are in
`tests/artifacts/b32/browser-transaction-e2e/*interac-receipt*`.
These two Orders can resume after deployment without another fixture.

### Safety and test results

- Real existing confirmed B32 outsider `920643b2-8e1c-49b4-897c-71c225e84693`
  recovered using official Admin generateLink + Auth verifyOtp, with tokens
  only in memory: real HTTP Order/Fulfillment/Interac-state reads denied 403.
  Receiving-email endpoints return 200 with NULL (no private email).
  No new identity, password change, verification change or elevated browser
  role was used. Evidence: `interac-outsider-http.json`.
- `interac-history-diagnostic.json`: actual Buyer/Seller SQLSTATE 42501,
  endpoint and Auth actor evidence for the two completed orders.
- `node tests/interac-completion-history-db.cjs`: PASS on real LOCAL
  PostgreSQL engine (PGlite), synthetic fixtures/dependency helpers.
  Actual proposed migration compiles/applies locally; verifies ACL/Owner,
  participant/anon/unverified/non-Interac denials, open and terminal reads,
  report/receipt replay, terminal-write denial, receipt-before-exchange,
  completion trigger and Direct compatibility. This is not remote PASS.
- `node tests/order-domain-api.cjs`: PASS including strict Interac request
  fields, readable receipt guard error, no privileged fallback mutation.
- `node tests/order-payment-ui.cjs`: PASS (local/mocked UI regression).
- TypeScript, targeted ESLint, git diff --check: PASS.
- `node tests/b32-interac-build.cjs`: Production Build PASS, isolated
  `.next-b32-interac-build`, B32 env overrides/clears old .env.local values,
  payment/refund/transfer disabled. Existing CSS/Browserslist/Connect SSR
  notices are warnings. Build output was not deployed.
- Direct: prior Desktop/Mobile browser PASS retained; shared RPC local SQL
  regression PASS. Direct full browser chains were not unnecessarily rerun.
- Real post-migration historical reads, remote receipt/completion negative
  tests and concurrent multi-session PostgreSQL tests: NOT TESTED/BLOCKED.
  Historical Shop/Delivery real fixture test: NOT TESTED.

### Release decision and minimum next action

**NO-GO for opening Interac to users.**

- P0 (1): receipt prerequisite is not yet enforced in the deployed database.
- P1 (2): terminal Interac historical read fix is not deployed; complete
  Desktop/Mobile post-migration browser and state/privacy regressions pending.
- P2: existing non-critical profile analytics 503 and build notices; unrelated
  UI/dependency work was not included.

Review and explicitly apply ONLY the new migration to B32, then resume the
two open Orders above via their existing Buyer/Seller UIs. Do not rerun
004–010 or reopen the old completed orders. Successful remote deployment and
end-to-end history/negative tests are required before changing the decision.

This section supersedes earlier browser PASS/smoke/partial summaries below.
Existing fixtures and accepted orders were retained; no migration, financial
operation, account creation, or replacement Listing/Offer was performed.

| Scenario        | Browser result                                   | Existing Order                         | Evidence                                                                                                                                                                                      |
| --------------- | ------------------------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop Direct  | PASS                                             | `45b97937-159c-4490-b6ca-e4fe0764f994` | Both authenticated participants refreshed and reopened the exact order; both showed Current Step Completed and external exchange confirmed.                                                   |
| Mobile Direct   | PASS                                             | `4ed36fc2-fe5b-421b-ba2c-3ec391ede78f` | Real mobile Seller Accept, both Agreements and exchange confirmations; both refreshed exact-order pages showed Completed.                                                                     |
| Desktop Interac | BLOCKED — complete Interac acceptance not passed | `e03c06c5-dcef-4229-afe9-0ea66e343060` | Buyer report returned 200; Seller receipt was not executed before exchange completion. Lifecycle is completed, paymentStatus pending, paymentPaidAt null. Completed Interac read returns 403. |
| Mobile Interac  | BLOCKED — complete Interac acceptance not passed | `a294b358-7834-44dc-81f0-c70ec4598df2` | Buyer report returned 200; Seller receipt was not executed before exchange completion. Lifecycle is completed, paymentStatus pending, paymentPaidAt null. Completed Interac read returns 403. |

The earlier continuation script incorrectly treated a Completed heading alone
as full Interac PASS and allowed exchange confirmation before the receipt
test. This was a test sequencing/error-reporting defect; those PASS labels
are withdrawn. Saved-evidence validation now requires both report and receipt
HTTP 200 evidence and rejects transaction-read errors. The driver now waits
for the actual action response, stops on HTTP failure, and does not proceed
to Interac exchange confirmation before receipt-confirmed state.

The real UI request defect was fixed in `components/home/order-current-step.tsx`:
Interac report and receipt actions no longer include unsupported clientActionId.
The strict API field contract is preserved. Browser Buyer report now returns
200 instead of 400. Seller receipt on an open order remains NOT TESTED through
this UI because both retained Interac fixtures have already completed.
No terminal order was reopened or amended.

A second observed blocker is GET `/api/order-domain/{id}/interac-payment`
returning 403 for both completed Interac orders, causing the transaction step
read-error UI. The deployed 008 read helper requires lifecycle_status=open;
the existing read and write eligibility predicates are shared. A separately
reviewed database change would need to distinguish participant-authorized
historical reads from open-order writes. No deployed migration was modified.

Fulfillment read-only HTTP regression: Buyer 200, Seller 200, anonymous 401;
authoritative order lifecycle/payment fields were unchanged by the reads.
Existing outsider credentials could not be found safely; real third-party
regression is NOT TESTED. No accessible historical Shop/Delivery fixture
was found; real historical HTTP regression is NOT TESTED. Mock service/API
regression passed for null non-external projection, denied participant RPC,
anonymous access, exact Interac body fields, and unchanged mutation routing.
Mock results do not replace the missing real-user tests.

Artifacts: `tests/artifacts/b32/browser-transaction-e2e/*-final-continuation.json`,
participant screenshots, archived continuation JSONs, and
`fulfillment-http-regression.json`. All business mutations in these browser
runs were UI clicks; HTTP calls outside the browser were authentication or
read-only verification. No PaymentIntent endpoint was invoked; checked
completed orders retain pending paymentStatus and null paymentPaidAt.
TypeScript, targeted ESLint, order-domain-api, interac-payment-state and
git diff --check passed. Existing non-critical profile/activity 503 responses
remain outside this transaction test scope.

Release decision: Direct browser closure is verified; full Direct + Interac
limited-user release remains NO-GO until Interac receipt sequencing/history
read behavior and missing real privacy regressions are resolved.

Date: 2026-11-08
Target: isolated B32 Supabase project `giqdwyiupslpfhstbtqf`
Branch: `b30-staging-acceptance-20261024`
Working-tree HEAD: `9c11796033b6ed9b2f3f3e6e917c28010f042bb4`

## RC fingerprint and scope

The working tree is intentionally dirty and was not reset, cleaned, committed,
or pushed. Existing Resale/B32 changes were preserved. The tree contains
untracked Next build output directories (`.next-b32-*`) and ignored local test
credentials; these are runtime artifacts and are not release files. No tracked
environment file or credential file is present. Migration 004–009 files remain
unchanged and were not redeployed.

Key file SHA-256 fingerprints:

| File                                             | SHA-256                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `scripts/dev-b32.cjs`                            | `4562a7e895b143b7c7357f652f18c0ea95a56fc7feb960d9bd25e562d2e86761` |
| `lib/listing-fulfillment.ts`                     | `16a4f4ccce0ffd8224a27187fc0b23bcf33b0f400611f872355a2a4a5949ddca` |
| `components/listings/use-message-seller.ts`      | `3a917df0b51c562360f81ad74aee8f78e7a6babccafe4b11dfd80426bf5590d6` |
| `components/listings/published-listing-card.tsx` | `2e7b8cf0500cc16adfc83d3564243118aa7603ceb720ba329b8a88268907da24` |
| `pages/listings/[id].tsx`                        | `0dc4a59d9b0074127fb25e6c95d0ee7f32a977f480529f6905be7b6fa6a04867` |
| `components/home/order-campus-payment.tsx`       | `f4b35c94a672073829ca1377d987e9f42d256d3b6fb5f944af7e303663171904` |
| `docs/B32-RESALE-V3-ACCEPTANCE.md`               | `fb5632bcf7b84429ac83ccf379bffe1a3bbfe11c959ebd77ebedf62d910785b6` |

## Acceptance evidence

| Area                                | Result                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration 004–009                   | PASS                          | Previously verified on isolated B32; no redeploy this round                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Direct exchange API lifecycle       | PASS                          | Two-account API E2E through completion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Interac API lifecycle               | PASS                          | Payment report, seller receipt, agreement, and participant completion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Contact Seller desktop/mobile smoke | PASS                          | Resale request omits legacy `intent=contact-seller`; no page errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Western location API                | PASS                          | Save/readback persisted on B32                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Third-party privacy negative paths  | PASS                          | Anonymous 401; synthetic outsider 401/403 for order, payment, agreement, handoff                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Payment Disabled gate               | PASS                          | Payment endpoint returns server-side 503                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Seller Not Ready gate               | PASS                          | `seller_payout_not_ready` remains enforced                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| TypeScript                          | PASS                          | `tsc --noEmit --pretty false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ESLint                              | PASS                          | `npm run lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Production build                    | PASS                          | `npm run build`; only existing autoprefixer/Stripe SSR warnings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| CI workflow syntax/static check     | PASS                          | Workflow diff check and `node --check` for B32 scripts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| GitHub Actions RC run               | NOT TESTED                    | No commit/push was authorized in this round                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| B32 offline/security suites         | PASS                          | `tests/b32-offline.cjs` and targeted Resale/Interac/location/payment suites                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Seller projection RPC diagnostics   | PASS (post-010 API recheck)   | Seller Orders `GET /api/orders?workspace=sales` returned HTTP 200 and included order `c0e8856f-b9d8-4547-95c3-aefcf97a9c26`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Interac Accept RPC diagnostic       | PASS (post-010 API recheck)   | Offer Accept returned HTTP 200 and created order `c0e8856f-b9d8-4547-95c3-aefcf97a9c26` even without `meetup_location`; later meetup proposals remain validated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Follow-up migration 010             | PASS (independently deployed) | `tests/resale-order-projection-guards.cjs`; remote version `20261109035046`; preserves function metadata and keeps initial meetup location optional                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `git diff --check`                  | PASS                          | Line-ending warnings only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Desktop Direct exchange browser E2E | BLOCKED                       | Real Seller/Buyer UI reached Listing → Contact Seller → Conversation → Make Offer → Seller Accept → Order creation. Opening the resulting Seller Orders workspace returned HTTP 403 `Order not accessible.` from `GET /api/orders?workspace=sales`, so Agreement/confirmation/completion could not be exercised. Direct signed RPC diagnostics showed `marketplace_order_detail` and `marketplace_order_snapshot_media` pass, while the workspace presentation projections `marketplace_order_economics`, `marketplace_order_meetup_history`, and `marketplace_campus_payment_state` return SQLSTATE 42501 because they still require `is_western_user()`. |
| Desktop Interac browser E2E         | BLOCKED                       | Real Seller/Buyer UI reached the Interac conversation and offer. Seller Accept called `POST /api/offers/{offer}/accept` and returned HTTP 503 `Unable to load Offers. Please retry.`. Signed RPC diagnostics reproduced SQLSTATE 23502: `null value in column "location" of relation "order_meetup_revisions"`; the active offer omitted `meetup_location`, which the current validator allowed even though the revision schema requires it.                                                                                                                                                                                                               |
| Mobile Direct exchange browser E2E  | NOT TESTED                    | The same backend order-workspace blocker was found during desktop Direct testing before starting a second mobile fixture.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Mobile Interac browser E2E          | BLOCKED                       | Real mobile Buyer UI created the offer; desktop Seller UI against that same B32 conversation reproduced the 503 Accept failure. The flow could not reach Order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Browser tooling                     | PASS                          | Chromium and project-local `playwright-core` are available; full dual-account flow was not run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Custom Google Places                | BLOCKED                       | B32 has no `GOOGLE_PLACES_API_KEY`; 503 + manual fallback are intentional                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Stripe Protected Payment E2E        | BLOCKED                       | Seller readiness/proof-of-liveness not complete; payment remains disabled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Security and release decision

- No P0 database or transaction-security issue was found in this RC pass.
- The pre-010 browser run found two release-relevant backend failures: the Seller Orders workspace presented a verified participant order through three still-Western-only read projections (HTTP 403), and the Interac offer-accept endpoint reached a NOT NULL violation caused by an on-campus offer with no location (HTTP 503 mapping). Independent post-010 API rechecks resolved both; full browser completion remains unverified.
- Direct exchange and Interac remain suitable for isolated API/internal investigation only, not browser-based user trial.
- Google Places automatic search is not required for the manual Western/custom
  location fallback, but must remain explicitly disabled until a dedicated B32
  key and quota/restriction policy are configured.
- Protected Payment is not release-ready while Stripe Seller readiness and
  Test Mode payment verification remain incomplete.

### Risk levels

- **P0:** None identified in the executed scope.
- **P1:** Complete the blocked desktop/mobile browser flows against the post-010
  service; clean release-tree review; Stripe
  Seller readiness and PaymentIntent/Webhook verification; decision on the
  legacy Shop-only `contact-seller` shortcut.
- **P2:** Google Places key/quota setup and broader visual regression coverage.

## Decision

**NO-GO for public production release.**

**NO-GO for browser-based limited-user testing.** The API lifecycles remain
useful for isolated internal diagnosis, with Stripe Protected Payment and
Google Places automatic search disabled, but the two concrete browser blockers
above must be fixed before a user trial.

Before a limited-user or public release, complete the P1 items above and
produce a clean, explicitly scoped release tree without build artifacts or
local credentials.

Migration 010 was independently applied to B32 as remote version
`20261109035046`. It was needed because the pre-010 catalog baseline rejected
ordinary verified Resale participants in read-only projections and permitted an
impossible on-campus offer that later violated `order_meetup_revisions.location NOT NULL`.

## Release tree inventory

The current worktree contains the pre-existing Resale/B32 implementation
changes plus the five browser-gate compatibility edits made during this RC
run:

- Source/UI/runtime: `components/home/messages-chat.tsx`,
  `components/listings/use-listing-offer-context.ts`,
  `components/home/orders.tsx`, `lib/order-payment-ui.ts`, and
  `lib/messages-realtime.ts` now accept the isolated B32 Supabase URL while
  retaining the fail-closed environment designation.
- Other tracked Resale/B32 source, tests, migrations, and scripts shown by
  `git status --short` are preserved user worktree changes; no unrelated file
  was reset or deleted.
- Release documentation: this report and
  `docs/B32-RESALE-V3-ACCEPTANCE.md`.
- Local-only/unreleaseable: `.env.local`, `.env.staging.local`,
  `.env.b32.test.local`, `tests/artifacts/b32/credentials.json`, and all
  `.next-b32-*` build directories. The environment/credential files are
  ignored by `.gitignore` or `.git/info/exclude`; some build directories are
  currently untracked and must be excluded from any eventual release commit.
  `.env.b32.test.local.example` is a non-secret template candidate. No secret
  value is present in the release tree.

Current SHA-256 for the five browser-gate edits:

| File                                               | SHA-256                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `components/home/messages-chat.tsx`                | `7d34ab3e11dd0c1f7f8e65567f83d323e48fb9b2df7920be3ea48cefb7895dda`  |
| `components/listings/use-listing-offer-context.ts` | `35ec48bf74b03bfbc5a5ab555c429443d4ef8af700882ef600f699c661c87a41`  |
| `components/home/orders.tsx`                       | `e85b77b0363544fe6b88fa5acae2c087b88f77ec84bd4b9a676ae1a711aa5094`  |
| `lib/order-payment-ui.ts`                          | `69c83db3339422ae76a64539d16c17ebd070560c063b7c7a0a09fadd1dc156a9`  |
| `lib/messages-realtime.ts`                         | `7fa50cf5772eeba7e9850b16cd17aee4d3ce8e9542d83757bfee292937717853d` |

## Browser automation follow-up (2026-11-09)

The remaining automation failure was reproduced with real B32 Buyer/Seller
sessions on an isolated port. The failure was not a lost cookie: the browser
`/api/auth/session` request returned HTTP 200 with the B32 user. The concrete
causes were:

- the Home shell was asserted after a fixed short delay while Next dev was
  still compiling, leaving the FOUC body hidden or the page in its initial
  Profile state;
- query-driven Home and conversation selection read `router.query` before
  hydration, so direct `section=messages`/`conversation=` URLs could fall back
  to Profile or omit the selected conversation.

Minimal fixes:

- `components/home/animated-sidebar-demo.tsx` now resolves section and
  destination from the hydrated query or `router.asPath`, and handles the
  route-complete URL explicitly;
- `components/home/messages.tsx` applies the same fallback for deep-linked
  conversations;
- `tests/b32-browser-navigation-diagnose.cjs` waits for rendered Home/listing
  markers instead of a fixed timeout and captures URL, DOM, screenshots,
  console/page errors and HTTP responses.

Real browser results after the fix on B32 port 3045:

- Desktop authenticated Home Messages/Buying: **PASS**
- Desktop Orders/Purchases and Orders/Sales: **PASS**
- Mobile authenticated Home Messages/Buying: **PASS**
- Mobile Orders/Purchases and Orders/Sales: **PASS**
- Desktop/mobile Listing load: **PASS** (mobile heading is intentionally
  compact; listing body rendered)
- Real Listing → Message Seller: **PASS**; conversation route and B32
  conversation API returned HTTP 200.
- Complete Offer → Accept → Order → Agreement → Completion flows: **NOT
  TESTED** in this run; existing fixtures contain prior active/replaced offers
  and no fresh, unblocked Interac offer was selected through the UI.

The remaining 503 responses observed during the run were
`/api/profile/activity?period=7D` and the non-critical
`/api/listings/view` analytics call; the B32 account-activity RPC retains its
existing Western-only guard. These did not block Home/Orders navigation or the
conversation route and were not changed in this browser-automation-only pass.

Clarification: the browser result above is navigation/fixture evidence only.
The four complete Direct/Interac desktop/mobile transaction flows remain
NOT TESTED because the available listing had prior active/replaced offers and
no fresh unblocked offer was selected through the UI.

## RC update: deployed Migration 011 and final Interac closure (2026-11-09)

This is the current authoritative RC result and supersedes the pre-011
Interac/browser blockers above.

- Remote migration `20261109183845 interac_receipt_completion_history` is
  present on B32. This run did not deploy, repair, or replay any migration.
- Desktop Interac browser E2E: **PASS**, Order
  `4b4de7fb-efe2-41c4-b092-8da111085043`.
- Mobile Interac browser E2E: **PASS**, Order
  `1596f92f-1a59-4baf-bf50-160031686a71`.
- Both Orders completed through real Buyer and Seller browser confirmation.
  After refresh, both roles saw Completed, confirmed external exchange, and
  receipt-confirmed Interac history.
- Historical report/receipt timestamps did not change under terminal write
  rejection or duplicate exchange idempotency checks.
- Both completed Orders remain pending/non-Paid/not-eligible, with zero campus
  payment attempts and no B31 protection row.

Receipt prerequisite negative acceptance used legal Order
`a6106031-127b-46af-8781-6bafe1389b04`. It had a Buyer payment report and both
Agreements but no Seller Receipt. Buyer and Seller Exchange calls both returned
409, history remained `payment_reported`, and lifecycle remained open. This is
real B32 HTTP/database evidence, not a mock.

Privacy acceptance: participant historical reads returned 200; anonymous
returned 401; the existing confirmed outsider returned 403 for Order,
fulfillment, and Interac payment history across the two completed Orders and
the negative Order. The receiving-email endpoint returned a nullable result
without exposing the address.

Direct compatibility: the frozen Desktop Direct Order
`45b97937-159c-4490-b6ca-e4fe0764f994` accepted duplicate Buyer/Seller exchange
requests as idempotent 200/confirmed. The previously completed Mobile Direct
browser flow remains PASS. The new Interac gate did not apply to Direct mode.

Targeted TypeScript, ESLint, local PostgreSQL state-machine, order-domain API,
payment UI, formatting, and diff checks passed. Production build evidence from
the same application code remains PASS; this final round changed only test
fixtures and documents after that build.

### Current risks and release decision

- **P0: 0.** No remaining Direct/Interac safety or completion blocker in the
  executed B32 scope.
- **P1:** Produce a clean reviewed release tree and run the deployment-specific
  Production environment checklist before any public release. Stripe Protected
  Payment remains disabled and is not part of this limited trial.
- **P2:** Dedicated Google Places key/quota setup, existing non-critical Profile
  activity 503, and broader visual/concurrency coverage.

**GO:** isolated B32 internal acceptance and limited-user Direct + Interac trial
with Stripe Protected Payment and Google Places automatic search disabled.

**NO-GO:** full public production/full-feature launch. Production deployment,
Stripe readiness/payment E2E, and Google Places readiness remain separate
uncompleted release scopes.

## Release-tree consolidation and Stripe preparation (2026-11-09)

The reproducible file classification, migration hashes, maintained test entry
points, excluded local material, and Stripe next-stage checklist are recorded
in `docs/B32-RESALE-V3-RELEASE-TREE.md`.

The browser E2E entry point is retained but now refuses to create new B32
fixtures unless `B32_E2E_CREATE_FIXTURES=1` is explicitly supplied. The stable
offline RC entry point is `npm run test:b32:resale-v3:offline`; real privacy and
receipt-gate checks remain separate because they intentionally use B32 network
sessions.

A read-only Stripe Test API snapshot confirmed that the existing Connected
Account remains details-submitted and charges-enabled, but payouts are disabled
because proof of liveness is currently due and past due. Protected Payment
therefore remains outside this RC. No Stripe object or database row was changed.

Release-tree verification: TypeScript PASS, full ESLint PASS, isolated B32
production build PASS, 12-suite offline RC PASS, CI YAML parse PASS, migration
hash manifest PASS, `git diff --check` PASS, and sensitive/ignored-file checks
PASS. The worktree is suitable for a reviewed staging pass but not for a single
undifferentiated commit; diagnostic scripts and local artifacts are excluded by
the release-tree manifest.

### Protected Payment groundwork and Binding reconciliation

The historical duplicate Binding is explained by an earlier self-platform
configuration combined with uniqueness scoped by platform. The canonical row
is now independently anchored by the Connected Account's Test-mode
`uu_binding` metadata; no account or Binding was deleted or rewritten.

Migration `20261109190000_stripe_binding_reconciliation.sql` was independently
deployed to B32 as remote version `20261109213247`. It adds audited, idempotent
supersession and excludes superseded rows from every reviewed setup, payment,
transfer, webhook, and payout lookup. It does not alter 004-011.

Live acceptance then verified the Test key's platform, Connected Account,
confirmed Seller ownership and `uu_binding` metadata. The first controlled RPC
superseded one stale self-platform row, retained the canonical Binding, and
transactionally wrote the audit; the second identical call returned zero.
Setup lookup for the stale platform now returns null. An official Test Account
Session for Embedded Onboarding was created successfully without logging its
client secret.

The PaymentIntent adapter now implements the architecture already required by
B31: a platform charge with no `on_behalf_of`, followed only later by a
separately gated Transfer. The frozen seller account is authenticated through
server-owned database state and Stripe metadata. Buyer method and seller
recipient readiness are rechecked even when an existing Intent is reused.
Signed webhook retrieval remains the only Paid evidence; failed, duplicate,
delayed, and out-of-order events retain their existing reconciliation path.

Targeted Stripe setup, PaymentIntent, webhook reconciliation, Refund, Transfer,
B31, Direct/Interac shared regressions, TypeScript, ESLint, production build,
and `git diff --check` pass. No PaymentIntent, Charge, Refund, Transfer, Payout,
or money-provider operation was executed. The only remote database mutation was
the explicitly authorized 012 reconciliation. Stripe enablement remains blocked
by manual proof of liveness, `payouts_enabled=false`, and a subsequent Test-mode
Payment Element + signed webhook E2E.
Migration 012 also compiled and passed synthetic local PostgreSQL tests for
service-only execution, metadata preservation, idempotent non-destructive
supersession, audit insertion, cross-user conflict denial, and stale metadata
denial. This is local evidence only, not a remote B32 deployment claim.
