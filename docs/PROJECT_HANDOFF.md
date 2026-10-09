# Campus Marketplace project handoff

Snapshot: **2026-10-09, America/New_York**. This is a self-contained starting
point for a new ChatGPT/Codex session. It records repository inspection and prior
verified rollout evidence; this documentation task did not contact Supabase.
Older phase documents deliberately preserve historical pending/not-deployed
statuses. The final statuses here and the latest rollout sections take precedence.

## 1. PROJECT OVERVIEW

Campus Marketplace is a PWA for Western University students buying and selling
second-hand items. Auth requires a verified Western (`uwo.ca`) account for
protected Marketplace operations.

The application uses Next.js 12 Pages Router, React 18, TypeScript, SSR and
`pages/api` backend routes. Supabase provides Auth, PostgreSQL, Storage and private
Realtime Broadcast. RLS, guarded RPCs and database triggers enforce authoritative
ownership, message identity, sequence/read state and username rules. PWA support
uses the existing Next/PWA configuration. Dependency management is npm with
`package-lock.json`; the repository selects Node 24.x.

There is no standalone Express/Spring backend, Prisma/Drizzle/Firebase layer or
currently hosted frontend. Local production-configured UI verification is not a
hosted frontend deployment. Netlify's inherited configuration/adapter were removed;
do not treat Netlify as the current hosting architecture.

| Environment | Hosted Supabase project | Project ref |
| --- | --- | --- |
| Production | campus-marketplace | yzvchumzyonegujucyqs |
| Staging | western-marketplace-staging | pcaqxezdfxofysghssyo |

Server-only `APP_ENV=production` or `APP_ENV=staging` must match the exact public
Supabase project URL/key binding. Unknown/mismatched designations fail closed.
`SUPABASE_SERVICE_ROLE_KEY` is server-only and project-bound; never print its value,
return it from an API or add a `NEXT_PUBLIC_` service-role variable. The Realtime
bridge gives the verified owner their existing user access token, not a privileged
key or refresh token; its response is private/no-store and must not be logged.

Production settings live in ignored `.env.local`; staging has a dedicated ignored
`.env.staging.local` and guarded `npm run dev:staging` launcher. Do not copy values
between accounts/chats or infer the database target from a localhost port. Browser
cookies are hostname-scoped, not port-scoped; independent test users need separate
contexts. `localhost` and `127.0.0.1` are different cookie hosts.

## 2. CURRENT GIT / CHECKPOINT STATE

Inspection at the start of this handoff task found:

| Item | Actual state |
| --- | --- |
| Branch | main |
| HEAD | 4023d04eeb052262afadbc53bf731107bc2098c9 |
| HEAD subject | fix: improve auth signup and session flow |
| Working tree before these documentation edits | Clean |
| Upstream | origin/main |
| Ahead / behind | 0 / 0 |
| Remote branch hash | Same full hash as HEAD, verified with read-only git ls-remote |
| Auth UX checkpoint | Committed and pushed before this documentation task |

Relevant checkpoints, newest first:

| Commit | Purpose |
| --- | --- |
| 4023d04 | fix: improve auth signup and session flow |
| a977fc9 | feat: add realtime messaging — Phase 3 checkpoint |
| 74d832d | feat: add durable image messaging — Phase 2 checkpoint |
| 65f8dfe | feat: checkpoint marketplace UI and production text messaging — Phase 1 checkpoint |
| 2119e65 | Complete marketplace listings and profile experience |

This task adds the two handoff/design documents and updates PROJECT_STATUS.md;
those documentation edits are not committed or pushed. Re-run Git status in the
new session rather than assuming this snapshot is still current. Historical
"no commit/push" statements in rollout reports describe those audit turns, not
the current checkpoint state.

The local migration inventory below is recorded applied to production by the
rollout evidence. It was not queried remotely again for this handoff. SQL headers
such as "not applied" record original authoring checkpoints, not current status.
Do not reapply them or edit their bytes.

| Migration | Purpose |
| --- | --- |
| 202609290001_marketplace.sql | Marketplace/profile baseline |
| 202610030001_marketplace_usernames.sql | Username identity/cooldown |
| 202610040001_marketplace_taxonomy.sql | Taxonomy |
| 202610050001_marketplace_publication_favorites.sql | Publication/Favorites |
| 202610070001_messages_text.sql | Phase 1 TEXT |
| 202610070002_messages_images.sql | Phase 2 IMAGE |
| 202610080001_messages_realtime.sql | Phase 3 private Broadcast |
| 202610090001_auth_pending_username.sql | Auth pending username correction |

## 3. MARKETPLACE BASELINE

Listings, seller ownership, publication, listing images and Favorites use real
authenticated APIs/database state. Sellers create/manage their own listings;
publication and image handling are guarded rather than trusting a client seller
ID. Public listing visibility and protected owner operations remain separate.
Listing money is integer cents, current currency CAD. Existing listing status is
`available` or `sold`; a future Order reservation status is not implemented.

Contact Seller on an eligible other seller's published available listing resumes
after authentication where needed and finds/creates its Buyer/Seller conversation.
Buying and Selling are separate Messages destinations. Starting via a listing
checks current eligibility; existing conversations remain readable/sendable after
the listing is sold or deleted, with snapshots and unavailable/deleted live-link
presentation. Do not equate marking a listing sold with an implemented Order or
Payment. Favorites is persisted, not the old local demo implementation.

Profile/session behavior is shared through cookie-backed authenticated session
state, verified Western checks and guarded username operations. Some inherited
profile/avatar/activity presentation remains local/demo UI; do not infer a financial
accounting or Orders backend from those components.

## 4. MESSAGES PHASE 1 — TEXT

**Status: PRODUCTION.** `public.conversations` and `public.messages` persist
history. Participants are the listing's Seller and initiating Buyer; identity is
the original listing UUID + Buyer + Seller. Immutable title/price/currency/category
snapshots survive listing changes/deletion. Live listing/profile references can
become null after deletion without deleting the message history.

Database locks/triggers allocate per-conversation sequences and server timestamps.
TEXT sends use a client message UUID for idempotency: an exact retry returns the
same durable message; conflicting reuse is rejected. Read watermarks advance
monotonically through explicit rendered sequence boundaries. Unread counts count
incoming rows above the viewer watermark, excluding their own messages; do not
subtract sequence numbers. A successful new send acknowledges preceding history;
an idempotent retry does not acknowledge newer incoming messages.

Participant RLS and authenticated guarded RPCs enforce access. Ordinary writes
are not direct client table writes. Sold/deleted listings do not block existing
conversation sends. The existing authenticated APIs remain authoritative.
Hosted staging mutation/security tests and authenticated production smoke passed.

See [TEXT rollout](MESSAGES_PHASE1E_B.md) and
[TEXT data contract](MESSAGES_BACKEND_DESIGN.md).

## 5. MESSAGES PHASE 2 — IMAGE

**Status: PRODUCTION.** Durable IMAGE parents have ordered `message_images`
children and private `chat-images` Storage objects. One IMAGE message contains
1–4 JPEG/PNG/WebP files, each at most **3 MiB / 3,145,728 bytes**. It has no caption;
durable metadata stores object paths, never blob/public/signed URL strings.

The actual attachment UI sends browser Files through prepare → private upload →
server byte/hash/receipt verification → atomic finalize → durable rendering.
Pending reservations/receipts live outside sent-message history; incomplete sends
do not consume a durable message sequence or inflate unread state. Client nonce,
manifest and byte hashes protect retry/idempotency and conflicting reuse.

Participant-authorized server signing produces **300-second** private image URLs;
the existing gallery renews leases/retries recoverable failures. Expired/abandoned
submissions and administrative deletion use the durable cleanup/orphan worklist.
Do not assume an unattended scheduler exists merely because cleanup mechanisms
are defined. Privileged Storage/receipt/cleanup operations use the service role
only on the server; ordinary authorization remains user/participant-scoped.

Full hosted staging E2E used actual generated decodable images through the UI,
including four-image and size/type boundaries, independent Buyer/Seller sessions
and outsider privacy. Disposable data/objects/credentials were removed. Production
catalog/security and existing-account smoke passed. Two-account production IMAGE
mutation testing was intentionally **DEFERRED**; staging remains its E2E evidence.

See [IMAGE production evidence](MESSAGES_IMAGE_PHASE2E_B.md),
[frontend staging E2E](MESSAGES_PHASE2C.md) and
[IMAGE data contract](MESSAGES_IMAGE_BACKEND_DESIGN.md).

## 6. MESSAGES PHASE 3 — REALTIME

Supabase **private Broadcast** is invalidation only. Existing authenticated APIs
are the source of truth. The own-user topic is
`marketplace:messages:<Auth UUID>`. One private channel belongs to the authenticated
mounted Messages tab/context and is shared across Buying/Selling, rather than
one channel per conversation or image. Browser topics/payloads cannot grant access.
Minimal recipient-derived signals trigger authorized canonical refetches; do not
introduce message bodies, private URLs or credentials into notifications.

The integration supports incoming TEXT/IMAGE, Buying/Selling refresh, unread and
activity reorder, active-history reconciliation, own-message echo dedupe and
reconnect/focus/online recovery. Refresh work is bounded/coalesced; lost signals
are repaired by canonical catch-up. Unmount/logout stops the channel and discards
in-memory access context. Other-user/malformed/anonymous private topics are rejected.

| Component | Status |
| --- | --- |
| Realtime backend | PRODUCTION DEPLOYED |
| Realtime frontend | PRODUCTION-CONFIGURED / AUTHENTICATED SMOKE VERIFIED |
| Hosted staging E2E | PASSED |
| Two-account production Realtime mutation | DEFERRED |
| Hosted frontend | NOT DEPLOYED |

Production smoke verified authenticated APIs/bridge, own private join, one-channel
mount/leave/remount/logout and topic privacy. It does not prove live two-account
production mutation delivery. See [design](MESSAGES_REALTIME_DESIGN.md),
[staging acceptance](MESSAGES_REALTIME_PHASE3D.md) and
[production evidence](MESSAGES_REALTIME_PHASE3E.md).

## 7. AUTH UX CLEANUP

**PRODUCTION DEPLOYED / VERIFIED**, checkpoint **4023d04**. Login itself was not
the reported bug: the issue concerned transition after authentication succeeded.
Sign-in now waits for authenticated session/profile state before entering Market;
the user verified successful production sign-in enters Market normally. Bootstrap
failure retries Market preparation without resubmitting credentials. Stale action
errors clear correctly, while current failures remain visible.

Create retains its blue success/checkmark. Verify, Resend and Edit signup details
are distinct. Edits preserve the draft/email, invalidate the current challenge UI
and require a fresh code; edited passwords are saved only after successful OTP
and canonical username verification. Unchanged initial signup does not write the
password twice. Duplicate submissions are guarded.

Fresh Create explicitly dispatches `/signup` exactly once, never chooses resend
from browser registration state. Pending Resume/Resend requires database-backed
ownership before provider `/resend`; missing/stale/cross-account/verified pending
state receives a generic rejection without an email dispatch. Anti-enumeration
behavior is retained; Resume is not an arbitrary account-existence probe.

`202610090001_auth_pending_username.sql` is **PRODUCTION**. An original Auth INSERT
binds a hashed random capability to one unverified account; the plaintext ticket
is stripped from stored metadata. The cookie is HttpOnly, SameSite=Lax, /api/auth
scoped, 24-hour lifetime and Secure on hosted production HTTPS (localhost smoke
is exempt). Server-only correction checks capability/expiry, matching Western email
and authoritative `auth.users.email_confirmed_at` under row lock. It cannot target
an arbitrary UUID or use browser-trusted verification flags. Correcting a pending
username invalidates old confirmation tokens atomically; uniqueness, reserved
names and verified-account **168-hour / 7-day** cooldown remain enforced.

Fresh pre-Auth backup, single-migration dry-run, application, history/grants/source
verification and DB lint passed. Staging is the mutation evidence; no production
pending accounts were manufactured. Final existing-account production smoke:

| Check | Result |
| --- | --- |
| Session | 200 / authenticated |
| Buying and Selling, probes and normal app | 200 |
| Realtime bridge | 200 |
| Messages UI / private join | Present / succeeded |
| Maximum channels | 1 |
| Logout / channels afterward | 200 / 0 |
| Authenticated API after logout | 401 |
| Runtime errors / unhandled rejections / probe errors | 0 / 0 / 0 |
| Timeout / overall | false / passed true |

Temporary harnesses were removed; an earlier single rejection was not captured
and did not recur in the final instrumented run. Its source is undetermined, not
a proven Auth defect. An IPv4/IPv6 localhost server conflict also affected harness
availability; it was a local test setup issue, not a cross-project Auth route.
See [complete Auth evidence and validation](AUTH_UX_CLEANUP.md).

## 8. AUTH EMAIL / SMTP LIMITATION

**Real UWO email delivery: DEFERRED UNTIL CUSTOM SMTP.** Signup routing/correction
code is accepted; production-grade email infrastructure is the remaining launch
requirement, not unresolved signup logic. Custom SMTP has not been configured.

The built-in provider's observed limit was two emails/hour, with restricted
organization-member recipients. Staging real-email acceptance was stopped rather
than repeatedly consuming quota. A generic nonexistent-user resend 200 was not
evidence of delivery. Hosted mutation/OTP tests and mocked email transport are
distinct from real inbox acceptance. Before public launch, separately configure
custom SMTP and rerun controlled real UWO signup/correction/newest-code/delivery
acceptance. Do not send emails or change provider settings simply to resume work.

## 9. BACKUPS

All three directories exist locally outside the repository/Git; their original
verification is recorded in the rollout reports. Never copy them into Git.

| Checkpoint | Local directory |
| --- | --- |
| Pre-IMAGE, includes TEXT state | C:\Users\MLTZ\ProductionBackups\campus-marketplace\20261008T011038Z-pre-images |
| Pre-Realtime, includes IMAGE state | C:\Users\MLTZ\ProductionBackups\campus-marketplace\20261008T205249Z-pre-realtime |
| Pre-Auth, includes post-Realtime state | C:\Users\MLTZ\ProductionBackups\campus-marketplace\20261009T041034Z-pre-auth-ux |

Native PostgreSQL 17 tooling and secure local pgpass were used: custom-format
database dump, password-free role metadata, TOC, manifest and SHA-256 records.
The pre-Auth archive was rechecked nonempty, checksum-matching and fully readable
by offline pg_restore decode. It predates the Auth migration and is not a current
post-Auth backup. Logical dumps do not contain Storage object bytes or every hosted
project setting. Future authorized production changes need a fresh current backup.
No Docker or local PostgreSQL server was required. Passwords must stay in secure
local configuration, never chat, logs, command arguments or repository files.

## 10. KNOWN TECHNICAL DEBT / LIMITATIONS

| Item | Meaning |
| --- | --- |
| GlideSelect.jsx global ESLint parserServices/naming-convention issue | Pre-existing unchanged technical debt; focused lint passes. Production build exits 0 but global lint is not clean. |
| Legacy Next/Webpack on Node 24 | Existing validation uses --openssl-legacy-provider; do not change application code to compensate for a misconfigured build command. |
| No hosted frontend | Separate future release work, not proof that the Supabase backend is undeployed. |
| Custom SMTP absent | Launch requirement; real UWO delivery acceptance remains deferred. |
| No Order/Payment system | Product design comes first; no provider, money movement or payment backend exists. |
| Typing/presence/live read receipts | Intentionally outside Phase 3 scope. Durable read watermarks still exist. |
| Natural full JWT expiry, prolonged stress, actual OS sleep | Not exhaustively tested; do not inflate the smoke/E2E claims. |
| Seller account deletion | Owned listings' seller FK can block deletion; deliberate listing cleanup is required. Do not promise automatic full account deletion. |

## 11. IMPORTANT PRODUCT/UI BEHAVIOR TO PRESERVE

- Empty Messages shows **"No conversations yet."**, without a giant empty bordered card.
- Desktop recent three avatars and +N expansion; Buying/Selling stay separate.
- Mobile full list → Chat navigation, with preserved responsive geometry.
- Chat/attachment physical transition: **320ms**, `cubic-bezier(0.22,0.61,0.36,1)`.
  Those callers use the mobile timing; shared desktop Market/Home timing differs
  (380ms). Reduced-motion handling must remain.
- Attachment overlay preserves the underlying Chat/history mount; Cancel restores
  exact scroll position. FileDrop and image gallery behavior remain intact.
- Incoming TEXT/IMAGE and own-send echoes reconcile without duplicate messages.
  A user browsing older history is not yanked to the bottom by incoming messages.

## 12. WHAT NOT TO DO

Do not rewrite Messages or make Realtime a second source of truth. Do not expose
service-role credentials in browser bundles. Do not edit already-applied migrations;
future database changes require new migrations and explicit environment scope.
Do not treat old Netlify/demo/UI scaffolding as current hosting or a payment engine.
Do not deploy before planned hosted-release work, assume SMTP is configured, or
start Payments implementation before product design is complete.

Begin a new session with Git/status/source inspection and these docs, not a
production mutation. Do not run hosted staging fixture scripts without authorization:
they create disposable users/data and some modes can dispatch Auth emails. Local
API/session tests use mocked transport; PostgreSQL contract tests use PGlite and
may require a locally configured PGLITE_MODULE. Missing tools do not authorize
Docker installation, production fixtures, database resets or arbitrary test users.
Secrets, pgpass, backups and tests/artifacts remain ignored/local-only.

Useful local entry points are `tests/auth-modal-api.cjs`,
`tests/auth-pending-username-db.cjs`, `tests/auth-username-db.cjs`,
`tests/marketplace-session.cjs`, `tests/messages-api.cjs`,
`tests/messages-images-api.cjs`, `tests/messages-realtime-client.cjs` and the three
Messages migration-static tests. The final Auth checkpoint passed TypeScript,
focused ESLint, these regressions, production build, browser secret scan,
documentation links and diff checks. Historical visual scripts may describe old
UI; prefer the latest documented contract, not their assumptions.

## 13. NEXT PROJECT PRIORITY

**ORDERS / TRANSACTIONS / PAYMENTS product design** is next. Hosted frontend
deployment comes later. Payments implementation has **NOT STARTED**.

Read [Order/Payment product concepts and open decisions](ORDER_PAYMENT_PRODUCT_DESIGN.md)
and continue the product discussion before choosing a provider, schema, API or
migration. [PROJECT_STATUS.md](PROJECT_STATUS.md) retains detailed chronological
evidence; this handoff is the current concise map.
