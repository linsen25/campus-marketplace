# Business V1 B30-C1 — Staging Rollout Plan

Status (2026-10-24): **PLAN PREPARED — DEPLOYMENT NOT AUTHORIZED / NOT READY**.

Target is only `western-marketplace-staging` (`pcaqxezdfxofysghssyo`). No remote
write, migration, provider call, Git mutation, or application deployment was
performed for this plan.

## B30-C2 blocker review

**Backup: STAGING BACKUP RISK ACCEPTED (not PASS).** The user accepts that this
rebuildable Staging project has no purchased Pro backup guarantee for this phase
and accepts possible test-data loss. Existing documents still contain no
verifiable backup timestamp,
PITR setting, retention, restore scope, or Storage protection evidence. A human
Staging administrator must, without exporting data, record the project/ref,
backup or PITR enabled state, latest completed backup timestamp, retention,
permitted restore scope, expected RPO/RTO, Storage object protection, and the
least-privilege restore approver. This acceptance does not satisfy the
Production-release gate; Production still requires backup and restore evidence.
No backup, dump, restore, or settings change was performed.

**Vercel binding: BLOCKED / NOT VERIFIED.** Local inspection found no
`.vercel/project.json` or `vercel.json` proving a target. A separately authorized
read-only Vercel metadata review must confirm team/project ID, repository,
production branch, Preview/Staging branch, Preview variable names (presence only,
never values), Supabase ref mapping, and automatic-production-deploy risk. No
Vercel metadata was queried in B30-C2.

**CLI: LOCAL FIX VERIFIED; REMOTE DRY-RUN PENDING.** The bundled CLI is
`2.120.0` at `node_modules/.bin/supabase.cmd`. Its normal profile is not writable
in the managed environment. With a temporary worktree-local `USERPROFILE`/`HOME`
and `SUPABASE_CLI_TELEMETRY_DISABLED=true`, `--version` and `db push --help`
completed and confirmed the supported `--dry-run` flag. No project link or
Staging contact occurred. The 13-file local manifest is recorded in
[`B30 Migration Hash Manifest`](BUSINESS-V1-B30-MIGRATION-HASH-MANIFEST.md).

After explicit read-only remote authorization, the next command is:

`supabase db push --project-ref pcaqxezdfxofysghssyo --dry-run --skip-vault`

It must report exactly the 13 manifest versions. Never use `--linked`, never run
`db push` without `--dry-run`, and stop on any extra/missing version or identity
mismatch.

## Readiness blockers

The following evidence is still required before any migration approval:

- A verifiable Staging database backup/PITR timestamp, retention and controlled
  restore procedure. The permitted read-only checks did not expose this evidence.
- A trustworthy byte archive/hash basis for the 79 already registered migrations;
  version registration alone is not SQL-byte equality proof.
- A working, explicitly targeted Supabase dry-run procedure. `supabase` help/list
  invocation was blocked by the managed environment's telemetry-file permission
  error; no `db push`, repair or remote mutation was attempted.
- Explicit Vercel Preview/Staging project and environment binding. No local
  `.vercel/project.json` or `vercel.json` establishes that mapping, and the
  branch-to-deployment relationship is not proven locally.
- Source parity, bearer configuration and schedule ownership for the hosted
  Worker/Edge Function paths.

Until these are independently evidenced, the correct status is **B30-C1 NOT
DEPLOYMENT READY**. Feature flags and Shop admission remain disabled.

## Exact pending migration set

Apply only in this order, one atomic migration at a time. Hashes are SHA-256 of
the current local SQL bytes; remote byte equality is not verified.

| # | Migration (version) | SHA-256 | Depends on / objects | Data and lock notes | Read-only verification |
|---:|---|---|---|---|---|
| 1 | `20261022041410_order_seller_transfer_operations.sql` | `5C3F6EDB977EDE0D55EC12EF94484EBEDB83F174B84F9124F90DB2ACC79A152A` | B21–B23, Protection/settlement; transfer operation, immutable trigger and service RPC | New private table/indexes; no backfill; DDL/index locks | Table/RLS, trigger, owner/search_path, grants and RPC signature |
| 2 | `20261022073253_order_transfer_observations.sql` | `3C352799785777D7385DF453D18A728DAF0D2FAA65D76A67973A7D423CA68483` | #1 and webhook inbox; transfer observations/result RPC | Constraint/function changes and indexes; no provider/data backfill | Purpose constraints, result tables/RPC ACL and immutable bindings |
| 3 | `20261022110000_connected_payout_observations.sql` | `387624EE7D212E8A9C3D45180DE84D4BDC41E6CCB80BA25503F75BDD1834B4F2` | #2; connected payout observation | Private table/index/trigger; no payout creation or backfill | Account/mode/platform keys, RLS, grants, trigger and RPC |
| 4 | `20261022194401_stripe_dispute_observations.sql` | `AF06C2CE359A4536D6740ABEEBA2D88C7D29B7213D5C005BC19F01BF3C7DD153` | B22 evidence and #1; dispute observations/hold trigger | Private table, webhook constraints/index; no dispute action | Dispute binding, hold trigger, ACL/search_path and purpose isolation |
| 5 | `20261022202042_operational_case_foundation.sql` | `DF50EEA39A498C20CCCB48911C0BC11180FC32D666CC290118D2397D5881BEFB` | Protection cases and #4; cases/evidence/audit | Future-trigger writes only; no historical backfill | RLS, immutable audit/evidence and source-trigger definitions |
| 6 | `20261023010212_operational_recovery_audit.sql` | `8EA8139C00BDC7D00533E3E08B96DC48FAA92A1C236C2C517579D2B9249097B0` | #1–#5 and inbox; recovery runs/exceptions | Future-only structures; no historical backfill | Lease/fencing constraints, service RPC ACL, no new financial authority |
| 7 | `20261023015435_shop_transaction_admission.sql` | `A4FA79B16537CD875C2A6D9B8CBEAFCAE49D5F56272D1C11B0F157E4E5ECC810` | B12/B14; singleton admission and guard replacement | Controlled singleton seed `enabled=false`; no user data | Singleton false, three guards enabled, private ACL |
| 8 | `20261023030000_shop_suspension_lifecycle.sql` | `5D39E7FD1C1A1E62C918AD7CE707E2EB39779D9ECA414180E573F2790298C038` | #7, B12, Offers/Messages; suspension cycles/events | Cursor seed and future trigger effects; no historical backfill | Cycle/message/offer guards, RLS, default-off behavior |
| 9 | `20261023173802_authoritative_shop_provider_notifications.sql` | `619568E1CA6AA56D83664233960C4749CBD88BF2C52973AF2A47BAD671349BFE` | B12/B23/B24/#8; notification projections | Future-only trigger projections; no backfill | Event categories, recipient derivation, ACL and idempotency keys |
| 10 | `20261023190043_worker_runtime_reliability.sql` | `104161EA636838468978CB7A249D2E0F52475F6EE8BE728ACD47A60EB0D46C68` | Existing due-work function/B09; bounded worker pass | Function replacement only; no data backfill | Function definition, 50-row bound, lock/advisory behavior |
| 11 | `20261023224905_worker_observability.sql` | `8CB6BB1F32D81ECF579BC0B4D772C6C5824D82B10B205FC8311C9A7BAD876A01` | #10, existing cron/extensions; runtime receipts/summary | Private run table/index/trigger; hosted http/Vault path needs config evidence | RLS/ACL, fixed search_path, cron function references; do not invoke |
| 12 | `20261024012808_resale_discovery_query.sql` | `C41F69D98929B3076C810DBB29852F52398C1A130363CF7602E6AE0C72364372` | B15 listings/extensions; search RPC and indexes | `pg_trgm` plus non-concurrent indexes; reads existing listings and may hold long locks | Extension, index validity, RPC/RLS and query definition |
| 13 | `20261024052628_notification_filtered_pagination.sql` | `1D0765B42ED1D689128F69B0C26E22F2FC066CB67B1636D1485113CA94EF0957` | #9 notification categories; indexes/RPC | Indexes read existing notifications; no backfill | Indexes, recipient predicate, RPC grants and stable cursor contract |

No migration is a rollback. A failed transaction may roll back atomically; a
committed migration requires a reviewed forward repair. Never reset, delete, or
rewrite historical financial data to resolve drift.

## Controlled execution batches

**Batch 0 — authorization and safety gate (required).** Reconfirm the exact
project ref, migration list/hash archive, backup/PITR evidence, clean reproducible
release artifact, and all finance/Shop flags OFF. Stop on drift, unknown backup,
identity mismatch, or an indeterminate prior result. Requires explicit user
approval.

**Batch 1 — B24/B25 foundations (#1–#6).** Apply sequentially with a read-only
catalog/RLS/ACL checkpoint after each migration; pause after #4 and #6 because
dispute/operations constraints alter financial boundaries. No Stripe calls or
worker execution. Existing rows must remain unchanged. Any lock timeout,
unexpected trigger, grant, or function owner stops the batch.

**Batch 2 — Shop lifecycle and notifications (#7–#9).** Apply sequentially while
`NEXT_PUBLIC_SHOP_TRANSACTIONS_ENABLED=false`, database admission remains false,
and lifecycle remains disabled. Verify B14 guards and that no historical Order,
Offer, Message or notification is backfilled. Stop if a guard becomes permissive.

**Batch 3 — worker reliability (#10–#11).** Apply only after matching server
code is available. Existing transaction/email cron may remain installed, but do
not invoke workers manually. Verify bounded functions, leases, observability ACL
and required extension/config metadata. Stop if source parity, bearer setup or
cron ownership is unknown.

**Batch 4 — query/index layer (#12–#13).** Schedule #12 in a maintenance window
because non-concurrent indexes and `pg_trgm` can hold locks. Verify index validity
and bounded plans, then deploy matching API code before using the new RPCs. Stop
on extension/lock failure or query/RLS drift.

Every batch requires: preconditions, one approved atomic write, migration-history
count/hash check, object/ACL/RLS assertions, a no-business-data-mutation check,
and an explicit stop decision. No batch is authorized by this document alone.

## Runtime and deployment binding gaps

| Component | Current evidence | Required before activation |
|---|---|---|
| Stripe platform / Connect / Accounts v2 webhooks | Routes exist locally; registration and deployed endpoint scope NOT VERIFIED | Explicit Staging Test Mode endpoints, secrets and replay plan |
| `/api/stripe/worker` | No DB cron found; Vercel mapping NOT VERIFIED | Explicit Staging deployment, bearer secret presence check, bounded schedule and owner |
| Notification Email Edge Function | ACTIVE version 11; source/bearer parity NOT VERIFIED | Deploy matching source, verify internal bearer and safe recipient test |
| Shop Suspension lifecycle | Not deployed/scheduled | Deploy #8 disabled; schedule only under separate approval |
| B28 observability | #11 pending | Deploy matching code and verify private runtime receipts |
| Transaction Due Work | Existing minute cron metadata succeeded | Observe only; never infer business success from cron success |
| Inbox retention | Existing hourly cron metadata succeeded | Observe only; verify post-migration function after #11 |
| Hosted media cleanup | No executor found | Policy/owner/cadence decision; do not enable implicitly |

Required environment names are documented without values: `APP_ENV`, Supabase
URL/key, Stripe API/provider credentials, platform account ID, three webhook
secrets, worker secret, and the feature flags listed in the release inventory.
Secret values must never be printed or copied into this report.

## Stripe Test Mode acceptance plan (later B30-C)

Run only after schema/app parity and separate approval, using uniquely identified
temporary accounts and no production data: PaymentIntent creation and trusted
confirmation; webhook signature/replay/ordering; Refund; Seller Transfer;
Connected Payout observation; Dispute observation; provider 429/5xx/timeout;
lease fencing and recovery; and every default-off flag. Classify each result as
local Fake Provider PASS, real Staging Test Mode PASS, or NOT TESTED. A Test Mode
pass does not establish production funding, Merchant of Record, Connect liability,
negative-balance, dispute-fee, refund, or manual-approval policy.

## Approval required next

Before B30-C deployment, obtain separate approval for: backup evidence review;
the exact 13-migration set/order; an explicitly bound Staging application and Edge
Function release; any cron/webhook configuration; temporary test accounts/data;
and each provider/financial feature activation. This plan does not authorize any
of those actions.

## B30-C2 final status

**DEPLOYMENT READINESS BLOCKED** — backup/PITR evidence, Vercel binding and
authorized remote dry-run remain outstanding. No remote writes occurred.

## B30-C4 Batch 1 result

The explicit linked Staging target was verified as `pcaqxezdfxofysghssyo` /
`western-marketplace-staging`. A temporary migration workspace containing the
79 applied files plus only the six approved files was used. Its read-only
dry-run listed exactly the six authorized migrations (#1 through #6 in the
manifest). They were then applied once with `--skip-vault --yes`; the CLI
reported success for every file.

A read-only migration-history query confirmed 85 registered migrations (79
previous plus 6 new) and exactly seven remaining local files absent remotely.
No repair, reset or retry was used. CLI schema-diff and schema-dump checks were
attempted but Docker/Podman is unavailable, so post-deployment object, ACL, RLS,
SECURITY DEFINER and trigger checks remain **NOT VERIFIED** beyond migration
execution and the prior static contract. No worker, cron, Stripe, payment,
refund, transfer, payout, Shop transaction or Vercel operation was started.

## Current rollout status

**B30-C4 BATCH 1 APPLIED — 6 MIGRATIONS; POST-DEPLOYMENT SECURITY METADATA
VERIFICATION INCOMPLETE.** The next batch remains stopped until the missing
read-only schema/ACL/RLS checks are completed. No second batch was applied.

## FREE BETA scope adjustment — next three migrations

The next candidate set is #7–#9: Shop admission, Shop suspension lifecycle and
authoritative Shop/provider notifications. Static review finds no Stripe API,
refund, transfer, payout or payment creation path in these migrations. #7 seeds
the database admission singleton as `enabled=false`; #8 installs service-role-
only lifecycle functions but no scheduler; #9 projects already-authoritative
facts into the existing in-app notification domain and does not perform provider
actions.

For FREE BETA, #7 and #9 are compatible with deployment while their existing
default-off/application gates remain disabled. #8 is **policy-deferred for
execution**: the migration may remain a dormant schema dependency, but
`SHOP_SUSPENSION_LIFECYCLE_ENABLED` must stay false and no lifecycle RPC, Worker
or Cron may run. The free platform must not suspend Shops merely because a
two-month trial expires. No migration is applied in this planning step.

Payment, Refund, Transfer, Payout, Dispute and paid-membership acceptance are
classified **DEFERRED FOR PAID LAUNCH**. They are not required for FREE BETA
acceptance and must not be represented as passed.

## B30-C6 Batch 3 deployment result

Staging history was read as 88 before deployment. Local hashes matched the
manifest for `20261023190043_worker_runtime_reliability.sql` and
`20261023224905_worker_observability.sql`. A temporary workspace containing the
88 applied migrations plus only these two files produced an exact two-file
dry-run. Both were applied once to `pcaqxezdfxofysghssyo`; the CLI reported
success for each. History is now 90 applied with only the two B29 migrations
pending. No Worker, Cron, Stripe, financial RPC, Git or Vercel operation was
started.

Static review confirms #10 bounds transaction due work and #11 adds private
worker receipts/observability with service-role-only RPCs and fixed search paths;
it does not install a new scheduler. Existing Cron definitions remain the only
scheduled paths. The email wrapper preserves the existing invocation path and
was not manually invoked.

Remote post-deployment catalog verification of new tables/indexes/constraints,
RLS/ACL, function permissions/search paths and Cron metadata was not available
through the current execution context. Those items remain **NOT VERIFIED**;
Batch 3 migration application is PASS, but full acceptance is pending the
connected read-only catalog evidence.

## B30-C7 Batch 4 deployment result

Staging history is confirmed at 90 and both final B29 versions are absent. Local
SHA-256 values match the manifest:

- `20261024012808_resale_discovery_query.sql` —
  `C41F69D98929B3076C810DBB29852F52398C1A130363CF7602E6AE0C72364372`
- `20261024052628_notification_filtered_pagination.sql` —
  `1D0765B42ED1D689128F69B0C26E22F2FC066CB67B1636D1485113CA94EF0957`

The isolated 92-file workspace dry-run listed exactly these two migrations. The
Resale function is `security invoker`, bounded to `p_limit` 1–100 with stable
offset bounds and published/available Resale predicates. The notification RPC
is `security definer` with fixed `search_path`, derives `auth.uid()` and filters
on `recipient_user_id`, with a bounded 51-row page and 90-day cutoff. Indexes
are non-concurrent and may require a maintenance window on populated Staging;
neither migration creates a provider, Shop lifecycle or Cron action.

The user subsequently approved this exact two-file batch. With bounded
`lock_timeout=10s` and `statement_timeout=900s`, both migrations applied once
without lock timeout or version conflict. Migration history is now 92/92 and
all local versions are registered; no other SQL was applied.

The CLI history check passed. Remote catalog verification of RPC definitions,
index validity, effective ACL/RLS, Cron/feature-flag state and Shop Admission
still requires the connected read-only SQL evidence path and is not inferred
from migration success. Real search/filter/pagination, notification isolation
and mobile infinite-load remain B30 browser/API acceptance work.

**B30-C7 BATCH 4 MIGRATION APPLY PASS — CATALOG AND RUNTIME ACCEPTANCE PENDING.**

## B30-C5 Batch 2 deployment result

Staging history was read before deployment and showed all three target versions
absent. A temporary workspace containing the 85 applied migrations plus only
#7–#9 produced a dry-run listing exactly those three files. They were then
applied once to `pcaqxezdfxofysghssyo`; the CLI reported success for each.

Post-deployment migration history is 88 applied and four pending (#10–#13). No
other migration was included. Existing default-off gates were not changed; no
Shop lifecycle Worker/Cron, notification Worker, Stripe provider, payment,
refund, transfer or payout operation was invoked.

Remote catalog verification of the admission singleton, suspension scheduler
absence, RLS/ACL, trigger/index/constraint state and SECURITY DEFINER
`search_path` was not available in this execution context. Those checks are
**NOT VERIFIED**; migration application is PASS, but full B30-C5 acceptance
remains pending connected read-only catalog evidence.

## B30-C4 post-deployment security verification

Linked project metadata and read-only migration history confirm the target and
85 registered versions (79 previous plus 6 Batch 1). The six local SQL files
were statically reviewed for the expected private tables, indexes, constraints,
immutable triggers, `SECURITY DEFINER SET search_path=''` functions and
service-role-only grants.

Direct `pg_catalog`/`information_schema` verification could not be completed:
the available CLI schema-diff and schema-dump commands require Docker/Podman,
which is absent. No alternative credential or user-data path was used. Remote
object existence, effective ACL/RLS, function owners/search paths and trigger
state are therefore **NOT VERIFIED**; runtime identity behavior remains outside
this check. Finance and Shop flags were not changed, and no financial or Shop
operation was invoked.

### Supabase read-only evidence supplied after deployment

The connected Supabase read-only inspection now verifies: 85 unique migration
records; RLS enabled on the nine reviewed finance/operations tables; no direct
anon/authenticated DML on those tables; zero invalid indexes and zero unvalidated
constraints in the reviewed scope; all 13 related triggers enabled; and no
anon/authenticated EXECUTE on the reviewed Transfer, Payout, Dispute and
Operational Recovery provider RPCs. The reviewed `SECURITY DEFINER` functions
have fixed `search_path`.

This satisfies the Batch 1 static catalog/security acceptance for the reviewed
scope. It does not prove: every constraint/index definition byte-for-byte
against the six source files; function owner identity for every helper; effective
RLS behavior under real anon/owner/other-user sessions; runtime environment flag
values; provider/webhook/worker behavior; or remote SQL archive byte equality.
Those remain **NOT VERIFIED / B30-C runtime work**.

**Batch 1 conclusion: B30-C4 BATCH 1 POST-DEPLOYMENT SECURITY PASS for the
reviewed static catalog scope.** The next batch still requires separate approval
and the remaining runtime/configuration gates.

## B30-C3 status

The CLI help contract is verified locally, but explicit Staging linking failed
because no Supabase access token is available in this environment. No token was
read or printed. Vercel metadata was not queried because no Vercel read-only
connector/CLI is available and that access requires separate authorization.
Consequently the 13-version remote dry-run and Production/Preview isolation are
still **BLOCKED**.

**Final status: B30-C1 DEPLOYMENT READINESS BLOCKED — PLAN COMPLETE, NO REMOTE WRITES.**
