# Auth UX cleanup

## Final status — 2026-10-09

- Auth UX cleanup: **PRODUCTION DEPLOYED / VERIFIED**.
- Pending username correction migration: **PRODUCTION**.
- Existing-account sign-in transition: **VERIFIED** by the user's production observation.
- Messages/Realtime Auth regression: **VERIFIED** by the final production diagnostic.
- Real UWO email delivery: **DEFERRED UNTIL CUSTOM SMTP**.
- Payments: **NOT STARTED**. No commit or push.

Earlier staging/preflight/pending statuses below are historical checkpoints;
the final authorized production rollout and cleanup supersede them.

2026-10-08; baseline `a977fc9`. Local Auth UX plus authorized staging-only pending correction. **PAYMENTS NOT STARTED.
PRODUCTION DATABASE/SCHEMA UNCHANGED. New Auth migration applied to staging only; no production migration, deployment, commit or push.**
Phase 1 TEXT, Phase 2 IMAGE and Phase 3 Realtime source remain unchanged.

## Sign-in finding and fix

Existing flow: form run() clears its current error/status, POST sign-in calls
Supabase signInWithPassword, verifies the current Western user and establishes
HttpOnly cookies. onAuthenticated dismisses the form into the success reveal.
Previously prepareMarket() started router.push('/listings') while an independent
refresh() request ran concurrently; refresh failures were swallowed and marked
username-ready. That is a concrete ordering defect, **not proof of the cause of
the user's intermittent real-account report**. Its exact red error and real
failure were not reproduced or guessed.

Preparation now awaits the cookie-backed session/profile refresh, requires a
non-null authenticated seller, updates identity state, then navigates once and
waits for the existing destination readiness handshake. A subsequent session/
profile failure stays in the existing signed-in Market-retry reveal; retry repeats
bootstrap/navigation, not the credential POST. Timed-out preparation cannot
later navigate after its abort. The existing pending-intent guard prevents a
dismissed or duplicate completion from resurrecting navigation. Contact-seller
and recovery continuation behavior remains unchanged.

The form already cleared errors on new attempts; this was retained. New edit,
resume and successful code actions clear the prior action's errors. Successful
resend clears the old entered code. Genuine current failures remain visible.

## Actual signup architecture and constraint

Before this cleanup, **Send code**, not the final Hold-to-create control, invoked
signup-code / auth.signUp(email,password,metadata). It created an unverified Auth
user immediately and the existing create_profile trigger created/reserved the
username immediately. Username is both Auth metadata and canonical profile data;
password is assigned in Auth at that point. Email, password, username, agreement
and entered OTP in the form are volatile React state. The final Hold-to-create
control invoked verify-signup: verifyOtp, verified-user check and
marketplace_confirm_username. It did not save another password. Thus an editable
password after code issuance could misleadingly appear saved when it was not.

Resend calls auth.resend(type signup); it sends a confirmation for the same
identity and does not update credentials/profile. Provider confirmation tokens
are email-bound and rotated by a successful send; rate/send failures do not
advance our form step. See [Supabase resend](https://supabase.com/docs/reference/javascript/auth-resend)
and [confirmation implementation](https://github.com/supabase/auth/blob/master/internal/api/mail.go).
The app does **not** assume repeating signUp updates an existing unconfirmed
user's password or metadata: current [provider signup source](https://github.com/supabase/auth/blob/master/internal/api/signup.go)
explicitly avoids updating that user. A same-name fresh signup also fails the
existing availability check because its profile already reserved the name.

The newly authorized [pending correction migration](../supabase/migrations/202610090001_auth_pending_username.sql)
adds a narrow exception for an owned, unverified registration. Applied migrations
were not edited. The existing verified-account trigger still uses
`now() < old.username_changed_at + interval '168 hours'`, starts/restarts the
clock on actual username changes, treats exact no-op as unchanged, and retains
case-insensitive uniqueness and 30-day verified rename holds.

Pending signup has no authenticated Supabase session. Instead, signup generates
a random 256-bit capability on the server and passes it to the original Auth
INSERT. The profile trigger binds its SHA-256 hash to that new user's UUID and
strips the plaintext from persisted metadata. Repeated signup cannot bind a
new capability to an existing account. The browser receives only an HttpOnly,
SameSite=Lax cookie scoped to /api/auth (Secure on hosted production); it is
not returned in JSON or readable by browser JavaScript. It expires after 24
hours and survives a same-browser refresh. Earlier/expired registrations can
still verify their original details but cannot use this new correction capability.

The service-only `marketplace_correct_pending_username` RPC takes the cookie
capability, email and candidate, never an arbitrary target UUID. It checks the
private hash/expiry and locks the matching Auth row, then checks authoritative
`auth.users.email_confirmed_at IS NULL` and exact normalized Western email.
A browser verification boolean or claimed user ID has no effect. The server
client fails closed for unknown/mismatched projects or service-role credentials.
Anonymous/authenticated callers cannot execute the RPC or write its private
control table; profile username UPDATE grants/RLS remain unchanged.

The RPC uses the existing advisory lock and profile unique index. A private,
transaction-bound marker allows the identity trigger to omit only the pending
rename cooldown/history hold. Validation/reserved names/current owners/other
release holds still apply. On failure the entire transaction rolls back. On
success the old pending username is available, the new profile/display name and
Auth metadata agree, and the cooldown timestamp restarts for the eventual
verified account. Already verified accounts are rejected even through the
service-only RPC.

Correction also clears confirmation_token and deletes only confirmation-token
rows from auth.one_time_tokens in the same transaction. Other recovery/email
change tokens are not modified. This uses the hosted Auth token stores described
in [Supabase token source](https://github.com/supabase/auth/blob/master/internal/models/one_time_token.go).
Hosted staging tests actually submitted an old OTP to GoTrue after correction
and confirmed rejection; this is not an assumption about resend semantics.
The old application payload cannot confirm a different canonical username.

## Updated actions and verification semantics

- **Create** submits valid signup details and begins verification. It reuses
  StatefulButton's spinner/check/error states; an opt-in retainSuccess prop keeps
  the blue Code sent check until editing/mode change/unmount. It cannot be clicked
  again in that completed state. Other StatefulButton consumers keep their
  original default behavior, including Messages.
- **Verify code** submits the current code, verifies email/Western eligibility
  and confirms the reserved username before any optional password update.
- **Resend code** requests a new confirmation for the same identity, preserves
  credentials, keeps the existing countdown and clears the old code on success.
- **Edit signup details** returns to editable fields without clearing email,
  username, password or consent. It clears the code/current verification step,
  hides password reveal, preserves the pending identity and requires a successful
  new send before Verify becomes available again. Same-email continuation uses
  resend, not another account/profile insertion.
- **Resume verification** supports reload/back/dismissal after a code was already
  requested. Re-enter the original reserved username and current credentials;
  the action requests another code rather than creating a user. With the existing pending cookie, it also reconciles an edited username before resend. Nothing in this
  local draft is authentication: OTP and the existing profile RPC must pass.
- **Retry** is only the reusable button's actual failure state for that operation.

Passwords remain in volatile form/ref memory only. Initial unchanged signup still
has **no second password write**. For a changed/resumed password the API updates
the verified owner's password only after OTP and username confirmation. A
same_password response means the desired password is already set and succeeds;
other update errors close the local session and direct the user to recovery.
Recovery's existing verification/password-write path is unchanged. Wrong/expired
OTP or wrong profile username cannot reach the edited-password write.

Changing email begins verification for that new address and clears the old
challenge UI. A code for the old email cannot verify the new email. A different
email represents a different Auth identity; its username must be available.
The abandoned old unverified registration is not automatically deleted, merged
or renamed. Username-only same-email edits explicitly call the hardened pending correction
API before resend; they do not bypass the verified-account cooldown. OTP verifies email ownership, not a password value;
the optional password assignment is an explicit action after that proof. No
server-role browser client is introduced. Only the narrow HttpOnly pending cookie
and its private database hash are added.

Shared run() pending protection prevents overlapping Create/Verify/Resend/sign-in;
controls disable while the task is pending. The success button has its own
pending/completed guard. Editing cannot run during an in-flight request.

## Verification and limits

[Auth API regression](../tests/auth-modal-api.cjs) uses the installed Supabase
SDK with mocked HTTP transport: cookies/session, password rules, signup metadata,
OTP/profile ordering, unchanged initial password path, edited/resumed password,
same-password handling, failure sign-out, old-code and mismatched-username rejection,
legacy login, recovery, safe diagnostics and same-origin guards.

[Browser regression](../tests/auth-ux.browser.cjs) runs the actual local UI with
intercepted Auth/listing transport and blocked hosted traffic on an isolated
server. It checks 390/430/1280/1536: failed-then-successful login, delayed bootstrap
before navigation, stale-error removal, retained blue check beyond the former
two-second reset, one Create request on double-click, editable preserved values,
fresh code/old-code rejection, password saved after verification and pending username
correction. The 390 case additionally checks another account, bootstrap failure then
Market retry without re-login, refresh session, email separation, duplicate Resend,
pending reload/resume without duplicate accounts, and recovery UI.
The one-second resend countdown is accelerated in the fixture; real request/button
timing remains. Mobile/desktop screenshots were inspected for overlap/overflow,
then removed with the isolated server output after verification.

The browser suite uses **mocked transport**, not live hosted email delivery.
Additional [PostgreSQL tests](../tests/auth-pending-username-db.cjs) execute the
real new SQL alongside the original username migrations and test ownership,
private controls, rollback, release, token invalidation, uniqueness races,
direct-write denial and verified cooldown. The original complete username DB
regression also passes.

[Hosted staging tests](../tests/auth-pending-username-staging.cjs) pin all network
and CLI targets to western-marketplace-staging. The successful run used explicitly
unverified admin-created disposable accounts and admin-generated valid OTPs,
not manually supplied credentials or inbox access. It passed A/G correction +
fresh hosted OTP verification + intended username/password, B release, C taken
name rollback, D actual GoTrue old OTP/stale application rejection, E verified
cooldown/privilege denial, F competing concurrent claims and ownership, H no
duplicate users/profiles. Fixture users/profiles/private capability rows were
removed and checked zero. No production connection was made.

## Fresh signup routing and origin checkpoint

The new read-only diagnosis found one staging `/auth/v1/resend` request at
2026-10-09 02:50:29 UTC, status 200, associated with localhost:3000. Auth/gateway
entries had the same request ID. There was no `/signup` in the inspected two-hour
window, no UWO Auth user, and no confirmation-request audit event. The built-in
provider had no custom SMTP/email hook and no UWO organization member. This was
a nonexistent-user resend no-op, not evidence that an email was delivered.
No recipient addresses, credentials or OTPs are retained here.

The proven implementation gap was an always-available Resume action calling
resend without pending ownership validation. Its generic provider 200 was shown
as a successful send and created a local draft even though no user existed.
The shared send handler also selected resend from sentEmail/registration refs.
That is an unsafe source of routing authority. Which control the user actually
clicked, and why they used the 3000 context, were not observed and are not guessed.

Create now supplies an explicit create intent and always uses signup-code;
Resend/Resume/Send new code supply a distinct resend intent. Every resend API
request must pass the existing hardened RPC's capability hash/expiry, email
ownership and authoritative unverified-state check before auth.resend. No-cookie,
stale/deleted draft, mismatched capability and verified-state failures give the
same non-enumerating message. Browser booleans cannot prove account existence.
An unavailable draft is cleared locally and returns to Create, without automatic
signup fallback or another email attempt. Correction and the verified seven-day
cooldown are unchanged. No migration or hosted config/data change was needed.
Resume is limited to the original browser's valid pending capability; it is not
an email-address existence probe.

All application Auth fetches use relative paths with same-origin credentials;
Marketplace navigation uses relative /listings. No 3112-to-3000 redirect, rewrite,
absolute Auth base URL or intentional proxy was found. Existing PWA Auth routing
is NetworkOnly and development disables the service worker. Service workers are
origin scoped. Cookies on the same hostname are not port scoped, so separate
users must use separate browser contexts; the intended 127.0.0.1:3112 context also
has a different hostname from localhost:3000. The old isolated capture had zero
sends; the 3000 log event was not its request. No silent proxy was established.

Deterministic tests now pin the actual UI to http://127.0.0.1:3112, disable service
workers, intercept transport and block hosted traffic. They assert all Auth
requests retain that origin. The real SDK API tests assert:

- Fresh Create: exactly one provider /signup, zero /resend.
- Valid owned pending Resume/Resend: database proof, then exactly one /resend.
- Stale/missing/verified proof: zero provider resend; generic rejection.
- Create with stale capability: one /signup, zero /resend or correction RPC.
- Deleted server fixture with a surviving UI ref: no send, draft resets; explicit
  Create then sends one signup and no resend, including double click protection.
- A request from localhost:3000 to host 127.0.0.1:3112 is rejected before provider
  access. Actual browser cross-origin Auth requests: zero at all four widths.

**AUTH UX CODE: READY TO CHECKPOINT. REAL UWO EMAIL DELIVERY: DEFERRED UNTIL
CUSTOM SMTP IS CONFIGURED LATER.** No SMTP setup or real email sends occurred
in this routing fix. Hosted mutation/security evidence from the previous staging
run remains distinct from mocked email transport tests. Production migration
remains not applied. No production connection, Payments, deployment, commit or push.

The unknown intermittent real-account error remains unproven. Legacy historical
Auth visual scripts were not claimed fully revalidated; the new focused suite
describes the current Create/Verify/Edit contract explicitly.

Passed TypeScript, focused ESLint, the browser suite, Auth API, marketplace-session,
Realtime client/auth lifecycle, TEXT/IMAGE API guards and all three Messages static
migration tests. Production-configured build exits 0 and browser JavaScript assets/maps
contain no configured service key or its environment reference. Existing global
GlideSelect.jsx parserServices lint debt and Browserslist age warnings remain
unchanged; global lint is not claimed clean. 189 local documentation links and diff checks
pass. No credential, token or local artifact is commit-eligible.

## Final validation command/process notes

The previous custom programmatic node -e build invocation repeatedly entered
build-worker startup and did not finish. This was a local validation-command /
process issue; the temporary build processes were stopped. No application code
or Auth configuration was changed as a workaround.

The final run uses the normal Next CLI entry (node node_modules/next/dist/bin/next
build) under NODE_ENV=production and the existing production APP_ENV/project
configuration. Temporary ignored validation preloads verify production settings and block hosted
fetch in the build/worker processes. The standard CLI produced its normal .next
output; the final browser scan checks that actual output. No permanent config
change was made.
Validation NODE_OPTIONS includes --openssl-legacy-provider: the initial isolated
CLI environment omitted that compatibility flag and reported
ERR_OSSL_EVP_UNSUPPORTED in inherited Webpack hashing under Node 24.13.0.
This is a build-environment issue, separate from Auth behavior. No production
network request, email send, permanent config edit or application workaround is
part of the corrected command. Temporary validation files are removed afterward.

Final checks cover TypeScript, focused ESLint, Auth/session and exact signup/resend
path counts, pending migration static checks plus execution in embedded PostgreSQL,
the original username/cooldown regression, Marketplace session, TEXT/IMAGE/Realtime
auth and migration regressions, and the actual UI at 390/430/1280/1536 on
127.0.0.1:3112 with mocked transport. Browser privileged-secret scanning (49 assets), 189 local
documentation links and git diff --check pass and complete the checkpoint audit.
The unchanged global GlideSelect.jsx parserServices issue is pre-existing debt;
focused lint passes and global lint is not claimed clean.

**AUTH UX IMPLEMENTATION: READY FOR PRODUCTION PREFLIGHT.** All final checks
passed; the corrected production-configured build exited 0. **REAL UWO EMAIL DELIVERY: DEFERRED UNTIL CUSTOM SMTP IS CONFIGURED.**
Production Auth migration remains not applied. No commit or push.

## Files and remaining work

Changed/new Auth sources: components/auth/auth-modal.tsx;
components/velora/auth-signup-card.tsx and auth-signup-card.module.css;
components/velora/stateful-button.tsx; pages/api/auth/[action].ts;
lib/server/pending-signup.ts; lib/auth-pending.ts; the new migration above. Tests:
auth-modal-api.cjs, auth-ux.browser.cjs, auth-pending-username-db.cjs and
auth-pending-username-staging.cjs. Documentation: this file and PROJECT_STATUS.md.

The earlier staging dry-run proposed ONLY 202610090001_auth_pending_username.sql;
that file was applied to staging and its history entry verified. It was not changed
or reapplied in this routing fix. **PRODUCTION MIGRATION
REMAINS PENDING**; production was not contacted. Real email acceptance is deferred until custom SMTP is configured later, per
the latest user scope; it is not claimed passed. The original
intermittent real-account sign-in error remains unproven.

**STAGING ONLY. PRODUCTION UNCHANGED. PAYMENTS NOT STARTED.
PHASE 1/2/3 MESSAGING PRESERVED. NO commit. NO push.**

## Production preflight — 2026-10-09

**READY FOR AUTH UX PRODUCTION ROLLOUT.** This section records subsequent
read-only production verification; earlier staging-only statements above describe
the implementation and validation runs, not this preflight.

Hosted project inventory and the local link identify campus-marketplace /
`yzvchumzyonegujucyqs` as production and western-marketplace-staging /
`pcaqxezdfxofysghssyo` as staging. Native psql used the existing pgpass/TLS
connection with default_transaction_read_only enabled. Production history has
exactly 202609290001, 202610030001, 202610040001, 202610050001,
202610070001, 202610070002 and 202610080001. The pending control table and
correction RPC are absent. The fresh CLI dry-run, explicitly pinned to production
with --dry-run --skip-vault, proposes ONLY 202610090001_auth_pending_username.sql,
with no roles or seeds.

Candidate file SHA-256:
`e94bbdb229c65bd14bb55017fdd36e9e9a755f57dc53c2a8b6568e491a7c2c8d`.
All ten statements exactly match staging migration history after only CRLF/LF,
outer whitespace and statement-delimiter normalization. Supabase history does
not retain an original file-byte hash, so that comparison proves applied SQL text
equivalence rather than an independently stored original-byte digest.

Production profile/history columns, generated normalized username, unique index,
RLS, Auth triggers, token columns and confirmation enum, and SHA-256 primitive
are compatible. All six username dependency function bodies match the original
reviewed username migration. Function owners, hardened search paths and grants
are intact; authenticated clients cannot UPDATE username or its cooldown column.
The candidate preserves the 168-hour verified cooldown, uniqueness/advisory lock,
reserved-name checks and verified release holds. Pending correction requires
service-only EXECUTE plus a matching unexpired capability and authoritative
unverified Auth row; there is no arbitrary target UUID or client verification flag.
No previously applied migration was edited; Phase 1/2/3 remain unchanged.

Local production APP_ENV/public project URL and server credential role/project
claims pass without printing values. The project guard rejects unknown/mismatched
designations. The capability cookie is HttpOnly, SameSite=Lax, /api/auth scoped,
24-hour lifetime, non-Secure only for localhost/127.0.0.1 production smoke,
and Secure for hosted production HTTPS. No NEXT_PUBLIC_ service-role variable
exists. No configuration change was made.

The prior full local validation remains applicable: application code did not
change during preflight. Focused Auth API/request-path and actual PostgreSQL
pending-ownership/cooldown tests were rerun successfully; git diff --check passes.
The production build, four browser widths, environment/Marketplace/Messages
regressions, browser secret scan and documentation-link results above remain
valid. GlideSelect.jsx global lint debt is unchanged. Real UWO email delivery
remains DEFERRED until custom SMTP; it does not block code acceptance.

### Rollout sequence — prepared, not executed

1. Immediately before applying, create a fresh post-Phase-3 logical backup at
   `C:/Users/MLTZ/ProductionBackups/campus-marketplace/<UTC-YYYYMMDDTHHMMSSZ>-pre-auth-ux/`.
   Use native pg_dump custom format for database.dump and pg_dumpall --roles-only
   --no-role-passwords for roles.sql, via existing pgpass and TLS. Record UTC
   start/end, tool/server versions, sizes and SHA-256 hashes; save archive-toc.txt,
   backup-manifest.json and SHA256SUMS.txt. Require successful exits, nonempty
   files, pg_restore --list and full offline decode to NUL. This includes the
   post-Realtime schema and migration history; Storage object bytes are separate.
   No backup or restore was performed in this preflight.
2. Recheck the hosted production name/ref, local project binding and backup.
3. Repeat the production-pinned --dry-run --skip-vault; stop unless only the Auth
   migration is proposed and its recorded candidate hash still matches.
4. Under separate rollout authorization, apply ONLY
   202610090001_auth_pending_username.sql with --skip-vault and no roles/seeds.
5. Read-only verify migration history, table RLS, private grants, service-only RPC,
   hardened functions, authoritative verification checks and preserved cooldown.
   Rely on the passing staging/local mutation tests; do not create production data
   or attempt a production username change to test the cooldown.
6. Run a non-destructive existing-account login/session smoke; verify Marketplace,
   refresh, Messages and Realtime lifecycle. Send no signup/resend emails.
7. Remove temporary smoke files/session artifacts, run the final security/Git
   checkpoint audit and report results.
8. Commit/push the Auth cleanup only after separate explicit authorization.

**PRODUCTION NOT MODIFIED. AUTH MIGRATION NOT APPLIED. NO EMAILS SENT.
SMTP NOT CONFIGURED. PAYMENTS NOT STARTED. PHASE 1/2/3 PRESERVED.
NO commit. NO push.**

## Authorized production rollout — 2026-10-09

**PRODUCTION AUTH MIGRATION APPLIED / EXISTING-ACCOUNT SMOKE VERIFIED.**
This supersedes the preflight-only status above. Production target remains
campus-marketplace / yzvchumzyonegujucyqs; no staging or other migration was applied.

Fresh backup outside Git:
`C:/Users/MLTZ/ProductionBackups/campus-marketplace/20261009T041034Z-pre-auth-ux/`.
Native PostgreSQL 17.11 custom pg_dump and password-free roles-only pg_dumpall
succeeded using existing pgpass/TLS. Archive TOC and full offline pg_restore
decode to NUL passed, all files are nonempty, and recorded SHA-256 checksums match.
UTC start/end and tool/server versions are in the manifest. This backup captures
post-Realtime, pre-Auth state; Storage object bytes are not included.

| File | Bytes |
| --- | ---: |
| database.dump | 549485 |
| roles.sql | 6173 |
| archive-toc.txt | 68378 |
| backup-manifest.json | 1214 |
| SHA256SUMS.txt | 329 |

The candidate SHA-256 still matched the preflight digest. The final dry-run
proposed ONLY 202610090001_auth_pending_username.sql, with no seeds/roles.
That migration applied successfully using --skip-vault. It appears exactly once
in production history; a subsequent dry-run reports no pending migrations.

Post-apply verification confirms postgres ownership, SECURITY DEFINER and empty
search_path for the new RPC, EXECUTE only for postgres/service_role, private
control-table RLS with no anon/authenticated/service_role direct access, and zero
control rows immediately after apply. Source checks confirm authoritative
email_confirmed_at, expiry, Auth row locking and the existing 168-hour verified
cooldown. Authenticated direct username/cooldown UPDATE remains denied. No
production pending users or username changes were manufactured to test this;
staging remains the mutation evidence. Messaging functions, triggers, policies
and publication membership have identical pre/post fingerprints:
cb512a22eaabfd958deeee6982e1dd43. Existing migration files remain unchanged.
Production DB lint reports no schema errors; no auto-fix was performed.

Final TypeScript, focused ESLint, Auth API/session/request-path, pending username
PostgreSQL, original username/cooldown, Marketplace, TEXT/IMAGE/Realtime and all
three messaging migration tests pass. The production-configured Next CLI build
exits 0 with hosted build fetch disabled by a temporary ignored preload. Existing
GlideSelect.jsx global parserServices lint debt and Browserslist warnings remain
unchanged. Browser secret scan passes for 49 assets; 181 relative local links
under docs pass. Git-eligible secret/local-only scan passes and the index is empty.
Real UWO email delivery remains DEFERRED UNTIL CUSTOM SMTP.

The user manually confirmed existing production account sign-in succeeds and
successful authentication enters Market normally. The original reported issue
was the post-authentication transition, not failure of Login itself; do not claim
a reproduced Login defect. These two production smoke checks are accepted without
another sign-in attempt. Remaining existing-session, Messages, one-channel,
logout/zero-channel and post-logout 401 checks are pending.

A temporary ignored
localhost-only harness observes normal app requests and private Realtime channel
counts without displaying credentials, cookies, JWTs or response bodies. It does
not create users, listings, conversations or messages. Final smoke evidence and
artifact cleanup must be recorded before declaring the checkpoint complete.
The harness now reuses existing cookies, accepts the manual sign-in/Market
observation and contains no sign-in/signup/resend/verification request actions.
The browser connector exposes no browser or tabs, so remaining evidence requires
the user's diagnostic output from the same authenticated browser profile.

The first existing-session diagnostic confirmed session HTTP 200/authenticated
but did not exercise Messages. Harness review found that /home defaults to
Profile, its Open Home action omitted section=messages, and API probes waited
for a successful channel join. WebSocket instrumentation was also installed at
iframe load, which could miss a channel created during hydration. These are
temporary harness defects, not evidence of an Auth/Login defect.

The corrected ignored localhost server opens the normal
/home?section=messages&destination=buying route with a diagnostic-only marker,
inserts instrumentation before Next hydration, reports normal-app Buying/Selling
and bridge statuses, and performs independent read-only API probes. UI detection
uses the actual Messages section rather than desktop-only heading text. Explicit
stages, timeout/error counters and promise handling replace silent waiting.
The normal unmarked route has no injected instrumentation. The actual compiled
app passed auto-mount, one-channel private join, logout cleanup and post-logout
401 checks in an isolated headless browser with synthetic Auth/API/WebSocket
transport and external traffic blocked. Blocking service workers caused a local
PWA test setup error; allowing the existing local PWA in that isolated context
resolved it without an application change. This proves the harness flow only;
live production Messages/API/channel evidence remains pending user execution.

Subsequent user-provided production diagnostics pass the substantive flow:
session 200/authenticated, both probe and normal-app Buying/Selling 200, bridge
200, Messages rendered, private join succeeded, maximum channels one, logout 200,
channels zero and post-logout API 401. Runtime/probe errors and timeout are zero.
Final passed=false solely because one unhandled rejection was recorded. The old
harness retained only its count, not its reason/stack; classification is pending.
No Auth, signup, migration or application behavior was changed on that evidence.
Temporary diagnostics now capture bounded redacted rejection name/message/stack,
frame source, stage and session-ended timing without suppressing the rejection.
A synthetic local capture/redaction check passes. A real capture or retained
browser-console reason is required before attributing it to harness cleanup or
application teardown and declaring the checkpoint complete.

The final user-provided production rerun passed. Session authentication and both
probe/normal-app Buying/Selling APIs are HTTP 200; bridge HTTP 200, Messages UI
rendered, private join succeeded and maximum channel count is one. Logout is
HTTP 200, channels are zero afterward and the authenticated API returns 401.
Runtime errors, unhandled rejections and probe errors are zero, rejectionDiagnostics
is empty, timedOut=false and passed=true. This supersedes the pending smoke gate.
The earlier single rejection's source was not captured and remains undetermined;
it did not recur in the final instrumented run. It is not claimed to prove a
harness artifact or an application defect. No application change was made for it.

Local harness availability was also corrected: a competing IPv6 Next dev server
returned 404 while the IPv4 harness returned 200. The temporary wrapper served
both loopback addresses, preserving localhost cookies and rejection diagnostics.
It used the local dev-mode app with the production project binding after the
normal dev server replaced the earlier build cache. Final production build
validation is performed separately; no hosting or Auth configuration changed.

Final cleanup stopped only the verified temporary harness process, removed the
entire ignored tests/artifacts/auth-rollout directory, and verified HTTP 404 for
both /__auth-rollout-smoke.html and /__auth-rollout-instrument.js on the normal
localhost app. The normal dev server was preserved. No smoke route, instrumentation,
credential/session dump or generated fixture is retained for the checkpoint.

Final checkpoint validation passes: TypeScript, focused Auth ESLint, Auth/session
and signup/resend API tests, pending correction and original username PostgreSQL
tests, Marketplace session regression, TEXT/IMAGE/Realtime Auth/environment tests,
and Phase 1/2/3 migration static tests. The production-configured standard Next
build exits 0; its actual .next/static output and public browser assets pass the
privileged-secret/smoke scan (49 assets). Next ignored the temporary distDir hook,
so no isolated build output is claimed. The temporary validation preload was
removed after scanning. Existing GlideSelect.jsx global parserServices lint debt
and Browserslist warnings remain unchanged; focused lint passes.

181 relative local documentation links and git diff --check pass. The external
pre-Auth backup remains nonempty with matching checksums and full offline archive
decode passing again. Git status has seven modified and seven new Auth source,
migration, test and documentation files; no deleted or staged files. The index
is empty. Git-eligible configured-secret/JWT/local-only scans pass: no .env.local,
service credential, access/refresh token, Supabase token, database password,
pgpass, production backup, staging credential, temporary smoke/session dump or
test artifact is eligible. This final audit made no Supabase calls, applied no
migration and sent no emails.

**SAFE FOR AUTH UX CHECKPOINT COMMIT. PRODUCTION DEPLOYED / VERIFIED.
REAL UWO EMAIL DELIVERY DEFERRED UNTIL CUSTOM SMTP. PAYMENTS NOT STARTED.
PHASE 1/2/3 PRESERVED. NO commit. NO push.**

**NO EMAILS SENT. SMTP NOT CONFIGURED. PAYMENTS NOT STARTED.
PHASE 1/2/3 PRESERVED. NO commit. NO push.**
