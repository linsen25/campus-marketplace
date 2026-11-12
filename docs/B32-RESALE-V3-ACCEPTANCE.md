# UU B32 Resale V3 Acceptance

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

## Current bounded browser continuation — 2026-11-09

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
Project: `giqdwyiupslpfhstbtqf`

## 1. Migration status

| Migration | Remote status                 | Evidence                                                                                                                                                                                    |
| --------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 004       | PASS                          | Remote history `20261108043416`                                                                                                                                                             |
| 005       | PASS                          | Remote history `20261108043423`                                                                                                                                                             |
| 006       | PASS                          | Remote history `20261108043732`                                                                                                                                                             |
| 007       | PASS                          | Remote history `20261108095042`; revised SQL applied to B32                                                                                                                                 |
| 008       | PASS                          | Remote history `20261108095049`; revised SQL applied to B32                                                                                                                                 |
| 009       | PASS                          | Independently applied to B32 as remote version `20261108185655`; 10 transaction functions now use `is_verified_user()` and historical Delivery/Courier/cancellation guards remain unchanged |
| 010       | PASS (independently reported) | Applied to B32 as remote version `20261109035046`; projection guards use `is_verified_user()` and initial meetup snapshot may be NULL while later proposals remain validated                |
| 011       | PASS                          | Applied to B32 as remote version `20261109183845`; participant-authorized Interac history reads, Seller Receipt completion gate, and completion trigger verified                            |

No migration repair, reset, or duplicate execution was performed. Old Staging and Production were not accessed.

## 2. Local SQL review

`202611070007_interac_email_auth_claim_fix.sql` uses the trusted JWT email claim together with `is_verified_user()` and does not grant access to `auth.users`.

`202611070008_interac_payment_confirmation.sql` keeps Interac payment attestation separate from Stripe/Paid state and B31 protection. Participant checks use `auth.uid()`, RPCs are `SECURITY DEFINER` with fixed `search_path`, direct table access is revoked, and repeated reports/receipt confirmations are idempotent.

Remote permission metadata was independently verified: private-table direct access is revoked, RLS is enabled, anonymous sensitive RPC execution is denied, authenticated execution is limited to the public RPCs, and SECURITY DEFINER/search_path/owner checks passed.

## 3. B32 environment isolation

Changed `scripts/dev-b32.cjs`:

- requires Project Ref `giqdwyiupslpfhstbtqf` and its Supabase URL;
- requires Test-mode Stripe publishable/secret keys;
- rejects Live Stripe key prefixes;
- requires Supabase, webhook, origin, and account configuration variables;
- validates optional `B32_TEST_PROJECT_REF` when present;
- clears variables declared only by `.env.local` before Next.js starts, preventing stale Staging/Production values from supplementing B32;
- preserves an independent port and `NEXT_DIST_DIR`.

Secrets are not printed or committed.

## 4. Local service evidence

Using `npm run dev:b32 -- 3034 .next-b32-final-e2e` (this round):

- `/` returned HTTP 200;
- `/api/auth/session` returned HTTP 200;
- `/api/stripe/webhook` GET returned HTTP 405;
- `/api/orders?workspace=purchases` returned HTTP 401 for an anonymous request
  (the B32 environment guard was reached; no Staging fallback/503);
- isolated build directory was used;
- the process was kept isolated on 3034 with an independent build directory.

Listeners on 3021/3022 remain untouched because ownership could not be safely confirmed.

The local transaction API now accepts the exact B32 project through the same
fail-closed environment checks used by the existing Staging path. Snapshot
media storage also validates the B32 service-role JWT ref before any private
bucket operation.

The B32 runtime also enables the already-deployed Resale transaction preference
columns (the previous helper only recognized the old Staging project), without
changing any database or payment guard.

## 5. Test evidence

| Area                                           | Result                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `node --check scripts/dev-b32.cjs`             | PASS                                                                                                                              |
| Interac email verification static test         | PASS                                                                                                                              |
| Interac payment state static test              | PASS                                                                                                                              |
| Interac settings static test                   | PASS (previous evidence)                                                                                                          |
| TypeScript                                     | PASS (previous evidence)                                                                                                          |
| Targeted ESLint                                | PASS (previous evidence)                                                                                                          |
| `git diff --check`                             | PASS (line-ending warnings only)                                                                                                  |
| `tests/resale-verified-transaction-access.cjs` | PASS                                                                                                                              |
| B32 Seller/Buyer Auth login                    | PASS (both HTTP 200)                                                                                                              |
| Seller verified-email Interac setting          | PASS                                                                                                                              |
| Interac listing creation/publication           | PASS (listing `f8ac9d08-6404-492c-b9f9-4f3758c4bb51`)                                                                             |
| Interac receiving-email setting/readback       | PASS (verified Seller email only)                                                                                                 |
| Interac Buyer report + duplicate report        | PASS (same timestamp/state; no Stripe call)                                                                                       |
| Interac Seller receipt confirmation            | PASS (after Buyer report)                                                                                                         |
| Interac agreement confirmation                 | PASS (Buyer then Seller)                                                                                                          |
| Interac participant completion                 | PASS (Buyer/Seller external-exchange confirmations)                                                                               |
| Anonymous Interac access                       | PASS (401)                                                                                                                        |
| Invalid/fake-order Interac access              | PASS (no private email returned)                                                                                                  |
| Duplicate post-completion receipt              | PASS (blocked with Seller-required/state guard)                                                                                   |
| Direct exchange conversation (verified path)   | PASS (`marketplace_find_or_create_conversation`; HTTP 200)                                                                        |
| Direct exchange Offer → Accept → Order         | PASS (Order `ea5ad6ca-8faa-42f4-b7ce-4eaf40eb8286`)                                                                               |
| Direct exchange Agreement + both confirmations | PASS                                                                                                                              |
| Direct exchange repeat confirmation            | PASS (idempotent `confirmed` result)                                                                                              |
| Contact-seller shortcut                        | BLOCKED (separate historical `marketplace_contact_seller` still Western-only; not used to bypass the verified path)               |
| Browser E2E                                    | NOT TESTED (HTTP/API lifecycle executed)                                                                                          |
| Western location persistence                   | PASS (listing `03346615-b061-4a0e-8975-a49565c63cbf`, API readback matched)                                                       |
| Custom Google Places                           | BLOCKED/NOT TESTED (B32 Places API returned 503: provider unavailable; manual-location fallback remained available)               |
| Remote order ledger query                      | BLOCKED (B32 `service_role` has no direct `public.orders` SELECT; no privileged bypass used)                                      |
| Seller order projection RPC diagnostics        | PASS (post-010 recheck; Seller workspace returned HTTP 200 and included order `c0e8856f-b9d8-4547-95c3-aefcf97a9c26`)             |
| Interac Accept RPC diagnostic                  | PASS (post-010 recheck; active offer without `meetup_location` accepted and created order `c0e8856f-b9d8-4547-95c3-aefcf97a9c26`) |
| Follow-up migration 010                        | PASS (independently applied to B32; local static review and remote version evidence recorded)                                     |

## 6. Business E2E status

- Direct exchange: **PASS via HTTP/API** using the verified `marketplace_find_or_create_conversation` path. The earlier 403 was caused by the optional `intent=contact-seller` shortcut, which calls the separate Western-only `marketplace_contact_seller` RPC. No permission was bypassed.
- Direct exchange completed through Agreement and both external confirmations on order `ea5ad6ca-8faa-42f4-b7ce-4eaf40eb8286`; repeat confirmation returned the authoritative `confirmed` state.
- Interac report/receipt/agreement/external-completion flow: **PASS via HTTP/API** on order `85f00435-9beb-4897-b2a1-51c23c37747e` (existing B32 conversation/offer). Buyer report and Seller receipt remained separate from Stripe state.
- Interac order state ended in participant-confirmed external exchange; no PaymentIntent endpoint was called and the payment feature remained disabled.
- Western/Custom location browser flow: **NOT TESTED**.
- Stripe Seller Readiness/payment guard: **BLOCKED** for the existing `uu_pay` offer; `marketplace_offer_accept_preflight` returned `seller_payout_not_ready`. No PaymentIntent or funds operation was executed.

## 7. Remaining release blockers

1. The `contact-seller` shortcut remains Western-only; ordinary Resale uses the verified conversation path. Decide separately whether that shortcut should be widened.
2. Migration 010 is independently reported applied to B32; re-run the blocked browser flows against the post-010 service.
3. Complete dual-account browser E2E for Direct exchange, Interac, and location flows.
4. Complete Seller Readiness before Protected Payment testing.
5. Grant/route a controlled B32 read path if authoritative order-ledger verification is required; no direct `service_role` table read was assumed.

No Commit, Push, deployment, Stripe Live operation, Refund, Transfer, Payout, or remote Staging/Production change was performed.

## 8. Final UI integration evidence

- Resale `Message Seller` now calls `/api/messages/conversations` with only
  `listingId`; it no longer sends the legacy `intent=contact-seller` flag.
- The legacy flag remains opt-in for Shop listings and the historical
  `marketplace_contact_seller` capability was not widened.
- Browser smoke on B32 port 3034 loaded a published listing at desktop size
  and observed the POST body without the legacy intent. No page runtime errors
  were observed.
- Custom Google Places 503 has a concrete configuration cause in B32:
  `GOOGLE_PLACES_API_KEY` is absent. The server intentionally returns the
  manual-location fallback instead of fabricating a place.
- Stripe Payment Disabled remains a server-side 503 gate. Seller Readiness is
  a separate `seller_payout_not_ready` business gate; neither was bypassed.

## 10. Release-candidate disposition

- Production build, TypeScript, ESLint, B32 offline/security suites, and
  targeted Resale/Interac/location/payment regressions passed on the current
  working tree.
- Full dual-account desktop/mobile browser E2E is **BLOCKED/PARTIAL**: the
  pre-010 browser run stopped at Seller Orders HTTP 403 and Interac Accept
  HTTP 503; post-010 API rechecks pass, but the complete browser flows remain
  unverified because the harness could not reliably drive the authenticated
  Home workspace navigation.
- Custom Google Places remains **BLOCKED** because the isolated B32 environment
  has no `GOOGLE_PLACES_API_KEY`; manual location fallback is preserved.
- Stripe Protected Payment remains **BLOCKED** until Seller readiness and
  Test-Mode PaymentIntent/Webhook verification are completed.
- GitHub Actions was not rerun because this RC round explicitly forbade
  Commit/Push; local workflow/script syntax checks passed.
- RC decision: **NO-GO for public production and browser-based limited-user
  testing**. API lifecycles remain useful for isolated diagnosis only, with
  Stripe and Google Places automatic search disabled. See
  `docs/B32-RESALE-V3-RC-REPORT.md` for the reproducible fingerprint and
  release checklist.

## 9. Privacy negative-path evidence

- Anonymous Interac order access returned HTTP 401.
- A synthetic, email-confirmed B32 outsider session returned HTTP 401 for
  Interac order read, payment report, and agreement read, and HTTP 403 for a
  forged handoff request. No private receiving email or order state was exposed.
- The outsider was created only in the isolated B32 project and was not used to
  modify any business record.

## 11. Final browser E2E pass (2026-11-08)

The real B32 browser run used Chromium with the existing Seller/Buyer
accounts, desktop and mobile viewports, and the isolated service on port 3034.
Google font and websocket requests were aborted only in the harness so the
page could render deterministically; no application data or business step was
mocked.

- Desktop Direct exchange: **BLOCKED** after real Listing → Contact Seller →
  Conversation → Make Offer → Seller Accept → Order creation. Opening the
  resulting Seller Orders workspace returned HTTP 403 `Order not accessible.`
  from `GET /api/orders?workspace=sales`; Agreement and completion could not
  be exercised. Direct signed RPC diagnostics showed `marketplace_order_detail`
  and `marketplace_order_snapshot_media` pass, while the workspace presentation
  projections `marketplace_order_economics`, `marketplace_order_meetup_history`,
  and `marketplace_campus_payment_state` return SQLSTATE 42501 because they
  still require `is_western_user()`.
- Desktop Interac: **BLOCKED** after the real conversation and offer. Seller
  Accept returned HTTP 503 `Unable to load Offers. Please retry.` from
  `POST /api/offers/{offer}/accept`. A signed RPC diagnostic reproduced
  SQLSTATE 23502: `null value in column "location" of relation "order_meetup_revisions"`; the active offer omitted `meetup_location`, which
  the current validator allowed even though the revision schema requires it.
- Mobile Interac: **BLOCKED** after the real mobile Buyer created the offer;
  the same Seller Accept endpoint reproduced the HTTP 503 failure.
- Mobile Direct exchange: **NOT TESTED** after the shared order-workspace
  blocker was found; no false PASS is claimed.

The initial browser “Attachment only” symptom was traced to five client-side
formal-flow gates that still recognized only the old Staging Supabase URL. The
B32 project ref is now accepted by the same fail-closed gates, so the real
browser displayed the `Make Offer` action. Those changes passed targeted
TypeScript, ESLint, `order-payment-ui`, `listing-contact-reuse`, and
`git diff --check` checks.

The two browser blockers are recorded as P1 release blockers. No migration,
database permission, Stripe payment, refund, transfer, payout, or production
configuration was changed in response.

The historical pre-010 proposal (now independently deployed to B32 as
remote version `20261109035046`)
`supabase/migrations/202611090010_resale_verified_order_projection_guards.sql`
contains the minimal fix: switch only the three read-only projections to
`is_verified_user()` while preserving participant checks, and reconcile the
optional on-campus `meetup_location` model by allowing NULL only on the
immutable revision-0 snapshot. The UI renders that state as “To be arranged”;
the existing proposal validator still requires a concrete location for later
meetup changes. Post-010 API rechecks show Seller Orders and Interac Accept
now return HTTP 200; full browser completion remains unverified.

The earlier HTTP 403/503 entries above are retained as pre-010 historical
evidence and are not the current post-010 API status.

## 12. Browser automation follow-up (2026-11-09)

The browser automation diagnosis used real B32 sessions on port 3045. Session
cookies were retained (`/api/auth/session` returned HTTP 200). The instability
was caused by asserting the Home shell during Next dev compilation and by
reading `router.query` before hydration for query-driven Home/conversation
routes. The fixture now waits for rendered markers and records URL, DOM,
screenshots, console/page errors, and HTTP responses.

Desktop and mobile Home Messages/Buying plus Orders/Purchases and Orders/Sales
navigation passed. Listing load and Listing -> Message Seller passed, with the
conversation route and API returning HTTP 200. Full Offer -> Accept -> Order ->
Agreement -> Completion flows remain **NOT TESTED** in this run because the
available fixture had prior active/replaced offers and no fresh unblocked
Interac offer was selected through the UI. The existing Profile activity 503
(`/api/profile/activity?period=7D`) is a Western-only analytics guard; the
non-critical `/api/listings/view` analytics call also returned 503. Neither
blocked navigation/conversation and neither was changed.

## 13. Migration 011 post-deployment browser acceptance (2026-11-09)

This section supersedes the earlier pre-011 Interac blockers above. Remote
migration history contains `20261109183845 interac_receipt_completion_history`.
No migration was applied or repaired in this test run.

### Real desktop and mobile browser results

The isolated B32 service ran on `http://localhost:3050` with
`.next-b32-interac-011-e2e`. Existing Seller and Buyer accounts and the two
already-open Orders were reused; neither Listing nor Order was recreated.

| Scenario                           | Result | Order                                  | Evidence                                                                                                                       |
| ---------------------------------- | ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Desktop Interac                    | PASS   | `4b4de7fb-efe2-41c4-b092-8da111085043` | Buyer Exchange 200, Seller Exchange 200, both refreshed UIs show Completed, external exchange confirmed, and receipt confirmed |
| Mobile Interac                     | PASS   | `1596f92f-1a59-4baf-bf50-160031686a71` | Same full browser result at the mobile viewport; both participant history reads returned 200 after completion                  |
| Desktop Direct (frozen regression) | PASS   | `45b97937-159c-4490-b6ca-e4fe0764f994` | Previously completed browser flow; post-011 duplicate Buyer/Seller exchange requests both returned 200/confirmed               |
| Mobile Direct (frozen regression)  | PASS   | `4ed36fc2-fe5b-421b-ba2c-3ec391ede78f` | Previously completed browser flow; shared local Direct regression remains green                                                |

The first Desktop evidence capture saw the Completed shell before its two
independent history projections had settled and recorded the initial
`External exchange: Unavailable` placeholder. A direct participant HTTP check
returned 200/confirmed for both roles. The Playwright fixture now waits for
Completed, confirmed external exchange, and receipt-confirmed Interac history
before capture; the one targeted retry passed. No application authorization
or business state was changed for this timing issue.

The recorded Buyer report and Seller receipt timestamps were unchanged before
and after completion and idempotency requests:

- Desktop: report `2026-11-09T08:36:58.410549+00:00`; receipt
  `2026-11-09T08:37:05.889346+00:00`.
- Mobile: report `2026-11-09T08:39:14.582325+00:00`; receipt
  `2026-11-09T08:39:19.961944+00:00`.

Both completed Orders remain `payment_status=pending`,
`payment_paid_at=NULL`, and `payout_status=not_eligible`. Remote read-only
checks found zero `campus_payment_attempts` and no `order_protection` row for
either Order. No PaymentIntent, Stripe Paid state, payout, or B31 hold was
created.

### Receipt gate and privacy negative acceptance

One independent negative fixture was created through normal Listing APIs and
browser transaction UI:

- Listing `acd33643-327b-4e07-93ae-6f8c32ef0164`
- Order `a6106031-127b-46af-8781-6bafe1389b04`
- Buyer Payment Report and both Agreements completed; Seller Receipt was
  intentionally omitted.

The participant history RPC returned 200 with `payment_reported` and
`sellerReceivedAt=NULL`. Buyer and Seller Exchange requests each returned 409
with the receipt precondition; the Order remained `open + pending`, with no
exchange attestation, payment attempt, protection row, or Paid timestamp.

For both completed Orders, Buyer and Seller history reads returned 200 and
`receipt_confirmed`. Re-report and re-receipt attempts after completion both
returned 403. Duplicate exchange confirmations returned 200/confirmed and did
not change the report/receipt timestamps.

Anonymous history access returned 401. The existing confirmed B32 outsider
account returned 403 for Order, fulfillment, and Interac history on both
completed Orders and the negative Order; the nullable receiving-email API
returned no address. No private order, reference, or receiving email leaked.

### Targeted checks and disposition

- TypeScript: PASS
- Targeted ESLint: PASS
- Local PostgreSQL migration/state-machine regression: PASS
- Order-domain API regression: PASS
- Payment UI regression: PASS
- `git diff --check`: PASS (existing line-ending warnings only)
- Native remote concurrent-session race test: NOT TESTED; sequential real
  Buyer/Seller requests and the database lock/trigger path were exercised.

Current decision: **GO for isolated B32 internal testing and a limited-user
Direct exchange + Interac trial**, with Stripe Protected Payment and Google
Places automatic search kept disabled. **NO-GO for full public production**
until a clean release tree, Production environment verification, and the
separately scoped Stripe/Places readiness work are complete.
