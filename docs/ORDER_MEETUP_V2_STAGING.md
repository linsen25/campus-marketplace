# V2-D1 On Campus scheduling / reschedule / no-show

## D2A payment/no-show integration update (2026-10-12)

[D2A technical qualification](ORDER_CAMPUS_PAYMENT_V2_STAGING.md) is complete on
staging. The D1 initial confirmation, mutual revision history and +60m deadline
authority are unchanged. Existing meetup_mutable admits only unpaid Pending/Failed;
Processing/Paid now use real server payment states and cannot reschedule, cancel
normally or release through no-show settlement. Inspection alone is not a barrier.

New payment and no-show share Listing -> Order locks (payment first takes the
Buyer capability advisory lock, matching V1). No-show-first expires/releases and
payment rejects; payment-first protects Processing and then Paid, retaining the hold.
Both overlap orders passed; no Paid+Expired or released Paid inventory. Failed
payment still permits D1 expiry/Cancel. No V1 30-minute deadline was introduced
into V2. Buyer/Seller meetup copy shows held inventory for Processing/Paid rather
than implying an unpaid grace countdown still settles it. Paid is not handoff,
Protection or Completed. D2B remains unimplemented.

The D1 completion/planning statements below record the earlier D1 checkpoint.


2026-10-12: staging implementation and final hosted qualification passed.
V2-D1 ON CAMPUS SCHEDULING / RESCHEDULE / NO-SHOW COMPLETE.
V2-D2 ON CAMPUS INSPECTION / PAYMENT / HANDOFF / PROTECTION IS READY FOR IMPLEMENTATION PLANNING.
Target only western-marketplace-staging `pcaqxezdfxofysghssyo`, real localhost:3000.
Production is not accessed; `.env.local` unchanged. No commit/push or hosted deployment.

## Applied migrations

- `202610120005_order_meetup.sql`, SHA-256
  `efc126a2a3f336007cf129de7c8a345c072eb9ea6e09ad66b035e4e87d9f6a6a`.
- `202610120006_order_meetup_guard.sql`, SHA-256
  `e6927b32a89e2b86f984593bb6d28f512e8341fe733ad9c8c9dabfa736bbcc30`.

All had exact-staging rollback dry-runs and full canonical/media fingerprints
before application. 006 fixes only a PL/pgSQL name collision found in real
no-show qualification: the new receipt query used alias r, also an existing
protect_order variable. The rejected function call rolled back atomically;
005 was not edited after apply. All A1/A2/B/C1/C2 applied files remain immutable.

- `202610120007_order_meetup_retention.sql`, SHA-256
  `d5f635840da81b3be228b2a619c9552d6a66e0d21ed1bac6e6dc85ef40233a8e`.

007 narrows the expiry guard to an Open -> Expired transition. A rollback-only
synthetic profile deletion proved that the previous guard also intercepted an
already-Expired Order's legitimate FK SET NULL update. The existing C2 historical
participant cleanup rule remains authoritative; no lifecycle semantics change.

## Authority

`public.order_meetup_revisions` is participant-readable with no direct write
grants. Immutable fields store absolute scheduled_at, public/campus location,
note, base confirmed revision, sequence, proposer/proposed time and decision
actor/time. Revision zero is an exact projection of accepted immutable On Campus
Offer terms, inserted in the same Order transaction; initial historical projection
never rewrites an Order, accepted snapshot or original events. Deferred winner
validation also requires the initial confirmed revision.

The current authoritative schedule is the highest-sequence Confirmed revision.
All earlier confirmed revisions stay Confirmed, immutable history. Pending is
never authority. A partial unique index permits at most one Pending proposal.
Either participant may propose; a valid new proposal supersedes the previous
Pending row, including an own revision or opposite participant proposal.
Only the other participant may confirm/decline; proposer may withdraw. Confirm
requires a still-future pending proposal against the current confirmed revision.
Superseded/declined/withdrawn/closed proposals cannot become authoritative.
Terminal Orders close any pending proposal and reject new actions.

`marketplace_order_meetup_action` accepts only schedule fields, action, exact
Order/revision and UUID command. Private command receipts are actor+UUID keyed,
input-digested and replay the original result without a second revision/event.
A successful old command can reconcile after later transitions without changing
the current state; a never-successful stale confirm still rejects. Reusing a key
for changed input rejects. Auth.uid() and verified participant identity, not
preview perspective, authorize every operation.

API: POST `/api/orders/[id]/meetup/proposals`, and POST
`/api/orders/[id]/meetup/proposals/[revision]/confirm|decline|withdraw`.
The bounded API payload explicitly rejects economics, role, status, clock,
grace and extra fields. Same-origin/CSRF and existing exact-staging guards apply.
Server DTOs omit internal actor UUIDs; UI shows Buyer/Seller/System.

Scheduling reuses B's Toronto absolute-time conventions: zoned input, finite
instant, 15-minute increments, minimum 60-minute proposal notice and 30 Toronto
calendar-day horizon. Confirmation rechecks future time after locking. UI reuses
DayPicker/wheel and existing local-time formatting; locale strings never decide
server authority. No economic field, participant, Offer, Listing snapshot, private
media or fulfillment term can change via a schedule action.

## No-show / concurrency

All mutation and settlement paths lock Listing before Order, then revision.
No-show uses current confirmed scheduled_at + interval 60 minutes and
clock_timestamp() after locks, never Accept time, proposal time or client clock.
Pending alone cannot extend that deadline. Confirming a future replacement
before settlement wins changes the authoritative deadline; settlement first
makes confirmation reject. Confirm deliberately does not settle the old deadline
before obtaining its authority, so both valid serialization orders are possible.

Private settlement is invoked by the existing lazy Listing settlement path on
Order workspace/detail reads. The existing 15-second Order refetch, focus and
Realtime refresh can materialize eligibility. No new cron/job infrastructure;
there is no guarantee of unattended expiry until a read evaluates it. Client
shows timing context only and never fabricates Expired.

Only open V2 On Campus, unpaid, held Orders in the pre-handoff fulfillment state
qualify. Existing payment_paid_at and payment/fulfillment guards fail closed for
future Paid/handoff states; future D2 actions must share the Listing->Order locks.
No D2 fields or transitions are implemented.

The private expiry receipt records exact confirmed revision, deadline and
server decision time before the guarded Order update. One transaction changes
Order to Expired, releases Listing Pending to Available, closes pending proposal
and appends one order_no_show_expired event. Source Offer stays Accepted;
competitors stay Closed, never revived. Snapshot media remains bound/private,
and Expired moves to the existing role-specific Orders History.

Proposal/confirm/decline/withdraw/supersede/closure events reuse immutable
transaction_events; private messages invalidation reaches only actual Buyer and
Seller. This is invalidation/refetch, not a Notification or local authority.

## User interface

The existing V2 detail layout is retained. An On Campus-only Meetup panel shows
Current confirmed meetup, location/date/time/note, and separately New meetup
proposed or Awaiting confirmation. Existing green actions propose/confirm;
Decline/Withdraw are explicitly proposal actions, not Order cancellation.
Expandable history preserves original/proposed/confirmed terms and actor roles
with timestamps. Grace copy is neutral; only server Expired shows the outcome.
V2 Delivery never receives this panel. Accepted Offer/economic snapshot remains
separately visible; no Pay/countdown/inspection/handoff/Protection actions.
Successful server responses update the authoritative DTO and refetch; a failed
follow-up refresh keeps action receipts blocked until recoverable refresh.

## Qualification (passed)

Local API/static tests, TypeScript, focused ESLint and optimized staging-configured
build pass. Existing Auth/session, Messages TEXT/IMAGE/Realtime, V1, Payment UI,
Progress and scheduling regressions pass. Global GlideSelect.jsx parser debt and
existing build warnings remain unchanged.

Hosted tests use confirmed disposable staging identities (no Auth emails),
real C2 Accept and C1 private media. Elapsed-time fixtures change only exact
synthetic confirmed revision times under exclusive locks, suppressing fixture-only
guard/events; they do not change host time or add any RPC clock override. The
+59:59 check is rollback-only; all fixture graphs and objects are exactly cleaned.
Full row/media fingerprint comparison uses the same complete projection in
capture and recovery, with no historical C2-column normalization.

Reusable commands (run sequentially, never overlap canonical fingerprint suites):

```text
node tests/order-meetup-static.cjs
node tests/order-meetup-api.cjs
node tests/order-meetup-staging.cjs
node tests/order-meetup-concurrency.cjs
node tests/order-meetup.browser.cjs
node tests/order-meetup-staging-admin.cjs verify
node tests/order-meetup-guard-admin.cjs verify
node tests/order-meetup-retention.cjs
node tests/order-meetup-retention-admin.cjs verify
```

Exact ignored fixture recovery: `node tests/order-meetup-fixtures.cjs recover`.
Capture inspect baseline before fixtures; do not recapture during a test. Applied
migration apply/dry-run commands are not repeat qualification commands.

## Remaining D2 scope

No inspection confirmation, actual payment/provider or simulator, QR/6-digit
handoff, Handoff confirmed, Protection, Completion, Delivery flow, Maps, reminders,
Bell or emails. D1 qualification is complete; D2 planning may start separately, with no automatic D2.
Before V2-G Notifications, stop and require a stable Git checkpoint first.

## Qualification fixes

The D1 mutation callback originally reused cancellation navigation, which moved
successful scheduling into History. A separate authoritative `onUpdated` callback
now updates the exact Order without navigation; cancellation keeps its original
callback. Mobile qualification exposed a long unbroken V2 listing title exceeding
the 390px viewport. The existing title now wraps long words without changing its
font, spacing or layout. Rebuilding while the old optimized server was running
also caused stale resource manifests; restart the validation runtime after build.
This runtime validation issue did not require an Auth/application workaround.

## D1 changed files

- Database: the three additive migrations listed above; older applied files unchanged.
- Backend/DTO: `lib/server/orders-service.ts`, `pages/api/orders/[[...segments]].ts`,
  `lib/orders-api.ts`, `types/order.ts`, `types/offer.ts`, `lib/server/offers-service.ts`.
- UI: new `components/home/order-meetup.tsx`; V2 detail, detail wrapper and formal
  Orders callback integration; one V2 title wrapping rule in the existing CSS module.
- Tests: `order-meetup-api`, `order-meetup-static`, hosted domain, concurrency,
  browser, V1 compatibility, retention, fixtures and exact-staging admin scripts.
- Docs: this record, PROJECT_STATUS, PROJECT_HANDOFF, MARKETPLACE_V2_IMPACT_AUDIT,
  and the C2 integration note in OFFER_ACCEPT_V2_STAGING.

## Final report closure map (all passed)

| # | Requirement | Implementation / evidence |
|---|---|---|
| 1 | Architecture | Participant RPCs + immutable revision history + existing lazy settlement and private invalidation. |
| 2 | Migrations | 005 domain, 006 SQL alias correction, 007 historical FK correction, separately listed above. |
| 3 | SHA-256 | Three separate hashes above; older applied sources unchanged. |
| 4 | Initial schedule | Revision 0 exactly projects accepted immutable location/time/note in the Accept transaction. |
| 5 | Revision schema | order_meetup_revisions, private command journal and expiry receipts; no direct client writes. |
| 6 | Current authority | Highest confirmed revision; pending never replaces it. |
| 7 | Buyer proposal | Real RPC and authenticated browser editor. |
| 8 | Seller proposal | Real RPC and authenticated browser editor. |
| 9 | Self-confirm | Rejected server-side; action absent in proposer UI. |
| 10 | Confirmation | Other participant only; future/current-base validation after shared locks. |
| 11 | Decline | Other participant only; original schedule stays confirmed. |
| 12 | Same sender revision | Previous pending becomes Superseded; new pending preserves payload history. |
| 13 | Pending uniqueness | Partial unique index; both concurrent participant proposal orders qualified. |
| 14 | Immutable history | Confirmed revisions retained; immutable location/time/note/base/actor/time. |
| 15 | Economics | Order economic/snapshot/private-media fingerprint unchanged across mutations. |
| 16 | Grace | Current confirmed scheduled_at + interval 60 minutes, clock_timestamp after locks. |
| 17 | Settlement | Existing read/lazy Listing settlement; atomic expiry receipt, Order/event and release. |
| 18 | +59:59 | Rollback-only synthetic boundary stays Open. |
| 19 | +60m | Expired, Listing Available, one receipt and expiry event. |
| 20 | Pending deadline | Future unconfirmed proposal cannot extend old confirmed deadline. |
| 21 | Confirmed deadline | Future mutually confirmed revision replaces deadline. |
| 22 | Expiry / confirm | Both serialization orders under observed overlapping database locks. |
| 23 | Expiry / cancel | One terminal outcome, one terminal event and release. |
| 24 | Concurrent proposals | Both first-winner orders; one pending, one superseded. |
| 25 | Stale/idempotency | Old revisions reject; same-command successful receipts replay without new event. |
| 26 | Listing release | Pending -> Available in same settlement transaction. |
| 27 | Source Offer | Accepted preserved. |
| 28 | Competing Offer | Closed preserved, no revival. |
| 29 | Realtime | Independent Buyer/Seller browser contexts, 15-second polling disabled; outsider receives zero. |
| 30 | Responsive | 390/430/1280/1536 editor, incoming/awaiting, history/grace and Expired; V2-only long-title wrap. |
| 31 | V1 | Hosted create/replace/cancel Request, Accept/30-minute deadline, existing payment simulator, cancel/expiry; local Active/History regressions. |
| 32 | Delivery | No meetup revision/action/settlement; existing immutable Delivery state unchanged. |
| 33 | Payment/inspection | No D2 implementation; existing V1 simulator used only as compatibility evidence. |
| 34 | QR/handoff | Not implemented. |
| 35 | Protection | Not implemented. |
| 36 | Notifications/email | No Bell/Notifications/email implementation or sends. |
| 37 | Manual history | Full pre-D1 canonical row/media fingerprint comparison; Nike untouched. |
| 38 | Cleanup | Exact scoped synthetic graph/users/objects/journals removed; no capability residue. |
| 39 | Docs | Focused record + status/handoff/impact + accurate C2 integration note. |
| 40 | Staging | pcaqxezdfxofysghssyo only, each additive migration applied exactly once. |
| 41 | Production | No remote production access or writes; .env.local unchanged. |
| 42 | Git index | Empty; sensitive/runtime/test artifacts excluded. |
| 43 | Commit/push | Neither performed. |
| 44 | Diff | git diff --check passes. |

The FK regression uses actual profile deletion and FK SET NULL in a rolled-back
transaction, checking the terminal Order, Available Listing, one expiry event and
receipt, and retained media. Complete snapshot/media fingerprints match afterward.
All three applied migrations remain immutable; fixes are additive.

## Final evidence, after all three applied migrations

- Migration 005/006/007: exactly once on staging, all source hashes unchanged.
  Actual deployed guard is limited to Open -> Expired. Public RPCs are postgres
  SECURITY DEFINER with empty search_path, authenticated-only; protected triggers
  remain enabled and privileged client media RPC access remains denied.
- Rollback-safe historical Buyer profile deletion/FK SET NULL: passed; no second
  expiry, no Listing change, one expiry event/receipt, three private media references.
  Complete snapshot/media fingerprints match afterward.
- Hosted domain suite: initial exact projection, both participant proposals,
  self/outsider rejection, other-participant decisions, own withdrawal, replacement,
  command replay/conflict, stale confirm, economics and private-media retention.
  +59:59 stays Open; +60m expires once and releases Listing. Pending does not extend
  the deadline; a confirmed future replacement does. Cancelled/Expired operations
  reject. Delivery has no scheduling/no-show effect.
- True concurrency after 007: 14 observed independent overlapping transactions;
  0 deadlocks, 0 lock timeouts, 0 invariant failures. Both winner orders covered for
  proposals, confirm/replace, confirm/cancel, expiry/confirm, expiry/cancel and
  expiry/proposal; identical concurrent proposal/confirm replay creates one change.
  Source Offer Accepted and private media retained; one terminal event/release.
- Hosted V1: Request create/replace/cancel, Accept, exact 30-minute reservation,
  existing payment simulator, Order cancellation and rollback-safe legacy expiry
  passed. Local Active/History classification regressions passed.
- Final browser: every scheduling callback stays on the exact Order Detail;
  original Cancel Order History navigation passed. Independent authenticated Buyer
  and Seller receive private invalidation and update without reload; polling disabled.
  Broadcast counts for the tested conversation: Seller 11, Buyer 10, outsider 0.
  Duplicate event count 0; runtime error count 0. Refresh persistence passed.
- 390/430/1280/1536: confirmed/pending/incoming/awaiting, editor/focus/Cancel,
  reachable Confirm/Decline, history, grace and Expired passed. No horizontal
  overflow; V2 title now measures 342px within 390px instead of overflowing to
  393px. Existing panel/dialog scrolling and typography retained; screenshots reviewed.
- TypeScript, focused ESLint, optimized staging-configured build, D1 API/static
  suites and 27 other local Auth/Marketplace/Offers/Orders/Payment UI/Progress/
  TEXT/IMAGE/Realtime/migration regressions passed. DB lint has no D1 issue;
  only existing validate_offer_terms/order_money IMMUTABLE/STABLE warnings remain.
  The existing global GlideSelect.jsx lint parser debt remains unchanged.
- Browser instrumentation corrections only: include binary WebSocket frames and
  scope duplicate location text to current/pending content, excluding hidden history.
  Neither required application behavior changes.
- Final cleanup verification: 0 D1 synthetic users, revisions, command/expiry
  receipts, Orders/Offers/Listing graphs and private snapshot Storage objects.
  All 12 protected pre-D1 canonical/manual/media table fingerprints match; Nike
  and manual history unchanged. Ignored test screenshots/diagnostics/scope journals
  are removed after final verification; reusable test sources remain. The optimized
  local runtime build remains ignored so localhost:3000 continues to run the main app.
- Git index empty; no commit/push. Private-value scan: 758 eligible files and 46
  browser resources, 0 privileged values/prohibited eligible files. 421 local
  documentation links and git diff --check passed. Pre-existing working-tree changes
  from earlier phases were preserved; this record identifies only D1 scope.

Applied-time records (UTC): 005 21:01:14, 006 21:10:12, 007 21:44:37 on
2026-10-12. Production was never remotely accessed or modified; .env.local was
not changed. No new Payment, inspection, QR/6-digit handoff, Protection, Delivery
checkout, Notification/Bell or email functionality. No Auth emails sent.

STOP after D1. Before V2-G Notifications, require a stable Git checkpoint first.
