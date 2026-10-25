# Business V1 B30 — Local Release Inventory

Generated 2026-10-24. This is a local inventory, not a deployment record. B30-C1
rollout planning is documented in
[B30 Staging Rollout Plan](BUSINESS-V1-B30-STAGING-ROLLOUT-PLAN.md); no remote
write or deployment has occurred. B30-C2 verified the local CLI dry-run
capability only. B30-C3 records **STAGING BACKUP RISK ACCEPTED (not PASS)**;
remote dry-run, Supabase token-based linking and Vercel binding remain blocked.

FREE BETA rollout scope: evaluate only pending Migrations #7–#9 for the next
approval. Admission remains disabled; Shop suspension execution and scheduling
remain disabled; Payment, Refund, Transfer, Payout, Dispute and paid-membership
validation are **DEFERRED FOR PAID LAUNCH**.

B30-C5 applied #7–#9 only after an exact three-file dry-run. Staging history is
now 88 applied / 4 pending. No Worker/Cron/provider operation ran. Remote
post-deployment catalog verification for Shop singleton, scheduler absence and
RLS/ACL/function security remains NOT VERIFIED in this context.

B30-C6 applied #10–#11 only after an exact two-file dry-run. Staging history is
now 90 applied / 2 pending; only the final B29 pair remains. No Worker/Cron or
provider action was invoked. Static worker security review passed; remote
post-deployment object, ACL/RLS and Cron metadata verification remains pending.

B30-C7 readiness: final B29 migrations #12–#13 are still pending. Hashes match
the manifest and the 92-file isolated dry-run listed exactly those two. Resale
search is bounded/RLS-preserving; notifications are recipient-scoped and
bounded. Index creation may require a maintenance window. No C7 migration was
applied.

B30-C7 deployment applied #12–#13 only after the exact two-file dry-run, with
bounded lock/statement timeouts. Staging history is now 92/92. Migration apply
passed; remote catalog and real browser/API behavior remain separate acceptance
checks.

B30-C4 applied only migrations 1–6 from the pending set. The isolated dry-run
matched exactly six files; Staging history is now 85 applied / 7 pending. The
remaining seven files are unchanged and were not included. Schema-diff/dump
post-checks are NOT VERIFIED because Docker/Podman is unavailable. Static SQL
review confirms the intended private/RLS/service-role-only contracts; this is not
runtime ACL/RLS proof. Connected Supabase catalog evidence subsequently verified
the reviewed nine-table RLS/ACL scope, 13 enabled triggers, constraint/index
health and reviewed provider RPC restrictions. Real-user RLS and runtime flags
remain unverified. Batch 1 post-deployment security is PASS for that reviewed
scope; Batch 2 remains separately gated.

## Worktree

- Git branch: `main`
- HEAD: `feef08febda8a1c77cccc81245db4764a2a50473`
- Worktree: intentionally dirty with accumulated Business V1 source, migrations,
  tests and documentation. Nothing was staged, committed, reset, pushed or cleaned.
- `package.json` and `package-lock.json` are present and unchanged in the B30-A
  diff. No dependency or package-manager change was made.
- `.env.sample` contains names and safe disabled defaults only. `.env.local` and
  `.env.staging.local` remain ignored and were not inventoried as releasable source.
- Required new migrations/tests/docs appear as ordinary untracked files and are not
  hidden by `.gitignore`.
- Ignored non-source roots observed: `.next`, `node_modules`, `supabase/.temp`,
  `tests/artifacts`, generated PWA files and `tsconfig.tsbuildinfo`.

## Migration inventory

B30-C1 confirmed the 13 pending entries and local SHA-256 values below. Ordered
batches, lock risks, read-only checkpoints and stop conditions are maintained in
the rollout plan. Backup/PITR evidence, remote SQL byte equality and an explicit
Vercel Staging binding remain **NOT VERIFIED**.

There are 92 local migration files with unique ordered versions. B30-B explicitly
verified 79 registered Staging migrations: B21–B23 (the first five entries below)
are registered and their expected objects are installed; B24–B29 (the remaining 13) are pending. There are no remote-only versions or version/name mismatches.
Remote original-SQL hashes remain **NOT VERIFIED**, so registration is not claimed
as byte-identical archive proof.

| Order | Migration                                                      | SHA-256                                                            | Dependency / responsibility                        | Deployment status / risk                             |
| ----: | -------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------- |
|     1 | `202610200002_order_payment_intent_start.sql`                  | `7FD77C4C3582A4DFE2895ED6F818109A6FDE189CEF5243CF2F498ADB295E1183` | Existing Orders, frozen economics, Stripe bindings | DEPLOYED metadata; remote hash NOT VERIFIED          |
|     2 | `202610210001_order_payment_reconciliation.sql`                | `5088677CDD830C59F047795718BB13914A42BCE554E22E3E1F55EFF07CC228B9` | B21 attempts and webhook inbox                     | DEPLOYED metadata; remote hash NOT VERIFIED          |
|     3 | `202610210002_order_refund_operations.sql`                     | `31228F534284AC2A420731FC0301EE85ABABD411E66DCE24780CAA021D5B8A95` | B22 paid evidence and settlement authorization     | DEPLOYED metadata; remote hash NOT VERIFIED          |
|     4 | `202610210003_order_refund_observations.sql`                   | `96DFB9EA06CBADDDB8F50907C1D3AC633FE23395F905CDBF887B840ED4A78089` | B23-A operation                                    | DEPLOYED metadata; remote hash NOT VERIFIED          |
|     5 | `202610210004_order_refund_event_integration.sql`              | `F30A794C64369C6B57720D2B65556DCA75F31381C395182A283C24BE940C1B9E` | Stripe inbox purpose isolation                     | DEPLOYED metadata; remote hash NOT VERIFIED          |
|     6 | `20261022041410_order_seller_transfer_operations.sql`          | `5C3F6EDB977EDE0D55EC12EF94484EBEDB83F174B84F9124F90DB2ACC79A152A` | Protection/settlement/refund conservation          | MISSING / expected pending                           |
|     7 | `20261022073253_order_transfer_observations.sql`               | `3C352799785777D7385DF453D18A728DAF0D2FAA65D76A67973A7D423CA68483` | Transfer operation and Stripe inbox                | MISSING / expected pending                           |
|     8 | `20261022110000_connected_payout_observations.sql`             | `387624EE7D212E8A9C3D45180DE84D4BDC41E6CCB80BA25503F75BDD1834B4F2` | Connected account scope                            | MISSING / expected pending                           |
|     9 | `20261022194401_stripe_dispute_observations.sql`               | `AF06C2CE359A4536D6740ABEEBA2D88C7D29B7213D5C005BC19F01BF3C7DD153` | Charge/PaymentIntent evidence                      | MISSING / expected pending                           |
|    10 | `20261022202042_operational_case_foundation.sql`               | `DF50EEA39A498C20CCCB48911C0BC11180FC32D666CC290118D2397D5881BEFB` | B25 observations and Protection cases              | MISSING / expected pending                           |
|    11 | `20261023010212_operational_recovery_audit.sql`                | `8EA8139C00BDC7D00533E3E08B96DC48FAA92A1C236C2C517579D2B9249097B0` | Operations and inbox leases                        | MISSING / expected pending                           |
|    12 | `20261023015435_shop_transaction_admission.sql`                | `A4FA79B16537CD875C2A6D9B8CBEAFCAE49D5F56272D1C11B0F157E4E5ECC810` | B12 membership and B14 guards                      | MISSING / expected pending; admission remains closed |
|    13 | `20261023030000_shop_suspension_lifecycle.sql`                 | `5D39E7FD1C1A1E62C918AD7CE707E2EB39779D9ECA414180E573F2790298C038` | Admission, Offers, Messages, membership cycles     | MISSING / expected pending                           |
|    14 | `20261023173802_authoritative_shop_provider_notifications.sql` | `619568E1CA6AA56D83664233960C4749CBD88BF2C52973AF2A47BAD671349BFE` | B12/B23/B24/B26 authoritative events               | MISSING / expected pending                           |
|    15 | `20261023190043_worker_runtime_reliability.sql`                | `104161EA636838468978CB7A249D2E0F52475F6EE8BE728ACD47A60EB0D46C68` | Existing transaction due-work functions            | MISSING / expected pending                           |
|    16 | `20261023224905_worker_observability.sql`                      | `8CB6BB1F32D81ECF579BC0B4D772C6C5824D82B10B205FC8311C9A7BAD876A01` | Cron metadata, worker queues and recovery audit    | MISSING / expected pending                           |
|    17 | `20261024012808_resale_discovery_query.sql`                    | `C41F69D98929B3076C810DBB29852F52398C1A130363CF7602E6AE0C72364372` | Public Listing RLS and search extensions           | MISSING / expected pending                           |
|    18 | `20261024052628_notification_filtered_pagination.sql`          | `1D0765B42ED1D689128F69B0C26E22F2FC066CB67B1636D1485113CA94EF0957` | Notification domain/B27 category contract          | MISSING / expected pending                           |

Entries 1–5 are **DEPLOYED by version/object metadata; HASH NOT VERIFIED**.
Entries 6–18 are **MISSING / expected pending**. All 18 use forward-only ordering
and passed their local schema/domain tests. New
private financial/operations tables enable RLS and revoke direct client access.
Privileged RPCs use fixed `search_path`, explicit actor/service checks and explicit
default EXECUTE revocation. Public discovery uses RLS-preserving authority. B30-B
must verify actual installed owners, grants and policies; local source review is not
runtime proof.

## Application and runtime inventory

### API and workers

- Platform Stripe webhook: `/api/stripe/webhook`
- Connected webhook: `/api/stripe/connect-webhook`
- Accounts v2/thin-event webhook: `/api/stripe/account-webhook`
- Authenticated internal worker: `/api/stripe/worker`
- Email Edge Function: `supabase/functions/notification-email-worker`
- Existing Auth, Listings, Messages, Offers, Orders, Shop, Notifications and media
  APIs remain the shared business entry points; no second Order/payment/message
  system was added.

### Required environment names and safe defaults

`APP_ENV`, public Supabase URL/key, Stripe API version, secret/publishable keys,
platform account ID, application origin, three webhook signing secrets and the
worker secret require environment-specific values. No value is recorded here.

The source template keeps these defaults:

| Capability                       | Default                                             |
| -------------------------------- | --------------------------------------------------- |
| Stripe account/provider setup    | `STRIPE_PROVIDER_ENABLED=false`                     |
| Order Payment execution          | `STRIPE_ORDER_PAYMENTS_ENABLED=false`               |
| Refund execution                 | `STRIPE_ORDER_REFUNDS_ENABLED=false`                |
| Seller Transfer execution        | `STRIPE_ORDER_TRANSFERS_ENABLED=false`              |
| Transfer commercial approval     | `STRIPE_ORDER_TRANSFERS_CREATE_APPROVED=false`      |
| Connected Payout observation     | `STRIPE_CONNECTED_PAYOUT_OBSERVATION_ENABLED=false` |
| Stripe Dispute observation       | `STRIPE_ORDER_DISPUTE_OBSERVATION_ENABLED=false`    |
| Operational recovery             | `STRIPE_OPERATIONAL_RECOVERY_ENABLED=false`         |
| Shop transaction presentation    | `NEXT_PUBLIC_SHOP_TRANSACTIONS_ENABLED=false`       |
| Shop suspension hosted lifecycle | `SHOP_SUSPENSION_LIFECYCLE_ENABLED=false`           |
| Database Shop admission          | singleton row inserted with `enabled=false`         |

Connected Payout observation is read-only even when later enabled; it creates no
Payout. B27 provider/Shop event types are in-app only under the approved producer
contract and do not add a new real-email eligibility policy. Human operational
review writes remain locked because no approved human role source exists.

### Storage, Realtime and media

- `listing-images` retains legacy public objects; new Resale media uses the private
  `listing-images-private` authority and controlled byte-serving API.
- `profile-avatars` remains private with Profile-bound reads.
- Message image manifests and signed reads retain participant RLS.
- Realtime remains a refresh signal; database rows are authoritative.
- Hosted orphan/media cleanup deployment is an explicit release decision.

### Scheduling

Source contains existing transaction due-work, Notification email, Stripe worker,
Shop lifecycle and observability contracts. B28 installs no new hosted scheduler.
Actual `pg_cron`, Vercel Cron, Edge Function invocation, retry cadence and alert
ownership are **NOT VERIFIED** in B30-A.

## Local tests

### Passed in B30-A

- Repaired B29-A fixtures: `market-search.cjs`, `marketplace-taxonomy.cjs`,
  `marketplace-foundations-api.cjs`.
- Replaced the stale Welcome-page SSR/data-switch assertions with the current
  fixed 21-image, no-`href`, no-Listing-dependency contract.
- `/listings` SSR success/error props serialization regression, plus the real local
  Next.js route with empty loopback Supabase responses: Market Shop/Resale,
  Filter/Sort and pointer hit targets pass at 390/430/820/1280/1536 in normal and
  reduced-motion modes (10/10). No forced click or remote request was used.
- B20–B25 adapters/services and B21–B25 isolated PostgreSQL authority,
  idempotency, locks, leases, ACL/RLS, immutable audit and conservation.
- B12 membership native races; B14/B26 Shop admission/suspension native races;
  B06 Messages and B07 Offers native concurrency; B09 transaction races.
- B27 Notification API/presentation/email boundaries; B28 worker reliability and
  observability; B29 120k Resale and 200k Notification query qualifications.
- Storage/media isolation and publication recovery.
- Browser component matrices: Shop management 5 widths × normal/reduced motion;
  Messages/Offer provenance 5 × 2; Notifications presentation 5 × 2; Bell 5;
  preferences 5; external Order 5; Shop transaction controls.

### Not local PASS

- Populated `/listings` Search/Filter/Desktop Pagination/Mobile Infinite Load against
  real Supabase data. Empty SSR, serialization and navigation are local PASS; a
  `/home` demo is not an equivalent populated-data contract and was correctly not
  accepted as evidence.
- Remote Auth email, Realtime WebSocket, Storage, PostgREST, webhook, scheduler and
  Stripe Test Mode behavior.
- Exact hosted extension portions of the three notification/cron migrations noted
  above.

## Deployment and rollback order

1. Use the completed B30-B identity/history/schema/config preflight and recheck only
   time-sensitive facts immediately before an approved deployment.
2. Resolve hash, policy and provider prerequisites; approve an exact migration set.
3. Apply pending migrations in the table order, one verified atomic migration at a
   time; stop on any indeterminate result.
4. Verify definitions/RLS/ACL/indexes after each risk boundary before application
   deployment.
5. Deploy the matching application/Edge Function only under separate approval.
6. Configure webhooks/schedules/secrets and activate capabilities separately.
7. Run temporary-account and Stripe Test Mode acceptance, preserving immutable
   provider history under a stable test-run identity.

Application code can be rolled back to a compatible build. Applied migrations and
immutable financial evidence must use a reviewed forward fix; destructive rollback
or history rewriting is not an accepted recovery strategy.
