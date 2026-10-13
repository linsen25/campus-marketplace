# Campus Marketplace project handoff

## Current provider-independent checkpoint (2026-10-13)

PROVIDER-INDEPENDENT BACKEND: COMPLETE / VERIFIED through Backend Completion Pass.
EXTERNAL INTEGRATIONS: DEFERRED. FRONTEND PRODUCT POLISH: FUTURE.
REAL-MONEY PAYMENT NOT YET INTEGRATED. Hosted media cleanup is deferred; its
domain and local/manual staging worker path exist. Notification email/push delivery is not
implemented. See [current evidence](BACKEND_COMPLETION_STAGING.md) and the
[external integrations backlog](EXTERNAL_INTEGRATIONS_BACKLOG.md).
Older phase stop boundaries below are historical; preserve their evidence.
Future UX: Maps, Notifications feed/Bell, Browse/Search and general
polish. The previous read-only production lint incident is documented, with zero
production writes; use the guarded staging lint entry point for qualification.

The current [V2 Offer / Agreement revision](V2_OFFER_AGREEMENT_REVISION.md) adds
per-sender Active Offers, Declined, five-minute withdrawal, Listing preference,
centered Agreement history and new 1% item-only / CA$5-cap economics. Eight additive
migrations are applied to staging. **COMPLETE / STAGING VERIFIED:** full two-role,
four-width qualification, 18 true-overlap races, V1/Market regressions and cleanup
passed. The final evidence is in that report;
older phase boundaries and fee evidence below are historical, not current defaults.

## V2-D2A implementation update (2026-10-12)

V2-D2A On Campus Buyer inspection and explicit staging payment is implemented
and hosted-qualified only on western-marketplace-staging (`pcaqxezdfxofysghssyo`).
008/009/010 additive migrations are applied once; accepted C2 snapshots stay immutable.
Inspection never charges. New payment checks the actual Buyer and authoritative Set
capability; a private intent enters Processing before trusted simulator resolution.
Processing/Paid block ordinary Cancel, no-show release and meetup changes. Failed
remains retry/cancel/expiry compatible; inspection alone does not block expiry.
Paid remains Open / Listing Pending / payout Not eligible / fulfillment pending.

Twenty overlapping races passed without deadlocks, timeouts or invariant failures.
Buyer/Seller private updates 5/5, outsider 0 with polling disabled; fresh UI Pay, restart
reconciliation, ten states at four widths, D1/V1/Delivery regressions and optimized
staging build passed. Synthetic fixtures are cleaned and manual/Nike/media
fingerprints unchanged. [Full authority, hashes and 51-item closure](ORDER_CAMPUS_PAYMENT_V2_STAGING.md).
Production and `.env.local` untouched; no real charges/emails, commit/push or hosted
deployment. No QR/6-digit handoff, Protection, Completion/Sold, payout release,
Delivery progression or Notifications. Stop before D2B implementation; D2B is ready
for planning only. Before V2-G, remind the user to create a stable Git checkpoint.
Earlier D1/C2 statements below are historical phase scope.

## V2-D1 implementation update (2026-10-12)

V2-D1 On Campus scheduling / mutual rescheduling / +60m no-show is complete
on staging only. All three additive migrations are applied and immutable. Hosted
qualification, 14 true-concurrency runs, historical FK retention, V1/Delivery
regressions and 390/430/1280/1536 authenticated Realtime browser checks passed.
Synthetic data is cleaned; canonical/manual/media fingerprints are unchanged.
[Technical record](ORDER_MEETUP_V2_STAGING.md). C2 snapshots and winner authority
remain intact. No D2 Payment/inspection/handoff/Protection or Notifications.
Production/manual history untouched; no commit/push. Stop before G for a stable
Git checkpoint.

## V2-C2 implementation update (2026-10-12)

C2 was applied only to staging as `202610120004_offer_accept.sql`.
Recipient-only Accept, explicit V2 Order protocol, immutable snapshots/private
media binding, one Listing winner/Pending, competing V2 Closed and safe unpaid
cancellation are implemented. Hosted qualification, 13 true-concurrency runs, three-session Realtime and
390/430/1280/1536 browser qualification passed. Canonical/manual fingerprints
are unchanged and synthetic fixtures are cleaned. See
[the C2 technical record](OFFER_ACCEPT_V2_STAGING.md).
Earlier B/C1 scope statements below describe those phases, not current C2 scope.
Production and manual history are untouched; no commit/push. D/E/F/Notifications
remain out of scope. Before V2-G, stop for a stable Git checkpoint.

## V2-C1 private snapshot media foundation (2026-10-12)

**MEDIA RETENTION FOUNDATION COMPLETE / STAGING QUALIFIED.** Only additive
migration `202610120003_order_snapshot_media.sql` was applied to staging
`pcaqxezdfxofysghssyo`. Private immutable copies, authoritative preparation,
byte verification, complete-batch binding, leased orphan cleanup and participant
signed reads passed hosted tests, including four independent overlapping
transaction cases with both winner orders and zero deadlocks/lock timeouts.
[Technical implementation and qualification](ORDER_SNAPSHOT_MEDIA_V2_STAGING.md).
Canonical/manual fingerprints are unchanged; synthetic fixtures are removed.
Public Listing and private chat media behavior remain intact. Production was not
accessed; no commit/push. Full V2 Accept, Listing winner/Pending, timers and
Notifications are **not implemented by C1**. V2-C may resume only as a subsequent
task; do not resume automatically. Keep the stable checkpoint requirement before
V2-G.

## Current V2-B staging implementation (2026-10-12)

Final On Campus/Delivery Offer terms migration `202610120002` applied only to
staging `pcaqxezdfxofysghssyo`; Offer UX is COMPLETE / QUALIFIED with final two-session browser
qualification passed. [Implementation and evidence](OFFER_DOMAIN_V2_STAGING.md).
Listing Make Offer reuses exact conversation identity. Messages supports both
roles' initial/Counter/Revision and sender-only Withdraw, with authoritative
history/Realtime refresh, payout gating and stale-mutation recovery. V1 history
remains semantically Order Request, with Active compatibility conflict handling.
No V2 Accept, Order creation, inventory mutation, payment/timer, Protection or
Notifications implementation. Production and manual/Nike histories untouched.
Four responsive widths, native modal/reduced-motion, real IMAGE, refresh persistence
and forced stale-refetch recovery passed. Seven synthetic Offers were removed;
canonical/manual history fingerprint unchanged. Zero Orders / inventory mutation.
V2-C Accept / Listing winner foundation is ready for implementation planning only.
No commit/push. Before future V2-G Notifications, require a stable code checkpoint.

Older phase records below are historical; their "UI remains V1 / B not started"
statements describe the preceding checkpoints, not the current implementation.

## V2-A2 staging implementation (2026-10-12)

V2-A2 backend mutation migration applied on staging only; current UI remains V1.
[Technical authority/qualification](OFFER_DOMAIN_V2_STAGING.md) documents Buyer/Seller
Create/Counter, sender-only Withdraw, sender-specific payout gating, protocol
isolation and stale retry protection. Migration `202610120001`,
SHA-256 `2bab910d14e5b1ee486731681c928e8e97bbf2feca7f896e6add92f5051d86be`.
A2 COMPLETE / QUALIFIED: 13 true concurrent cases, zero deadlock/timeout/invariant
failures, safe two-participant Realtime invalidation and synthetic cleanup pass.
V2-B OFFER UX IS READY FOR IMPLEMENTATION PLANNING; do not begin automatically.
No V2 Accept, Order creation, inventory/payment/timer/fulfillment changes or
Notifications. Canonical manual/Nike histories protected; production untouched.
The approved competitor-inspired future UX remains binding, deferred to its phases.

## Revised Marketplace V2 contract - documentation only (2026-10-11)

**V2 contract REVISED AND RE-CLOSED. V2-A1 protocol isolation IMPLEMENTED on
staging; user-facing app remains V1. A2 backend implemented as recorded above; V2-B UI is not started.** Authoritative future product source:
[MARKETPLACE_V2_PRODUCT_CONTRACT.md](MARKETPLACE_V2_PRODUCT_CONTRACT.md), with
[Notifications design](NOTIFICATIONS_V2_PRODUCT_DESIGN.md),
[impact/phase audit](MARKETPLACE_V2_IMPACT_AUDIT.md) and
[Offer compatibility audit](OFFER_DOMAIN_V2_STAGING.md).

New V2 Offers use Withdrawn (Cancelled is an Order outcome). Accept creates a
Pending Listing and immutable transaction evidence; Completed makes Sold,
cancellation/expiry before completion releases Available. On Campus inspects
before payment and uses meetup + 60m no-show grace with mutually confirmed
rescheduling. Delivery is direction-aware: Buyer accepts Seller Offer -> immediate
30m payment; Seller accepts Buyer Offer -> 12h checkout claim then one-time 30m
when Buyer intentionally starts checkout. Do not implement old universal
Delivery/On Campus Accept-timer assumptions or reinterpret legacy deadlines.
Paid physical handoff requires Buyer QR/6-digit verification; Notifications remain
one priority-weighted feed with unread Price Drop coalescing. Protection coverage
is future policy direction, not an implemented real-money guarantee.

A1 only isolates protocols/authority, sender/recipient, legacy compatibility,
V1 mutation guards and cross-protocol Active exclusivity. A2 owns bidirectional
mutations; no fulfillment, timers, Pending, snapshots, reschedule, handoff or
Notifications implementation belongs to A1. Lower dated records retain V1 history.
A1 applied only `202610110004_offer_protocol_isolation.sql` to staging
`pcaqxezdfxofysghssyo`; explicit immutable protocol/sender/recipient, validated
4-row V1 backfill, legacy Accept/Cancel/Replace guards, filtered V1 history and
cross-protocol Active exclusivity. No V2 Accept/mutation/UI or future fulfillment,
timer, Pending/snapshot or Notifications implementation. Original historical
fields/Orders/events preserved. See Offer audit for checksum and verification.
Production/.env.local untouched; no commit/push. Email/custom SMTP deferred.

## Narrow post-Phase-F cleanup - staging (2026-10-11)

Only the three remaining recorded UI bugs were corrected:

- Accept confirmation now uses the existing `profile.dialog` card surface with
  `FadingDialog`; title, snapshot terms, actions and backend call are unchanged.
- Successful Accept immediately installs a per-authenticated-user/conversation
  interaction barrier for that Request and fences pre-success history reads.
  It does not rewrite Request status or synthesize an Order. A failed refresh
  retains the barrier and shows a recoverable error/Retry; an old Active response
  remains non-actionable. Fresh server non-Active/absent state reconciles the barrier.
- Homepage planned-payment copy now distinguishes Buyer payment before fulfillment,
  Protection after confirmed handoff/receipt and later Seller payout eligibility.
  No escrow claim, 72-hour reference or payment-after-Protection implication.

New recovery tests cover synchronous barriers, stale read fencing, refresh failure,
server-truth recovery and conversation/user scope. Four-width browser checks
(390/430/1280/1536) use real staging authentication but fully intercepted synthetic
Accept/Order/history responses: correct card surface, native keyboard/focus,
Cancel/Escape zero writes, disabled duplicate confirmation and recoverable stale
eligibility. Actual transaction writes and runtime errors are zero.

Final validation: TypeScript, focused ESLint, Request/Accept, Orders, Phase E
Payment, Phase F Progress, Auth/session and Messages local regressions passed.
The unchanged Phase F/Payment read-only two-session browser matrix passed 64
state/viewport cases with zero runtime errors and transaction writes. Read-only
staging fingerprint verification preserved the manual Monitor Request and
financial state. Sensitive-value/bundle scans, documentation links and
`git diff --check` passed; Git index remains empty.

No database/migration/RPC or lifecycle/financial semantics changed. Phase E Payment
UI, Phase F Progress/Next Step, Settings, payout gate and simulator are untouched.
The manual Monitor Request is preserved. Production untouched; no commit or push.
The sections below retain earlier implementation history.

## Phase F role/fulfillment Progress and Next Step - staging (2026-10-11)

Formal Order Detail now derives one read-only presentation from the persisted
Order DTO and the authenticated Buyer/Seller identity. `lib/order-progress-ui.ts`
selects Pickup/Meet, fixed Shipping or shipping-quote milestones; the shared
`OrderProgress`/Velora Stepper renders supplied labels and variable step counts.
The frozen preview retains its isolated legacy sequence. No preview transaction
store or client progression participates in formal derivation.
Formal flows have 5/6/7 milestones. Mobile uses the same markers and rail in a
vertical arrangement so the full labels remain readable; desktop remains
horizontal. The isolated preview keeps its existing responsive layout.
Paid marks only accepted/payment complete, with no current future milestone;
Next Step interprets the persisted awaiting-fulfillment state separately.

- Fixed Pending: Buyer **Complete payment**; Seller **Waiting for buyer payment**.
  Only the authoritative unpaid reservation displays a countdown.
- Paid Pickup/Meet: Buyer **Meet the seller**; Seller **Meet the buyer**. Shared
  snapshot location, schedule and optional note appear; Payment is completed.
- Paid Shipping: Buyer **Waiting for seller to ship**; Seller **Ship the item**.
- Shipping cost pending: Buyer **Waiting for shipping quote**; Seller **Set
  shipping cost**. No quote action, countdown or finalized payable total.
- Expired: terminal **Reservation expired**, role-specific explanation, no active
  Payment step. Completed/current/inactive milestones have accessible labels.
- Fulfillment, Protection, completion and payout milestones remain inactive.
  `payoutStatus` never fabricates fulfillment progress; Not eligible stays inactive.

Phase E Payment UI and simulator semantics are unchanged. A successful simulator
POST followed by the exact authoritative Order GET naturally updates this
presentation; no optimistic transaction transition is introduced. Overview,
Fulfillment, Payment tabs and Next Step/Stepper styles are preserved.

No migration, schema, RPC, reservation, inventory, Request/Accept, financial
semantics, provider or future fulfillment action changed. Production untouched.
The manual Monitor Active Request `88260b5b-0851-4bf2-a100-8a5c11edd8c9` is preserved.
Remaining known bugs: Accept confirmation surface; Accept success/history-refetch
stale eligibility; Homepage payment/payout trust copy. Global GlideSelect.jsx
parser debt remains pre-existing. No commit or push.

Phase F validation passed: 64 read-only state/viewport cases in independent
real Buyer/Seller staging sessions (Pickup and Meet tested separately), 8 detail/
navigation checks and 44 skeleton/loading checks. All report zero runtime errors
and zero transaction writes. Approved Phase E browser regression passed 36
state/viewport cases, including exactly one Buyer simulator POST, held exact Order
GET, subsequent persisted Paid presentation and Seller refresh of the same Order.
Pending presentation stayed until the authoritative GET completed; Paid then
marked accepted/payment complete and removed the reservation Next Step/countdown.
Seller never received Buyer payment controls; Buyer never received payout account
metadata. Scoped synthetic fixtures were removed, capabilities restored to Unset,
and canonical/manual history fingerprints unchanged.

TypeScript, focused ESLint, pure mapping/Stepper accessibility tests, financial/
capability guards, payout gate, Request/Accept/static contracts, Orders/schedule/
expiry, Auth/session and Messages TEXT/IMAGE/Realtime regressions passed.
Staging financial rollback SQL regression passed without applying migrations.
An additional optional local marketplace-security PGlite check could not run:
the separately installed PGlite tooling is absent; no dependency was installed.
The corresponding hosted rollback security regression passed. Sensitive-value/
browser bundle scans, documentation links and git diff --check passed; index empty.
Screenshots/results are Git-ignored. No production access, email, commit or push.

Earlier sections below are historical implementation records.

## Phase E role-specific Payment UI - staging (2026-10-11)

The formal localhost:3000 Order Payment tab now derives Buyer/Seller role solely
from the authenticated user ID and persisted Order participants. Buyer sees the
Order money snapshot, own account payment method, reservation context or confirmed
amount/paid time. Seller sees Buyer payment, item earnings, separate shipping
reimbursement, zero platform fee, authoritative payout status and own payout
account metadata. Account setup links reuse Settings -> Payments & payouts.

The exact-staging Buyer-only STAGING ONLY simulator calls the existing Phase D
API. Unset/Needs attention disables it. Success ignores the mutation DTO and
refetches the exact Order; background reads retain content. Shipping pending,
Expired and Paid show no simulator/countdown. No normal production Pay action.
Independent real Buyer/Seller sessions, Settings navigation and 36 responsive
state checks at 390/430/1280/1536 passed. Held-refetch testing proved no optimistic
Paid state/full-page loading flash; refresh preserves Paid for both roles. Scoped
fixtures were removed and canonical data/manual Monitor Request preserved.

Seller Payment mirroring Buyer is fixed. The other four known bugs remain:
role-shared Stepper labels, Accept confirmation surface, Accept/refetch stale
eligibility and Homepage trust copy. Backend financial semantics, Request UI,
Overview/Fulfillment and milestone labels were not changed. Phase F remains next.
Production untouched; no migrations, emails, provider, commit or push.
See [financial state record](ORDER_FINANCIAL_STATE_STAGING.md#phase-e---role-specific-payment-ui).

## Phase D Order financial state - staging (2026-10-11)

[Phase D technical record](ORDER_FINANCIAL_STATE_STAGING.md): one additive
migration `202610110002_order_financial_state.sql` applied exactly once to staging.
Orders now separate Payment (initial Pending) and Payout (initial Not eligible),
with an authoritative paid timestamp. Three historical expired Orders were
backfilled without revival or history changes. The Buyer-only staging simulator
requires a persisted Set payment method and a payable, unexpired reservation;
shipping pending is rejected. Paid retains inventory and cannot be expired by the
unpaid reservation path. Idempotent retries emit no duplicate payment event.
Hosted lock races, competing inventory, security tests and independent Buyer/Seller
API/read/refresh checks passed. Test fixtures were removed; canonical capabilities
restored to Unset and manual Monitor Request preserved. Minimal Paid display and
unpaid-countdown hiding only; the five known UI bugs remain unchanged. No provider,
normal Pay UI, payout execution or other Phase E/F work. Production untouched;
no emails, commit or push. Earlier phase entries below are historical.

## Phase C seller payout gate - staging (2026-10-11)

The [Phase C record](FINANCIAL_CAPABILITIES_STAGING.md#phase-c---seller-payout-gate-2026-10-11)
uses one additive function-only migration `202610110001_order_payout_gate.sql`.
Create/Replace and first Accept require current persisted Seller payout Ready at
one serialized database boundary; Cancel and completed idempotent retries remain
independent. Seller entry reads its own safe financial API and routes blocked
attempts to Settings. Buyer sees only a safe temporary eligibility explanation.
No schema/backfill/payment state/provider changes. Prior Phase A/B entries below
are historical and their statements about Phase C not implemented are superseded
by this entry. Production remains untouched; no email, commit or push.

## Phase B financial Settings ? implemented on staging (2026-10-11)

[Financial capability integration](FINANCIAL_CAPABILITIES_STAGING.md#phase-b--settings-integration-2026-10-11):
Settings Payments & payouts plus Overview status summaries use persisted safe data.
Separate STAGING ONLY Set/Ready/Needs attention/Clear controls use authenticated,
exact-project guarded server mutations marked staging_test; not real onboarding.
Actual UI persistence, isolation, responsive/loading/error checks and regressions
passed. Canonical demos restored to Unset/Unset; manual Active Request untouched.
No schema/migration change. Phase C payout gate, Order payment state, provider and
five known UI bugs remain unimplemented/unchanged. Production untouched; no emails,
commit or push. Prior Phase A entry below is historical infrastructure scope.

## Phase A financial capabilities ? implemented on staging (2026-10-10)

[Phase A technical record](FINANCIAL_CAPABILITIES_STAGING.md): private account-level
payment/payout capability rows, identity-bound safe GET projection and
service-role-only trusted read/mutation helpers. Migration `202610100003` applied
only to staging; rollback security tests and four real demo cookie sessions passed.
Existing users remain Unset/Unset. No Payment UI, payout gate, Order payment state,
simulator or provider integration. Existing manual fixtures and RPCs unchanged;
production untouched. Five known UI/client bugs remain separate work. No commit/push.

The following contract-closure entry records the prior documentation-only pass.

## Current Payment/Payout contract (2026-10-10)

**PRODUCT CONTRACT CLOSED FOR CURRENT PLANNED PHASES.**
[Approved V1 closure](ORDER_PAYMENT_PRODUCT_DESIGN.md#13-decision-closure-and-next-phase-boundary)
locks terminal visibility, historical Accepted plus linked outcome, Completed
independent of payout Paid, tracked shipping/trusted receipt, issue payout holds,
shipping reimbursement, late-payment reconciliation, handoff defaults and optional
Maps. These rules are not yet implementation changes. Five known UI/client bugs
are recorded in the contract and remain unfixed. Phase A is safe when separately
authorized; provider/security details do not reopen product decisions.

The [finalized product contract](ORDER_PAYMENT_PRODUCT_DESIGN.md) is authoritative:
account-level Payment method and Payout account under Settings; Seller payout Ready
before sending a Request; Buyer method setup may follow Accept; distinct payment
and payout lifecycles, item-price Seller earnings, 24-hour Protection, role-specific
progress and persisted Buyer-only staging payment simulation as future work.

Formal Requests/Accept/Orders/reservations/expiry are implemented on staging.
[Order Detail parity](FORMAL_ORDER_DETAIL_PARITY.md) now includes Next Step,
Stepper, Overview/Fulfillment/Payment and exact URL-based View Order navigation.
Payment method/onboarding/gates, paid transition/simulator and fulfillment/payout
backend remain unimplemented. Next proposed phases are A-H in the contract;
implementation requires separate authorization. This pass changes documentation
only: no code, data, production operation, commit or push.

## Historical minimal formal UI recovery (2026-10-10)

This historical recovery preceded the separately approved detail parity above.
The global pass's loaded-state additions and the interrupted parity expansion
have been withdrawn. Structural skeletons remain loading-only; the prior loaded
Request/Order components and navigation are preserved. No new filtering, linked
Order outcome, archive or transaction rule applies. See the exact
[recovery audit](FORMAL_UI_REGRESSION_RECOVERY.md). Stop for manual inspection of
the real staging localhost:3000 app; production and manual fixtures are untouched.

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

| Environment | Hosted Supabase project     | Project ref          |
| ----------- | --------------------------- | -------------------- |
| Production  | campus-marketplace          | yzvchumzyonegujucyqs |
| Staging     | western-marketplace-staging | pcaqxezdfxofysghssyo |

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

### Reusable real staging demo dataset

The [Order Request / Orders UI preview](ORDERS_PAYMENT_UI_PREVIEW.md) is presentational
only: fixed conversation listing editor, confirmation, transient compact/expanded
card history with supersession, ephemeral accepted Orders and desktop Order Detail.
The staging-only interaction preview includes local reservation/release, address
visibility after simulated payment, handoff code, shipment/delivery, protection
window and issue-hold flows. Pickup/Meet/Shipping forms inherit Create Listing styles;
Next Step and the adapted Velora Stepper stay outside the tabs. All transaction
state and fee calculations are ephemeral; refresh clears them. No Orders/Payments backend was added by that historical preview task. Formal
Requests/Accept/Orders were subsequently implemented on staging; see the current
boundary above. Preview changes remain uncommitted alongside the staging demo workflow.

For visual inspection, [STAGING_DEMO_DATA.md](STAGING_DEMO_DATA.md) documents the
project-locked seed/cleanup workflow and isolated localhost:3112 viewer. Four
marked synthetic identities, six listings, Favorites and four TEXT/IMAGE
conversations are currently seeded in staging. Credentials are ignored and local;
cleanup deletes only owned fixtures and refuses unrelated participant references.
Seed reuse, cleanup/reseed and independent Buyer/Seller browser checks passed.
No production changes or Orders/Payments fixtures were made. The workflow's source,
test and documentation changes are not committed/pushed.

## 2. CURRENT GIT / CHECKPOINT STATE

Inspection at the start of this handoff task found:

| Item                                          | Actual state                                                  |
| --------------------------------------------- | ------------------------------------------------------------- |
| Branch                                        | main                                                          |
| HEAD                                          | 4023d04eeb052262afadbc53bf731107bc2098c9                      |
| HEAD subject                                  | fix: improve auth signup and session flow                     |
| Working tree before these documentation edits | Clean                                                         |
| Upstream                                      | origin/main                                                   |
| Ahead / behind                                | 0 / 0                                                         |
| Remote branch hash                            | Same full hash as HEAD, verified with read-only git ls-remote |
| Auth UX checkpoint                            | Committed and pushed before this documentation task           |

Relevant checkpoints, newest first:

| Commit  | Purpose                                                                            |
| ------- | ---------------------------------------------------------------------------------- |
| 4023d04 | fix: improve auth signup and session flow                                          |
| a977fc9 | feat: add realtime messaging — Phase 3 checkpoint                                  |
| 74d832d | feat: add durable image messaging — Phase 2 checkpoint                             |
| 65f8dfe | feat: checkpoint marketplace UI and production text messaging — Phase 1 checkpoint |
| 2119e65 | Complete marketplace listings and profile experience                               |

This task adds the two handoff/design documents and updates PROJECT_STATUS.md;
those documentation edits are not committed or pushed. Re-run Git status in the
new session rather than assuming this snapshot is still current. Historical
"no commit/push" statements in rollout reports describe those audit turns, not
the current checkpoint state.

The local migration inventory below is recorded applied to production by the
rollout evidence. It was not queried remotely again for this handoff. SQL headers
such as "not applied" record original authoring checkpoints, not current status.
Do not reapply them or edit their bytes.

| Migration                                          | Purpose                          |
| -------------------------------------------------- | -------------------------------- |
| 202609290001_marketplace.sql                       | Marketplace/profile baseline     |
| 202610030001_marketplace_usernames.sql             | Username identity/cooldown       |
| 202610040001_marketplace_taxonomy.sql              | Taxonomy                         |
| 202610050001_marketplace_publication_favorites.sql | Publication/Favorites            |
| 202610070001_messages_text.sql                     | Phase 1 TEXT                     |
| 202610070002_messages_images.sql                   | Phase 2 IMAGE                    |
| 202610080001_messages_realtime.sql                 | Phase 3 private Broadcast        |
| 202610090001_auth_pending_username.sql             | Auth pending username correction |

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

| Component                                | Status                                               |
| ---------------------------------------- | ---------------------------------------------------- |
| Realtime backend                         | PRODUCTION DEPLOYED                                  |
| Realtime frontend                        | PRODUCTION-CONFIGURED / AUTHENTICATED SMOKE VERIFIED |
| Hosted staging E2E                       | PASSED                                               |
| Two-account production Realtime mutation | DEFERRED                                             |
| Hosted frontend                          | NOT DEPLOYED                                         |

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

| Check                                                | Result              |
| ---------------------------------------------------- | ------------------- |
| Session                                              | 200 / authenticated |
| Buying and Selling, probes and normal app            | 200                 |
| Realtime bridge                                      | 200                 |
| Messages UI / private join                           | Present / succeeded |
| Maximum channels                                     | 1                   |
| Logout / channels afterward                          | 200 / 0             |
| Authenticated API after logout                       | 401                 |
| Runtime errors / unhandled rejections / probe errors | 0 / 0 / 0           |
| Timeout / overall                                    | false / passed true |

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

| Checkpoint                             | Local directory                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Pre-IMAGE, includes TEXT state         | C:\Users\MLTZ\ProductionBackups\campus-marketplace\20261008T011038Z-pre-images   |
| Pre-Realtime, includes IMAGE state     | C:\Users\MLTZ\ProductionBackups\campus-marketplace\20261008T205249Z-pre-realtime |
| Pre-Auth, includes post-Realtime state | C:\Users\MLTZ\ProductionBackups\campus-marketplace\20261009T041034Z-pre-auth-ux  |

Native PostgreSQL 17 tooling and secure local pgpass were used: custom-format
database dump, password-free role metadata, TOC, manifest and SHA-256 records.
The pre-Auth archive was rechecked nonempty, checksum-matching and fully readable
by offline pg_restore decode. It predates the Auth migration and is not a current
post-Auth backup. Logical dumps do not contain Storage object bytes or every hosted
project setting. Future authorized production changes need a fresh current backup.
No Docker or local PostgreSQL server was required. Passwords must stay in secure
local configuration, never chat, logs, command arguments or repository files.

## 10. KNOWN TECHNICAL DEBT / LIMITATIONS

| Item                                                                 | Meaning                                                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| GlideSelect.jsx global ESLint parserServices/naming-convention issue | Pre-existing unchanged technical debt; focused lint passes. Production build exits 0 but global lint is not clean.                    |
| Legacy Next/Webpack on Node 24                                       | Existing validation uses --openssl-legacy-provider; do not change application code to compensate for a misconfigured build command.   |
| No hosted frontend                                                   | Separate future release work, not proof that the Supabase backend is undeployed.                                                      |
| Custom SMTP absent                                                   | Launch requirement; real UWO delivery acceptance remains deferred.                                                                    |
| Financial implementation pending                                     | Formal Orders exist on staging; no provider, account financial setup, paid transition or payout backend exists.                       |
| Typing/presence/live read receipts                                   | Intentionally outside Phase 3 scope. Durable read watermarks still exist.                                                             |
| Natural full JWT expiry, prolonged stress, actual OS sleep           | Not exhaustively tested; do not inflate the smoke/E2E claims.                                                                         |
| Seller account deletion                                              | Owned listings' seller FK can block deletion; deliberate listing cleanup is required. Do not promise automatic full account deletion. |

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
start Payments implementation without separate authorization against the finalized contract.

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

Payment/Payout product rules are **FINALIZED; financial implementation has NOT
STARTED**. Read the [authoritative contract](ORDER_PAYMENT_PRODUCT_DESIGN.md),
including current staging boundaries and the A-H roadmap. Phase A is the proposed
next step: account-level financial model and provider-independent server contract.
Do not implement it without a separate instruction. Hosted frontend deployment
and production financial rollout require separate authorization.
[PROJECT_STATUS.md](PROJECT_STATUS.md) retains chronological evidence.
