# V2-C2 Accept / Listing winner foundation

2026-10-12: staging implementation applied; hosted and browser qualification passed.
V2-C ACCEPT / LISTING WINNER FOUNDATION COMPLETE.
V2-D ON CAMPUS FLOW IS READY FOR IMPLEMENTATION PLANNING.
Target: `western-marketplace-staging`, `pcaqxezdfxofysghssyo`, real main app
localhost:3000. No production access or mutation; `.env.local` is unchanged.
The optimized local build explicitly sets staging variables before Next loads
environment files. No commit/push or hosted frontend deployment.

## D1 integration (2026-10-12, qualified)

[On Campus scheduling](ORDER_MEETUP_V2_STAGING.md) now adds an exact initial
confirmed projection of accepted terms and immutable reschedule history. Its
new receipted no-show expiry extends only V2 On Campus lifecycle and the shared
lazy Order read settlement path. C2 economics, original terms/Listing snapshot,
private media and winner authority remain immutable. C2 scope statements below
are the qualified C2 boundary; D1 qualification is tracked separately.

## Migration and compatibility

Only new additive migration `202610120004_offer_accept.sql` applied at
`2026-10-12T20:01:03.520Z`, SHA-256
`7141e92183ba407861f0cd6e32af19be7ec854020c08d4c31a89114cbc4db370`.
Rollback dry-run first proved this was the only pending migration. A1/A2/B/C1
files are unchanged; C1 retains hash
`84ed02dde708f077533907a1cd8019ea122e0bb2322af5db4611b49dab909dbf`.

`orders.order_protocol_version` explicitly separates V1 and V2. Existing Orders
receive default 1 after an identity/protocol audit under an exclusive table lock;
no historical status, deadline, timestamp, event or terms are rewritten. Original
V1 CHECK expressions are retained behind the protocol-1 condition. V1 trigger
branches remain intact. Shared `orders_listing_hold` uniqueness prevents either
protocol from taking inventory held by the other.

V2 uses `money_status=v2_pending`, `terms_schema_version=2`, Payment Pending,
Payout Not eligible, no finalized service fee/total and no reservation/payment
deadline. Existing expiry settlement selects only V1. The V1 payment simulator
rejects V2 in SQL; V2 UI never mounts its simulator, Progress or countdown.

## Accept authority and orchestration

`POST /api/offers/[offerId]/accept` accepts **only** `clientActionId`. IDs for
roles, Listing overrides, snapshots, protocol and media paths are rejected.
Same-origin/CSRF protections, verified session and exact staging guards apply.

1. Session-authorized `marketplace_offer_accept_preflight` requires V2 recipient,
   rejects sender/self-Accept and checks likely eligibility. A successful command
   retry reconciles its original Order before media work or payout recheck.
2. Trusted server preparation uses [C1](ORDER_SNAPSHOT_MEDIA_V2_STAGING.md):
   registered identities before upload, immutable private copies, actual byte
   verification and complete batch receipt.
3. Session RPC `marketplace_accept_offer` performs final revalidation and binds
   C1 media in the same database transaction as Order/winner creation. Failed
   final Accept leaves unbound preparations under C1 TTL/lease cleanup; no
   synchronous distributed rollback deletes their media.

Lock order: actor/command advisory lock -> Seller payout capability advisory/row
lock -> Listing row -> Active V2 Offers in stable UUID order -> target Offer ->
C1 batch/assets -> Order bind. A2 Counter/Withdraw, V1 Accept and Listing edits
serialize through the same Listing authority; payout mutations use the existing
capability lock namespace. Media cleanup claims only the batch and cannot bind
a delete-claimed asset. No Storage I/O occurs inside final Accept.

Recipient identity is independent of marketplace Buyer/Seller roles. A Buyer
Offer accepted by Seller still creates an Order for the original Buyer and
Listing Seller. Seller payout is rechecked atomically for both directions.
Buyer payment method Unset/Set/Needs attention does not gate Accept.

Private `offer_accept_commands` records actor/command, exact Offer and Order.
Same-command replay returns the same Order, accepted timestamp, snapshots and
media even after payout downgrade. Reusing a command for another Offer rejects.
Order/request uniqueness, shared inventory uniqueness and deferred atomic-commit
checks enforce one winner with complete media and accepted Offer ownership.

Winner Offer becomes Accepted, Listing becomes **Pending**, competing Active V2
Offers across conversations become Closed. V1 Requests retain V1 status; their
future Accept fails against Pending inventory. New executable Offers cannot be
created while Pending. Closure never automatically reverses after cancellation.

## Immutable evidence and eligibility

New Offer inserts capture `listing_material_hash_at_offer` after the existing
Listing/Conversation identity lock. Historical pre-C Offers retain NULL and are
non-acceptable; no current Listing state is fabricated as their old baseline.

Material hash covers seller, title, description, category/subcategory, condition
and ordered ready media identities/paths/slots. Price is separate: current public
asking below Offer item amount rejects; a price increase alone permits honoring
the lower negotiated amount. Material changes keep lifecycle Active but block
Accept with review/new-Offer copy. No Stale lifecycle status is introduced.

`terms_snapshot` freezes source Offer, sender/recipient, exact discriminated
terms, schema version, accepted server time and participant names.
`listing_snapshot` freezes source ID, title, category/subcategory, condition,
description, public asking price at acceptance, currency, Seller, material hash
and media batch identity. Included-items fields do not exist and are not invented.
Private ordered media references are immutable in C1 tables. Order detail renders
these snapshots, never mutable live Listing joins. Buyer/Seller access returns
short-lived signed private media URLs; outsiders are denied and URLs are not
persisted in Orders.

## C2 user-facing foundation

Incoming eligible Active Offers show green Accept plus Counter; senders retain
Revise/Withdraw without Accept. Shared FadingDialog presents immutable terms and
fulfillment-specific confirmation: On Campus inspection precedes payment;
Delivery payment precedes delivery; accepting does not charge now. Canceling
confirmation writes nothing.

Successful Accept immediately installs a non-actionable receipt barrier before
history refetch. A failed refresh keeps actions blocked with Retry; server history
must confirm Accepted plus exact linked Order before release. Navigation uses
server-returned Order ID and marketplace roles: Purchases for Buyer, Sales for
Seller. Both C2 paths use the existing same-page shallow Orders navigation;
qualification reproduced a non-shallow query transition that updated the URL
without selecting the Orders workspace, and verified the narrow routing fix.
Accepted cards have green View Order; Closed cards are muted, say
"Listing no longer available" and have no executable actions.

V2 detail reuses ListingMedia, existing Order layout/styles, OfferTermsSummary
and approved OrderCancellation. It shows snapshot facts, terms, lifecycle and
Payment Pending. On Campus says payment follows inspection; Delivery says
payment is required before delivery. No unimplemented fulfillment actions or
fake Progress are presented. Pending Listings display "Pending transaction".

Buyer or Seller may cancel an open unpaid V2 Order using existing reason/note
and idempotency infrastructure. It becomes Cancelled/History, releases Pending
inventory to Available and preserves actor/reason/note/time. Source Offer stays
Accepted, competitors stay Closed, Payment stays Pending and private snapshots
remain bound. New negotiation is allowed after release. No C2 automatic V2
expiry exists.

## Qualification record

Hosted qualification passed the domain and edge suites and 13 independent
concurrency runs. The real localhost:3000 browser suite passed with three
independent synthetic authenticated contexts and zero runtime errors.

Independent transaction synchronization uses a first transaction that performs
its real operation and holds its locks through `pg_sleep(35)`. The observer
confirms PgSleep before starting the second database process, then proves the
second transaction is waiting on a lock with a nonempty `pg_blocking_pids`.
Both winner orders are tested for Counter, Withdraw, payout downgrade, Listing
material edit, media cleanup claim and two Buyers. A duplicate command is also
run concurrently. Domain rejections are expected; deadlocks and lock timeouts
are not caught or hidden by retries. All 13 runs had zero deadlocks, zero lock
timeouts and zero invariant failures.

- Counter/Withdraw first prevents stale Accept; Accept first rejects the losing
  mutation. No partial winner or media binding survives a rejected Accept.
- Payout downgrade first prevents Accept; Accept first succeeds and its command
  replay returns the same Order despite a subsequent capability downgrade.
- Material edit first blocks Accept; Accept first freezes the original evidence.
- Cleanup claim first prevents binding; Accept first retains bound private media.
- Either Buyer can win, exactly one Order holds inventory, the other Offer closes.
  A competing V1 Request remains V1 and cannot win Pending inventory.
- Concurrent same-command Accept returns one identical Order and timestamp, with
  one `order_created`, one `offer_accepted` and one `listing_pending` event.

Domain/edge tests additionally prove recipient/sender/outsider isolation, Buyer
payment Unset/Set/Needs attention non-gating, correct roles for Seller acceptance
of Buyer offers, price/material/pre-C blockers, participant-only signed reads
with downloaded byte hashes, and immutable historical A media after real live
gallery replacement with B and source A cleanup. Buyer and Seller unpaid
cancellation are idempotent, release Available inventory, retain Accepted/Closed
history and terminal private snapshots. A real isolated V1 Accept retains its
30-minute deadline and V1 payment simulator; V2 refuses the simulator.

DB lint reported only the pre-existing B `validate_offer_terms` and legacy
`order_money` volatility warnings; no C2 warning/error and no unrelated fix.
The global `GlideSelect.jsx` parser issue remains pre-existing technical debt;
focused TypeScript-file ESLint passes.

Browser harness corrections preserve normal service-worker registration and
wait for loaded responsive content. Chrome's native top-layer dialog can inflate
root scrollWidth by the scrollbar gutter without overflowing any content;
responsive cancellation checks use dialog bounds plus inner content width.
No application change was made for these harness issues. Tests use confirmed synthetic
accounts without sending emails; passwords and sessions remain in memory.
Database/Storage cleanup is limited to exact journaled fixture identities.

Browser evidence covers recipient-only green Accept, sender no Accept, opaque
padded FadingDialog, keyboard focus containment and Cancel zero writes at
390/430/1280/1536. Real API acceptance plus forced history failure preserves a
non-actionable receipt barrier; Retry restores server Accepted/linked Order
without a duplicate. Buyer navigates to exact Purchases Order; Seller to exact
Sales Order, including direct acceptance of a Buyer-origin On Campus Offer.
Three mounted participants receive winner Accepted and competitor Closed via
Realtime. Accepted cards have View Order/no Accept; Closed has no executable
Accept/Counter. Both roles render private snapshot media, no V1 timer/Pay,
and retain the same Order after refresh. Cancellation confirmation/Keep order
are checked at all four widths with zero writes; real Buyer/Seller cancellation
and release are covered by the independent hosted domain/edge tests.

Final local validation: optimized staging-configured production-mode build,
TypeScript and focused ESLint pass; 25 local API/domain/static/UI regression
suites pass, covering Auth/session, Marketplace, TEXT/IMAGE/Realtime, V1 Requests
and Orders, Phase E Payment/Phase F Progress, A1/A2/B/C1/C2 and taxonomy.
Privileged-secret scan of 46 browser build files and all Git-eligible files is
clean; environment files, fixture journals/images/screenshots are Git-ignored.
All 417 relative documentation links and `git diff --check` pass; Git index is empty.

Final read-only staging audit: migration occurs exactly once with the recorded
SHA-256; Accept/preflight are postgres-owned security-definer functions with
empty search_path, authenticated execution and no anon execution. Privileged
C1 prepare/bind remains unavailable to browser roles. Bucket is private. Zero
synthetic Orders/Offers/commands/batches/assets/references/Storage objects remain.
Eight canonical/manual table fingerprints match the pre-apply baseline:
4 legacy Requests, 3 legacy Orders, 14 events, 6 Listings, 7 Listing images,
0 Offer commands, 9 Order commands and 1 capability row. No Nike or other manual
history is restored, consumed or rewritten. Generated local fixtures, journals
and screenshots are removed after qualification; only the ignored runtime
build remains while localhost:3000 serves the real staging app.

Reusable guarded commands:

```text
node tests/offer-accept-staging-admin.cjs inspect
node tests/offer-accept-staging.cjs
node tests/offer-accept-concurrency.cjs
node tests/offer-accept-edge.cjs
node tests/offer-accept.browser.cjs
node tests/offer-accept-staging-admin.cjs verify
node tests/offer-accept-static.cjs
node tests/offer-accept-build.cjs
node tests/offer-accept-build.cjs serve
```

Run hosted qualification suites sequentially so independent canonical baseline
checks cannot include another suite's temporary fixtures. `inspect` precedes
tests; do not recapture the baseline during fixtures. `recover` is available on
each fixture suite for exact journaled cleanup after interruption. Applied
`dry-run`/`apply` modes are not rerun commands.

## Remaining product boundaries

C2 preserves the approved Kijiji inspect-first/local negotiation, eBay structured
Offer/winner/evidence, Facebook Marketplace lightweight conversation strengths
and Campus Marketplace bidirectional campus-specific authority.

No V2-D meetup actions/rescheduling/+60m expiry/payment/handoff/Protection start;
no V2-E 12h/30m windows, payment start, address release, courier/tracking/receipt;
no final V2-F Progress; no Notifications/Bell/Price Drop/email.
Do not start V2-D automatically. Before V2-G, stop and require a stable Git
checkpoint first.

## Requested C2 closure map

| Report items | Result / evidence |
| --- | --- |
| 1-3 Architecture / migration / SHA | Session preflight, trusted C1 preparation, final atomic RPC; only `202610120004_offer_accept.sql`, SHA recorded above. |
| 4 API / RPC | POST `/api/offers/[id]/accept`, `marketplace_offer_accept_preflight`, `marketplace_accept_offer`; command UUID only. |
| 5-7 Authorization / self-Accept / protocol | Actual verified recipient only; sender/outsider denied; V1 cannot enter V2 and V2 cannot enter V1 Accept. |
| 8-9 Capability gates | Locked Seller payout recheck; Buyer payment Unset, Set and Needs attention do not gate acceptance. |
| 10-11 Protocol / legacy | Explicit protocol 2 and V2 constraints; legacy defaults to 1, original semantics and fingerprints unchanged. |
| 12-13 Inventory | Available becomes Pending, never Sold on Accept; shared held-Listing unique index and deferred winner checks. |
| 14-15 Media orchestration / bind | Real bytes copied/verified before RPC; complete private C1 batch binds in the same winner transaction. |
| 16-17 Snapshots | Immutable accepted terms plus Listing facts, asking price, participant names and ordered private media references. |
| 18-21 Eligibility | Offer-time material SHA; pre-C NULL safely blocks; lower current ask blocks higher Offer; higher ask alone allows negotiated lower amount. |
| 22 Two Buyers | Both winner orders exercised with overlapping transactions; exactly one winner, other Active V2 Offer Closed. |
| 23 Counter | Both winner orders exercised; Counter-first blocks stale Accept, Accept-first rejects Counter. |
| 24 Withdraw | Both winner orders exercised; Withdraw-first blocks Accept, Accept-first rejects Withdraw. |
| 25 Payout | Both winner orders exercised; downgrade-first blocks, committed Accept preserves idempotent replay. |
| 26 Listing edit | Both winner orders exercised; edit-first blocks, Accept-first keeps original immutable evidence. |
| 27 Media cleanup | Both winner orders exercised; claim-first prevents binding, bind-first prevents cleanup of retained media. |
| 28-30 Competition / V1 / no revival | Other Active V2 Offers Closed; V1 Request unchanged but Pending prevents winning; cancellation never revives Closed. |
| 31 Idempotency | Concurrent identical command yields identical Order ID/time, one terminal event set and one inventory holder. |
| 32-35 Confirmation / navigation / cards | Responsive opaque FadingDialog and zero-write Cancel; exact Purchases/Sales Order navigation; Accepted View Order, Closed muted/no actions. |
| 36-38 Pending UI / detail / isolation | Pending transaction caption; reused ListingMedia/detail layout/terms/cancellation; no V1 countdown, payment simulator or fake Progress. |
| 39-40 Media reads / historical A | Buyer/Seller signed reads match copied SHA; outsider denied; actual live A-to-B gallery swap and source cleanup leave historical private A intact. |
| 41-43 Cancel / release / retention | Buyer and Seller unpaid cancellation idempotent; Available release, Accepted source/Closed competitors retained; terminal media retained. |
| 44-45 Realtime / responsive | Three independent real sessions observe winner/competitor invalidation; 390/430/1280/1536 matrix and zero runtime errors. |
| 46-47 V1 / manual history | Real synthetic V1 Accept, 30-minute deadline and simulator pass; eight canonical/manual fingerprints unchanged. |
| 48 Documents | This record plus domain, media review, C1 media foundation, impact audit, Project Status and Project Handoff updated. |
| 49-52 Deferred scope | No D meetup implementation, E Delivery implementation, final F Progress or Notifications/Bell/Price Drop. |
| 53 Product direction | Approved inspect-first, structured winner/evidence and lightweight campus negotiation principles remain documented. |
| 54-55 Deployment boundary | C2 migration applied once only on staging; production untouched, no hosted frontend deployment. |
| 56-58 Git | Empty index, no commit/push, clean diff whitespace check; secrets/fixtures/artifacts are not Git-eligible. |

## C2 file map

- Migration: `supabase/migrations/202610120004_offer_accept.sql`.
- API/server: `pages/api/offers/[[...segments]].ts`,
  `lib/server/offers-service.ts`, `lib/server/orders-service.ts`.
- Client reconciliation/navigation: `lib/offers-api.ts`,
  `hooks/use-formal-offers.ts`, `components/home/messages-chat.tsx`.
- Presentation: `components/home/offer-ui.tsx`,
  `components/home/formal-v2-order-detail.tsx`,
  `components/home/formal-order-detail.tsx`,
  `components/home/formal-orders.tsx`,
  `components/home/order-cancellation.tsx`,
  `components/home/messages-listing-preview.tsx`,
  `components/listings/home-listings.tsx`, `lib/order-terminal-presentation.ts`.
- Types: `types/offer.ts`, `types/order.ts`, `types/listing.ts`,
  `types/conversation.ts`.
- Reusable qualification: `tests/offer-accept-staging-admin.cjs`,
  `tests/offer-accept-staging.cjs`, `tests/offer-accept-concurrency.cjs`,
  `tests/offer-accept-edge.cjs`, `tests/offer-accept.browser.cjs`,
  `tests/offer-accept-static.cjs`, `tests/offer-accept-build.cjs`;
  updated scope assertions in `tests/offers-api.cjs` and `tests/offer-terms.cjs`.
- Documents: `docs/OFFER_ACCEPT_V2_STAGING.md`,
  `docs/OFFER_DOMAIN_V2_STAGING.md`, `docs/OFFER_ACCEPT_V2_MEDIA_REVIEW.md`,
  `docs/ORDER_SNAPSHOT_MEDIA_V2_STAGING.md`,
  `docs/MARKETPLACE_V2_IMPACT_AUDIT.md`,
  `docs/PROJECT_STATUS.md`, `docs/PROJECT_HANDOFF.md`.

The repository already contained other uncommitted work before C2. This list
identifies C2 scope, not a claim that the entire working tree was newly authored
in C2. No unrelated work was reset or staged.
