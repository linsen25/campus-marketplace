# B06 Messages ? local qualification (2026-10-19)

Status: COMPLETED — authorized Staging acceptance passed on 2026-10-19;
see the dated live acceptance addendum below. The earlier sections
describe the local-only pass and must not be read as live runtime evidence.
This document is not a new full-project audit.

## Exact task boundary

B06: qualify existing first-contact/text/images/unread/realtime under two live
Staging sessions. Concurrent first contact dedupes; client UUID retry one message;
sequence monotonic; outsider denied; no stale read decrement; reconnect/logout,
private topic and signed image access. Exit: both sides see canonical data without
fixture shortcuts. Local-only authorization cannot satisfy the live-session exit.
No Staging calls, account creation, remote writes, mail, payments or B07 operations
were performed in this B06 pass. No migration file or database permission change.

B05 authorized scope is accepted with limitations, not an unconditional assertion
that excluded/untested cases passed. Historical snapshot byte download/hash is
explicitly excluded by user decision and must not be requested again in this
workflow. New real-transaction snapshot prepare/bind belongs to transaction
acceptance (B07). Six unclassified legacy public objects are a separate retained
risk, not cleanup candidates. No B05 historical images were read or modified here.

## Existing architecture reused

| Flow | Existing implementation / authority | Local evidence / limit |
|---|---|---|
| First contact/reuse | `pages/api/messages/conversations/[[...segments]].ts`, `lib/server/supabase-messages-repository.ts`; `marketplace_contact_seller`, `marketplace_find_or_create_conversation`; `conversations_identity`, private first-contact receipt | Two native DB connections converge to one thread and one intro/ack pair; existing thread reused after Sold. No backfill of old history. |
| TEXT/history | Same API/repository; `marketplace_send_text`, immutable sent rows and server sequence trigger | Native DB persistence, same UUID/content retry, payload conflict/blank rejection, monotonic sequence, continued send after Listing deletion. |
| Read/unread | `marketplace_mark_conversation_read`, per-participant greatest watermark; repository excludes own sends and auto replies | Native DB late reads cannot regress; replaying a send cannot consume newer incoming unread; history boundary preserves messages arriving later. |
| IMAGE lifecycle | `pages/api/messages/images/[[...segments]].ts`, `image-upload/[submissionId]/[imageId].ts`, `lib/server/message-image-service.ts`; prepare/verified receipt/finalize/abandon RPCs; private chat-images | Native manifest retry/receipt/atomic finalize/abandon queue; transport tests verify exact bytes, MIME/size/hash, outsider before privileged work. No live Storage claims. |
| Private image presentation | `message_images` participant RLS -> server-only signed paths, 300s URLs | Native outsider metadata denial; actual signing service uses only RLS-derived paths, empty result starts no privileged signing; provider signing failure returns retryable error. Previously issued signed URLs are bearer capabilities until expiry; no instant logout-revocation claim. |
| Realtime | `pages/api/messages/realtime-session.ts`, `lib/messages-realtime.ts`, `lib/messages-reconciliation.ts`; own private topic and canonical refresh | Actual SDK-boundary client tests and native topic RLS; hosted sockets remain unverified this pass. |

Reviewed historical authority sources: `202610070001_messages_text.sql`,
`202610070002_messages_images.sql`, `202610080001_messages_realtime.sql`,
`202610130012_message_withdrawal.sql`, current TEXT RPC in
`202610130013_offer_revision_guards.sql`,
`202610150009_contact_seller_first_contact.sql`,
`202610160009_message_shop_provenance.sql`. No historical migration edited.
Existing Shop provenance, Listing/private-image projection and Auth guards reused.

## Confirmed defects and minimal correction

Only application file changed: `lib/messages-realtime.ts`.

1. Initial SDK `setAuth()` or channel initialization throws AFTER assigning `client`.
   Catch schedules start(), but start() immediately exits because client exists.
   Result: no subscribed channel despite apparent retry. Reproduced by the new test
   against the old implementation (active subscription 0, expected 1).
   Fix: clear the partial client, queue disposal and recreate only after teardown.
2. stop() previously awaited removeAllChannels() before disconnect(). If removal
   rejects, disconnect never executes. Fix: shared disposal uses try/finally so
   socket disconnect is attempted even when channel cleanup rejects.
3. Initial failure could overwrite the token-refresh timer handle with retry timer
   without clearing the former. Fix: clear the owned timer before scheduling retry.

The patch preserves public function arguments, own-topic/private configuration,
Auth token bridge, canonical signals/refresh, retry delay, no-token-persistence,
UI rendering, controls, navigation and interactions. No UI component/CSS modified.
No new Messages, auth, queue or persistence system was created.

## Added focused tests

- `tests/messages-b06-realtime.cjs`: actual connector in a deterministic VM; initial
  auth/channel errors recover to one subscribed private channel, failed client
  disconnected, rejected teardown still disconnects, all owned timers cleared,
  late post-stop signals ignored. Zero network.
- `tests/messages-b06-api.cjs`: actual IMAGE finalize route, auth/origin/participant
  guards, committed send survives signing failure, same-ID presentation retry and
  no accidental abandon; actual signing service derives only RLS-visible paths.
- `tests/messages-b06-db.cjs`, `messages-b06-seed.sql`, `messages-b06-db.sql`:
  native PostgreSQL 17 isolated on 127.0.0.1; real prerequisite Messages migrations
  and current relevant RPC body. Two real connections race first contact and a
  same-UUID send. SQL covers role gates, read persistence/stale reads, image
  verification/finalization retries, passive cleanup queue, private topic fencing,
  optional Broadcast failure, Sold/deleted Listing thread continuity.

Native DB boundary: Supabase-owned auth/storage/realtime schemas are local stand-ins;
Storage rows describe simulated object receipts, NOT a running hosted Storage or
WebSocket service. Realtime send fixture records invalidations and injects outage.
No notification delivery/worker, real Offers/Orders, or business flow outside B06
is certified by these local fixtures. Native temporary cluster is stopped in finally.

## Validation results

PASS:
- new B06 realtime + API + native PostgreSQL suites;
- `messages-api.cjs`, `messages-images-api.cjs`, `messages-realtime-client.cjs`,
  `message-shop-provenance.cjs`;
- static `messages-text-migration.cjs`, `messages-images-migration.cjs`,
  `messages-realtime-migration.cjs` (source assertions, not hosted execution);
- `message-image-actions.browser.cjs` at 390/430/1280/1536, offline: existing
  attachment drafts, text-only actions, gallery/viewer and no image writes;
- application TypeScript, focused ESLint, git diff --check and added-file whitespace.

Browser runner needs `node --openssl-legacy-provider` for the existing Webpack on
Node 24. The initial no-flag launch failed before browser execution; rerun passed
without product/dependency changes. `messages-phase2d-transport.cjs` is a hosted
preload, not a standalone local suite; direct invocation rejected missing Staging
environment before network and was not enabled/rerun. It is not counted as a pass.
No unresolved local product/test failure is claimed hidden or skipped.

## Required separately approved Staging acceptance

Target ONLY `pcaqxezdfxofysghssyo`, always explicit project ref; never default CLI
link. No new migration is currently proposed.

Before writes: narrow read-only deployed RPC/RLS/Storage/private Broadcast capability
check against these exact sources, check test side-effect hooks. Stop on drift or
unapproved UI/security change. Do not repeat the project audit.

Approval needed for newly tagged temporary users, published test Resale Listing
and images, Conversations/messages/image submissions and their cleanup. Since
message sends project in-app notifications, include ONLY temporary recipients'
notification/preferences cleanup and prevent email delivery; no configuration
change or mail sends. Any resource not owned by this run remains untouched.

Run two independent authenticated local browser sessions (Buyer/Seller) plus an
outsider and anonymous context:
1. Concurrent first contact including existing-conversation entry; exactly one
   authoritative identity and expected first-contact history, no duplicate messages.
2. TEXT send in both directions, reload/new session/history pagination; same UUID
   repeated/concurrent retry and payload conflict; server monotonic sequence.
3. IMAGE prepare/upload/receipt/finalize, lost responses, partial uploads, failed
   signing AFTER commit, same-ID retry, cancel/expiry and late upload cleanup.
4. Actual unread list/history, delayed read responses, send replay, multi-device
   read watermarks and new messages arriving after rendered boundary.
5. Real private topics: own subscription succeeds, outsider/forged writes denied;
   reconnect/offline/visibility/token refresh/logout/account switch reject stale
   callbacks and refresh canonical data. Controlled failures remain local proxies.
6. Signed image access: only participants can request links, outsider renewal
   denied, correct MIME/bytes/TTL; private Storage direct reads remain denied.
   No B05 historical snapshot downloads. Do not promise instant signed-link revocation.
7. Existing frozen UI in desktop/mobile contexts; do not alter it. Any UI problem
   is a report/approval boundary, not permission for visual fixes.
8. Clean exactly this run's messages/Conversations/submissions/Storage, test
   notifications and accounts with reference checks; verify residue zero, retain
   necessary immutable audit history. No broad Storage or historical cleanup.

Conclusion: B06 local implementation and regressions are ready for authorized
Staging qualification, but B06's two-live-session exit is NOT yet satisfied.
Stop here; do not begin B07. No Git stage/commit/push.

## Authorized Staging acceptance — 2026-10-19

User authorized only project `pcaqxezdfxofysghssyo`, new uniquely tagged B06
accounts/resources, client-local fault injection and exact cleanup. The default
Production CLI link was never used as a target. Environment/project JWT claims
were checked by `scripts/v2-maintenance-staging.cjs`; every DB query specified the
Staging project ref. No migration, grant, policy, trigger, Auth configuration,
cron, provider/payment operation or hosted application deployment was performed.

Read-only preflight checked deployed contact/send/read RPC definitions, relevant
Auth/Listing/Conversation/Message/notification trigger bodies, private chat bucket
and own-topic Realtime policies. `project_message_notification` creates an in-app
event; `notify_notification_delivery` queues mail only when eligible AND the
recipient email preference permits it. All test accounts were created using
admin `createUser(email_confirm:true)` (no signup/invite/recovery email), and only
their email preferences were disabled before any Messages activity. In the final
run, a read-only safety receipt observed 10 temporary in-app notifications,
3 email opt-outs and ZERO email delivery records.

New live harness: `tests/messages-b06-staging.cjs`. It starts the current local
Next app with project-pinned environment and blocked non-Staging server requests;
credentials, cookies, JWTs and passwords remain in process memory. Real routes,
session cookies, repositories, RPCs, Storage and WebSockets are used. It does not
replace the Messages data source or UI components. Chrome is the same installed
executable used by the existing browser tests. Artifact reports contain resource
IDs/counts only; no credentials or signed URLs.

Runtime observations:

- Three concurrent contact-seller API requests converge to one authoritative
  Conversation and one intro/ack pair, on an actually published temporary Resale.
- Independent Buyer/Seller sessions subscribe to private real Staging WebSockets;
  reciprocal TEXT and IMAGE invalidations arrive with canonical role/scope data.
  Outsider own feed remains empty; foreign private topic join is rejected.
- Three concurrent identical message UUID requests return one message ID; persisted
  sequence is strictly monotonic. Read watermark cannot decrease; a new incoming
  message remains unread when the previous rendered boundary is replayed.
- IMAGE prepare/upload/finalize returns decodable signed JPEG bytes. Discarding a
  successful upload response locally, preparing/uploading again and finalizing
  again reuses submission/object/message identity. Outsider signed-link renewal
  is denied. Anonymous, outsider AND participant direct private Storage download
  are denied; participant access is through the authorized server signing path.
- The actual connector is loaded against the real SDK and Staging bridge. A
  test-wrapper-only initial `setAuth` throw recovers to one channel. Closing only
  the test WebSocket transport, then waiting for an actually joined channel,
  restores event delivery. Session-ended disposal leaves no owned channel/timer;
  subsequent real messages do not reach its stopped callback.
- Current browser pages receive canonical messages in both roles. Reload and a
  real logout/re-login retain message history; logged-out API returns 401.
  Buying/Selling API collections remain separate.

Test-infrastructure retries are not product failures and are not hidden passes:
the first attempt raced intentional asynchronous SDK disconnect/connect; the next
used a close code disallowed by Node WebSocket; the next asserted event delivery
before channel rejoin; subsequent attempts lacked Playwright's default browser or
hit the local Home cold-build 30s deadline. Only the harness was corrected (raw
transport close with valid application code, joined readiness, installed Chrome,
120s navigation deadline). Each attempt ran exact cleanup and verified zero run
residue before another attempt. Screenshots captured during breakpoint loading
were not accepted as settled layout evidence; the final harness waits for the
actual persisted message after reopening the same deep link at each width.

Local reruns: TypeScript, focused ESLint, B06 connector/API suites, existing
Messages API/image/client and Shop provenance suites passed. Native PostgreSQL
initially could not start under the restricted Windows token; the explicitly
authorized loopback-only rerun passed and stopped its temporary cluster. Existing
offline attachment/gallery browser tests passed at 390/430/1280/1536. None of
those offline results is presented as hosted Storage/WebSocket evidence.

### Final result and evidence

B06's documented exit is satisfied: both authenticated participants see canonical
persisted data through the current app, without fixture message sources. The final
live run `a2868fa8-703e-4daa-95a6-d67d436ef6e2` passed all harness assertions and
cleanup. Evidence is local/ignored at
`tests/artifacts/b06-live-a2868fa8-703e-4daa-95a6-d67d436ef6e2/result.json`.

Both actual UI composers sent successfully and the other page displayed each
canonical message. Settled screenshots at 390/430/820/1280/1536 wait for persisted
history after breakpoint reconciliation; DOM width assertions found no horizontal
overflow. The same browser context then logged out via the real Auth endpoint and
existing session-ended signal, logged in as the temporary outsider and received a
new message targeted to the OLD Buyer. That message did not populate the new
identity's page; the old Conversation returned 404 and the new Buying collection
remained empty. The separate Buyer logout/re-login test restored persisted history.

Final exact-ID read-only cleanup audit includes ALL EIGHT temporary test attempts,
not merely the last successful one. Each attempt used three newly tagged users and
one published test Listing. All 17 audited residue counters are zero: Auth users,
identities, sessions, refresh tokens, profiles, preferences, Conversations,
Messages, message images, submissions, Listings, Listing images, notifications,
notification events, account activity, cleanup queue and Storage objects. Receipt:
`tests/artifacts/b06-all-run-cleanup.json`. No existing or historical resource was
deleted; no cleanup scope was broadened. Local servers/sockets were stopped.

Files changed in this acceptance pass: new `tests/messages-b06-staging.cjs`, this
qualification document and the B06 progress entry in
`docs/BUSINESS-V1-TASK-BREAKDOWN.md`. The earlier local connector correction was
reused unchanged. UI/component/CSS changes: NONE. App business-code changes during
this acceptance: NONE. No migration, Production, email, payment, Git stage/commit/
push or B07 activity.

Boundaries (not hidden passes):

- Hosted interruption was confined to the test WebSocket and SDK wrapper; no
  provider-wide outage, shared RPC fault, long offline duration or natural JWT
  expiry was induced. Controlled reconnect/refresh and identity changes passed.
- Existing Shop provenance passed its actual repository/offline regression. No
  Shop membership, product publication or Shop Order transaction was created;
  those separate business tasks are not certified by B06.
- Signed media remains a bearer capability for its existing 300-second lease.
  Logout does not imply instant revocation of previously issued links. Natural
  lease expiry and every device/OS browser permutation were not timed here.
- History pagination/many-thread ordering have local regression coverage; the live
  fixture used one canonical Conversation per run, not a large inbox load test.
- Browser account switch used real Auth endpoints plus the existing session-ended
  signal. It does not claim a new acceptance of the Settings logout dialog itself.

Final checks: application TypeScript, focused ESLint, actual connector/API local
regressions, native PostgreSQL concurrency/permissions suite, existing Messages/
image/client/provenance regressions and offline attachment browser suite passed.
No unresolved product failure was found. B06 is Completed within its approved
scope; stop here and do not start B07.
