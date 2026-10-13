# Locked backend completion pass — staging

Target: `western-marketplace-staging` / `pcaqxezdfxofysghssyo`.
Checkpoint policy (2026-10-13): **PROVIDER-INDEPENDENT BACKEND: COMPLETE / VERIFIED**.
**EXTERNAL INTEGRATIONS: DEFERRED. FRONTEND PRODUCT POLISH: FUTURE.**
**REAL-MONEY PAYMENT NOT YET INTEGRATED.** See the
[external integrations backlog](EXTERNAL_INTEGRATIONS_BACKLOG.md).
This record supersedes the older D2A stop boundary for the explicitly authorized
backend pass. No provider was selected. No frontend redesign was performed.

## Implemented domain authority

- Delivery Offers require `delivery_area` containing `country_code`,
  `province_code`, `city_label`, and `postal_prefix`. Canada/FSA normalization is
  server-side. Counter/Revise creates a new immutable Offer version; Accept freezes
  the area into the existing Order terms snapshot.
- `marketplace_private.v2_order_economics` freezes item, delivery, Buyer fee,
  Buyer total, Seller gross and zero Seller platform fee during Order creation.
  The existing integer-cent rounding helper calculates 4% of item only, minimum
  100/max 1500 cents. Delivery is excluded from that percentage base. No historical
  Order or V1 financial columns were rewritten.
- One shared payment-attempt authority retains the existing `campus_payment_attempts`
  name for compatibility. Both fulfillment types use `marketplace_start_order_payment`;
  the old campus RPC is a constrained wrapper. Payment start enters Processing,
  while the separate trusted staging resolver establishes Paid/Failed. No real money
  is charged. Frozen economics are available through participant-only projection.
- Seller-origin Delivery starts one 30-minute checkout at Accept. Buyer-origin
  Delivery has one 12-hour claim, then one 30-minute checkout. Refresh/retries never
  extend either timestamp. Unpaid expiry releases inventory; Processing retains it
  until authoritative reconciliation. Exact Buyer address must match accepted
  country/province/FSA, is frozen when payment starts, and is unavailable to Seller
  before Paid. City-label equality is not authority. No address enters events or
  Notifications. On Campus still has no Accept-to-payment countdown.
- One paid-only handoff authorization supports independent random 256-bit QR token
  and random six-digit fallback. Credentials are encrypted with an owner-only
  private random key; verifier digests are HMACs. Only Buyer can retrieve credentials;
  only actual Seller can redeem. Either channel invalidates both. Five numeric
  failures within ten minutes lock numeric verification for fifteen minutes; QR
  remains usable. No arbitrary credential expiry was introduced.
- Trusted possession starts exactly one 24-hour Protection period. Buyer may open
  one unresolved, allowlisted Protection case before expiry. Case hold prevents
  completion and payout eligibility; no verdict/refund is fabricated. Mature,
  unheld Protection alone permits Completed / Listing Sold / payout Eligible.
  Accepted Offer history remains Accepted. Payout eligibility is not execution.
- Courier Seller shipment/tracking is informational. A service-role staging
  trusted-Delivered boundary and actual Buyer Confirm Received independently start
  Protection once. Courier has no handoff codes and no real carrier integration.
- Notifications reuse transaction events and a small private durable projection
  table. Participant destinations, exact priorities, actor suppression, incoming
  Offer/Counter, checkout, handoff, delivery, Protection, completion and payout
  projections are persisted. Protection notices coalesce with useful possession
  notices. Favorites Price Drop notifications preserve first/latest prices and
  coalesce while unread; Favorites do not create availability subscriptions.
- Confirmed-schedule revision identities prevent stale meetup reminders. Only
  future 24h/1h thresholds are scheduled. Delivery has one 1h claim reminder and
  one 10m payment reminder. A single `run_transaction_due_work` entry serializes
  overlapping scans and uses domain locks/server time. Staging pg_cron runs it
  once per minute. It processes V2 only, preserving manual V1 history.

## Server surfaces and maintenance

`/api/notifications` is a session-authenticated, no-store feed/mark-read surface.
`/api/order-domain/:id/:operation` exposes participant projections and bounded
checkout/address/payment-start/handoff/case/shipment/received operations. Writes
require same-origin CSRF protection. Callers cannot supply financial authority or
invoke a Paid resolver. Credentials occur in response bodies/POST bodies, never
URLs, events, logs or browser bundles. Every new server surface fails closed unless
configured for the exact staging project.

The existing optimized main application remains on localhost:3000. The independent
qualification build is ignored under `tests/artifacts/backend-completion-build`.
The only component compatibility change adds the existing Completed status label;
there is no new visual flow, Maps, feed/Bell polish or Agreement Card work.

The private-media orphan sweep reuses its existing bounded lease/verification
implementation. For explicit local staging maintenance:

```sh
node scripts/staging-backend-worker.cjs --once
node scripts/staging-backend-worker.cjs
```

The latter performs due-work each minute and private-media sweep hourly. The hosted
transaction cron does not depend on that local process. Do not run the worker with
production configuration; it checks exact project and service-role claims and
never prints keys. This pass does not provision a hosted media-deletion executor.

**PRIVATE MEDIA CLEANUP DOMAIN: COMPLETE.** Eligibility uses a 24h orphan TTL;
deletion leases expire/reclaim, bound media cannot be claimed, and finalization
checks object absence and valid lease ownership. The local/manual worker path exists.
**HOSTED MEDIA CLEANUP EXECUTOR: DEFERRED EXTERNAL/OPS INTEGRATION.** Under the
2026-10-13 policy, this accepted operational deferral does not block the checkpoint.
No hosted media-cleanup deployment or local continuous-worker qualification is claimed.

Staging DB lint must use `node scripts/staging-backend-lint.cjs`. Its exact-target
guard rejects missing/production refs and connection overrides before spawning
the CLI; `node tests/staging-target-guard.cjs` tests rejection without network.
Do not use an unqualified `db lint --linked` command.

## Additive migrations

All nine migrations are applied exactly once to staging. Deployed latest bodies,
empty search paths, private RLS and the scheduler were inspected read-only.
Already-applied migration sources/history were not rewritten.

| Migration | SHA-256 | Purpose | Staging status / occurrences |
| --- | --- | --- | --- |
| `202610130001_notifications_domain.sql` | `885b9a5af2421c46edcfd2f8b042cee9bc605487963f7e832e3e8fbcb06d5a13` | Notification persistence/RLS/Price Drop | Applied / 1 |
| `202610130002_delivery_area_economics.sql` | `af956ece51c84be13f43c45dd0b1bf8763c6a310971445c59ba615139439c007` | Coarse area and frozen integer-cent economics | Applied / 1 |
| `202610130003_delivery_checkout_payment.sql` | `6d50b7c6f8e76fa67ed61eb83ee0bee436dc5690340144d2b09e95a3d589ca62` | Private address, checkout clocks and shared Payment | Applied / 1 |
| `202610130004_handoff_protection.sql` | `0aac5f226cc4007ce5174e296a6768442d26036d1516a3f258907b6538546c50` | Single-use handoff and Protection/case/completion | Applied / 1 |
| `202610130005_courier_possession.sql` | `9c00899d801e5243d4d11702e0510bed441ceb29a0e43d2065137ecef94c64e5` | Trusted Courier/Buyer possession boundary | Applied / 1 |
| `202610130006_notifications_due_work.sql` | `4f91078777b8ab0215c1a29958eafa889085eed0f6f024d92b55fd0261a89dfb` | Event fanout, reminders and idempotent due-work | Applied / 1 |
| `202610130007_staging_due_work_schedule.sql` | `d77596b564c49adec764ee2612325b96cf5be5f9fffa79234ac6e904c41032c1` | Hosted staging minute transaction cron | Applied / 1 |
| `202610130008_backend_volatility.sql` | `da285bbabe22c620856875254f01701c37510053aaf530ded6d14c6759130fcf` | New helper/projection volatility correctness | Applied / 1 |
| `202610130009_payout_notifications.sql` | `2ac9c8ee4550e1edddc1f893d56e9a1f4a44554e3428a1e9583f01966290b652` | Payout status/attention notification projection | Applied / 1 |

## Qualification

Rollback-only suites cover normalized area, fee minimum/cap/rounding, frozen
economics, private-address matching/visibility, one-time checkout, Processing
inventory safety, handoff rate limits/replay/participant permissions, exact-once
Protection, case hold/completion, Courier possession, notification recipient and
reminder rules, and price-drop coalescing. Every synthetic graph rolls back.

Fourteen real overlapping independent-transaction tests passed: repeated duplicate
handoff, QR versus fallback, case-first/completion-first, checkout-first/expiry-first,
and Processing/Paid reconciliation in both orders. Distinct PID/XID and lock waiting
were observed. Zero deadlocks, lock timeouts or invariant failures. Exact synthetic
cleanup restored the canonical/manual/media fingerprint and minute job.

Seven further overlapping runs passed: Pending Payment before/after deadline in
both winner orders (repeated), Cancel versus shared Payment in both orders, and
overlapping worker scans. Total: 21 qualified concurrent runs, zero deadlocks,
lock timeouts or invariant failures. No Paid+Cancelled or Paid+Available outcome
was observed. Worker completion/event cardinality remained one. A transient
private-media fixture upload interrupted one attempt; its synthetic graph was
cleaned and the full deadline suite subsequently passed without transaction retries.

The deployed archive SHA matches each local migration byte-for-byte; 41 latest
function bodies, empty search paths and 13 private RLS tables were verified. The
minute job is restored active. Final explicit staging DB lint has no errors and
only the two pre-existing order_money volatility warnings. No legacy helper was
auto-fixed. Standard git diff --check passes; untracked new source whitespace is
checked separately. A core.autocrlf=false diagnostic produced CRLF-only false
positives and is not the repository's normal validation command.

D1 terminal participant-FK retention regression also passed with exact synthetic
cleanup and unchanged canonical/manual/media fingerprint. Final read-only staging
counts for V2 Offers/Orders, synthetic Listings, media batches, checkout, handoff,
Protection, cases and Notifications are zero; one minute job remains active.
Temporary credential/session/SQL diagnostic journals were deleted after verifying
their resolved workspace path. Git index remains empty. 418 local documentation
links pass; no commit-eligible privileged token/credential was detected.

Local API/security, Auth/session, TEXT/IMAGE/Realtime, Offer/Accept, D1/D2A static/API,
financial-environment guard regressions, TypeScript/focused lint and optimized
staging build passed. Browser bundle scan found no privileged/session JWT or
service-role variable and verified the staging endpoint. Old Auth database tests
requiring unavailable `@electric-sql/pglite` were not claimed passed in that
original completion pass. The final checkpoint separately provisioned PGlite
0.5.9 under ignored `tests/artifacts/checkpoint-db-runtime`; five local database
suites now pass (security/RLS, username, pending ownership, foundations and taxonomy).
No application dependency or lockfile was changed for this test runtime. Global
GlideSelect parser technical debt remains unchanged.

## Scope incident and safety

One DB lint invocation accidentally omitted `--project-ref` and used the repository's
production link. It performed read-only lint, not migrations or data writes. Its
result was discarded, and lint was rerun with explicit staging ref. Therefore this
pass cannot claim production was never accessed. Production received **no writes**.
All migration/query/test operations otherwise use explicit staging ref or a guarded
staging URL/service-role identity. `.env.local` was not modified. Manual/Nike
historical samples were not used for progression or destructive testing. No emails,
commit, push, hosted frontend deployment or real provider operations occurred.

## Final checkpoint qualification (2026-10-13)

Under the revised policy, the provider-independent/domain backend is qualified;
the explicitly deferred integrations in the backlog do not block this checkpoint.
No new domain, UI, migration or provider implementation was added during packaging.
Changes in this review are documentation, target-guard/audit tooling, safe test
failure classification and Git artifact/byte-preservation rules.

- TypeScript without incremental output, focused ESLint across every changed/new
  TypeScript file, and an isolated optimized staging-configured build pass.
- 39 local suites pass, including five standalone PGlite 0.5.9 database suites;
  Auth/session, TEXT/IMAGE/Realtime, V1 Request/Accept/cancellation, V2 Offer/Accept,
  D1/Payment, presentation compatibility and environment/security checks pass.
- All nine deployed backend SQL suites pass in synthetic rollback transactions.
- The 14-domain and 7-deadline concurrency suites were rerun completely: 21 fresh
  qualified runs, independently observed PID/XID/lock overlap, zero deadlocks,
  lock timeouts or invariant failures. The overlapping worker skips its second scan.
  An earlier fresh attempt was interrupted during media fixture preparation after
  transport retries; it was not counted as passing. Scoped cleanup ran, and the
  complete domain suite subsequently passed. No database-race retry masks failure.
- Fresh real V1 Accept/payment/cancel/release and D1 scheduling/rescheduling/no-show
  regressions pass. Canonical/manual/media fingerprints match before and after
  each destructive suite. Nike remains the existing Expired V1 Order.
- Final read-only residue counts are zero for V2 Orders/Offers, synthetic users/
  Listings, media batches/objects, checkouts, handoff, Protection/cases and
  Notifications. The three canonical V1 Orders remain two Cancelled and one Expired.
- Explicit staging inventory has no pending migration. All nine archives/raw local
  hashes, 41 deployed bodies/search paths and 13 private RLS tables match; minute
  transaction cron is active. No migration is applied in this checkpoint review.
- Guarded staging lint has no errors; only the two historical order_money warnings
  remain. Production-target/missing-target/override rejection is tested without
  network; actual archival callback evaluation preserves SQL `$$` byte-for-byte.
- Browser scan covers 46 files and verifies the staging endpoint with no privileged
  or session JWT/key exposure. Commit-eligible files and documentation links are
  scanned by `tests/backend-checkpoint-security.cjs` without printing private values.
- `.gitattributes` preserves this checkpoint's already-applied migration bytes;
  `.gitignore` excludes generated TypeScript build caches. `tsconfig.tsbuildinfo`
  is removed from tracking, not treated as implementation source. Credentials,
  environments, SQL diagnostics, fixtures and build/browser artifacts are excluded.
  The previously applied cancellation migration's extra EOF newline is preserved
  with a per-file whitespace declaration; its SQL is not rewritten. Only test SQL
  EOF whitespace is trimmed. Final staged diff checks pass and all 26 migration
  blobs equal their original working-file bytes, including the nine recorded SHAs.

The original production read-only incident above remains part of the historical
record. This review does not contact production or modify `.env.local`. No emails,
real money or hosted frontend deployment occur. One local checkpoint commit is
authorized after final index validation; no push is authorized.

## Final outcomes

IMPLEMENTED AND VERIFIED: the defined provider-independent transaction domain and
notification/deadline backend on staging. Backend interfaces are qualified, not
real-money/provider integrations. Existing frontend Delivery editing does not yet
collect the new required coarse area; no placeholder or silent default was injected.
Delivery UX wiring belongs to the subsequent frontend pass.

BLOCKED BY EXPLICIT DECISION: real providers and full dispute/refund policy below.
NOT IN THIS BACKEND PASS: frontend polish, Maps, Agreement Card, feed/Bell visual UI.

## Explicit boundaries

- REAL PAYMENT PROVIDER DECISION REQUIRED.
- REAL PAYOUT PROVIDER DECISION REQUIRED.
- CARRIER PROVIDER INTEGRATION REQUIRED for real trusted carrier events; Buyer
  Confirm Received remains an independent possession authority.
- FULL DISPUTE/REFUND POLICY DECISION REQUIRED. Cases remain RESOLUTION_REQUIRED.

Provider-independent interfaces describe session/intent, idempotency references,
webhook verification, reconciliation, authorized refunds and payout execution; no
provider implementation, real charge, refund allocation, tax treatment or provider
fee allocation is invented. Bell/feed polish, Maps, Agreement Card and unrelated
frontend work are not in this backend pass.
