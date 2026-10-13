# V2-D2A On Campus inspection and payment

> Historical D2A checkpoint. New V2 Offers/Orders now follow the
> [current Offer/Agreement revision](V2_OFFER_AGREEMENT_REVISION.md): 1% of item
> price only, no minimum, CA$5 cap. Earlier 4% rule-tagged Orders remain unchanged.

Status: STAGING IMPLEMENTATION / HOSTED QUALIFICATION PASSED (2026-10-12).
Final cleanup/privilege/security checkpoint passed.

Target: western-marketplace-staging (`pcaqxezdfxofysghssyo`), real main app
`http://localhost:3000`. Production is outside this work. No provider integration,
handoff credentials, Protection, completion, payout release, Delivery or Notifications.

## Authority and pre-apply review

Applied additive foundation: `202610120008_order_campus_payment.sql`. All applied C2/D1
migrations remain unchanged. The staging-only transactional dry-run proposed only
this file and rolled back successfully; all canonical fingerprints matched.

Buyer-only authenticated inspection records one private `campus_inspections` row
per Order. Confirmation itself cannot charge and does not change Order economics,
accepted terms, meetup history or snapshot media. The row freezes the accepted item
price and the existing versioned `preview_cad_v1` Buyer fee rule: 4%, minimum CA$1,
maximum CA$15. Seller platform fee stays zero; Seller earnings exclude Buyer fees.
The original C2 Order financial snapshot remains unchanged. A whitelisted participant
projection displays the separate payment quote, without instrument/provider data.

Authenticated Buyer payment start requires inspection and rechecks the authoritative
payment-method capability under its lock. Missing/Needs attention returns setup
required without starting an attempt. Client fields are restricted to command UUID.
The service checks its trusted staging key before starting. No client chooses amounts
or outcomes. A committed private attempt and Order Processing state precede a
separate service-role-only simulator resolution. Paid/Failed timestamps and events
are receipt-guarded. A failed trusted resolution leaves Processing held for recovery;
it does not invent failure or release inventory. This is test payment, not a real charge.

Lock order: per-command advisory lock, Buyer payment capability advisory lock (start),
Listing, Order, then capability row (start) or payment-attempt row (resolution). Inspection, Cancel and D1 expiry share
Listing -> Order. Capability updates do not acquire inventory locks. The capability-before-inventory
order matches V1, including historical retries on a Listing reused by a V2 Order. V1 payment remains
behind its existing protocol-specific RPC and deadline semantics.

Processing/Paid block ordinary Cancel, D1 no-show and meetup modifications. Failed
permits retry with a new command, eligible Cancel and D1 expiry. Inspection alone is
not an expiry barrier. Existing D1 `meetup_mutable` already expresses these payment
conditions. Payment start deliberately does not settle expiry before competing for
the shared inventory lock: expiry-first rejects start; start-first protects Processing.
Paid keeps Order open, Listing Pending, payout not eligible, and fulfillment pending.
No artificial payment countdown exists.

Idempotency: inspection is unique per Order; command reuse across Orders rejects.
Payment attempts retain unique Buyer/command identity and one Processing/Paid per
Order. A same-command retry reconciles the existing attempt; resolving an outcome
twice cannot alter timestamps/events. Failed retries create a separate attempt.

UI actions use authenticated Order role. Seller never receives inspection or Pay.
Successful receipts and ambiguous transport failures block local actions until an
authoritative read succeeds. Private Realtime remains invalidation followed by read.
Paid is neither handoff nor Completed, and must not imply Protection or payout release.

## Qualification

Hosted synthetic domain, twenty true overlapping races, D1/V1/Delivery and historical
FK retention regressions passed. Final real Buyer/Seller/outsider browser run: private
invalidations 5/5/0 with 15-second fallback disabled, runtime errors 0, four primary
UI POSTs with UUID-only bodies, refresh persistence true, one Order/one Paid event.
A separate fresh Pending -> inspection -> explicit Buyer Pay UI flow passed with
one payment attempt/event and Seller Realtime confirmation. No stale-cache bypass.

Ten UI states at 390/430/1280/1536 passed (40 layout snapshots): before inspection,
Seller before payment, inspection/setup required, Needs attention, Buyer/Seller
Processing, Buyer/Seller Failed, Buyer/Seller Paid. No horizontal overflow. Eight
additional visible Paid payment-card snapshots passed and were reviewed for both
roles; existing panel/CardAction typography and spacing are retained. A responsive
remount briefly detached a screenshot target; waiting for layout before capture fixed
that test coordination issue without application changes.

34 local Auth/session, Marketplace, Offers/Accept, Requests/Orders/cancellation,
Payment UI/Progress, financial capability/Settings, TEXT/IMAGE/Realtime/migration,
D1 API/static and D2A API/static suites passed. TypeScript, focused ESLint and
optimized staging-configured production-mode compilation passed. DB lint exits 0:
no D2A issue; four pre-existing IMMUTABLE/STABLE warnings in validate_offer_terms
and order_money are retained. Global GlideSelect.jsx lint parser debt is unchanged.
The build's existing two-worker validation setting is not an application workaround.

Before V2-G Notifications: stop and remind the user to create a stable Git checkpoint.
Do not begin D2B automatically.

## Additive qualification corrections

008 applied only to staging; SHA-256 `9ee979c206dfb290268250e91718013a86b74ddbe84be890b4563127552362eb`.

009 (`202610120009_order_campus_paid_inventory.sql`) applied only to staging;
SHA-256 `6d0eab0a08093f88e8475d49b48c9e4ece065d9567d63f87704ec34e277ab9ff`.
Hosted qualification exposed the old Paid inventory CHECK requiring finalized V1
money. 009 preserves that V1 expression while allowing receipt-guarded V2 On Campus
Paid with its unchanged accepted economic snapshot. Both applies preserved canonical
rows exactly. Applied migration sources were not rewritten.

010 (`202610120010_order_campus_payment_lock.sql`) is applied only to staging;
SHA-256 `2d4e7561f95c4665466a7ec74357ca7ebbe817413208bc06f71b25ae87ced8c7`. Static review found a potential cross-protocol lock inversion if a
legacy payment retry targeted an old Order on the same reused Listing. It aligns
V2 start with V1 capability-before-inventory locking; payment semantics are unchanged.
Final lock qualification passed both historical V1 retry orders, including a third-transaction
capability-row barrier, and both winner orders for payment/cancel and payment/expiry.
Six real overlapping runs had zero deadlocks and zero lock timeouts.

## Recovery and qualification corrections

A resumed Processing payment returns the existing attempt even after a browser restart
with a new command; it never creates a second charge intent. Only the authenticated Buyer
can request reconciliation and only the trusted staging service resolves it. The original
authorization stays attached to that attempt; capability checks apply to new payment starts.

A browser test changed a cached Set capability to Needs attention on the server. Payment
was rejected before any attempt; the UI refreshes capabilities and offers Settings. That
test exposed a ref-driven recovery button remaining disabled after the operation finished.
A React running-state flag now rerenders that button, while the synchronous ref still guards
double clicks and the separate reconciliation block preserves transaction authority.
No database/payment semantics changed for this UI correction.

The first browser run reached a stopped localhost during compilation. Another immediate
viewport measurement preceded React responsive layout settling. Both were validation
coordination issues: restart the latest staging build and poll actual bounds for at most
five seconds. Persistent overflow still fails. These did not require application changes.

## Final 51-item closure map

| # | Requested result | Evidence / authority |
|---|---|---|
| 1 | D2A architecture | Inspection receipt, payment intent, trusted resolution; separate participant projection. |
| 2 | Migrations | 008 foundation, 009 Paid inventory compatibility, 010 lock/recovery correction; staging only. |
| 3 | SHA-256 | Exact hashes above; immutable C2/D1 hashes checked. |
| 4 | Inspection persistence | Private Order-keyed receipt; Buyer/command/time plus frozen quote. |
| 5 | Buyer-only inspection | RPC checks actual auth.uid() against Order Buyer; Seller/outsider rejected. |
| 6 | Inspection idempotency | One receipt/event, stable timestamp; duplicate overlapping calls reconcile. |
| 7 | API/RPC/service | POST inspection/confirm and payment/start; UUID-only body, session/CSRF/no-store; service-only resolve. |
| 8 | Payment capability | New start locks/rechecks Set; Unset/Needs attention create no attempt; Settings recovery. |
| 9 | Amount authority | Accepted Order item_amount_cents, not current Listing or client amount. |
| 10 | Buyer fee | Versioned 4% rule, CA$1 minimum/CA$15 maximum; quote frozen on inspection. |
| 11 | Seller earnings | Item amount, zero Seller platform fee; excludes Buyer service fee. |
| 12 | Seller payment | RPC denial; no Seller Pay/inspection controls. |
| 13 | Pre-inspection payment | Rejected without receipt; no attempt or charge. |
| 14 | Pending/Processing/Paid | Durable Processing first; trusted result; Paid leaves Order open and Listing Pending. |
| 15 | Failed | Durable failed attempt/event; unpaid retry/cancel/expiry remain eligible. |
| 16 | Payment idempotency | One Processing/Paid per Order; same command/resolve retain timestamp/events; restart returns same intent. |
| 17 | Paid Cancel | Both participants denied; no release/event. |
| 18 | Processing Cancel | Both participants denied until authoritative resolution. |
| 19 | Failed Cancel | Allowed; one terminal event and Listing Available. |
| 20 | Payment/Cancel race | Both winner orders verified in primary and final-lock suites; no Paid+Cancelled/released Paid inventory. |
| 21 | Payment/Expiry race | Expiry-first rejects start; payment-first blocks settlement and retains hold. |
| 22 | Paid no-show | No expiry/release; meetup history retained. |
| 23 | Processing no-show | No unsafe settlement/release. |
| 24 | Failed no-show | Unpaid D1 settlement releases Listing exactly once. |
| 25 | Inspection-only no-show | Receipt does not block D1 expiry. |
| 26 | Paid Listing | Pending, held for this Order; not Sold. |
| 27 | Paid Order | Open, awaiting_fulfillment; not Completed or handed off. |
| 28 | Paid payout | not_eligible; no release or provider integration. |
| 29 | Buyer UI | Inspect/continue without charge; method setup; explicit staging Pay, processing/retry/reconciliation. |
| 30 | Seller UI | Read-only server state, inspection acknowledgement, item earnings and payout not eligible. |
| 31 | Safety copy | Verify Marketplace Order, not screenshots/emails/chat claims; retain item until future handoff. |
| 32 | Realtime | Buyer/Seller 5/5 private updates, outsider 0; 15-second fallback disabled; real UI Paid/refetch. |
| 33 | Responsive | Ten states x four widths passed; eight visible Paid card captures reviewed. |
| 34 | D1 regression | Hosted scheduling/reschedule/confirm/decline/withdraw/replace/+59:59/+60m/cancel/expiry/release passed. |
| 35 | V1 regression | Real legacy Accept, 30-minute deadline, simulator, Paid, Cancel/release, rollback expiry and D1 exclusion passed. |
| 36 | Delivery | Cannot inspect/start On Campus payment; D1 excludes Delivery. |
| 37 | Immutable snapshot | Accepted terms/economics, source Offer, meetup history and three private media refs checked before/after. |
| 38 | Cleanup | Each synthetic suite completed exact scoped cleanup; final 008/009/010 admin verification below. |
| 39 | Manual history | Full canonical fingerprints checked before/after; Nike not opened or modified. |
| 40 | Documentation | This record plus status/handoff/impact/D1 integration updated. |
| 41 | QR | Not implemented. |
| 42 | Six-digit credential | Not implemented. |
| 43 | Handoff verification | Not implemented; Paid is not handoff. |
| 44 | Protection | Not implemented or started. |
| 45 | Completion/Sold | No automatic completion or Sold. |
| 46 | Notifications/Bell/email | Not implemented; no Auth/notification emails sent. |
| 47 | Staging application | 008/009/010 applied once to exact staging after rollback dry-runs; latest localhost optimized build. |
| 48 | Production | Not accessed; production .env.local unchanged. |
| 49 | Git index | Empty; ignored fixtures/credentials excluded; final security checkpoint below. |
| 50 | Commit/push | Neither performed. |
| 51 | diff check | Passed after final documentation and cleanup. |

## Changed source and reproducible qualification

Application: `components/home/order-campus-payment.tsx`, `formal-v2-order-detail.tsx`,
`order-meetup.tsx`; `lib/server/orders-service.ts`, `lib/orders-api.ts`;
`types/order.ts`, `types/offer.ts`; `pages/api/orders/[[...segments]].ts`.
Reuses existing CardAction, financial capability hook/Settings route, Order panel/amount
styles and participant-scoped Realtime invalidation/refetch. No new dependency/library.

Qualification scripts:

- `tests/order-campus-payment-staging.cjs`: hosted domain/security/economics/idempotency.
- `tests/order-campus-payment-concurrency.cjs`: 14 overlapping primary/duplicate/repeated races.
- `tests/order-campus-payment-lock-concurrency.cjs`: six final-lock/cross-protocol overlaps.
- `tests/order-campus-payment.browser.cjs`: actual authenticated role UI/Realtime/responsive/recovery.
- `tests/order-campus-payment-ui-smoke.cjs`: fresh Pending Pay success and visible role-card captures.
- `tests/order-campus-payment-api.cjs`, `tests/order-campus-payment-static.cjs`: local boundaries/hash tests.
- Three staging-admin scripts: exact candidate rollback/apply/verify and 15-table canonical baseline.
- Existing D1 fixture cleanup now includes only scoped D2 receipts/attempts. V1 financial test
  fixture explicitly declares protocol 1, as required by existing A1 isolation; no V1 app change.

Never run fixture suites concurrently: each takes a canonical baseline and cleans its
exact synthetic IDs. Race tests internally use independent PostgreSQL sessions.
The first operation holds its lock through a 25-second pre-commit sleep; the second
starts before commit, and pg_stat_activity/pg_blocking_pids must prove a real Lock wait.
The final cross-protocol test also uses a third transaction holding a capability row
to prove legacy-capability-first overlap. SQLSTATE 40P01 and lock timeout are not
caught/retried; domain rejection because the other transaction won is expected.
Twenty overlapping runs: zero deadlocks, zero lock timeouts, zero invariant failures.

## Applied timestamps (UTC)

| Version | Applied once to staging |
|---|---|
| 202610120008 | 2026-10-13T00:45:42.611Z |
| 202610120009 | 2026-10-13T00:49:16.027Z |
| 202610120010 | 2026-10-13T01:06:34.871Z |

All three exact-candidate dry-runs rolled back before apply. Final verification compares
15 whole-table canonical/manual fingerprints against each pre-apply baseline, checks
postgres ownership/security definer/empty search_path, participant-only public RPCs,
service-role-only resolution, private snapshot bucket, enabled guards and zero synthetic
Auth/transaction/media/inspection/attempt rows. Nike/manual history stays unchanged.
The original C2/D1 files remain immutable.

## Final checkpoint

008/009/010 each appears exactly once; all final admin checks passed. Their three
15-table canonical/manual baselines match exactly. Synthetic Auth users, receipt/
attempt/meetup/media journals, Orders/Offers/Listings and snapshot Storage objects
remaining: zero. Guards are enabled; snapshot bucket remains private. The four
task-only ignored artifact directories were removed after screenshots/report review.
No session/credential/SQL diagnostic/image fixture from this task remains. Existing
unrelated ignored caches and the running staging build are preserved.

Final security audit: 773 commit-eligible files, 46 browser static resources and
425 local Markdown links checked; privileged values found 0, prohibited files
eligible 0, Git index empty, git diff --check passed. `.env.local` and staging
credentials remain ignored and were not edited. No commit/push, production access,
real payment, email or hosted deployment. The real main application remains on
localhost:3000 configured for staging, with preview mode disabled.

V2-D2A ON CAMPUS INSPECTION / PAYMENT COMPLETE.

V2-D2B ON CAMPUS HANDOFF / PROTECTION IS READY FOR IMPLEMENTATION PLANNING.

Stop here. Do not begin D2B automatically. Before V2-G Notifications, remind the
user to create a stable Git checkpoint.
