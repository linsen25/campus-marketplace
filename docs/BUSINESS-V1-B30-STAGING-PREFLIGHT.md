# Business V1 B30-B — Staging Read-Only Preflight

Status (2026-10-24): **B30-B READ-ONLY PREFLIGHT COMPLETE — DEPLOYMENT NOT STARTED.**

## Scope and evidence boundary

This report covers metadata-only inspection of Supabase project
`western-marketplace-staging` (`pcaqxezdfxofysghssyo`). Every project-targeted
remote call used that explicit ref. The project inventory also returned a separate
inactive project, but no database, configuration, logs or API call was targeted at
that ref. No Production database was accessed.

Remote SQL was executed only inside explicit `BEGIN TRANSACTION READ ONLY` /
`ROLLBACK` blocks and returned `transaction_read_only = on`. Queries inspected
catalogs and bounded operational metadata only. No business RPC, worker, cron,
webhook, user row, message, order, financial detail, Storage object or Vault secret
value was read or executed.

The verified project reports:

- Name: `western-marketplace-staging`
- Project ref: `pcaqxezdfxofysghssyo`
- Region: `us-east-1`
- Status: `ACTIVE_HEALTHY`
- PostgreSQL: `17.11`
- Project API origin: ref-matching Supabase project URL

## Migration reconciliation

| Classification                    |        Count | Evidence                                                               |
| --------------------------------- | -----------: | ---------------------------------------------------------------------- |
| Local migrations                  |           92 | Local filenames; all versions unique in B30-A                          |
| Staging registered migrations     |           79 | Supabase migration metadata                                            |
| Registered locally and remotely   |           79 | Version/name comparison                                                |
| Local but not registered remotely |           13 | B24–B29 tail below                                                     |
| Remote but absent locally         |            0 | Version/name comparison                                                |
| Version/name mismatch             |            0 | Version/name comparison                                                |
| Remote SQL byte hashes            | NOT VERIFIED | Migration metadata does not provide a trustworthy original-byte digest |

The 18 B21–B29 deployment candidates from B30-A now divide as follows.

### DEPLOYED by version metadata (5)

1. `202610200002_order_payment_intent_start.sql`
2. `202610210001_order_payment_reconciliation.sql`
3. `202610210002_order_refund_operations.sql`
4. `202610210003_order_refund_observations.sql`
5. `202610210004_order_refund_event_integration.sql`

Their expected B21–B23 tables, columns, indexes and service-only RPCs are present.
This proves installed object compatibility, not byte-identical SQL archives. Their
remote source hashes remain **HASH NOT VERIFIED**.

### MISSING / expected not yet deployed (13)

1. `20261022041410_order_seller_transfer_operations.sql`
2. `20261022073253_order_transfer_observations.sql`
3. `20261022110000_connected_payout_observations.sql`
4. `20261022194401_stripe_dispute_observations.sql`
5. `20261022202042_operational_case_foundation.sql`
6. `20261023010212_operational_recovery_audit.sql`
7. `20261023015435_shop_transaction_admission.sql`
8. `20261023030000_shop_suspension_lifecycle.sql`
9. `20261023173802_authoritative_shop_provider_notifications.sql`
10. `20261023190043_worker_runtime_reliability.sql`
11. `20261023224905_worker_observability.sql`
12. `20261024012808_resale_discovery_query.sql`
13. `20261024052628_notification_filtered_pagination.sql`

This is an expected deployment gap, not a current Staging schema failure. No
migration was applied.

## Schema, RLS and ACL findings

### VERIFIED metadata

- All 16 current `public` tables and all 48 current `marketplace_private` tables
  have RLS enabled.
- `anon` and `authenticated` have no direct table grants in
  `marketplace_private`.
- `anon` has no executable private-schema function.
- `authenticated` has private-schema `USAGE` only for the existing narrowly scoped
  helpers `is_western_user`, `shop_profile_text_length` and
  `valid_meeting_reference`; no private financial function is executable.
- Every inspected `SECURITY DEFINER` function in `public` and
  `marketplace_private` has an explicit fixed `search_path`; no missing-search-path
  definer was found.
- B21 Payment, B22 Reconciliation and B23 Refund RPCs are not executable by
  `anon` or `authenticated`; expected entry points are executable by
  `service_role` only.
- `profiles.id` retains an FK to `auth.users`.
- The three B14 Shop Conversation/Offer/Order INSERT guards are installed and
  enabled.
- B26 Shop Transaction Admission is not installed because its migration is still
  pending. Therefore the existing B14 guards remain fail-closed; no database
  admission row exists to enable Shop transactions.
- B24 Transfer, Payout observation, B25 Dispute/Operational Cases, B28 receipts and
  B29 query objects are absent exactly as expected from the pending migration set.

### STATIC REVIEW ONLY / B30-C REQUIRED

Catalog inspection does not prove real `anon`, owner, other-user or
`authenticated` request behavior. Cross-account API/RLS tests, current-session
claims and actual service-role project fencing require isolated B30-C accounts.

## Storage, Realtime and Auth

| Component                              | Result                                                                              | Classification               |
| -------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------- |
| `listing-images`                       | Exists, `public=true` for legacy media                                              | DEPLOYED                     |
| `listing-images-private`               | Exists, `public=false`                                                              | DEPLOYED                     |
| `profile-avatars`                      | Exists, `public=false`, WebP-only                                                   | DEPLOYED                     |
| `chat-images`                          | Exists, `public=false`                                                              | DEPLOYED                     |
| `order-snapshot-media`                 | Exists, `public=false`                                                              | DEPLOYED                     |
| Storage object policies                | Owner/service boundaries and private guard policies present                         | DEPLOYED / metadata verified |
| Realtime Postgres Changes publication  | No UU tables published                                                              | EXPECTED DISABLED            |
| Private Realtime Broadcast             | `realtime.messages` RLS, authenticated receive and restrictive write fences present | DEPLOYED                     |
| Auth/Profile binding                   | `auth.users` exists; Profile FK present                                             | DEPLOYED                     |
| Auth email/password/dashboard settings | Not exposed by the permitted DB metadata path                                       | NOT VERIFIED                 |

No Storage bytes were downloaded. Realtime WebSocket delivery, signed media reads,
login/session behavior and real cross-user isolation remain **B30-C REQUIRED**.

## Cron, workers and Edge Functions

Installed extensions required by the existing hosted paths include `pg_cron`,
`pg_net`, `supabase_vault` and `http`.

| Hosted component                     | Staging actual                                                          | Result                                   |
| ------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------- |
| Transaction Due Work                 | Active pg_cron job, every minute                                        | DEPLOYED                                 |
| Notification Email invocation        | Active pg_cron job, every minute                                        | DEPLOYED                                 |
| Notification Inbox retention         | Active pg_cron job, hourly at minute 15                                 | DEPLOYED                                 |
| Last 24h cron metadata               | Due work 1,440 succeeded; Email 1,440 succeeded; retention 24 succeeded | VERIFIED metadata only                   |
| Notification Email Edge Function     | `notification-email-worker`, ACTIVE, version 11, `verify_jwt=false`     | DEPLOYED                                 |
| Edge worker application bearer check | Required by the existing design; deployed bundle parity not proven      | NOT VERIFIED                             |
| Stripe `/api/stripe/worker` schedule | No database cron job found                                              | CONFIGURATION REQUIRED                   |
| Shop Suspension lifecycle            | Migration/schedule absent                                               | EXPECTED DISABLED                        |
| Hosted media cleanup                 | No hosted executor found in inspected metadata                          | CONFIGURATION REQUIRED / policy decision |
| B28 worker observability             | Migration absent                                                        | MISSING                                  |

Cron success proves scheduler invocation completion only. It does not prove email
delivery, provider acceptance, business outcome correctness or deployed source-byte
parity. Vault secret names/values were not enumerated and no secret plaintext was
read.

Vercel was not inspected: an explicit Staging Vercel project/deployment mapping was
not established through the available evidence, so selecting a Vercel target would
have violated the environment boundary. Its application deployment, environment
flags and Cron configuration are **NOT VERIFIED**.

## Stripe and webhook preflight

The local application defines separate platform, Connect and Accounts v2 webhook
routes plus the authenticated Stripe worker route. No Stripe API was called. The
Supabase metadata inspected here cannot prove that Stripe Test Mode endpoints are
registered, that their event subscriptions/account scope are correct, or that
signing and worker secrets match the deployed application.

The following remain **CONFIGURATION REQUIRED / B30-C REQUIRED**:

- explicit Staging Vercel deployment identity and environment isolation;
- platform, connected-account and Accounts v2 Test Mode webhook registrations;
- signature verification and duplicate/out-of-order replay behavior;
- worker bearer configuration and hosted schedule;
- all Payment, Refund, Transfer, Payout and Dispute Test Mode evidence.

## Deployment Gap Matrix

| Component           | Local Expected                          | Staging Actual                            | Gap                                   | Risk                                        | Next Action                                           |
| ------------------- | --------------------------------------- | ----------------------------------------- | ------------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| Project identity    | Explicit Staging ref                    | Exact ref/name matched                    | None                                  | Low                                         | Keep explicit targeting                               |
| Migration history   | 92 local                                | 79 registered                             | 13 pending                            | High if app deployed first                  | B30-C deploy exact ordered set only                   |
| B21–B23             | Payment/reconcile/refund foundation     | 5 migrations and expected objects present | Remote hashes not proven              | High financial provenance                   | Verify archive/source digest before further migration |
| B24                 | Transfer and Payout observation         | Absent                                    | MISSING                               | Financial features unavailable              | Deploy migrations 6–8 while flags remain OFF          |
| B25                 | Dispute/cases/recovery                  | Absent                                    | MISSING                               | No new operational holds/recovery           | Deploy migrations 9–11 before enabling provider work  |
| B26                 | Shop admission/suspension               | Absent; B14 guards enabled                | EXPECTED DISABLED                     | Shop transactions remain closed             | Deploy 12–13; keep singleton and app flags OFF        |
| B27                 | Authoritative notifications             | Absent                                    | MISSING                               | New event projections unavailable           | Deploy migration 14 after B26                         |
| B28                 | Runtime reliability/observability       | Absent                                    | MISSING                               | Limited hosted visibility                   | Deploy 15–16 before activation                        |
| B29                 | Bounded discovery/notifications         | Absent                                    | MISSING                               | New app queries incompatible until deployed | Deploy 17–18 before matching app release              |
| Public/private RLS  | Enabled, no client private-table access | Matches metadata                          | Runtime identities untested           | Medium                                      | B30-C cross-user tests                                |
| Storage             | Five expected buckets/policies          | Present with expected visibility          | Byte/API behavior untested            | Medium                                      | B30-C media matrix                                    |
| Realtime            | Private Broadcast, no Postgres Changes  | Matches metadata                          | WebSocket runtime untested            | Medium                                      | B30-C two-session test                                |
| Auth                | Existing Supabase Auth/Profile          | FK present                                | Dashboard/runtime config NOT VERIFIED | Medium                                      | Read-only dashboard confirmation, then B30-C auth     |
| Transaction cron    | Minute schedule                         | Present; 24h successful metadata          | Business effects not tested           | Medium                                      | Observe during B30-C without manual replay            |
| Email cron/function | Minute schedule + Edge worker           | Present and active                        | Delivery/source parity NOT VERIFIED   | Medium                                      | Approved recipient/provider test in B30-C             |
| Stripe worker       | Hosted bounded schedule                 | No DB cron; Vercel NOT VERIFIED           | CONFIGURATION REQUIRED                | Critical before finance activation          | Bind explicit Staging app and schedule                |
| Shop lifecycle      | Default OFF                             | Not installed/scheduled                   | EXPECTED DISABLED                     | None until Shop launch                      | Deploy disabled; schedule only after approval         |
| Media cleanup       | Approved hosted executor                | Not found                                 | CONFIGURATION REQUIRED                | Orphan accumulation                         | Decide owner/cadence before enabling                  |
| Stripe webhooks     | Three isolated Test Mode endpoints      | Registration NOT VERIFIED                 | CONFIGURATION REQUIRED                | No trusted provider evidence                | Verify/configure separately in B30-C                  |

## Minimum B30-C sequence

1. Explicitly identify the Staging Vercel project/deployment and compare safe
   environment-variable presence without printing values.
2. Obtain a trustworthy archive/hash basis for the 79 installed migrations,
   especially B21–B23; stop on drift.
3. Deploy only the 13 pending migrations in the exact order listed above, one
   atomic migration at a time, verifying history and installed definitions after
   each risk boundary.
4. Keep every financial flag, Shop presentation/admission and Shop lifecycle flag
   OFF; verify disabled behavior before any provider configuration.
5. Deploy the matching application and Edge Function only after schema parity.
6. Configure and verify isolated Stripe Test Mode webhook endpoints and the worker
   schedule; do not enable money movement merely because endpoints exist.
7. Run approved temporary-account cross-user Auth/RLS/Storage/Realtime and
   Resale/Shop/Message/Offer/Order acceptance.
8. Enable and test Payment, Refund, Transfer, Payout observation and Dispute flows
   separately, stopping on unknown outcomes and preserving immutable test history.
9. Validate monitoring ownership, Email delivery, Shop lifecycle and any approved
   cleanup; then perform a separate Production decision.

## Final classification

- Local source/deployment gap is understood: **VERIFIED**.
- Staging project and metadata-only schema posture: **VERIFIED**.
- Migration source-byte equality: **NOT VERIFIED**.
- Real user/API/provider behavior: **NOT TESTED — B30-C REQUIRED**.
- Remote writes/deployment/test data/provider calls: **NONE**.

**B30-B READ-ONLY PREFLIGHT COMPLETE — B30-C NOT STARTED.**
