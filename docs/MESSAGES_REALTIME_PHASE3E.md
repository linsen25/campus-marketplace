# Phase 3E: controlled production Realtime rollout

2026-10-08. **PHASE 3E COMPLETE. Backend migration PRODUCTION DEPLOYED. Frontend
PRODUCTION-CONFIGURED / AUTHENTICATED SMOKE VERIFIED.** No hosted frontend
deployment, production fixtures, message sends, commit or push.

Target only: campus-marketplace / `yzvchumzyonegujucyqs`. Staging was not the
rollout target. The [Phase 3D preflight and rollback plan](MESSAGES_REALTIME_PHASE3D.md)
and unchanged [migration](../supabase/migrations/202610080001_messages_realtime.sql)
govern this rollout.

## Backup and application gates

Before mutation, local APP_ENV production, exact production public URL, configured
server credential role/project and the actual linked production project were
verified without printing secrets. The CLI link was explicitly changed from
staging to production; commands also supplied the production ref.

Fresh verified backup outside Git:
`C:/Users/MLTZ/ProductionBackups/campus-marketplace/20261008T205249Z-pre-realtime/`

| File | Bytes |
| --- | ---: |
| database.dump | 518590 |
| roles.sql | 6173 |
| archive-toc.txt | 63856 |
| backup-manifest.json | 1158 |
| SHA256SUMS.txt | 332 |

Native PostgreSQL 17.11 pg_dump and password-free pg_dumpall completed successfully
using existing secure pgpass/TLS. The custom archive TOC contains conversations,
messages, message_images, image_message_submissions and migration history; all
files are nonempty and hashes recorded. Full pg_restore decode to NUL succeeded.
No restore, Docker or local database server was used. Storage object bytes are
not in the archive; Phase 3 does not modify them.

Production pre-apply history contained exactly the first six migrations through
202610070002. Final dry-run proposed ONLY 202610080001, with no roles or seeds.
All three Messages SQL hashes matched the reviewed baselines. Realtime SHA-256:
`5d16a4638eb2f2ac9f697e994f8a9ed9f91d9dd79034939426e8b8f55380499a`.

Only 202610080001 was applied successfully. No repair or rollback was attempted.
Post-apply history is exactly:

```text
202609290001
202610030001
202610040001
202610050001
202610070001
202610070002
202610080001
```

## Catalog, health and durable messaging

Both helpers exist with exact staging-verified source hashes, postgres ownership,
empty search_path, SECURITY DEFINER and no authenticated/service_role execute.
The two expected AFTER triggers are enabled. Five expected realtime.messages
policies include restrictive read and INSERT/UPDATE/DELETE namespace fences.
Zero public application tables are published for Postgres Changes.

A native psql read-only before/after fingerprint comparison found existing
application function definitions, constraints, non-Phase3 triggers, application/
Storage policies, table grants and buckets unchanged. Phase 1 TEXT and Phase 2
IMAGE definitions are preserved. Production linked DB lint returned no schema
errors. Management GET health reported ACTIVE_HEALTHY with unchanged settings:
not suspended, no admin suspension, presence false, private_only null.

The initial aggregate log query used the obsolete per-source table shape. The
current API requires the unified `logs` table with a source filter and ClickHouse
aggregates; see [official log-query documentation](https://supabase.com/docs/guides/observability/advanced-log-filtering).
That diagnostic query was corrected without changing project settings. Final
GET-only aggregate review covered 2026-10-08T20:52:49Z through 21:19:29Z:

| Source | Recorded events | Policy-error matches | Broadcast-exception matches | Authorization mentions | Partition mentions |
| --- | ---: | ---: | ---: | ---: | ---: |
| realtime_logs | 35 | 0 | 0 | 3 | 4 |
| postgres_logs | 33 | 0 | 0 | 1 | 1 |

The two Postgres notification-skip text matches were logged CREATE FUNCTION
definitions (severity LOG, SQLSTATE 00000), not actual notification-skip logs.
One recorded ERROR / SQLSTATE 23514 was explicitly classified as **no partition
of the messages relation found for row**, the known managed cold-partition
condition. Subsequent authenticated own joins succeeded without any migration
or settings repair. Authorization mentions coexist with intentional rejected
topics; counts alone are not claimed to prove each event's cause. No recorded
policy-error/Broadcast-exception match or additional ERROR/FATAL/PANIC category
was found by these bounded filters. This is a scoped review, not a guarantee
against every future/unrecorded failure. No raw events, row details, user IDs or
credential-bearing output were printed. Realtime remains ACTIVE_HEALTHY.
No production send was made to manufacture a log/event or cold partition. A public-
credential anonymous join to a controlled nonexistent private Messages topic was
explicitly rejected with CHANNEL_ERROR; no fixture was created.

Durable sends/finalizes remain existing API/RPC authority. The unchanged optional
notification exception isolation retains staging cold-start and scoped-fault
evidence; ordinary Realtime failure does not decide persistence success. No
production mutation regression fixture was run.

## Minimum production client enablement

The [browser controller](../lib/messages-realtime.ts) now allows exactly the
staging and production project mappings. Next.js exposes only the nonsecret
NEXT_PUBLIC_MESSAGES_ENV designation derived from APP_ENV at build/start; unknown
or mismatched designation/URL/public-key configurations start no connection.
The [server bridge](../pages/api/messages/realtime-session.ts) now relies on the
existing exact staging/production environment guard rather than its historical
staging-only extra gate. All verified-user, issuer/role/expiry, same-origin,
HttpOnly session and no-store checks remain. No service key/refresh token is used
by the Realtime browser connection. Tests cover both authorized mappings and
cross-project/unknown rejection, plus lifecycle and token validation.

Ten local test scripts, TypeScript and focused Phase 3 source/test lint pass.
Final production linked DB lint reports no schema errors. The clean production-
configured optimized build exits 0 after removing smoke routes and stopping the
temporary server; 107 browser assets/maps pass configured-secret, privileged-JWT
and temporary-route scans. The compiled Realtime client is present and production
binding is selected by APP_ENV; the staging identifier remains only as the
explicit supported alternate mapping, not the production target. No privileged
public variable exists. The build route manifest contains no temporary route.

The earlier build failed because simultaneous Next dev startup used the same
.next directory. That local execution mistake was corrected with isolated smoke
output; the final clean build succeeded. It still reports the unchanged
GlideSelect.jsx global naming-convention/parserServices issue and Browserslist
age warnings. Focused lint is clean; global lint is not claimed clean.

## Existing-session smoke — passed

The temporary localhost route mounted the normal Home/Messages implementation
under the normal session provider, using the user's existing production browser
session. The local sanitized result exactly matched the user's reported result:

| Check | Result |
| --- | --- |
| Buying / Selling / verified bridge | 200 / 200 / 200 |
| Bridge fields / private no-store | Safe fields only / true |
| Normal Messages UI / empty state | Present / true |
| Own private-topic join | Succeeded, private true |
| Mount / leave / remount | 1 / 0 / 1 |
| Maximum simultaneous user channels | 1 |
| Controlled other / malformed / anonymous topic | All rejected |
| Logout / channels after logout / subsequent Buying | 200 / 0 / 401 |
| Overall | passed true |

The access context remained in memory; results contain only statuses, counts and
booleans. No credentials, refresh token or topic/user identifiers were recorded.
No production message, listing or Auth-user was created. The authorized logout
ended the existing session. No reauthentication was requested. Live two-account
mutation delivery is not inferred from this empty-state single-account smoke.

Two-account production TEXT/IMAGE mutation testing is **DEFERRED**. Hosted staging
remains the authoritative mutation E2E evidence. Natural full JWT expiry, actual
OS sleep/wake and prolonged stress limits remain as documented in Phase 3C/D.

## Cleanup and final checkpoint audit

Removed pages/__phase3e-smoke.tsx and pages/api/__phase3e-result.ts; stopped the
temporary port-3000 server; removed tests/artifacts/messages-phase3e, including
sanitized result and isolated server build; restored .gitignore exactly to the
Phase 2 checkpoint. Phase 3B/C/D temporary artifact roots are also absent. No
temporary production smoke route is in the final build manifest or browser
output. Reusable Phase 3 tests remain. Older ignored Phase 1/2 screenshots and
Netlify audit artifacts are unrelated existing local evidence and were not
deleted or made commit-eligible.

The external fresh backup was fully decoded offline to NUL again and all hashes
in SHA256SUMS.txt match. It remains outside Git; no restore/new backup was run.
Final production history remains exactly seven versions, two enabled notification
triggers and zero application publication members. This cleanup/audit applied
no migrations, created no fixtures and issued no production data/schema/settings
change.

The index is empty. Eligible source/documentation files contain no configured
service credential, privileged access JWT, refresh token, Supabase access token,
credential-bearing database URI, password, pgpass, backup, generated fixture,
browser/session dump or temporary smoke harness. .env.local/.env.staging.local
and local build/artifact directories remain ignored. Service-key references in
server-only source/documentation are not credential values. No key is exposed
through NEXT_PUBLIC_ configuration. Phase 1/2 migrations, dependencies and
GlideSelect.jsx match checkpoint 74d832d.

All **24 Phase 3 changed/new files** since checkpoint 74d832d:

| Purpose | Files |
| --- | --- |
| Backend | supabase/migrations/202610080001_messages_realtime.sql; pages/api/messages/realtime-session.ts |
| Browser/recovery/session | lib/messages-realtime.ts; lib/messages-reconciliation.ts; lib/listings-api.ts; next.config.js |
| UI | components/home/messages.tsx; components/home/message-history.tsx; components/home/message-photos.tsx; components/home/messages-chat.tsx; components/listings/marketplace-session.tsx |
| Tests | tests/messages-realtime-migration.cjs; tests/messages-realtime-staging.cjs; tests/messages-realtime-client.cjs; tests/messages-realtime-e2e-staging.cjs; tests/messages-realtime-browser-acceptance.cjs; tests/messages-realtime-browser-regression.cjs; tests/messages-realtime-browser-release-candidate.cjs |
| Documentation | docs/PROJECT_STATUS.md; docs/MESSAGES_REALTIME_DESIGN.md; docs/MESSAGES_REALTIME_STAGING_VERIFICATION.md; docs/MESSAGES_REALTIME_PHASE3C.md; docs/MESSAGES_REALTIME_PHASE3D.md; docs/MESSAGES_REALTIME_PHASE3E.md |

Eight tracked files modified, sixteen new eligible files; none staged. No tracked
files deleted. Final documentation local-link check passes 183 links across 26
Markdown files; git diff --check passes. Eligible-file secret/JWT/password scan
passes 548 files without printing credentials. Compiled public build environment
designation is explicitly production. Temporary localhost server is stopped;
normal browser UI is not a hosted frontend deployment.
**SAFE FOR FINAL PHASE 3 CHECKPOINT COMMIT**; no commit or push performed.

| Feature | Final status |
| --- | --- |
| Phase 1 TEXT | PRODUCTION |
| Phase 2 IMAGE | PRODUCTION |
| Phase 3 Realtime backend | PRODUCTION DEPLOYED |
| Phase 3 Realtime frontend | PRODUCTION-CONFIGURED / AUTHENTICATED SMOKE VERIFIED |
| Two-account production Realtime mutation | DEFERRED |
| Hosted frontend | NOT DEPLOYED |

**PRODUCTION TARGET: campus-marketplace / yzvchumzyonegujucyqs. FRESH PRE-REALTIME
BACKUP VERIFIED. PHASE 3 REALTIME MIGRATION APPLIED TO PRODUCTION. PHASE 1 TEXT
PRESERVED. PHASE 2 IMAGE PRESERVED. NO PRODUCTION FIXTURES CREATED. HOSTED FRONTEND
NOT DEPLOYED. NO commit. NO push. PHASE 3E COMPLETE. FINAL CHECKPOINT AUDIT PASSED.**
