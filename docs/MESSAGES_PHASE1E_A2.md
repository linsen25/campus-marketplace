# Messages Phase 1E-A2 — production baseline / rollout readiness

Verified 2026-10-07. **Messages is not deployed to production.** Only the explicitly
authorized production migration-history metadata repair was performed. No
application SQL migration, production fixture, app deployment, commit or push.

## Baseline proof before repair

CLI confirmed production `campus-marketplace` / `yzvchumzyonegujucyqs` and staging
`western-marketplace-staging` / `pcaqxezdfxofysghssyo`. Staging remains linked;
every production command explicitly pinned the production ref. No relink occurred.

All effects retained after the first four migrations were inspected, not just
Messages prerequisites. The reference is the hosted staging baseline whose stored
applied SQL was compared to all four unchanged local sources during Phase 1E-A.
The fifth staging migration adds Messages objects; those were excluded from this
baseline comparison. Function/SQL newline differences were normalized; row IDs,
timestamps and sequence current values were not used to claim schema equivalence.

| Inspected category | Objects/entries | Production versus staging |
| --- | ---: | --- |
| Tables and identity sequence | 6 | Match, including RLS/forced-RLS flags |
| Columns | 40 | Match: type, nullability, defaults/generated expressions/identity |
| Constraints | 25 | Match: definitions and validation state |
| Indexes | 12 | Match: definitions, validity and readiness |
| Functions | 18 | Match: full definitions, signatures/security/search paths |
| Function grants | 25 | Match, including PUBLIC/default ACLs |
| Relation/sequence grants | 69 | Match |
| Column grants | 22 | Match |
| Schema grants | 11 | Match |
| Policies | 18 | Match: roles/commands/permissiveness/USING/WITH CHECK |
| Triggers | 10 | Match: definitions and enabled state, including Auth triggers |
| Sequence configuration | 1 | Match: type/start/increment/bounds/cache/cycle |
| listing-images bucket | 1 | Match: public, 3 MB, JPEG/PNG/WebP |

Coverage: public profiles, listings, listing_images, listing_favorites; private
username_history and its identity sequence; all 18 functions, all 10 triggers,
all 18 final policies and all five explicitly created indexes named in the four
source migrations were independently checked present. Primary/unique/FK indexes
are included in the 12-index catalog inventory. Storage policies on storage.objects
were compared in full, including owner delete only after metadata no longer
references the object and no overwrite/upsert policy. No custom Marketplace
storage.objects trigger exists. Username backfill/publication historical data
changes cannot prove an original execution date; this establishes their present
schema effects, not provenance of earlier SQL Editor executions. Production had
zero listings at pre-flight. No material schema difference was found.

Ignored local evidence: `tests/artifacts/messages-phase1e-a2/baseline.sql`,
`production.json`, `staging.json`, `comparison.json`, `production-after.json`.
Catalog results contain definitions/privileges, not personal data or secrets.

## Authorized metadata repair and dry-run

Before executing, the exact four versions and metadata-only effect were reported.
The [supported repair mechanism](https://supabase.com/docs/reference/cli/supabase-migration-repair)
was used, without running migration SQL:

```powershell
npx.cmd --no-install supabase migration repair --linked --project-ref yzvchumzyonegujucyqs --status applied 202609290001 202610030001 202610040001 202610050001
```

CLI reported those four versions repaired to applied. Subsequent list and direct
read-only history queries agree:

| Local version | Production remote |
| --- | --- |
| 202609290001 | 202609290001 |
| 202610030001 | 202610030001 |
| 202610040001 | 202610040001 |
| 202610050001 | 202610050001 |
| 202610070001 | absent / pending |

```powershell
npx.cmd --no-install supabase db push --linked --project-ref yzvchumzyonegujucyqs --dry-run --skip-vault
```

Dry-run proposed **only `202610070001_messages_text.sql`**, seeds=[] and roles=[].
`--skip-vault` excludes config-secret updates. No real push occurred. Read-only
post-repair queries confirmed public.conversations and public.messages absent.
The entire inspected application/Auth-trigger/Storage baseline is unchanged after
repair. Migration source was not edited; Messages SHA256 remains
`2ee6cb35370c05cbc76d57fa78efd319cda24c1987cb8a5cbf5593121a3d4b7f`.

## Local runtime environment contract

`requireMessagesEnvironment()` runs before constructing the request-scoped client:

| Server-only APP_ENV | Required Supabase origin |
| --- | --- |
| staging | https://pcaqxezdfxofysghssyo.supabase.co |
| production | https://yzvchumzyonegujucyqs.supabase.co |
| absent / any other value | reject with 503 before Auth/database requests |

Only the bare HTTPS origin (optional trailing slash) is accepted; credentials,
paths, query/fragment and origin/port/project mismatches fail closed. A public
publishable key or legacy anon JWT is required; legacy JWT role/ref must match.
Secret/service-role keys and malformed/missing configuration are rejected. Opaque
publishable keys have no locally decodable project ref: the hosted environment
must still verify that key belongs to the selected project, and Supabase validates
it on requests. Parsing a legacy JWT here is configuration screening, not JWT
signature/session validation; normal verified Auth/RLS remains authoritative.

APP_ENV is never NEXT_PUBLIC. No new browser Supabase client, secret or service
role access. `scripts/dev-staging.cjs` supplies APP_ENV=staging to its child and
retains its existing exact staging URL/key checks. `.env.sample` documents the
explicit designation, with blank default. `.env.local` was not changed. For a
future production deploy set APP_ENV=production in both build and function runtime
alongside the confirmed production public URL/key; NODE_ENV alone does not select
a project. This change is local only and does not enable production Messages now.

## Hosted deployment verification

**Subsequent user clarification:** there is no hosted frontend deployment and
this project is not deployed on Netlify. The inherited configuration and unused
adapter were removed in the [Netlify cleanup](NETLIFY_CLEANUP.md). The observations
below describe the earlier pre-flight checkpoint, not a current hosting requirement.
Environment verification will be required when a frontend deployment is chosen;
there is no Netlify-specific rollout prerequisite.

Available tool inventory has no connected Netlify connector. Repository inspection
found netlify.toml but no .netlify/state.json, installed Netlify CLI or deployment
credential environment names. Therefore hosted variable names/values and exact
site identity could not be inspected: **remaining manual blocker**.

Read-only dashboard verification must establish APP_ENV=production,
NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in the production build
and runtime contexts; URL/key must resolve to campus-marketplace. Ensure staging
overrides are absent from that production context, public variables do not contain
service-role/secret values and previews use explicitly reviewed config. Report only
presence and project match, never values. Local env points to production but is
not evidence of hosted deployment configuration. No env setting/deploy was changed.

## Recovery status and proposed safe procedure

Production `backups list --project-ref yzvchumzyonegujucyqs` still reports
walg_enabled=true, pitr_enabled=false, backups=[] and physical_backup_data={}.
There is no listed usable restore point. Backup infrastructure enabled is not
proof of a restore entitlement/available backup. The plan/dashboard entitlement
cannot be confirmed from available tooling. No restore or paid-plan assumption.
Docker/Postgres tooling is absent; neither was installed.

**A logical backup is still required before the Messages production migration.**
The following procedure is proposed, not executed:

1. Obtain explicit approval for installing PostgreSQL 17 client tools or Docker
   on an appropriate backup machine. Verify the actual production project in its
   Connect panel and use its session pooler if direct IPv6 is unavailable. Do not
   guess a pooler hostname. Confirm access to a restricted, encrypted backup
   destination outside the repository; record backup timestamp and SHA256.
2. With [PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)
   available, take one consistent logical archive of
   application, Auth, Storage metadata and migration history. Using the confirmed
   direct host (requires IPv6 access), the exact proposed PowerShell command is:

   ```powershell
   $env:PGSSLMODE = 'require'
   pg_dump --host=db.yzvchumzyonegujucyqs.supabase.co --port=5432 --username=postgres --dbname=postgres --password --format=custom --schema=public --schema=marketplace_private --schema=auth --schema=storage --schema=supabase_migrations --file=C:/SecureBackups/campus-marketplace-before-messages.dump
   Get-FileHash -Algorithm SHA256 -LiteralPath C:/SecureBackups/campus-marketplace-before-messages.dump
   pg_restore --list C:/SecureBackups/campus-marketplace-before-messages.dump
   ```

   `--password` prompts; no credential goes in a command argument or repository
   file. Create/check the restricted backup directory before use and choose a new
   destination filename. For session pooling replace host/username with the exact
   Connect-panel values, using port 5432, not transaction pooling. Listing archive
   contents is inspection, not restoration. This archive includes ACL references;
   record required custom roles separately without role passwords.
3. Supabase CLI also supports the [logical backup workflow](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
   once Docker is approved/available. Proposed supplementary role export:

   ```powershell
   npx.cmd --no-install supabase db dump --linked --project-ref yzvchumzyonegujucyqs --role-only --file C:/SecureBackups/campus-marketplace-roles.sql
   ```

   Review its scope before relying on it. Do not treat an application-only CLI
   schema/data export as a complete Auth/Storage/history backup or claim independent
   exports share a consistent snapshot. PostgreSQL custom archive above provides
   one snapshot for the selected schemas.
4. Separately preserve any physical Storage object bytes and relevant Auth/project
   settings outside Git. [Database backups exclude Storage object bytes](https://supabase.com/docs/guides/platform/backups).
   Inspect other custom schemas/extensions, roles and dependencies and include them
   in the recovery scope if present. This procedure does not back up project keys,
   configuration or platform infrastructure automatically.
5. Validate restoration to a separately authorized disposable compatible Supabase
   environment before production rollout. Never blindly replay managed Auth/Storage
   DDL into an existing production project: review platform versions, archive list,
   ownership/grants and selected restoration order. Verify row counts, Auth/profile
   relationships, Storage metadata/files, policies/functions and migration history.
   No restore, even a disposable one, was performed in this phase.

If the additive Messages migration errors before commit, its transaction should
roll back; inspect the final tracking state. If app deployment subsequently fails,
revert/close application entry while retaining additive tables. Preserve any accepted
chat writes and prefer a reviewed forward fix. Catastrophic restore needs the
validated backup procedure and loses writes newer than its snapshot; never blindly
drop chat tables or erase tracking rows.

## Checks, files and remaining blockers

Passed: TypeScript --noEmit --incremental false; relevant ESLint; local Messages API
tests with staging/production accepted and invalid/mismatch/secret configurations
rejected before network; existing static SQL, conversation-state, message presentation
and image tests. Local production-mode `next build --no-lint` passed with child
APP_ENV=production and existing production URL/public key, not staging config;
ESLint ran separately. Existing Browserslist staleness warnings remain. No mutating
hosted acceptance suite was run against production. `git diff --check` passed and
the new report's links have valid targets; the known Phase 1E-A historical
design-link defect is outside this change.

Changed files: `lib/server/supabase-messages-repository.ts`, `scripts/dev-staging.cjs`,
`tests/messages-api.cjs`, `.env.sample`, `docs/PROJECT_STATUS.md`, this report.
Ignored local comparison/build artifacts only. Supabase migrations and .env.local
are unchanged. Existing unrelated workspace edits were preserved.

Resolved: production migration-history baseline and local runtime gate.
Remaining blockers: verified pre-rollout logical recovery, and hosted production
deployment identity/build/runtime env verification (including APP_ENV).
No Realtime, durable IMAGE, performance optimization or account-deletion redesign.

NO 202610070001 PRODUCTION APPLICATION

NO MESSAGES TABLES CREATED IN PRODUCTION

NO APPLICATION DEPLOYMENT

NO production test data

NO commit

NO push

NOT READY — recovery backup/restore readiness and hosted deployment environment remain unverified.
