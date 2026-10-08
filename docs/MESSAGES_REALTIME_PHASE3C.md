# Messages Phase 3C frontend Realtime and staging E2E

2026-10-08. **STAGING ONLY. PRODUCTION NOT MODIFIED.**
Backend: **STAGING VERIFIED**. Frontend: **INTEGRATED / STAGING E2E VERIFIED**.
Production Realtime and hosted frontend: **NOT DEPLOYED**. No commit or push.

Target was western-marketplace-staging (`pcaqxezdfxofysghssyo`), with an isolated
local app on port 3108 and independent disposable Seller A, Buyer B and Outsider C
browser contexts. The production environment file and normal browser/profile were
not changed. No production endpoint, smoke, migration or fixture was used.

The [Phase 3A contract](MESSAGES_REALTIME_DESIGN.md) and
[Phase 3B hosted verification](MESSAGES_REALTIME_STAGING_VERIFICATION.md) remain
the backend authority. No migration, database helper/policy, publication, bucket,
dependency, global hosted setting or Next.js/PWA configuration changed in Phase 3C.
The existing Realtime migration SHA-256 remains
`5d16a4638eb2f2ac9f697e994f8a9ed9f91d9dd79034939426e8b8f55380499a`.

## Implementation

The [browser controller](../lib/messages-realtime.ts) lazily creates a public-key
Supabase client for a mounted authenticated Messages owner. Its accessToken
callback uses a closure cache, one in-flight bridge request and memory-only SDK
sessionStorage. It does not construct a competing browser Auth session, persist
tokens, call setSession or expose server credentials. Teardown/join is serialized
across remounts. Exactly one receive-only private channel uses
`marketplace:messages:<current verified user UUID>` and messages_changed.

Both browser configuration and the
[POST session bridge](../pages/api/messages/realtime-session.ts) deliberately
enable this phase only for the staging project. Production browser configuration
does not install connection listeners, call the bridge or construct a socket.
The existing staging/production project guard stays intact for canonical Messages
and IMAGE APIs; unknown/mismatched configurations fail closed. Production Realtime
enablement requires separate rollout authorization and is not configured here.

The bridge reuses same-origin/custom-header protection and the existing HttpOnly
SSR cookie client. It calls verified getUser/Western eligibility before getSession,
then matches subject, authenticated role, expected issuer and unexpired exp.
Responses contain only accessToken, expiresAt and userId, with private no-store and
no-referrer headers. Refresh tokens, cookie values, profiles and service-role keys
are not returned. The existing Messages PWA NetworkOnly scope already covers it.

The existing [Messages owner](../components/home/messages.tsx) uses
[canonical reconciliation and bounded scheduling](../lib/messages-reconciliation.ts).
Broadcast is only a validated invalidation signal; provider-added id is not a
message ID. Buying/Selling lists and visible active history are read from existing
cookie-authenticated APIs. Role/selection changes do not create new channels.
Initial, navigation, recovery and live refreshes use the same constant-size dirty
scope queue: approximately 100 ms, one in-flight job per scope, at most two API
jobs, and a trailing pass for events during work. Manual older-history reads are
serialized with automatic history requests.

History merges durable IDs, checks sequence conflicts and orders by sequence.
Unchanged objects/keys and fresher IMAGE leases are retained; signed presentation
comes only from normal authorized APIs. Backward catch-up walks up to five 50-row
pages until the previous horizon overlaps. If the cap leaves a gap, old history
and its upward viewport remain until Load latest explicitly selects the new
window, scrolls to its tail and keeps a valid older-page cursor. Pure tests verify
an 80-row overlap recovery and a 350-row dataset capped at 250 incoming rows;
that larger dataset is simulated, not inserted into staging.

[History rendering](../components/home/message-history.tsx) follows incoming
messages only when already within 80 px of the bottom; confirmed own messages keep
the existing follow behavior. Otherwise it preserves a visible durable-row anchor
and offers a small New messages / Jump to latest button. Resize handling preserves
the anchor through image/gallery layout changes. Only visible rows in an active,
unobscured history and visible document are acknowledged after a paint frame.
Attachments/listing overlays and mobile Go Back suppress reads. Read RPCs serialize
per conversation and advance only confirmed boundaries; canonical list refetches
replace unread state instead of applying a potentially stale read-count response.

Every successful subscription, online/focus/visibility resume and token update
reconciles both lists and visible history. JWT refresh occurs through the server
bridge and setAuth. Session/account/unmount generations gate callbacks and late
API results. Logout notification is synchronous, credential-free, and supplemented
across tabs by a timestamp-only storage event. Session-provider refresh now accepts
the server's null seller result and clears signed-out account state. No cookie
visibility or login/OTP/recovery architecture was changed.

## Final real-browser evidence

Final frozen-source run **efa30d27** passed **31 groups**, including cleanup.
The earlier full run 073fbc75 also passed; the final run additionally uses the
refined bounded-history helper/cursor handling. Reusable source is
[the staging launcher](../tests/messages-realtime-e2e-staging.cjs),
[live acceptance](../tests/messages-realtime-browser-acceptance.cjs) and
[failure/regression cases](../tests/messages-realtime-browser-regression.cjs).

| Requested report item | Result |
| --- | --- |
| 1. Browser client | Lazy public URL/key; closure user JWT; no browser Auth replacement or persistent token storage. |
| 2. Session bridge | Verified existing HttpOnly session; POST/no-store; only user access token/expiry/ID. |
| 3. Channel/topic | One private own-user topic; receive-only; no per-conversation/list channels. |
| 4. Subscription count | One per active Messages tab; Buying/Selling switches retained the same join; zero on leave/logout. |
| 5. Invalidation | Minimal signals dirty scopes; raw payloads never become DTOs or bubbles. |
| 6. History | Canonical TEXT/IMAGE reconciliation, durable dedupe/order, pagination cap and authorized leases. |
| 7. Lists | Live preview/order/unread; active selection retained; hidden Selling cache refreshed. |
| 8. Own echoes | Exactly one TEXT/IMAGE bubble after response plus echo, including ambiguous-response retry. |
| 9. Read/unread | Inactive conversation remained unread; visible rendered history cleared only its watermark. Upward tail stayed unread until jump. |
| 10. Scroll | Near-bottom follows; upward position preserved; jump restores latest; gallery remains usable. |
| 11. Coalescing | Constant dirty flags/two jobs; local 100-invalidation burst tests verified no overlap plus trailing refresh. |
| 12. Recovery | Real offline/online, socket close/rejoin and focus reconciliation recovered missed TEXT/IMAGE. |
| 13. JWT refresh | Forced only disposable SSR expires_at metadata; verified a different real signed access token, setAuth, continued APIs/delivery and one channel. |
| 14. Lifecycle | Role/chat changes, mobile back, leaving Messages, remount and logout passed; generation/late-event guards also tested locally. |
| 15. Live TEXT | Buyer→Seller and Seller→Buyer actual composer/keyboard sends arrived without receiver reload. |
| 16. Live IMAGE | Buyer one image and Seller four through FileDrop/prepare/upload/receipt/finalize; recipient rendered authorized bytes live. |
| 17. Multiple conversations | Four Buying plus one Selling conversation; inactive unread, selected UUID, live ordering and recent-three/+N expansion passed. |
| 18. Rapid ordering | TEXT/TEXT/IMAGE/TEXT converged to unique durable IDs and ascending canonical sequences. |
| 19. Offline | Actual browser offline simulation; other user sent TEXT/IMAGE; reconnect caught up without reload/duplicates. |
| 20. Socket outage | Realtime-only sockets closed while normal HTTP TEXT/IMAGE remained usable; recovery reconciled missed history. |
| 21. Outsider | History/signing 404 and no primary UI data; actual browser cross-user private join rejected using Outsider's own JWT. |
| 22. Historical listings | Normal sold/delete endpoints; existing conversation still delivered live TEXT/IMAGE and authorized images. |
| 23. Responsive | 390/430/1280/1536: live incoming TEXT and IMAGE, readable images, composer/gallery, mobile back, one channel and no horizontal document overflow. |
| 24. Performance | Final four-message batch: 12 observed conversation GETs, 5,381 ms whole-batch convergence, one channel. Includes mutation/upload and button lifecycle time, not isolated socket latency. Counts are observations, not correctness requirements. |
| 25. Phase 1/2 | TEXT/IMAGE response-loss retries preserved identity; IME Enter guarded; cancel created no message; ordered four-image gallery and persistence after reload passed. |
| 26. Cleanup | Users, profiles, listings, conversations/messages, submissions/receipts/image children, Storage and scoped queue fixtures removed; local artifact root removed. |
| 27. Files | Browser controller/helper, session bridge, Messages/history/photos/chat/session/listings API, four new tests and documentation; no dependencies/migrations changed. |
| 28. Validation/build | TypeScript, focused ESLint, ten local test scripts, staging-configured production-mode build, browser secret scan, local documentation links and diff checks passed. |
| 29. Limitations | Natural signed JWT expiry was not waited out; no actual OS sleep, long-duration stress or production Realtime verification. Large pagination cap is unit-tested. |

Failure injection used browser request interception, not schema/service changes:
canonical history 503 retained existing data until a later signal healed it;
signing failure recovered via existing photo retry; committed TEXT and IMAGE
responses replaced with 502 retried the same durable intent and rendered once.
The cross-user join case changed only the disposable browser's outgoing join topic
on the wire; its real authenticated JWT and private config were unchanged. Backend
RLS rejected it. No authorization was weakened and no raw token/frame body logged.

Real JPEG/PNG/WebP fixtures were generated locally, uploaded through the attachment
UI and removed. Seller's primary listing was published using the real form; Buyer
entered through real listing Contact Seller. Connected acceptance then opened the
existing normal Messages route in both browser contexts, matching the established
staging harness. Receiver reloads were not used to make live assertions pass;
explicit reloads were reserved for mount/persistence/lifecycle tests.

## Cleanup, diagnostics and final checks

All normal and failed runs used scoped cleanup. Early harness issues included
Phoenix array-frame counting, composer readiness, a collapsed sidebar selector
and an incorrect partial PATCH fixture transition (the actual API uses /sold).
These were corrected in the tests; existing send semantics were not changed to
accommodate them. A constructor-throw outage simulator interrupted one run before
finally cleanup. Exact run fe100cf2 was recovered to zero using only its fixture
identifiers; the simulator now closes only Realtime sockets and pending response
waiters are handled. The final run completed cleanup normally.

Final run counters were zero users, listings, conversations, messages, submissions,
chat objects and cleanup queue. Child images/verification receipts cascade with
their parents. A separate read-only staging prefix check also returned zero Auth
users, profiles, listings and conversation snapshots across Phase 3C runs. Storage
removal was verified through object lookup; queue acknowledgement was scoped to
those removed fixture paths. The existing private chat-images bucket and applied
Phase 1/2/3 infrastructure remain. Managed transient Broadcast retention is not
canonical fixture data and was not purged.

The isolated app and browser stopped. Generated files, interrupted-run leftovers,
sanitized result JSON, SQL probes and isolated compilation cache under ignored
tests/artifacts/messages-phase3c were removed after recording evidence. Passwords,
keys, JWTs and cookie/session values were not printed or written into harness files.
Automatic review rejected an initial proposed temporary server-file launcher over
credential persistence concerns; the executed launcher uses in-memory node -e code
and child environment credentials instead.

The ten local scripts cover Messages TEXT/IMAGE API and environment guards,
image/presentation/conversation models, Phase 1/2/3 migration source, Realtime
bridge/client/queue/lease/pagination safety and the existing mocked SSR cookie,
refresh and sign-out contract. The final optimized build exited 0 and generated
all pages; browser output contains neither the actual privileged key nor
SUPABASE_SERVICE_ROLE_KEY. The existing unchanged GlideSelect.jsx global ESLint
parser-services error still appears during build, alongside Browserslist age
warnings. Focused lint is clean; global lint is not claimed clean. No unrelated
lint/dependency fix was made. Existing Next.js/PWA configuration is unchanged.

No refresh token or service-role browser variable was added. The index remains
empty; .env.local is ignored and configured secrets are absent from commit-eligible
files. The Phase 1/2 SQL hashes and dependencies still match checkpoint 74d832d.

**REALTIME FRONTEND VERIFIED ON STAGING. PHASE 1 TEXT PRESERVED. PHASE 2 IMAGE
PRESERVED. NO typing/presence/read-receipt features. NO production modification.
NO commit. NO push.**
