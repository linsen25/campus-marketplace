# Messages Phase 1E-B — controlled production TEXT rollout

2026-10-07. The explicitly authorized production migration succeeded. The
frontend remains local, not hosted. **Authenticated production smoke PASSED**
with an existing account, confirmed by the user and credential-free HTTP evidence.
The final text-only empty-state refinement and isolated responsive checks passed.
Phase 1E-B is complete within this scope; two-account mutation testing is deferred.

## Target, backup and final dry-run

CLI confirmed `campus-marketplace`, ref `yzvchumzyonegujucyqs`, production.
`western-marketplace-staging` remains linked, so every production command used
the explicit production ref; no command relied on the default linked target.

External backup:
`C:/Users/MLTZ/ProductionBackups/campus-marketplace/20261007T191844Z-39c743ba/`.
Native PostgreSQL 17.11 created a 312,805-byte archive, 6,172-byte password-free
roles export and 39,575-byte TOC. The archive contains 512 entries/41 table-data
entries and previously passed full pg_restore decoding to NUL without executing
SQL. This phase rechecked its existence and unchanged SHA256:
`5d9f5ecbdce8525e6203e6a507df394fd6dd5e798df7ea3cbf4efb3ae0455591`.
The external manifest records timestamps/hashes. No backup restore occurred;
physical Storage bytes are not part of that logical archive.

Before mutation, history matched the first four versions, both Messages tables
were absent and the unchanged migration SHA256 was
`2ee6cb35370c05cbc76d57fa78efd319cda24c1987cb8a5cbf5593121a3d4b7f`.
Final production dry-run proposed only `202610070001_messages_text.sql`, with
no seeds or roles. All prerequisites matched; none required repair/patching.

## Migration application

After explicitly reporting the production target, executed the normal workflow:

```powershell
npx.cmd --no-install supabase db push --linked --project-ref yzvchumzyonegujucyqs --skip-vault
```

CLI applied **only 202610070001_messages_text.sql** successfully. No manual SQL
Editor fragments, migration edits, history repair, seeds/role updates, Vault secret
updates, rollback or reapplication. Post-application local/production history:

| Version | Production state |
| --- | --- |
| 202609290001 | Applied, matches local |
| 202610030001 | Applied, matches local |
| 202610040001 | Applied, matches local |
| 202610050001 | Applied, matches local |
| 202610070001 | Applied, matches local |

## Structural and privilege verification

Read-only catalog comparison with the verified staging implementation passed:

| Category | Verified count |
| --- | ---: |
| Tables | 2 |
| Columns/defaults/generated expressions | 24 |
| Constraints | 22 |
| Indexes | 9 |
| Functions, including three public RPCs | 8 |
| Triggers | 5 |
| SELECT policies | 2 |
| Function privilege entries | 11 |
| Relation privilege entries | 26 |

Both `public.conversations` and `public.messages` exist with RLS enabled. All
constraints are validated, indexes valid and triggers enabled. Authenticated has
SELECT, but no table/column INSERT or UPDATE and no DELETE; anon has no SELECT.
Public RPCs `marketplace_find_or_create_conversation`, `marketplace_send_text` and
`marketplace_mark_conversation_read` are executable by authenticated, not anon or
PUBLIC. Hardened function definitions, identity/FK/snapshot restrictions, TEXT
checks, sequence/nonce uniqueness, read watermarks and immutable-message triggers
match staging. This is structural verification, not a production mutation or
concurrency test. Staging already supplies behavioral/concurrency evidence.

Production database lint (`db lint --linked --project-ref yzvchumzyonegujucyqs`)
returned results=[] and **No schema errors found**. No lint warnings or auto-fixes.
At structural verification, production had profiles=1, listings=0,
conversations=0, messages=0. Only aggregate counts were reported.
Final native PostgreSQL read-only recheck at 2026-10-07T19:40:35Z confirmed
all five migration versions and conversations=0/messages=0 again.

Ignored local evidence: `tests/artifacts/messages-phase1e-b/structure.sql`,
production/staging structural JSON, comparison and safe local smoke observations.

## Local production configuration and smoke

Existing `.env.local` points to campus-marketplace with a public key. Build and
local server use **APP_ENV=production**; `.env.local` hash stayed
`476751f10507725f4f24852621c856badf467f85a2c27f923072069a6267b504`.
No secrets were printed and no environment file or backend implementation changed.

Production-configured `next build --no-lint` passed under Node 24.13.0. The built
app runs locally at `http://localhost:3105`; this is not a hosted deployment.
Computer-use inventory returned no available browser, so automated observation
of the user's existing browser was unavailable. The user confirmed a safe existing
account was used for the user's manual local sign-in and Buying/Selling inspection.
The refined production-configured build was also tested locally on port 3106
using fully intercepted API fixtures, separately from this authenticated smoke.

Completed unauthenticated HTTP smoke:

- `/`, `/home?section=messages&destination=buying`, `/listings`: 200.
- `/api/auth/session`: 200 with authenticated=false in the independent anonymous
  request; no fabricated session.
- Both anonymous role-list requests: expected 401, without environment-gate 503.

Authenticated session, Buying/Selling, switching and zero-conversation UI outcome
are **PASSED**, as confirmed by the user. They reported no 500/503, missing
relations/RPCs, visible RLS or environment-gate errors. Credential-free local logs
corroborate three authenticated session checks with status 200, Buying/Selling
list responses with status 200 and zero conversations, no Messages API 5xx and
no upstream project mismatch. The observed checks occurred on 2026-10-07 at
17:23-17:24 America/New_York (21:23-21:24 UTC). This is user-assisted authenticated
smoke, not an agent-observed browser console test.

A temporary ignored local preload records only route
categories, status codes, authenticated booleans and list counts; it forwards real
responses unchanged and stores no password, cookie, token, user ID, message content
or personal DTO. It does not mock auth or bypass RLS. User browser console
checks cannot be claimed as agent-observed while browser access is unavailable.

## Final empty-state refinement and responsive regression

`components/home/messages.tsx` reuses the same `WorkspaceEmpty` component as
Favorites, including its #c1adcf muted color, inherited 14px/400/1.5 typography,
centered text, zero paragraph margin and existing 27.5% content anchor. No new
card or Favorites toolbar structure was copied. Both Buying and Selling render
only the empty-state text after a successful zero-conversation result. The desktop
ClientCard and mobile list/chat surface mount only when conversations.length > 0.
The application shell, headings, sidebar and mobile header/bottom navigation stay.
Populated-state JSX, history, composer and selection architecture are unchanged.

`tests/messages-empty.browser.cjs` exercises the built local app with every API
request intercepted and external requests blocked; no fixtures reach Supabase.
It compares computed empty text styling to Favorites, asserts no empty conversation
card, switches Buying/Selling and verifies four populated fixtures, canonical
activity sorting, unread indicators, desktop recent-three/+1/expanded-four list,
conversation selection and mobile chat/back. Existing service-worker isolation and
navigation-animation waits are used. No page errors after isolation.

| Width | Buying empty | Selling empty | Favorites text style | Populated UI |
| --- | --- | --- | --- | --- |
| 390 | PASS | PASS | MATCH | PASS |
| 430 | PASS | PASS | MATCH | PASS |
| 1280 | PASS | PASS | MATCH | PASS |
| 1536 | PASS | PASS | MATCH | PASS |

Screenshots and JSON results are in `tests/artifacts/messages-empty/` (ignored),
with `<width>-buying-empty.png`, `<width>-selling-empty.png` and
`<width>-populated.png`. Empty-state screenshots were visually inspected at all
four widths: no oversized inner panel/border, shared muted placement, mobile
bottom navigation unobstructed. Populated screenshots preserve the existing UI.

## Two-user tests, cleanup and feature limits

No pair of safe production accounts is available to this run: production has one
profile and the user offered one existing account. Two-participant send/reply,
unread, repeat entry and refresh mutation testing are deferred; no arbitrary Auth
users, forged login, SQL fixtures, listing or messages were created. Sold/deleted
workflow testing is skipped and relies on the passing Phase 1D staging evidence.
No concurrency/load test against production. No test-data cleanup is necessary.

Production is TEXT-only: the IMAGE reservation retains its TEXT-only constraint;
no public.message_images, chat-images bucket or Messages Realtime publication.
Local chat still passes sendEnabled=false to Attachment Composer. listing-images
is not used for chat. No Realtime integration, durable IMAGE upload, N+1 optimization
or Messages refactor was added.

## Final checks and files

Passed TypeScript --noEmit --incremental false; scoped relevant ESLint; local API
and environment-gate tests (valid staging/production accepted, mismatch/unknown/
secret config rejected before network); static migration source contract;
conversation-state; message-presentation; message-images; production-configured
build; live catalog assertions and `git diff --check`. Browserslist staleness is
the existing build warning. No staging-mutating harness was pointed at production.
Documentation file/heading checks passed for 99 local links across 15 Markdown files.

Final refinement edits `components/home/messages.tsx`, adds the isolated browser
test, and updates this report and `docs/PROJECT_STATUS.md`, plus ignored evidence.
Migration source, backend runtime code and .env.local are unchanged.
All unrelated working-tree edits are preserved. No public frontend/site deployment
or hosted monitoring is claimed.

PRODUCTION MIGRATION APPLIED: YES

MESSAGES TEXT DATABASE/BACKEND: PRODUCTION DEPLOYED

AUTHENTICATED MESSAGES UI: LOCALLY VERIFIED AGAINST PRODUCTION

AUTHENTICATED PRODUCTION UI SMOKE: PASSED

HOSTED FRONTEND DEPLOYED: NO

REALTIME: NO

DURABLE IMAGE BACKEND: NO

IMAGE SEND: DISABLED / GATED

TWO-ACCOUNT PRODUCTION MUTATION TEST: DEFERRED (staging E2E verified)

NO commit

NO push

No database changes or production tests were performed for the final UI refinement.
Hosted frontend deployment and the deferred production mutation test are outside
this completed phase; no public website deployment is claimed.
