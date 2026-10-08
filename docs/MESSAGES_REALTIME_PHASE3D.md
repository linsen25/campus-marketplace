# Phase 3D: final staging acceptance and production Realtime preflight

2026-10-08. **STAGING ACCEPTANCE COMPLETE. READY FOR PHASE 3E PRODUCTION
ROLLOUT**, subject to its fresh backup, final identity/dry-run gates and separately
authorized production frontend guard enablement. **PRODUCTION REALTIME NOT
DEPLOYED.** No application production schema/data, Storage, Auth or Realtime
settings changed. No frontend deployment, commit or push.

The established [design](MESSAGES_REALTIME_DESIGN.md),
[Phase 3B backend evidence](MESSAGES_REALTIME_STAGING_VERIFICATION.md) and
[Phase 3C browser evidence](MESSAGES_REALTIME_PHASE3C.md) were reviewed. No working
application behavior, migration, dependency or Next.js/PWA configuration changed
in this phase. The only test change is an opt-in shorter release-candidate branch
in the existing staging launcher plus a reusable acceptance module.

## Final staging acceptance

Target: western-marketplace-staging / `pcaqxezdfxofysghssyo`. Independent disposable
Seller, Buyer and Outsider browser contexts used the isolated local staging app
on port 3108, not the user's production app/browser. Run **efb4dd98** passed
**28 groups**, including scoped cleanup. Invocation:

```text
node tests/messages-realtime-e2e-staging.cjs --release-candidate
```

The launcher uses the installed Playwright module and Chrome via local environment
paths; keys, random passwords, cookies and JWTs remain in memory. It pins the
staging project and blocks browser/server traffic to other Supabase projects.
The existing Phase3C fixture prefix was reused intentionally for the shared
cleanup contract. Seller published a disposable listing through the normal UI;
Buyer used real Contact Seller navigation. Actual local JPEG/PNG/WebP files went
through attachment selection, prepare, private upload, receipt verification,
finalize and signed IMAGE rendering. No IMAGE was directly inserted for the flow.

| Check | Final result |
| --- | --- |
| Own private topics | Buyer, Seller and Outsider own joins; independent sessions |
| Live messages | Reciprocal TEXT; one/four IMAGE; decoded signed images, no recipient reload |
| Canonical state | Ordered durable IDs/sequences; own echoes produce one bubble |
| Lists | Multiple-conversation previews, activity order, inactive unread and retained selection |
| Read boundary | Scroll-up preserved; new message stays unread until jump and visible render |
| Recovery | Offline/online reconciles missed TEXT and IMAGE without recipient reload |
| Lifecycle | Mount 1, leave 0, remount 1, logout 0; role switches retain the same channel |
| Privacy | Fresh Outsider cross-user private join rejected; history/signing return inaccessible |
| Regression | Ambiguous TEXT and IMAGE retries preserve identity; cancel, IME, gallery, reload persistence |
| Layout | Live TEXT/IMAGE at 390, 430, 1280, 1536; no horizontal overflow; mobile back retains one list channel |
| Rail/overlay | Recent-three/+N expands four rows; gallery/attachment interaction preserved |

No browser runtime errors were recorded. Reusable tests also verify synchronous
logout/late-event gates, memory-only storage, serialized teardown and bounded
refresh jobs. This is not a prolonged browser listener/heap soak test.

Scoped cleanup verified zero disposable Auth users, listings, conversations,
messages, IMAGE submissions, chat objects and cleanup queue entries. Conversation
cascades remove IMAGE children/receipts; Auth cleanup removes disposable profiles.
Object lookups verified deletion. Generated images, SQL probes, local server
output and sanitized result files were removed after transferring evidence here.
No credential/session file was created. Managed transient Broadcast retention
was not purged. Staging migrations and private chat-images bucket remain.

## History, hash and migration audit

Staging history is exactly seven unique versions, in this order:

```text
202609290001
202610030001
202610040001
202610050001
202610070001
202610070002
202610080001
```

No repair was performed. Production history, read with native psql in explicit
read-only transactions before and after dry-run, is exactly the first six.
Production has zero Phase 3 helpers/triggers. The CLI remains linked to staging;
production commands supplied the explicit production project ref.

Candidate SQL SHA-256 is unchanged from the staging-verified Phase 3B version:
`5d16a4638eb2f2ac9f697e994f8a9ed9f91d9dd79034939426e8b8f55380499a`.
The candidate file is byte-identical to that recorded version. Staging live
helper bodies match the authored bodies exactly, with source MD5s:

| Helper | Source MD5 |
| --- | --- |
| notify_message_realtime | 6d5682c6bbee2503a5648986ecd420cd |
| notify_conversation_realtime | 464645fd9701444ea880bc0966168350 |

Both are postgres-owned definers with empty search_path and no authenticated or
service_role execute privilege. Both notification triggers are enabled; the five
expected policies remain, including restrictive namespace read/write fences.
Staging has zero public application-table publication members. Phase 1/2 SQL
hashes still pass their unchanged-baseline tests.

The SQL adds only Phase 3 notification helpers, two AFTER triggers and five
policies. Its DROP statements replace only its own named policies/triggers;
there is no destructive application DDL, Phase 1/2 schema/RPC change, listing,
favorites/profile change, Storage change or application publication mutation.
Recipients derive from current eligible participants. Trigger exception handling
retains Phase 3B's zero-partition cold-start and scoped notification-failure
TEXT/IMAGE persistence evidence. No SQL change invalidated that evidence, and
those fault injections were deliberately not repeated. Ordinary optional
notification exceptions are isolated; PostgreSQL fatal/cancellation behavior is
not promised to be immune.

## Production capability and dry-run

Target: campus-marketplace / `yzvchumzyonegujucyqs`. Native psql read-only catalog
queries confirmed PostgreSQL 17.6, managed `realtime.send(jsonb,text,text,boolean)`
and `realtime.topic()` owned by supabase_realtime_admin, partitioned
realtime.messages with RLS enabled and authenticated SELECT privilege. There
are no existing realtime-schema policies and zero public application-table
publication members, so no observed application namespace/policy collision.

GET-only Management API checks reported Realtime **ACTIVE_HEALTHY**, suspend
false, admin_suspended_at null, presence_enabled false, private_only null;
limits are 200 concurrent users, 100 events/second, 100 channels/client and
100 joins/second, matching staging. Null private_only is not an explicit enable
flag. No Dashboard/settings change is indicated by these checks. Actual production
private join remains a Phase 3E gate after policy application; it was not claimed
tested in this phase.

```text
npx --no-install supabase db push --linked --project-ref yzvchumzyonegujucyqs --dry-run --skip-vault
```

Dry-run proposed **ONLY 202610080001_messages_realtime.sql**; seeds and roles were
empty. Nothing was applied. The CLI printed its managed login-role initialization
step; no application migration/schema/data write was issued. Native read-only
post-check again confirmed six migrations and zero Phase 3 triggers.

## Auth, environment and privacy

Local .env.local remains ignored and unchanged: APP_ENV production and the exact
campus-marketplace URL. In-memory credential inspection confirmed the configured
server key's service_role role and production project binding, without printing
values. Existing TEXT/IMAGE guards accept the exact staging/production mapping;
tests reject unknown environments, swapped projects, privileged public keys and
missing/wrong-role IMAGE server credentials before privileged access.

Realtime browser code references only public configuration and the verified
user's short-lived access JWT. The bridge uses existing same-origin/custom-header
protection and HttpOnly SSR Auth; verified getUser/eligibility precedes getSession.
It returns only user accessToken, expiresAt and userId with private no-store.
No refresh token, cookie value or service key is returned/logged. Custom token
state is closure-only; the SDK storage adapter is a no-op. The credential-free
cross-tab logout notice stores only a timestamp. Logout clears token memory,
gates late callbacks, removes listeners/timer and tears down the channel.

Current browser and bridge Realtime guards are intentionally **staging-only**.
Production configuration creates no Realtime listener/socket/bridge polling.
Canonical production TEXT/IMAGE still work. Production guard enablement is a
separate reviewed application step in Phase 3E, not silently included here.

Own private `marketplace:messages:<Auth UUID>` receive policies and restrictive
namespace fences prevent cross-user reads and client spoof publishing. The fresh
release test rechecked cross-user rejection; private client publish denial and
public/private topic isolation retain the unchanged Phase 3B hosted evidence.
Payload remains conversationId, role, scope plus the platform notification id;
no body, URL/path, email, username or credential. The parser rejects other fields.
A copied valid access JWT remains a bearer capability until expiry; logout is
not claimed to revoke every copied token instantly.

Production-configured browser JS/maps and public assets were scanned: **107
files**, no configured service key or SUPABASE_SERVICE_ROLE_KEY reference.
No NEXT_PUBLIC_ privileged variable exists. Commit-eligible file scanning found
no configured secret, Supabase access token or credential-bearing database URI.

## Performance and limits

Phase 3C measured 12 GETs; this release run measured **15 conversation GETs in
5439 ms** for TEXT/TEXT/IMAGE/TEXT, with one channel. This is whole-batch time,
including mutations/upload and UI button lifecycle, not socket delivery latency.
Signals dirty role and active-history scopes; read acknowledgments can cause a
trailing list/history refresh to heal missed paired signals. Timing changes how
many batches coalesce. The queue has three constant dirty scopes, one in-flight
job per scope, at most two jobs concurrently, a 100 ms deadline and bounded
five-page catch-up. No unbounded growth or stale feedback loop was identified.
Do not optimize this number alone; application behavior remains unchanged.

Natural full JWT expiry was not waited through; the earlier real refreshed-JWT
test used disposable SSR expiry metadata. Actual OS sleep/wake, prolonged stress
and a heap/listener soak are not fully reproduced. Hosted frontend and production
Realtime remain undeployed. Typing, presence and live read receipts are excluded.
No new evidence makes these stated limits blockers.

## Exact Phase 3E rollout plan — not executed

1. Obtain explicit Phase 3E rollout authorization. Freeze/recheck candidate hash
   and clean target identity. Take a **fresh production logical backup immediately
   before rollout**, outside Git, of the current post-IMAGE state; verify it as below.
2. Reconfirm campus-marketplace identity, six-version history, compatible managed
   catalog/settings and no collision, using read-only checks.
3. Repeat the explicit production dry-run. Stop unless ONLY 202610080001 is pending.
4. Apply ONLY the frozen Realtime migration, without seeds, role changes, migration
   repairs, other migrations or manual managed-infrastructure edits.
5. Verify seven-version history, exact helpers/ownership/search_path/grants,
   five policies, two enabled triggers and no application publication changes.
6. Separately review and enable **both** browser and session-bridge production
   project gates, preserving exact project binding and all Auth checks. Update
   staging-only guard tests to verify both authorized mappings and mismatches;
   run focused tests/build. No hosted frontend deployment is implied.
7. With a safe existing signed-in production account on the local app, verify
   own private-topic join, normal Buying/Selling API reads, canonical Messages
   UI and leave/remount/logout cleanup. Do not solicit credentials or log JWTs.
   Empty history is a valid non-destructive single-account result; defer incoming
   mutation proof when no safe existing conversation exists.
8. Only if safe existing accounts/conversation and authorization are available,
   optionally send one agreed TEXT to verify two-account live delivery. Do not
   create production fixtures. IMAGE mutation remains deferred unless separately
   needed and authorized; staging already passed full E2E.
9. Remove any temporary local diagnostic page/route/artifact. Recheck target
   history/catalog and rerun TypeScript, focused lint, relevant tests, production
   build, browser secret scan, doc links and diff check. Report exact evidence
   and deferred scope. Do not commit/push/deploy without separate instruction.

## Failure and rollback plan — not executed

- Migration failure: stop; its transaction should roll back. Inspect actual
  catalog/history read-only before any retry; do not repair history blindly.
  Leave canonical Phase 1/2 APIs and production frontend guards unchanged.
- Authorization failure: disable/revert only production Realtime client/bridge
  enablement; inspect topic/private flag/verified session/policies. Do not relax
  RLS or publish message tables to bypass a failed join.
- Frontend connection failure: revert the optional Realtime integration/gates;
  durable API sends/reloads remain authoritative. Preserve all Phase 1/2 features.
- Delivery failure: reconcile via canonical APIs, investigate optional transport.
  If necessary, with explicit incident authorization, disable only
  messages_realtime_signal and conversations_realtime_signal (or remove only
  Phase 3 objects after dependency review). Keep unrelated triggers and Phase 1/2
  schema/data untouched; do not destructively restore the whole database merely
  to remove optional notifications. Restore reviewed objects via a deliberate
  forward recovery change and verify migration history consistently.

## Backup scope

The existing external pre-IMAGE checkpoint at
C:/Users/MLTZ/ProductionBackups/campus-marketplace/20261008T011038Z-pre-images/
still exists outside the repository (database.dump 345849 bytes; roles.sql 6327).
The existing archive was fully decoded offline to NUL successfully again; no
database restore was executed. Final audit completed at 2026-10-08T20:46:55Z.
It is **insufficient as the current post-IMAGE recovery checkpoint**. No new backup
was created in Phase 3D.

Immediately before 3E use native PostgreSQL **17.11 pg_dump/pg_restore**, existing
secure pgpass and TLS; no Docker or local PostgreSQL server. Recommended scope:
full custom-format schema/data dump of accessible production database schemas,
including application, Auth, Storage metadata, private helper/reservation/receipt/
cleanup state and migration history; separate roles/globals inventory without
role passwords (`pg_dumpall --roles-only --no-role-passwords`) using native tools
when permissions allow. Capture and report any managed-schema/role exclusions
instead of silently calling a partial dump complete. Record UTC timestamp,
server/client versions, command exit status, file sizes, SHA256, nonempty archive
TOC and full offline pg_restore decode to NUL. No restore against production.
Store all outputs outside Git with local access protection. Logical DB dumps
contain Storage metadata, **not Storage object bytes** or hosted Auth/Realtime
project settings; preserve object inventory/configuration separately if needed
for full disaster recovery. Phase 3 changes neither object bytes nor settings.

## Validation and checkpoint scope

Passed TypeScript; focused ESLint; ten local test scripts (TEXT/IMAGE API and
environment guards, image/presentation/conversation behavior, Phase 1/2/3 static
migrations, Realtime client/reconciliation and mocked Auth/session contract);
the hosted release run; production-configured optimized build; browser secret
scan (including a generic privileged-JWT source/output scan); documentation
links (178 local links across 25 Markdown files, zero broken); git diff --check.
Build exits 0 but still reports
the unchanged GlideSelect.jsx global naming-convention/parserServices issue and
Browserslist age warnings. Global lint is not claimed clean.

All Phase 3 changes since Phase 2 checkpoint **74d832d** remain uncommitted:

| Purpose | Files |
| --- | --- |
| Backend | supabase/migrations/202610080001_messages_realtime.sql; pages/api/messages/realtime-session.ts |
| Client/recovery | lib/messages-realtime.ts; lib/messages-reconciliation.ts; lib/listings-api.ts |
| UI/session | components/home/messages.tsx; message-history.tsx; message-photos.tsx; messages-chat.tsx; components/listings/marketplace-session.tsx |
| Tests | tests/messages-realtime-migration.cjs; messages-realtime-staging.cjs; messages-realtime-client.cjs; messages-realtime-e2e-staging.cjs; messages-realtime-browser-acceptance.cjs; messages-realtime-browser-regression.cjs; messages-realtime-browser-release-candidate.cjs |
| Documentation | docs/MESSAGES_REALTIME_DESIGN.md; MESSAGES_REALTIME_STAGING_VERIFICATION.md; MESSAGES_REALTIME_PHASE3C.md; MESSAGES_REALTIME_PHASE3D.md; PROJECT_STATUS.md |

The Git index is empty. .env.local, test artifacts, temporary runtime fixtures
and generated browser output remain ignored; no pgpass, backup, password,
access token or JWT/session artifact is commit-eligible. Temporary Phase 2E-B
diagnostic routes/pages remain absent. Reusable test source is retained; temporary
runtime harness output is removed. Dependencies, Next.js/PWA config, Phase 1/2
migrations and GlideSelect.jsx match the Phase 2 checkpoint.

**STAGING ACCEPTANCE COMPLETE. PRODUCTION DATABASE NOT MODIFIED by application
schema/data changes. PRODUCTION REALTIME NOT DEPLOYED. PHASE 1 TEXT PRESERVED.
PHASE 2 IMAGE PRESERVED. NO commit. NO push.**
