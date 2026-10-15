# Auth Signup interaction restoration — 2026-10-14

Visual/interaction sources: `3ce14cd211f1637d5a3ab7dc5cd65e7295a4abc3`
and `5d73126abd676efd2dd0ae5bb459b0e529912cc6`. Their relevant Auth
implementation is equivalent. This restores the interaction changed by
`4023d04eeb052262afadbc53bf731107bc2098c9`, without reverting its security fixes.

Fresh Signup shows the existing verification-code input and StatefulButton
**Send code** from the beginning. Send invokes signup-code once; its existing
**Sent**, 60-second cooldown, **Resend in Ns**, and **Resend code** feedback remain.
The separate blue Create sender and Auth-local `.create` style are removed.
Final verification uses the actual existing HoldButton: **Hold to create account**,
1000ms hold, **Create account**, then `form.requestSubmit()` and verify-signup.
Short clicks do not submit. Shared buttons and recovery/session components were
not modified.

Resume is contextual. On Signup entry the same-origin, no-store GET
`/api/auth/pending-signup-state` reads the existing HttpOnly cookie on the server.
The service-only, stable, security-definer SQL RPC
`marketplace_pending_signup_resumable(text)` checks its SHA-256 hash, expiry,
existing Auth/profile identity, unverified status and Western email eligibility.
It returns only a boolean. Invalid, missing, expired, completed or removed
capabilities return false. Error or unexpected response also yields false.
No account lookup parameters or private metadata are exposed. Async results are
fenced against mode changes and successful Send code. Active-form edit/resend
continues to use the existing authoritative ownership/correction path.

Only staging `pcaqxezdfxofysghssyo` received the additive migration
[202610140003_auth_pending_resumability.sql](../supabase/migrations/202610140003_auth_pending_resumability.sql).
SHA-256: `6baa368b7ab464e4e607fe4a6cd6b34dbf5e6c35894f95bdba0d3d26dca5c5cb`.
The server probe fails closed outside staging pending a separate production
rollout. Existing production correction behavior is not changed.

Qualification:

- Staging dry-run, application and live grants verification passed. Only
  service_role can execute; owner postgres, empty search_path, STABLE, no mutation.
- Synthetic pending-user tests ran inside rollback: valid/invalid/expired/
  verified/consumed states; full Auth/profile/control snapshots unchanged by the
  probe. Existing staging Auth/profile/control row fingerprints remained identical
  before and after deployment/qualification. No synthetic Auth rows persisted.
- Auth API transport tests verify minimal response, cookie-only proof, no-store,
  cross-origin rejection, no missing/tampered-cookie RPC calls and rejection of
  structurally unexpected RPC results. No real email was sent.
- Offline actual-component browser tests compare historical field/action
  dimensions and current behavior at 390/430/1280/1536. These are mocked transport
  checks, not real email delivery or a manually authenticated browser acceptance.
- Existing pending-username PostgreSQL tests preserve capability ownership,
  older OTP invalidation, collisions, direct-write protection and verified-account
  168-hour cooldown. Auth/session cookie regressions pass.

Real UWO email delivery remains **DEFERRED UNTIL CUSTOM SMTP**. No SMTP changes,
Order/Messages/Offer/Agreement changes, production access, `.env.local` edits,
commit or push occurred in this restoration pass. Prior unrelated worktree changes
remain intact. Existing GlideSelect.jsx global lint parser debt remains unrelated.
