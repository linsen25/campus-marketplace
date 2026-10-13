# V2-B Offer UX and final negotiation terms - staging

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


**V2-B COMPLETE / QUALIFIED on staging.** Main app is
localhost:3000, staging `pcaqxezdfxofysghssyo` only. Production and `.env.local`
were not changed. No V2 Accept, Order creation, Listing Pending, payment window,
checkout claim, Protection, or Notifications is implemented by B.

## Final term persistence

Migration [202610120002_offer_final_terms.sql](../supabase/migrations/202610120002_offer_final_terms.sql)
was applied exactly once at `2026-10-12T17:18:08.174Z`, SHA-256
`a25f44a4bff5fb6052a9e6e1d2a56c2c380bd171c2c576a670492607cb668109`.
A1/A2 migration files were not edited. New V2-only `offer_terms` is a strictly
validated, allowlisted discriminated JSON structure, not an arbitrary payload.
It adds no destructive V1 backfill. Existing immutable-row enforcement covers
both new columns. Null terms are reserved for pre-B foundation history; the
pre-apply baseline had zero such V2 rows. New creates always require final terms.

Common terms: positive safe-integer `item_amount_cents`, fulfillment, optional
string note (maximum 1,000 characters). On Campus: public `meetup_location`
(1-120 trimmed characters) and zoned `scheduled_at`. Delivery: nonnegative
safe-integer `delivery_fee_cents` and `seller_delivery` or `courier`. Combined
item/Delivery amount must remain a safe integer. No address, provider fee or
cross-mode fields are accepted. Money input uses decimal text -> integer cents;
no floating-point transaction authority.

Scheduling retains V1's 60-minute minimum notice, 30 Toronto calendar-day horizon,
15-minute local increments and finite/zoned timestamps. Creation/Counter/Revision
revalidates server time. Idempotent replay still precedes temporal revalidation,
so a previously completed command remains retryable as its schedule approaches.
There is no expiry settlement/timer implementation in B.

`listing_updated_at_at_offer` captures the authoritative Listing `updated_at`
under the existing Listing lock for future C eligibility. It is a coarse revision
reference, not a full material-change engine. Existing required V1 storage slots
remain inert compatibility scaffolding; V2 DTO/UI use only final `offer_terms`.
Current live Listing media is negotiation context, not an accepted Order snapshot.
Full evidence snapshots and material-change Accept validation remain V2-C work.

## UI and routing

- [Offer model](../types/offer.ts): typed `OfferTerms` union for On Campus/Delivery,
  immutable sender/recipient IDs and read-only Listing revision reference.
- [Offer service](../lib/server/offers-service.ts), [API client](../lib/offers-api.ts)
  retain A2 RPCs/endpoints, authenticated staging guard, private no-store and strict
  input authority. Unknown Accept paths remain absent. Seller-origin new terms
  retain payout Ready checks; Buyer offers and sender Withdraw do not need it.
- [Offer UI](../components/home/offer-ui.tsx): one Buyer/Seller form, Counter/Revise
  prefilled from authoritative Active terms, explicit fulfillment selection,
  asking-price preset (never auto-sends), optional note, immutable-term/replacement
  review, discard confirmation and sender-only red Withdraw confirmation.
- Reuses `FadingDialog`, `CardAction`, `ActionRow`, ListingMedia, existing workspace
  fields, existing segmented control, DayPicker and wheel scheduling controls.
  New Offer-specific layout avoids V1 fulfillment/state assumptions. No dependencies.
- Listing page and published card expose Message Seller + Make Offer only to an
  authenticated non-owner on available staging Listings. Existing authoritative
  conversation get-or-create is reused. The exact conversation is routed in URL.
  Each Listing Make Offer has a one-shot navigation intent; it survives responsive
  Chat remounts and grants no transaction/role authority. No Auth changes.
- Messages + entry: Make Offer / Send Offer initially, Counter Offer for recipient,
  Revise Offer for sender. Active legacy Request blocks V2 with explanatory copy;
  existing V1 Replace/Cancel/Accept compatibility stays available. V1 cards retain
  Order Request labels. Preview role controls remain isolated from formal app.
- Offer compact cards are image-free and show status, immutable sender direction,
  price, fulfillment and concise terms. Expanded view uses current Listing media,
  terms and role-correct actions; no Pay, Progress, Protection or reservation UI.
- Shared MessageRow aligns Offer senderId against authenticated viewerId. Stable
  createdAt + ID merge includes TEXT, IMAGE, V1 Request and V2 Offer artifacts.
  V2 event history is fetched; artifact status supplies awareness without duplicate
  fake Order notifications or a second negotiation dashboard.

## Refresh authority and testing

[Offer hook](../hooks/use-formal-offers.ts) refetches on existing private Realtime
invalidation and focus recovery. Background reads retain content; initial reads
use the existing timeline skeleton. A successful mutation establishes a synchronous
receipt barrier, invalidates earlier reads and closes its editor. Failed/outdated
history reads preserve prior displayed rows but keep actions blocked with Retry.
Only a matching/newer authoritative history clears the barrier. No fake final status.

Rollback candidate qualification passed final On Campus/Delivery validation,
unknown/cross-mode fields, zero/negative/fractional money, stale/far schedule,
Buyer initial with Seller Unset, Seller Ready gating, symmetric Counter and
same-sender revision, sender-only withdrawal including payout downgrade,
idempotency, immutable rows, V1 isolation/Request/Accept/payment/cancellation,
RLS and no Orders/inventory/timer side effects. Pre-apply dry-run proposed only B.

Local regressions: 27 pre-existing/A2/V1/TEXT/IMAGE/Realtime/Orders/Payment/Progress/
Auth/environment suites passed; additional [term tests](../tests/offer-terms.cjs)
and [recovery tests](../tests/offer-ux-recovery.cjs) passed. Browser results and final
security/cleanup qualification are recorded below after completion.

The original canonical Request/Order/Event/Listing/command/capability graph is
fingerprinted before/after. Nike Accepted Request / Expired Order remains untouched.
Synthetic fixture graph and temporary image Storage/receipt/queue data are scoped
and removed in finally; credentials/cookies/tokens never enter source or reports.

## Final B qualification (2026-10-12)

- Final optimized main-app build is staging-configured on localhost:3000. The
  build runner uses two local workers to respect this machine's memory budget;
  it does not change production/application worker configuration or `.env.local`.
- Two independent authenticated synthetic staging contexts passed Listing Make
  Offer -> existing conversation, Buyer initial On Campus with Seller payout
  Unset, Seller initial Delivery, symmetric Counter and both sender revisions.
  Seven immutable Offers were created through real UI/API/RPCs. Revision retained
  old terms and replaced the previous Active artifact; both sessions refetched.
- Seller payout blocker was role-specific. After payout downgrade, sender Withdraw
  still succeeded; Keep offer and cancelled/discarded editor flows made zero Offer
  mutations. Listing owner had no Make Offer action. No recipient Withdraw/Accept.
- Forced client GET 503 after a successful real revision left actions blocked and
  displayed Retry Offers. Removing that test-only fault recovered server truth.
  The failure was injected in browser fetch because PWA-controlled requests bypass
  Playwright's ordinary route interception. Mutations remained real staging calls.
- Real attachment UI exercised IMAGE prepare/upload/receipt/finalize/render using
  an existing safe local JPEG in memory. Mixed TEXT/IMAGE/V1/V2 history persisted
  and retained authenticated sender alignment. Buyer and Seller saw the same Offers
  via private Realtime invalidation. Total joins across route/remount tests were
  4 and 6, not concurrent channel counts.
- 390/430/1280/1536: no horizontal overflow, expanded terminal card fit without
  vertical scrolling and footer remained reachable; both role forms, retained
  cross-mode drafts, hidden-field omission and no address passed. Native modal
  focus/Tab, Escape/discard and reduced-motion checks passed. Reload retained seven
  Offers and the original synthetic V1 history. Runtime errors: zero.
- Fixture state before cleanup: one conversation, zero Orders, Listing available.
  Exact synthetic Auth/Listing/conversation/Request/Offer/event/command/capability/
  TEXT/IMAGE/receipt/object/cleanup-queue graph was removed. Whole canonical graph
  fingerprint returned to its original value, including Nike Accepted/Expired history.
- Rollback SQL tests passed again after apply. Read-only verification confirmed
  the B migration exactly once, V1 functions unchanged, correct RPC privileges and
  private validator inaccessible to anon/authenticated/service_role.
- 29 local Offer/V1/Orders/TEXT/IMAGE/Realtime/session/environment/static suites,
  additional schedule and mocked Auth tests, TypeScript and focused ESLint passed.
  Final optimized build passed. Global GlideSelect.jsx parser debt remains unchanged;
  focused lint was used separately from the build's type checking.
- 46 compiled browser JS chunks and commit-eligible files contained no actual
  configured privileged secrets. The SDK's literal `sb_secret_` type-detection
  prefix is library code, not a secret. Documentation links and diff whitespace
  checks passed; index empty, no commit/push. Evidence is Git-ignored under
  `tests/artifacts/offer-v2-b*`; credentials remain memory-only.

Qualification also exposed a real route-load animation defect: Framer Motion 6's
lazy renderer enumerated features after `domMax` registered its projection key,
then called its nonexistent `isEnabled`. The existing feature loader now initializes
only the minimal motion factory before feature registration; animations, Auth and
transaction semantics are unchanged. Blocked service workers initially produced
an unrelated Workbox `registration.waiting` test artifact; the final browser run
allowed normal PWA registration. Private Offers APIs were added to the existing
NetworkOnly rule. No dependency version or new framework was introduced.

V2-B OFFER UX COMPLETE.
V2-C ACCEPT / LISTING WINNER FOUNDATION IS READY FOR IMPLEMENTATION PLANNING.

## Scope and next checkpoint

Kijiji low-friction entry, eBay immutable negotiation history and Facebook direct
conversation entry remain binding future product direction, with Marketplace
server authority. V2-C is separately authorized future work. Before V2-G
Notifications, STOP and remind the user to create a stable code checkpoint first.
No commit/push now. No production access, provider integration, emails or deployment.

---

## Historical V2-A2 qualification (superseded current-UI statements)

# V2-A2 bidirectional Offer mutations - staging

A2 migration applied on staging only (`pcaqxezdfxofysghssyo`); current user-facing
UI remains V1. **A2 COMPLETE / QUALIFIED.** V2-B is ready for separately authorized
implementation planning, not started. V2-C Accept is not implemented.

## Migration and authority

- Migration: [202610120001_offer_mutations.sql](../supabase/migrations/202610120001_offer_mutations.sql).
- SHA-256: `2bab910d14e5b1ee486731681c928e8e97bbf2feca7f896e6add92f5051d86be`.
- Applied UTC: `2026-10-12T04:38:45.851Z`. A1 migration checksum and earlier migrations unchanged.
- New V2-specific RPCs: `marketplace_create_offer`, `marketplace_withdraw_offer`,
  `marketplace_offer_history`; private `mutate_offer`, `emit_offer_event`,
  private RLS-enabled `offer_commands`. No V2 Accept RPC/API.
- API: `POST /api/offers` (initial or Counter), `POST /api/offers/:id/withdraw`,
  `GET /api/offers?conversationId=...`. Auth cookies/verified UWO membership,
  same-origin write protection, staging/project guard, private no-store responses.
  Unknown paths including Accept reject; body/terms allowlists reject identity,
  protocol, Listing, role and lifecycle overrides.
- [Offer DTO](../types/offer.ts) and [service](../lib/server/offers-service.ts)
  expose explicit protocol 2, immutable participants/sender/recipient, chronological
  terms, replacement/withdrawal metadata and viewer-derived `canWithdraw`.
  No financial internals, `canAccept`, or UI-only persisted flags. linkedOrderId
  is null in this no-Accept phase. V1 mapper/history continues to exclude V2.

## Mutation rules

Buyer initial/Counter needs neither payment method nor Seller payout readiness.
Seller initial/Counter checks current persisted Payout Ready inside the existing
financial advisory lock. Unset/Needs attention fails atomically with the existing
safe `seller_payout_not_ready` product code. Either participant may replace the
same conversation's Active V2, including their own proposal. Existing terms,
identity, createdAt, ID and timeline position are immutable; old row becomes
Replaced (`superseded` storage spelling), new row becomes Active atomically.
Active V1 blocks V2 and vice versa; no conversion/cross-protocol replacement.

Only the Active Offer sender may Withdraw. Seller withdrawal does not check
payout; original timestamp/actor/note are retained on identical retry. All terminal
states reject new Withdraw commands; no resurrection. A2 normally produces only
Active/Replaced/Withdrawn. Schema reserves Accepted/Expired/Closed for later
trusted authority, but A2 triggers reject those transitions and no user API creates
them. V2 Cancelled is prohibited; V1 cancelled lifecycle remains unchanged.

A2 minimum terms are integer CAD item amount plus optional note. Existing V1
required Listing/display/fulfillment storage columns are compatibility scaffolding:
V2 stores inert shipping/included values to satisfy old required-column checks,
but does not expose these as Delivery terms or create an Order/Accept snapshot.
No fulfillment, expiry, inventory or payment decision follows from those slots.
V2-B/C own the actual On Campus/Delivery term and Accept snapshot work.

## Locks, idempotency, events and security

Lock order: actor/action/command advisory lock -> Seller payout capability advisory
and row lock (new Seller terms only) -> Listing -> Conversation -> current proposal.
Private commands are scoped by actor/action/nonce/input digest; matching retry
returns the original Offer's current authoritative state before payout/replacement.
Thus retry of old B after C never replaces C or reactivates B. Different input with
same key conflicts. Command FK to the new Offer is deferred inside the transaction;
private command evidence authorizes insertion/transition before any writes commit.
Normal clients cannot forge that evidence, write tables, or execute private helpers.

Create/replace/withdraw events identify auth.uid() as actor and derive Buyer/Seller
role correctly, independently of old Offer sender. Transition keys prevent duplicate
events. Both participants receive existing private `messages_changed` history
invalidation (conversationId/role/scope; Supabase may add its transport id).
Realtime carries no terms/payment authority. No Notifications subsystem is added.

Historical V1 function definitions for mutation/Accept/history and payout authority
are checked unchanged. Shared insertion/immutability/event triggers add only a
protocol-2 branch; V1 lifecycle checks/metadata, read filtering and expiry remain.
Table grants and participant RLS are preserved; new helpers are postgres-owned,
security-definer, empty search_path, private helpers have no client execute grant.

## Validation record

Pre-apply rollback migration + synthetic suite and post-apply suite passed. Covers
Buyer/Seller initial, both Counter directions, own-sender replacement, payout
Unset/Needs attention/Ready, withdrawal role/terminal checks, private-command
transition authority, immutable fields, strict identity overrides, idempotent
create/withdraw and stale retries, V1-on-V2 guards, cross-protocol blocking,
participant/outsider RLS and zero Orders/inventory writes.

Real localhost:3000 staging API synthetic flow passed Buyer Create, payout 409,
Seller Counter, V2 history, recipient Withdraw 403, unsupported Accept 404 and
idempotent sender Withdraw. Real canonical Buyer/Seller browser regression is
read-only: correct alignment, API 200, no Preview Controls, one successful private
Realtime join per role, zero runtime errors. Local Request/Accept/Replace/Cancel,
Messages TEXT/IMAGE/Realtime/session, Orders Active/History, Payment/Progress,
payout and demo/reset guard/hygiene regressions pass. No canonical seed/reset/
cleanup command was executed. The existing transaction-reset script pins its
reviewed schema graph and intentionally stops on new dependencies; a future
reset needs separately authorized graph review including offer_commands, not a
bypass of that safeguard. Global GlideSelect parser
debt is unchanged.

Independent transaction qualification: 13 verified cases. Two repeats each of
Buyer->Seller, Seller->Buyer, Buyer->Buyer and Seller->Seller Counter races;
four payout races cover Ready->Needs attention and Needs attention->Ready in
both commit orders; one identical concurrent Create returns the same Offer ID
with one command/event outcome. Distinct backend PID/XID plus actual
pg_stat_activity/pg_blocking_pids lock wait prove overlapping transactions.
First operation holds its transaction open after DML; the second reaches the
same authoritative lock before commit. Rejected Seller mutation while payout
is not Ready is a valid domain outcome, not a timeout. Zero deadlocks, lock
timeouts, statement timeouts or invariant failures. No generic retry hides errors.

Actual private Realtime: three isolated authenticated synthetic sessions join;
Seller and Buyer each receive seven minimal history/list invalidation signals,
Outsider receives zero. The A2 mutation trigger emits history; conversation
creation also emits the existing list signal. No Offer terms or finance fields
appear in any signal. All synthetic Auth/profile/session/capability/Listing/
Conversation/Request/event/command rows are removed via journal-scoped cleanup;
every canonical domain/profile field compares exactly, Auth comparison excludes
only ordinary sign-in activity timestamps. Four original V1 Requests remain;
new Offer commands count zero; migration recorded once. Protected Nike/manual
history not consumed, restored or reset.

Test-harness corrections: PL/pgSQL capability call inside DO requires PERFORM,
not an unassigned SELECT; Supabase adds permitted broadcast id and existing
conversation creation sends scope=list. Failed/unobserved attempts were not
counted as qualified races; scoped cleanup completed before reruns. An interim
whole-database fingerprint assertion overlapped intentionally committed synthetic
races; final rollback verification was rerun alone after cleanup and passed.
No application fix or migration revision was needed for these harness issues.

Final expanded rollback suite also validates synthetic V1 Create/Replace/Cancel
and retries, Buyer Accept/unchanged 30m reservation, existing trusted staging
Payment simulator/idempotency, pre-payment Order cancellation and unchanged
Accepted Request. Existing mutation/Accept/history/payout function definitions
are identical to the pre-A2 hosted snapshot. Private/public execute privileges,
postgres ownership, security-definer and empty search_path checks pass.
TypeScript, focused ESLint, 26 local regressions, secret/browser bundle scan,
documentation local links and git diff --check pass. Git index empty; no commit/push.

Future approved Kijiji/eBay/Facebook-inspired campus/low-friction negotiation,
immutable history, trust, On Campus inspection/handoff, direction-aware Delivery,
Notifications and price-drop quality goals remain binding and deferred. No UI,
V2 Accept, Orders, Listing Pending, timers, fulfillment or Notifications implemented.

---

# Historical V2-A1 implementation record

**Historical A1 checkpoint:** A1 implemented on staging, UI V1. A2 is now
implemented as documented above; this section retains A1 evidence. Product authority remains the revised
[V2 contract](MARKETPLACE_V2_PRODUCT_CONTRACT.md); A1 changes no target product
rules. [Impact/phase audit](MARKETPLACE_V2_IMPACT_AUDIT.md) assigns later work.

## Applied migration and pre-apply review

- Migration: [202610110004_offer_protocol_isolation.sql](../supabase/migrations/202610110004_offer_protocol_isolation.sql).
- Target only: western-marketplace-staging / `pcaqxezdfxofysghssyo`.
- SHA-256: `bea2ce1c4b63c0fed071fddea1fbc1d3998475cf9c63276ac7fbbff02eeac5a7`.
- Applied UTC: `2026-10-12T03:51:07.520Z`; migration recorded exactly once.
- Nullable columns first: `protocol_version integer`, `sender_user_id uuid`,
  `recipient_user_id uuid`; validate legacy relations/creation-event provenance,
  then backfill V1 / Seller origin / Buyer origin, then constraints/NOT NULL.
  Version defaults to 1. Historical UUIDs are not nullable live profile references.
- Immediately preceding validation: 4 legacy rows; 0 incompatible relations.
  Migration revalidates under exclusive Request lock; invalid rows abort atomically.
  No lifecycle, terms, original timestamps or existing Order/event rewrite.
- Retention trigger bypass is scoped to the transaction/exclusive lock for those
  three identity fields only; restored before commit. Unchanged status emits no event.
- No old migration edited, table renamed, column dropped or dependency installed.

## Authority and compatibility model

Versions are explicit persisted immutable metadata, not inferred from sender role.
V1 = historical/current Seller Request: sender Seller, recipient Buyer. V2 = future
bidirectional Offer. Normal clients cannot choose version or sender/recipient:
no table writes, no generic version-selectable RPC, V1 insert explicitly writes 1.
API rejects identity overrides; terms-level RPC overrides also reject. No public
V2 mutation or Accept RPC/API exists in A1.

Trusted synthetic V2 inserts exercise the foundation only. Insert guard resolves
Listing and exact Conversation participants, derives sender from verified auth.uid()
and recipient from the other participant; supplied inconsistent identities reject.
Unknown protocol rejects. Existing immutable-row comparison includes all three
new fields. V2 lifecycle transitions remain disabled until later authority exists.
New V2 target terminology is Withdrawn, not Cancelled; legacy cancelled Requests
retain their V1 status. Full V2 lifecycle mutation/status work belongs to A2/C.

V1 `mutate_order_request` requires V1 for targeted Replace/Cancel; V1 Accept
requires V1 before command lookup/payout/settlement/Order writes. Both Buyer-origin
and Seller-origin V2 rows hard-reject. V1 payout rules, terms validation, reservation
settlement, 30m/quote behaviour and command retry semantics remain unchanged.
Matched V1 retries return the same result and do not affect later proposals.

V1 history RPC filters Requests, eligible IDs and related transaction events to
V1; server mapper additionally fails closed for anything other than V1. Current
Seller-based timeline and actions never consume V2 rows. The V1 expiry helper
settles only V1. V2 test inserts emit no fake Seller-origin V1 events. V1 append-only
events/private messages_changed invalidation remain unchanged; sender-aware V2
events are A2 work. No separate V2 read API/DTO is added; RLS remains participant-only.

## Cross-protocol exclusivity and locks

Active(V1) + Active(V2) <= 1. Original Listing/Buyer/Seller-origin partial unique
index remains; additional `order_requests_conversation_one_active` enforces the
exact conversation scope. Neither index includes version. Insert guard locks
Listing then Conversation, matching current mutation/Accept order, then checks
cross-protocol conflicts. Active V1 blocks trusted V2; Active V2 blocks V1 create
and targeted V1 replacement. No cross-protocol replace/cancel/conversion/hiding.
Same-protocol uniqueness remains; no full symmetric proposal mutation is added.

RLS/table grants unchanged; private insert guard is security definer with empty
search_path, owner postgres, no PUBLIC/anon/authenticated/service_role execute.
Existing public V1 RPC authenticated-only execute/owner/search_path preserved.

## Validation and protected data

Pre-apply static checks and migration + fixtures in one rollback transaction
passed, followed by apply and a second full rollback suite. Tests cover V1
Create/Replace/Cancel/Accept retries, unchanged 30m Accept, both V2 directions
rejected with zero lifecycle/Order/Listing/event/command side effects, V1 read
isolation, protocol immutability, payout Unset/Needs attention rejection and RLS.
Protocol override API checks reject before network/RPC; V2 mapper rejects.

Independent concurrent staging transactions use pg_stat_activity/pg_blocking_pids
barriers: wait until winner holds locks in PgSleep, start other protocol, prove
its different backend PID/XID waits on that holder, then allow commit. Synthetic
fixtures alone are committed for visibility across independent transactions and
removed via journal-scoped finally cleanup. Sequential destructive cases roll back.
Browser sessions can update only normal Auth activity timestamps; cleanup compares
every other Auth field and all profile/transaction/Listing/capability fields exactly.
Final repeat: six races, V1/V2 each win three; zero deadlocks, lock timeouts or
statement timeouts; cleanup fingerprint passes. Earlier race results also passed
but its cleanup assertion compared normal Auth sign-in timestamps concurrently
changed by browser regression; this was a test fingerprint issue, not domain
mutation. No application retry masked a database deadlock.

Browser verification uses real Seller A/Buyer A staging sessions on localhost:3000.
Destructive UI responses are intercepted synthetic DTOs; authoritative mutation
semantics are covered by rollback SQL, not by consuming manual Requests. Accept
surface/focus/zero-write Cancel/stale recovery pass at 390/430/1280/1536; eight
Buyer/Seller Order cancellation/history cases and 56 Payment/Progress cases pass.
Seller composer confirmation/payout controls and loaded media pass at all four
widths. Real Messages API 200, own-right/other-left and no Preview Controls pass
for both roles; runtime errors and hosted transaction writes are zero. The real
Realtime probe confirms one active/private successful join per role, maximum one
channel, and Buying/Selling/session API statuses 200. An initial probe timeout
was caused by its own interception of the existing read-only Realtime session
POST; allowing that route resolved it without application changes.

TypeScript and focused ESLint pass; local Request/Accept/API/Orders/Active-History/
Payment/Progress/cancel/payout/Messages TEXT/IMAGE/Realtime/session/demo suites
pass. Existing cancellation/payment/expiry/Accept SQL passes in rollback. Privilege
checks confirm postgres owner, security-definer/empty search_path and correct
execute grants. Secret scan: Git-visible files and eight served browser scripts,
zero local-only filenames or privileged/local credential matches. Documentation
links and git diff checks are recorded at final verification. Global unchanged
GlideSelect.jsx parser debt is outside this focused pass.

Pre/post migration fingerprint excludes only the three newly added identity
columns from Request serialization; all original fields compare exactly, as do
entire Orders, events, Listings, commands and financial capabilities. Canonical
Nike/manual samples are not consumed or restored. No canonical reset is run;
new columns require no reset-graph adaptation. Test-only diagnostics live in
Git-ignored artifacts; credentials/tokens never enter source or reported output.

## Explicitly not implemented

No V2 Accept, bidirectional user mutation/UI, On Campus/Delivery terms or timers,
60m grace, 12h checkout, Listing Pending, new accepted Listing evidence, reschedule,
handoff, Notifications/Bell/Price Drop/email, Protection/refund or provider work.
Current V1 UI/Payment/Progress remain unchanged. Production and .env.local are
untouched. No commit/push; stop after A1. Future quality requirements and A1-A2
ownership remain in the impact audit.

## Retained earlier audit evidence

The sections below describe the **pre-A1** state and earlier paused V2-A pass,
not current deployment status. Their compatibility findings motivated the guards
implemented above; earlier statements that no migration exists are historical.

## Historical pre-A1 authority audit (2026-10-11)

| Area | Current authority | V2 compatibility boundary |
| --- | --- | --- |
| Storage/identity | [Request schema](../supabase/migrations/202610100001_order_requests.sql): conversation, Listing/Buyer/Seller origins and immutable terms; no proposal sender/recipient fields | Reuse this table; do not rename or rewrite historical terms/status/timestamps. |
| Create/replace/cancel | Latest staging `marketplace_private.mutate_order_request`, matching the [payout-gate migration](../supabase/migrations/202610110001_order_payout_gate.sql), permits authenticated conversation Seller only | Seller membership is not proposal-sender ownership for a Buyer-origin Offer. Legacy mutations need an explicit compatibility boundary. |
| Send payout gate | Create/replace call `require_seller_payout_ready(actor)` before Listing/Conversation row locks | New Buyer-origin proposals must bypass the send-side Seller gate; Seller-origin proposals must retain it. No Buyer payment-method check belongs here. |
| Idempotency | Actor/action/client UUID advisory lock, command digest, stored Request result; retry resolves before payout check | New Offer commands must not collide with old commands or replace a later proposal on retry. |
| Serialization | Financial-capability advisory lock (Seller send), then Listing row, Conversation row, target Request row | Preserve lock order across legacy Accept and new symmetric proposal mutations. True independent-transaction tests are still required. |
| Active uniqueness | Partial unique index on Listing/Buyer/Seller origins where status is `active` | Shared across proposal directions; explicit conversation uniqueness and participant-scope validation need migration design/testing. |
| History/RLS | Participant-only SELECT, verified Western eligibility, no direct client writes; history RPC additionally settles existing expiry | Do not call settling reads merely to audit protected manual records. New DTO must explicitly expose immutable sender/recipient. |
| Events/Realtime | Append-only transaction events and private `messages_changed` invalidation; creation/replacement/cancellation event roles default to Seller | Buyer-origin events require correct authenticated actor role; preserve the same invalidation architecture. |
| Accept | Latest staging `marketplace_accept_order_request`, matching payout-gate migration, requires caller = Request Buyer; rechecks membership, payout, inventory and timing under locks | It does not check proposal sender, recipient or version. A valid Buyer-origin row could be accepted by its own sender. Do not expose such rows to this path. |
| UI projection | [Request service](../lib/server/order-request-service.ts) and [Messages integration](../components/home/messages-chat.tsx) assume Seller-origin Request alignment/cancellation | New Buyer-origin rows cannot safely flow through the unmodified V1 projection. V2-A does not authorize rebuilding the Offer UI. |

## Historical pre-A1 derivation result

Direct staging reads found **4 legacy Request rows**, **0 invalid participant /
Listing-origin relationships**, and **0 creation events inconsistent with
Seller-origin identity**. Historical origin UUIDs are present and distinct;
non-null current participant references agree with them and the conversation.

Thus legacy identity is derivable as sender = `seller_origin_id`, recipient =
`buyer_origin_id`. These historical UUIDs are preferable to nullable profile FKs.
No backfill was executed. No Request, Order, event, capability, Listing or Nike
sample was mutated.

Staging migration history currently ends at `202610110003_order_cancellation`;
no V2-A migration exists or was applied in this pass. Full function definitions
were inspected locally in Git-ignored audit artifacts; no credentials, Auth
tokens or email addresses were collected or printed.

## Historical stop boundary and compatibility proposal

The task expressly requires stopping before broad Accept changes when current
Accept conflicts with storing Buyer-origin Offers. That conflict is confirmed
in the actual hosted definition, not just inferred from the UI.

A possible narrow continuation is a versioned proposal domain in the existing
table: legacy rows and unchanged V1 UI commands remain version 1; new symmetric
Offer commands produce version 2. The legacy Accept and targeted cancel/replace
paths would explicitly reject version-2 records, and the legacy history
projection would exclude them until the V2 UI integration. This is a proposed
compatibility fence, **not an implemented decision or an Accept redesign**.
V2-C would later own recipient-only acceptance and winner/Order authority, Pending
and accepted evidence snapshots, integrated with V2-D/E model-specific timing.

Any continuation must verify that the fence preserves all version-1 behavior,
including idempotent Accept retries, and cannot be bypassed through direct RPCs.
It must also explicitly define how legacy Active Requests participate in new
symmetric replacement and how both read projections preserve history without
misrepresenting Buyer-authored Offers.

No candidate migration, checksum, apply result or regression pass is reported:
implementation, Closed support, DTO/API, bidirectional mutations, concurrency,
security and V1 compatibility tests remain pending. Fulfillment, timers,
Payment/Progress, Notifications and production remain unchanged. No commit or
push was performed.
