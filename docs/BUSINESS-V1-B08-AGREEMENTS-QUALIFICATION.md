# B08: Agreement implementation and local qualification

2026-10-19. Status: **Local implementation/validation complete — cloud acceptance
deferred.** No application defect was reproduced; no application/UI/database
implementation change or migration was necessary. B09 not started.

## Exact task and dependencies

Task breakdown B08/P0: qualify existing dual Agreement acknowledgements and legacy
backfill; reuse `order_agreements`, not a new table. Verify Buyer/Seller confirm the
same frozen terms, duplicate/concurrent confirmations, unpaid legacy cannot bypass,
and paid/fulfillment/history never regress. Exit: payment becomes current only after
both eligible confirmations; frozen terms are not editable.

B07 local Offer acceptance/media invariants are prerequisites. B07 real Staging
acceptance stays deferred under the final data-protection decision. B09 fulfillment,
external exchange/protection and B20+ real financial operations are not implemented
here. External Orders retain their existing no-Payment branch; B08 does not invent
a Payment stage for them.

## Existing architecture reused

- `components/home/formal-v2-order-detail.tsx`, `order-stage-details.tsx` and
  `order-current-step.tsx`: existing frozen terms review and role-specific confirm.
- `hooks/use-order-flow.ts`, `lib/order-flow-api.ts`, `lib/order-current-step.ts`:
  server read/refresh and authoritative current-stage derivation.
- `pages/api/order-domain/[id]/[operation].ts` and
  `lib/server/order-domain-service.ts`: GET agreement, POST confirm-agreement,
  authenticated session, same-origin write, empty allowed body, safe errors.
  Confirmation calls the session RPC, not a trusted financial resolver.
- `marketplace_order_agreement`, `marketplace_confirm_order_agreement`,
  `order_agreement_ready`, `create_order_agreement`, `guard_agreement_payment`:
  existing RPC/projection/guard, participant authority and Listing -> Order ->
  Agreement locks. Confirmation sets only the actor's null timestamp. Retrying
  preserves timestamps, without a new command UUID requirement.
- `marketplace_private.order_agreements`: terms digest, participant timestamps and
  preserved_progress; `orders`, `listings`, snapshots and notification projections
  remain their existing authorities.
- `202610150003_order_agreement_handoff_v2.sql`: Agreement creation/backfill and
  initial guards. `202610160005_dual_payment_paths.sql`: latest external/UU guards
  and fulfillment projection. `202610150007_notification_agreement_trigger_return.sql`:
  notification-only correction. Existing source-index/audit used only for B08.

## Actual changes

All additions are test evidence, not a second business implementation:

1. `tests/agreements-b08-db.cjs`: reuse the existing native PostgreSQL harness
   pattern/bootstrap and only B07 fixture helper declarations. Never execute B07's
   time-warp/trigger-disabling tests. Load real migrations, then B08 SQL and two
   independent authenticated connections with observed server lock overlap.
2. `tests/agreements-b08-db.sql`: actual Accept -> Agreement fixtures, participant
   authorization, no-auth/unverified/outsider denial, timestamp replay, transaction
   rollback, notifications once, closed Order denial, UU pre-confirmation payment
   rejection and no Order/payment/media/inventory mutation. Local Seller readiness
   is a trusted fixture only; it does not call Stripe or certify provider readiness.
3. `tests/agreements-b08-backfill.sql`: ten historical-state temporary projection
   fixtures. Execute the actual migration backfill statement and actual readiness
   SQL with only relation names rebound to these fixture tables. Cover unpaid,
   processing, paid, refunded, paid timestamp, closed, delivery started, shipment,
   handoff and Protection; verify unchanged source payloads and stale digest denial.
   This is SQL rule qualification, not an upgrade against historical user Orders.
4. `tests/agreements-b08-api.cjs`: actual API/service with offline mocked transport;
   Agreement route/params, forged timestamp/terms/payment/body denial, invalid UUID,
   session/CSRF/environment errors, error redaction and safe repeat/retry. No network.
5. `tests/agreements-b08.browser.cjs`: existing real UI/fixture builders, fresh
   scratch root for every run. HTTP blocked; no shared artifact overwrite/deletion.
   Buyer confirmation waits; only both confirmations advance to Payment at all five
   widths. It does not modify real components or claim cloud persistence.
6. This report and the B08 task progress entry.

## Isolation and data safety

The native runner uses the existing local testing infrastructure: `mkdtemp` under
ignored `tests/artifacts/agreements-b08-db-*`, random `127.0.0.1` port and explicit
host/port/database/user for every psql operation. Inherited PG connection variables
are removed. It reads no environment file and invokes no Supabase CLI. It never
connects to or resets an existing development database. Its own temporary server
stops in finally; test artifacts are retained rather than deleting existing files.
No new persistent database, cloud project, branch or deployed environment is made.

Auth/Storage/Realtime are local stand-ins. Cron registration is inert, external
HTTP/Vault transport migrations are excluded, and all recipients disable email in
local fixtures. No immutable-history trigger is disabled. Payment-start calls only
exercise rejection before dual confirmation; no attempt/provider/resolver/payment
success executes. The closed-state case uses an ordinary local external Order
cancellation with zero attestations; assertions verify no settlement authorization,
payment attempt or outbound email delivery. No real financial operation occurs.

No Staging/Production access, historical media reads, user-data cleanup, demo data
generation or Git mutation occurred. All user Listings/cards/data remain untouched.

## Results

| Acceptance area | Result / evidence boundary |
| --- | --- |
| Same frozen terms, both actor confirmations | PASS native RPCs and digest; one actor never confirms the other |
| Duplicate/replayed/lost-response requests | PASS unchanged timestamps and fresh-connection reads |
| Concurrent Buyer/Seller and duplicate Buyer | PASS two native sessions; second connection observed waiting on Lock before release |
| Unauthorized/no-auth/unverified/direct private access | PASS native SQL roles and API boundary tests |
| Failure rollback and retry | PASS transaction rollback leaves no confirmation/notification; API errors redact internals and retry routes correctly |
| Immutable Order/history/media/inventory | PASS full Order baseline equality, held Listing pointer and two snapshot bindings unchanged; immutable triggers remain enabled |
| Payment gate | PASS actual payment-start RPC rejects before either/both eligible acknowledgements; confirmation itself never starts payment |
| Legacy unpaid cannot bypass | PASS unpaid/processing backfill projections remain false; actual readiness SQL checks frozen digest |
| Preserve paid/fulfillment/history | PASS ten-case native backfill/readiness projection plus existing current-stage derivation regression; not a live historical migration replay |
| Existing UI integration | PASS offline browser at 390/430/820/1280/1536, no overflow and role waiting/dual-confirm advancement |
| Real Supabase/Auth/Storage/Realtime/refresh-relogin | NOT EXECUTED — CLOUD ACCEPTANCE DEFERRED |

Commands passing:

- `node tests/agreements-b08-db.cjs`: real local PostgreSQL prerequisites,
  sequential assertions, ten-case backfill/readiness and two lock-observed races.
- `node tests/agreements-b08-api.cjs`.
- `node --openssl-legacy-provider tests/agreements-b08.browser.cjs`.
- `node tests/order-domain-api.cjs`, `node tests/order-current-step.cjs`,
  `node tests/offer-accept-static.cjs`, `node tests/order-snapshot-media.cjs`,
  `node tests/offers-b07-api.cjs`, `node tests/offer-terms.cjs`.
- Application TypeScript `--noEmit --incremental false`; focused ESLint;
  `git diff --check` (line-ending notices only), plus explicit new-file whitespace
  and encoding checks and focused JavaScript formatting checks.

New browser harness first lacked require.resolve forwarding (corrected only in that
new harness), then installed Webpack hit Node 24 OpenSSL compatibility. The documented
process-local legacy-provider flag allowed bundling; no dependency/app/security
configuration was edited. No old test or business assertion was removed/weakened.

## Remaining B08 boundary

Managed cloud execution and real two-device refresh/re-login remain unverified.
Creating accepted Orders for that test would leave immutable Offer/Order/events,
frozen economics, Agreement timestamps, bound media and notification history.
The user explicitly rejects that new permanent Staging history. Do not execute or
repeat the permission request as a workaround; do not create another environment.
No current UI/database change approval is needed because none is proposed.

B08 is locally qualified, not fully cloud accepted. Preserve B07's deferred status
and all existing data; stop here without beginning B09.
