# B02 account workflow validation

Date: 2026-10-18 (America/New_York). Target: Staging `pcaqxezdfxofysghssyo` only.

## Status and scope

The authorized no-email, disposable-account qualification passed. **The complete B02 acceptance gate is not yet satisfied.** Real signup/recovery email delivery, provider OTP time-expiry/rate limits, and the complete real password-reset/password-login round trip remain unverified. The user explicitly deferred real email verification to separate authorization.

No application defect requiring a code correction was reproduced. No UI, CSS, application business logic, schema, migration, RLS, trigger, provider configuration, or existing-user changes were made. B03 avatar persistence and B04 Settings password UI were not implemented. No Production access or Git mutation was performed.

## Existing implementation reused and actual evidence

| Workflow | Existing implementation | Current evidence |
|---|---|---|
| Signup and Western verification | `pages/api/auth/[action].ts`; `lib/marketplace-auth.ts`; `lib/server/marketplace-auth.ts`; Supabase Auth; `auth.users` -> `marketplace_private.create_profile()` -> `public.profiles` | Offline actual-handler/SDK signup validation passed. Two synthetic users created through the Admin API without email; actual generated signup OTPs verified through the existing `verify-signup` handler. Normal email-sending `signup-code` was deliberately not invoked live. Unverified login was rejected by the real provider. |
| Pending username correction/resume | `lib/server/pending-signup.ts`; `marketplace_correct_pending_username`; `marketplace_pending_signup_resumable`; `pending_signup_controls` | Duplicate candidate rejected; correction persisted; previous OTP rejected; valid capability resumed; verified user could not reuse pending correction. No resend endpoint was invoked. |
| Login and account read | Existing `sign-in`/`session`; `pages/api/profile/account.ts`; request-cookie SSR client in `lib/supabase/server.ts` | Both users returned their own profiles in fresh request contexts. Caller-supplied other-user IDs did not change the projected identity. Anonymous access denied. Wrong-origin login denied. Real relogin succeeded. Offline incorrect-credential, unverified/non-Western, safe-error and field-whitelist cases passed. |
| Session refresh and logout | Actual Supabase SSR SDK; `signOut({ scope: 'local' })` | Real refresh and rotated cookies worked; logout cleared request cookies; protected account read then returned 401; refresh of the signed-out session was rejected. Offline expired-refresh rejection, stale-cookie removal and revoked-session projection passed. This is not an all-devices logout or immediate invalidation of every already-issued JWT guarantee. |
| Username authority | `pages/api/profile/username.ts`; `lib/server/auth-username.ts`; `marketplace_change_username`; profile identity trigger, unique normalized index and private username history | Real reserved/invalid candidates rejected; exact current-name no-op returned canonical next-change time; changing a newly created verified username was rejected under the 168-hour rule. Availability remained advisory. A successful post-168-hour rename and 30-day history expiry were not time-travelled on Staging. |
| Notification preferences | `pages/api/notification-preferences.ts`; `marketplace_notification_preferences`; `marketplace_set_notification_preference`; `public.notification_preferences` | Two simultaneous partial-key writes persisted, email preference persisted, fresh requests and logout/login retained values. Second account retained defaults. Cross-user SELECT returned no rows; direct UPDATE was denied. Existing offline API tests passed. |
| Recovery | Existing `recover`/`reset-password` dispatcher and Supabase Auth | Real Admin-generated recovery OTP verified with the provider without email. Existing offline handler tests covered recovery OTP -> password update and provider failure. Live final password update was not invoked: password-change security notification configuration could not be established through the read-only CLI preview; the no-email constraint remained in force. No configuration was changed. |

## Known limitation preserved

`pages/api/profile/account.ts` returns `nextUsernameChangeAt: null`. The mutation RPC returns the canonical cooldown timestamp and the database enforces it, but a canonical account-read cooldown projection is missing. This was already documented in the audit. It was not added, and no Settings visual/interaction change was made. Any new database projection requires separate approval under B02's task definition.

## Tests and evidence

- `node tests/auth-modal-api.cjs`: passed; real SDK with mocked HTTP, not real SMTP.
- `node tests/marketplace-session.cjs`: passed; SDK/cookie contract with mocked HTTP.
- `node tests/profile-polish-api.cjs`: passed; existing API/username RPC boundary tests.
- `node tests/notification-preferences-api.cjs`: passed; exact partial fields, session/origin guards, safe errors.
- `node tests/account-workflow-api.cjs`: passed; added own-account, anonymous/unverified/domain, revoked/expired session and safe projection coverage against actual handlers/SDK with intercepted HTTP.
- Opt-in `tests/account-workflow-staging.cjs`: passed, nine workflow checkpoints and exact two-user cleanup. Uses an explicit Staging environment guard and blocks email-sending Auth endpoints. Credentials, cookies and OTPs stay in memory.
- Existing `notification-preferences.browser.cjs`: passed at 390/430/820/1280/1536, including non-blocking/latest-intent saves, isolated rollback, cross-key concurrency, stale-response protection and no overflow. The first launch hit the existing Node 24/old Webpack OpenSSL compatibility error; rerunning with `node --openssl-legacy-provider` passed without changing application code, dependencies or cryptographic business behavior.
- Application-source TypeScript and focused ESLint: passed.
- `git diff --check` and new-file whitespace checks: passed.

Ignored runtime journal: `tests/artifacts/b02/account-run-792f7b43-d612-46c1-8d32-47db78fea51e.json`. It contains identifiers/check names and cleanup flags, not passwords, email addresses, service keys, sessions or OTPs. Both created users were deleted and their absence was checked through the Admin API. No pre-existing fixture credentials were used.

Final explicit-Staging read-only cleanup evidence: `tests/artifacts/b02/cleanup-readonly.json`. For exactly those two IDs, remaining Auth users, profiles, notification preferences, pending signup controls, Auth sessions and username-history records all equal zero.

## Remaining acceptance work

1. Separately authorize controlled Western test inboxes, real signup/resend/recovery delivery, OTP time-expiry and bounded rate-limit testing; do not send to invented university addresses.
2. Confirm the password-change security notification setting read-only before any no-email live reset-password test, or obtain separate mail authorization. Qualify final password update, new-password login and rejection of the old password through the current recovery API.
3. Keep elapsed-cooldown/history-release and real browser lifecycle evidence distinct from mocked SDK tests and fresh request-context tests. Do not backdate real profiles or bypass identity triggers to fabricate a successful cooldown test.

Stop at B02. Do not begin B03 automatically.
