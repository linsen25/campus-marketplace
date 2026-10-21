# B04 — Authenticated Settings password change

Local implementation and separately authorized Staging acceptance complete.
Staging validation used only two run-created temporary accounts, now removed.
No application/schema/RLS/configuration changes, emails, or migrations during
acceptance. Historical local-only details below remain distinguished from live evidence.

## Scope and files

- `pages/api/auth/[action].ts`: add POST `change-password` after existing same-origin
  validation, before the unrelated email/signup/recovery dispatcher.
- `lib/server/auth-change-password.ts`: authenticated password-change service.
- `lib/auth-change-password.ts`: typed result and narrowly scoped HTTP client with
  explicit ambiguous-response handling. Uses existing cookie/API/header contract.
- `components/home/profile-overview.tsx`: wire the three existing fields and Save;
  replace unavailable notice. Existing classes, dimensions, buttons, animations,
  close behavior, username flow and avatar work remain intact.
- `tests/auth-change-password.cjs`: actual handler, SSR client and installed Auth SDK
  against an in-memory HTTP provider. Network restricted to mocked localhost.
- `tests/auth-change-password.browser.cjs`: actual Settings component/dialog/buttons
  and CSS; offline transport, sibling financial/shop/notification panels stubbed.

No `nextUsernameChangeAt` changes. No second identity or password persistence system.

## Identity and native password validation

Reuse `requireSameOriginWrite` and authoritative `requireMarketplaceUser/getUser`.
Only verified Western users may proceed. Accept exactly currentPassword, password,
confirmation; reject caller-supplied email/user ID. Reuse `validSignupPassword`.

Installed supabase-js 2.117.2 supports `UserAttributes.current_password`; its actual
Auth SDK forwards it to PUT /auth/v1/user. This parameter's enforcement depends on
Auth server settings and may exempt recovery sessions. Therefore also verify the
current password through native `signInWithPassword`, using only the email from the
authenticated user, in an ephemeral public-key client with persistence/auto-refresh
disabled. Compare returned user ID; revoke the proof session before any update.
The proof client never sets application cookies. If proof cleanup fails, stop
before changing the password. Its failed-to-revoke session may remain until provider
expiry or a subsequent successful others-scope revocation; no cleanup guarantee is
claimed for an unavailable Auth server.

Then update the original request-bound client using both current_password and
password. No admin password update, local hashing, password database, localStorage,
or password/token logging is added. Provider errors use fixed safe messages.
No reauthenticate/OTP/email endpoint is invoked, and existing recovery is unchanged.

## Session safety and partial outcomes

After confirmed password update, invoke original client's signOut(scope: others).
Keep current request/device session; do not sign out globally or replace it with the
ephemeral proof session. A scoped fetch observer verifies an actual successful
logout response: the installed SDK otherwise suppresses 401/403/404 logout errors.
No immediate revocation of previously issued access JWTs is promised.

Result states:

- Rejection before update: normal safe API error, existing dialog stays retryable.
- Updated + others revoked: close only after both confirmations.
- Updated + revocation failed: return explicit partial result, show existing error
  region, disable another password submission in this dialog. No new retry button
  or UI is introduced. There is currently no dedicated revocation-only retry UI.
- Ambiguous update/HTTP response: do not assert success or unchanged password; ask
  user to verify by signing in/recovery; block repeat write in this dialog.

## Local validation

API suite: 23 offline cases. Includes own-session retention, actual SDK refresh
success for current device and rejection for other device, other refresh-session
revocation, proof-session cleanup, wrong password, native current-password rejection,
expired session, schema/policy/confirmation checks, cross-origin/unauthenticated
requests, provider reauthentication requirement, cleanup failure, logout failures
401/403/404/500, uncertain update, safe output and no email endpoints.

Browser suite: 390/430/820/1280/1536, three unchanged password fields, shared policy
rules, mismatches disabling Save, pending Save, provider success closes, failure
retains fields and allows retry, partial/network result prevents repeat submission,
and no dialog horizontal overflow. Screenshots are ignored test artifacts only.

Existing `tests/auth-modal-api.cjs` recovery/signup/session regression passes.
Application TypeScript, focused ESLint and diff whitespace checks must pass before
handoff. Browser bundler on Node 24 requires process-local
`NODE_OPTIONS=--openssl-legacy-provider`; no application/runtime configuration changed.

These tests verify real SDK request/cookie behavior against mocked Auth, not real
Staging password updates or provider session invalidation.

## Separate Staging authorization and acceptance plan

1. Explicitly identify only pcaqxezdfxofysghssyo; never use default CLI link.
2. Read-only check actual Auth configuration and deployed version: current-password
   requirement, secure password change/reauthentication, security notification
   emails, password policy/rate limits, and relevant Auth hooks. Local config does
   not prove hosted configuration. If email verification/security emails would be
   required or sent, STOP for decision; do not disable/bypass them.
3. Only after separate approval, create uniquely identified temporary test users,
   without emails. Obtain two independent device sessions; use local application
   against Staging, never an admin password update.
4. Check wrong current password leaves password unchanged; update succeeds only
   after provider confirmation; new login works and old password fails. Confirm
   original device can still getUser/refresh, other device refresh fails. Existing
   access JWT may remain valid until expiry.
5. Verify expiry/policy failures and existing recovery without initiating live
   recovery/security email unless separately authorized. Do not force remote
   infrastructure outages to simulate partial failures; those are covered offline.
6. Clean up only resources created for this run, record residual resources. Never
   change real users or unrelated data. Stop before B05.

## Authorized Staging acceptance — 2026-10-19

Target: `pcaqxezdfxofysghssyo`; health returned GoTrue `v2.197.0`.
User explicitly confirmed via Dashboard: Password changed notification OFF,
Secure password change OFF, Require current password when updating OFF, and
authorized temporary-account creation, password/session tests and exact cleanup.
Those settings were not changed. Their source is the user's Dashboard confirmation,
not an inference from public Auth settings or CLI config diff.

Test: `tests/auth-change-password-staging.cjs`, opt-in with both
`B04_STAGING_WRITE_APPROVED=1` and `B04_NO_EMAIL_DASHBOARD_CONFIRMED=1`.
Real local Auth API handler + SSR/Supabase SDK against Staging; no deployed app
change. Transport enforces exact Staging origin, run-owned users for all Auth
writes, and blocks mail/OTP/recovery endpoints. Admin createUser is used only to
create two email-confirmed test fixtures without sending email; password change
itself uses the real authenticated application flow, never admin updateUser.
Passwords and tokens exist only in memory; journal retains safe actions/results.

Run: `b8318742-6f6a-4b46-937c-73643c4c1e89`.
Ignored evidence: `tests/artifacts/b04-b8318742-6f6a-4b46-937c-73643c4c1e89/result.json`.

Passed:

- Wrong current password rejected by UU with passwordUpdated=false; no password
  PUT occurred; original password still worked, despite native requirement OFF.
- Weak password, mismatched confirmation, forged target ID and anonymous request
  rejected before update.
- Correct change: real password PUT returned 200; others-scope logout returned 204.
- Original device session ID preserved, authenticated read and refresh successful.
- Other device refresh rejected with refresh_token_not_found.
- New password login succeeded; old password failed with invalid_credentials.
- Control user's identity, password login and original refresh session unaffected.
- No mail/OTP/recovery endpoint called; no email or unexpected reauthentication
  failure observed. No independent SMTP-delivery-log claim is made.
- Both temporary accounts deleted after verifying their exact run metadata.
  Read-only SQL verified zero users, identities, sessions, refresh tokens, profiles,
  notification preferences, avatar upload records and avatar objects for both IDs.
  Auth's own immutable/security audit history was not deleted.

Live provider failure/partial-success outages were not induced. Their handling
remains covered by the 23-case offline suite and existing browser tests; real
happy-path/session behavior is separately verified above. No access-JWT immediate
invalidation is promised. No existing users, Production, payment, configuration,
schema, RLS, or UI were changed. No stage/commit/push; B05 not started.
