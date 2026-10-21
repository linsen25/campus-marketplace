# B09: local transaction authority qualification

2026-10-19. **Local validation complete — cloud and scheduler acceptance deferred.**
The narrowly authorized browser locator correction passed. This is not full
Completed status; unexecuted transaction acceptance cases remain listed below.

## Exact scope and existing authority

Task breakdown B09/P0: qualify existing external exchange plus UU Pay fulfillment,
Protection and cancellation, independently of a real provider. External one-sided,
dual, dispute, cancel and expiry races must preserve inventory; external has no
Paid, fee, QR, Protection or payout. UU Pay role/time gates, handoff lockouts,
Courier receipt and due worker use current records/functions. Exit requires exact
held/released/Sold invariants and immutable attestations; no invented Seller report
privilege. B08 is the direct dependency; real provider work belongs to B20+.

Reused components and services: `OrderCurrentStep`, `OrderFlowCancellation`,
`FormalV2OrderDetail`, `AgreementCard`, `useOrderFlow`, `order-flow-api`,
`order-current-step`, the existing `/api/order-domain/[id]/[operation]` handler,
`order-domain-service` and `/api/orders` cancellation service. No component changed.

Existing RPCs: `marketplace_confirm_external_exchange`,
`marketplace_dispute_external_exchange`, `marketplace_external_exchange`,
`marketplace_cancel_order`, `marketplace_start_order_payment`,
`marketplace_resolve_campus_payment` (local simulator only),
`marketplace_start_seller_delivery`, `marketplace_generate_handoff_qr`,
`marketplace_handoff_credential`, `marketplace_verify_handoff`,
`marketplace_open_protection_case`, `marketplace_record_courier_shipment` and
`marketplace_confirm_courier_received`. No duplicate state machine was introduced.

Tables: existing Orders/Requests/Listings/events, external_exchanges,
v2_order_economics, order_flow_commands, campus_payment_attempts, delivery_checkouts,
seller_delivery_starts, handoff_authorizations, protection_cases/order_protection,
courier_shipments, buyer_receipt_commands, media and notification projections.

Sources: `202610160005_dual_payment_paths.sql`,
`202610140002_order_cancellation_settlement.sql`,
`202610150003_order_agreement_handoff_v2.sql`,
`202610130004_handoff_protection.sql`, `202610130005_courier_possession.sql`,
`202610130006_notifications_due_work.sql` and the already-existing
`202610180001_transaction_scheduler_alias_fix.sql`. No migration was edited/added.

## Findings and changes

No application business defect was reproduced by the executed tests. Missing
runtime evidence was addressed with tests; unexecuted time/cloud cases remain gaps.
Application files changed: **NONE**. UI changes: **NONE**.

Added:

- `tests/transactions-b09-db.cjs`: established native PostgreSQL harness pattern,
  current migrations, existing B07 fixture helper declarations only, two-session
  races with server-observed Lock wait. Does not execute old B07 time-warp tests.
- `tests/transactions-b09-db.sql`: external attestations/dispute/cancellation,
  authorization, local-only UU simulator fixtures, handoff/Protection roles and
  Seller delivery/Courier transitions; no scheduler or clock mutation.
- `tests/transactions-b09-static.cjs`: source contracts for scheduler lock/alias,
  reminder idempotency/external exclusion and mature-unheld Protection. Source
  assertions do not prove scheduler or maturity execution.
- `tests/transactions-b09.browser.cjs`: execute the existing dual-payment browser
  assertions using a fresh ignored scratch root, preserving previous artifacts.
- This report; task progress and confirmed Shop Contact planning rule.

## Actual verification

| Criterion | Result and limit |
| --- | --- |
| External single confirmation / duplicates | PASS native RPC: stable attestation, pending financial status, cancellation/expiry eligibility closes |
| External dual confirmation | PASS native RPC: Completed/Sold, release hold, no Paid/payout, zero fee |
| External disagreement | PASS native RPC: counterparty attestation required, replay stable, no completion/cancel, inventory held |
| Zero-confirmation cancel / stale confirm | PASS native RPC: cancel releases own pointer; later confirm denied |
| External private authority | PASS authenticated outsider/no-auth denial and private table access denial |
| External concurrency | PASS six actual two-connection lock-observed races: dual confirms, same actor, both orders of confirm/cancel, both orders of dispute/second confirm |
| External no QR/payment/financial Protection | PASS native rejection/no-created-record assertions; no financial provider |
| UU handoff roles / lockouts | PASS local simulated Paid: Buyer secret, Seller verifier; numeric failures persist/lock; QR remains independent; redemption/retry locks both channels |
| UU Protection | PASS exact 24-hour start, Buyer-only case, Seller denied, case replay, post-handoff cancel denied; no early completed/payout |
| Seller delivery | PASS local simulated Paid: Buyer cannot start, QR gated until Seller starts, milestone replay, then handoff |
| Courier | PASS local simulated Paid: no QR, Seller-only shipment/replay, shipment alone no Protection, Buyer-only receipt/replay starts Protection once |
| Due worker / mature-unheld conditions | PASS source contract only; scheduler and actual mature settlement NOT EXECUTED |
| Natural Meeting expiry / expiry races / timed Protection completion | NOT EXECUTED: no clock rewrites, trigger bypass, manual scheduler or 24-hour wait. Eligibility tests are not actual expiry execution |
| Cloud Auth/Storage/transactions/refresh-relogin | NOT EXECUTED — CLOUD ACCEPTANCE DEFERRED |

Native command `node tests/transactions-b09-db.cjs` PASS on the final suite,
including Seller delivery/Courier assertions. Earlier native run also passed before
those two cases were added; only final-suite results are used above.

Offline PASS: `transactions-b09-static.cjs`, `dual-payment.cjs`,
`order-domain-api.cjs`, `order-current-step.cjs`, `handoff-qr.cjs`,
`order-cancellation.cjs`, `offer-accept-static.cjs`. These do not invoke Supabase.
Application TypeScript and focused ESLint PASS.

After the approved locator correction, the final native B09 suite and all seven
listed offline regressions were rerun and PASS. Application TypeScript, focused
ESLint (including the modified old browser test) and `git diff --check` PASS;
the latter emitted only existing line-ending notices. Explicit documentation/new
file encoding and whitespace checks PASS. The scratch PostgreSQL server stopped
successfully and its runner exited zero. No existing test artifacts were deleted.

Browser command:
`node --openssl-legacy-provider tests/transactions-b09.browser.cjs`.
Initial run: 390 PASS; 430 FAIL in the old test locator after switching to
AgreementCard; later widths were not executed in that initial run. Following the
user's narrow approval, a 430-only run PASS preceded the complete five-width run:
390/430/820/1280/1536 all PASS. All original scenario assertions were retained.

The old `tests/dual-payment.browser.cjs` calls `window.showExternalAgreement()`
(React root.render), then immediately waits on an unscoped exact-text locator for
`Paid outside UU · No UU payment protection`. Before React commits the new card,
the current approved Order page can have two matching paragraphs: its top marker
and Current Step explanation. Playwright raises a strict-mode violation. This is
not evidence of a business failure or authority to change/remove UI copy.

Under explicit narrow approval, only the target block in the old test changed:
locate `[data-agreement-status="open"]`, wait until visible, assert its count is
exactly one, then run the unchanged exact-text/visibility wait inside it. The real
AgreementCard root defines this attribute from agreement.status. No first/nth,
skipped assertion, wording change, component or application change was used.
The single-width run selected 430 in memory through the existing isolated wrapper,
without editing its width list or overwriting existing artifacts. Its initial
temporary command had a relative require resolution error before browser startup;
only that temporary command was corrected, not a project loader or dependency.

New source-check harness initially used substring matching for `r.conversation_id`,
which also matched the suffix of `due_offer.conversation_id`; corrected only this
new test to a word-boundary regex. No product change or old assertion weakening.
Unused copied imports in the new browser wrapper were removed for ESLint.

## Isolation and safety

Only established isolated local PostgreSQL infrastructure was used: unique
`tests/artifacts/transactions-b09-db-*` directory, random loopback port, explicit
host/port/user/database, inherited PG variables removed, server stopped in finally.
No existing development database was connected/reset. No env file/Supabase CLI,
remote endpoint, historical media, user account or pre-existing test data accessed.
No new persistent environment was provisioned. Scratch artifacts are retained.

Auth/Storage/Realtime are local stand-ins; auth.jwt is a test-only local claims
projection. The literal Staging ref in a local simulator claim satisfies its
existing guard inside this isolated database; it is not a remote connection.
UU outcomes are **test-only simulated state**, never real payments/refunds/payouts.
Cron is inert and email transport excluded; local recipients disable email.
No immutable trigger was disabled, existing clock changed or scheduler invoked.
No old hosted scripts with trigger disabling or manual due-work were executed.

## Confirmed Shop rule recorded, not implemented

The existing Shop task-planning section now records: no standalone Contact Shop
from storefront; Contact Seller only through a specific Listing; retain Listing
identity/authorization and existing Messages backend, no Shop-ID-only conversation
or duplicate messaging tables. Backend enforcement belongs to later approved Shop
tasks. User owns UI control removal. No Shop UI/application edits during B09.

## Remaining boundary and status

The authorized browser locator correction is complete; no approval remains pending
for that change.
Timed expiry/races, mature Protection completion and due-worker execution remain
unverified under current no-clock-rewrite/no-manual-scheduler limits. Do not claim
these passed or silently invoke the worker; a separate bounded local validation
plan would be needed. Do not request shared-Staging transaction fixtures: actual
Accept/fulfillment would create prohibited immutable Order/event/economics/media
and notification history. No extra environment or historical-media workaround.

B09 status is **Local validation complete — cloud and scheduler acceptance deferred**,
with native/offline/browser checks PASS and explicit unexecuted cases. All existing Listings,
cards/data preserved; no Staging writes, Production, UI, real money/email, Git
stage/commit/push/reset/clean or B10. Stop after this report.
