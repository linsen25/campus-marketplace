# Business V1 B30 — Release Qualification Plan

Status (2026-10-24): **B30-A LOCAL QUALIFICATION COMPLETE; B30-B READ-ONLY PREFLIGHT COMPLETE; B30-C1 ROLLOUT PLAN COMPLETE — DEPLOYMENT READINESS BLOCKED.**

B30-B evidence is recorded in
[`BUSINESS-V1-B30-STAGING-PREFLIGHT.md`](BUSINESS-V1-B30-STAGING-PREFLIGHT.md).
The verified Staging history is 79 migrations: B21–B23 are registered and their
expected objects are installed, while the 13 B24–B29 migrations remain pending.
No reliable remote SQL-byte hash was available, so installed migration hashes are
not claimed as verified. No remote write or provider call occurred.

FREE BETA scope is now authoritative for B30: the next candidate set is
Migrations #7–#9 only, with Shop admission and notification projection kept
default-off. Shop suspension lifecycle execution is deferred; no scheduler or
lifecycle RPC may run, and expiry must not suspend free-beta Shops. All Payment,
Refund, Transfer, Payout, Dispute and paid-membership testing is **DEFERRED FOR
PAID LAUNCH**.

B30-C5 applied only Migrations #7–#9 to Staging after an exact three-file
dry-run. History is now 88 applied / 4 pending. Admission and lifecycle gates
remain disabled and no Worker/Cron or provider action ran. Remote catalog checks
for the singleton, scheduler absence, RLS/ACL and function security are pending;
full Batch 2 acceptance is not claimed until that read-only evidence is recorded.

B30-C7 deployment subsequently applied only the two final B29 migrations after
an exact two-file dry-run, using bounded lock/statement timeouts. History is now
92/92. Migration apply passed without conflict; RPC/index/ACL/RLS/Cron catalog
verification and browser/API acceptance remain pending and are not inferred from
history alone.

B30-C6 applied only Worker Migrations #10–#11 after an exact two-file dry-run.
Staging history is now 90 applied / 2 pending (the final B29 pair). No new
scheduler or provider action was invoked; existing Cron paths remain unchanged
by execution. Remote catalog verification of the new worker objects, ACL/RLS,
function security and Cron metadata is still pending.

B30-C7 prepared the final two B29 migrations only. Staging history is 90/92,
hashes match the manifest, and an isolated dry-run listed exactly the two final
files. Static review confirms bounded Resale search with `security invoker` and
recipient-scoped notification pagination with fixed `search_path`; index build
locks remain the only deployment risk. No Migration was applied in C7.

B30-C1 rollout preparation is recorded in
[`BUSINESS-V1-B30-STAGING-ROLLOUT-PLAN.md`](BUSINESS-V1-B30-STAGING-ROLLOUT-PLAN.md).
The exact 13-migration order and local hashes are known, but backup/PITR evidence,
remote SQL-byte archive proof, a usable explicit-target CLI dry run, and Vercel
Staging binding remain unverified. No deployment is authorized by this document.

B30-C2 reviewed the remaining blockers. The local Supabase CLI is usable with a
temporary worktree-local profile and exposes `db push --dry-run`; no remote
dry-run was executed without separate read-only authorization. Backup/PITR and
Vercel Preview-to-Staging binding remain **BLOCKED / NOT VERIFIED**. See the
[B30 migration hash manifest](BUSINESS-V1-B30-MIGRATION-HASH-MANIFEST.md).

B30-C3 records **STAGING BACKUP RISK ACCEPTED (not BACKUP PASS)** for this
rebuildable test environment. Production release still requires verified backup
and restore evidence. The CLI help contract is verified, but explicit Staging
linking could not proceed because no access token is available; Vercel binding
and the 13-version remote dry-run therefore remain blocked.

B30-C4 Batch 1 applied the first six approved migrations to Staging only. The
isolated dry-run matched exactly those six files, and migration history is now
85 applied with seven remaining. Schema-diff/dump verification was unavailable
because Docker/Podman is absent; ACL/RLS/object verification beyond migration
execution remains NOT VERIFIED. No provider, worker, cron, Shop transaction or
Vercel operation ran.

B30-C4 post-deployment security verification confirms the target and migration
history and records static SQL protections. Remote catalog-level object, ACL,
RLS, function-owner/search_path and trigger checks remain **NOT VERIFIED**;
therefore Batch 2 is not approved.

The connected Supabase read-only catalog evidence subsequently verified 85 unique
migrations, the nine reviewed tables' RLS and no direct anon/authenticated DML,
zero invalid indexes/unvalidated constraints in scope, 13 enabled triggers,
service-role-only reviewed provider RPCs, and fixed `search_path` on reviewed
SECURITY DEFINER functions. Batch 1 static security acceptance is therefore
PASS for the reviewed scope. Real-user RLS behavior, runtime feature-flag values,
full helper ownership/definition parity and provider behavior remain NOT VERIFIED.

## B30-A boundary

B30-A qualifies the current uncommitted worktree locally. It does not prove that
Staging has the same schema, configuration, provider permissions or data. No
Staging/Production/Stripe request, deployment, email, scheduler installation,
feature activation or Git mutation is authorized or performed.

The authoritative local baseline is Git `feef08febda8a1c77cccc81245db4764a2a50473`
plus every tracked and untracked source file listed by Git. Existing ignored
environment files, build output and test artifacts are not release source.

## Local qualification sequence

1. Inventory tracked/untracked/ignored files, migrations, package lock and safe
   environment template.
2. Apply the ordered schema/business migration chain to loopback-only PostgreSQL;
   separately test hosted Supabase integrations that a stock PostgreSQL server
   cannot provide.
3. Repair only stale test loaders/fixtures and rerun them.
4. Run focused API/service, native PostgreSQL concurrency and browser component
   integration for B21–B29 and affected earlier shared domains.
5. Run TypeScript, ESLint, Prettier, Node syntax, secret/config scans,
   `git diff --check` and a production build.
6. Classify every remaining gap without treating a disabled flag as launch proof.

## Local evidence and limitations

- The local directory contains 92 uniquely versioned migration files. The B21–B29
  tail contains 18 files and applies in filename order in isolated PostgreSQL.
- The current-schema harness applies the full ordinary SQL chain. It intentionally
  excludes `202610130007_staging_due_work_schedule.sql`,
  `202610150006_notification_scheduler_transport_privacy.sql`, and the hosted
  `vault`/`pg_net`/cron tail of
  `202610150004_notification_delivery_foundation.sql`. Their schema-adjacent
  contracts have focused tests, but actual hosted extensions/secrets/schedules are
  **NOT VERIFIED** locally.
- Docker is unavailable. The local Supabase CLI cannot write its telemetry file in
  the managed sandbox. No workaround contacted a remote project.
- The real `/listings` Next.js SSR route was exercised against a loopback-only,
  empty Supabase-compatible HTTP fixture. That run exposed and fixed undefined
  optional query values in Next.js props; the success and error props now pass a
  focused serialization regression. Market navigation/hit targets pass at five
  widths in normal and reduced-motion modes. Populated search/filter/pagination
  behavior against real Supabase data remains B30-C work, not a local PASS.
- Previously ignored `tests/artifacts`, `.next`, generated PWA files and
  `tsconfig.tsbuildinfo` are non-source outputs. Existing historical artifacts were
  not deleted because their ownership was not established. New temporary database
  instances were stopped; B30-modified transaction harness now removes its exact
  run directory.

## Blocker classification

### LOCAL BLOCKER

None in the locally exercised code paths. The three stale B29-A tests and the
legacy Welcome-page fixture test were repaired without weakening production
contracts and now pass. A real Next.js runtime check also
found that `/listings` returned non-serializable `undefined` query props; the page
now omits those optional keys and a focused success/error regression plus the 10/10
navigation matrix pass. A stock PostgreSQL server cannot prove Supabase-managed
network/cron extension installation; this is classified as Staging, not local
application logic.

### STAGING BLOCKER

- Reconfirm project identity, current migration history and archived SQL bytes.
- Confirm which of the 18 B21–B29 migrations remain pending and detect drift before
  any write.
- Validate RLS/ACL/function owners/search paths against deployed roles, private
  Storage, Realtime, PostgREST reload and real legacy rows.
- Verify webhook inbox backlogs, worker runtime state, cron definitions and hosted
  media/email cleanup without mutating business data during B30-B.
- Run populated `/listings` search/filter/pagination and Notification sparse-filter
  plans on Staging data; the empty local SSR/navigation path is already qualified.

### PROVIDER BLOCKER

- Stripe Test Mode platform/Connect Accounts v2 permissions and Canadian account
  capabilities.
- Real Customer, PaymentIntent, Charge, Refund, Transfer, reversal, connected
  Payout and Dispute retrieval/reconciliation.
- Exact platform/connected webhook endpoint subscriptions, signatures, event
  account scope and replay behavior.
- Membership billing remains separate from Order payments and is not proven by the
  B21–B25 test transports.

### POLICY BLOCKER

- Merchant of Record, platform/Seller fees and refund/dispute/chargeback liability.
- Dispute fees, negative-balance responsibility, forced Refund/Reversal and Seller
  recovery rules.
- Authorized human Operations identity, role source, evidence retention, dual
  approval and amount thresholds.

### RELEASE BLOCKER

- Separate authorization for every B30-C migration, configuration, test-data and
  provider operation; B30-B performed no writes.
- Hosted schedules, alert destinations/owners, monitoring response and rollback or
  forward-repair runbooks must be approved.
- Database migrations require forward repair after application; they are not
  represented as lossless one-click rollbacks.
- Production launch requires a new explicit decision after Staging and provider
  evidence. Feature flags remaining OFF is necessary but not sufficient.

### NON-BLOCKING

- Existing Browserslist database-age warning.
- Existing Autoprefixer `start`/`flex-start` compatibility warning.
- Git line-ending notices on Windows.

## B30-B — completed read-only preflight

The explicit Staging ref was verified before project-targeted queries. Read-only
transactions compared migration versions, installed objects, RLS/ACL, Storage,
Realtime, RPC owners/search paths, extensions and cron metadata. The resulting gap
matrix and evidence limits are in the Staging preflight report. User runtime
authorization was not inferred from administrative catalog access.

## B30-C — proposed separately authorized acceptance

Deploy only approved migrations in verified order and apply application code in an
explicit Staging-connected environment. Then use uniquely identified temporary
accounts/data and Stripe Test Mode to test Auth, Resale, Shop, Messages, Offers,
Orders, Notifications and the provider lifecycle. Activate each financial or Shop
gate only under its own approval and stop on unknown provider outcomes. Do not
delete immutable financial history; isolate retained test facts by stable run ID.

## B30-D — production decision

Resolve every provider/policy/release blocker, approve monitoring ownership and
forward-repair procedures, review final Staging evidence, then make a separate
Production decision. B30-A supplies no Production authorization.
