# V2 Offer / Agreement revision

**COMPLETE / STAGING VERIFIED** against `pcaqxezdfxofysghssyo` only.
The complete revision supplied on 2026-10-13 supersedes conflicting V2 target
rules. Existing V1 behavior and historical, frozen Order economics are retained.
The eight additive migrations below are applied to staging. Full qualification
and cleanup passed; this is not a production rollout or a real-payment integration.

## Impact audit before implementation

| Area                      | Existing implementation                                                                                                 | Required revision / dependency                                                                                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active authority          | `202610110004_offer_protocol_isolation.sql`: conversation-wide unique Active index and protocol conflict trigger        | V2 uniqueness becomes conversation + sender. Cross-protocol coexistence requires the requested product decision; preserve V1 single-Active semantics.                                                                                   |
| Create / Counter / Revise | Latest `mutate_offer` in `202610130002_delivery_area_economics.sql`; `offer_commands`                                   | Replace only the actor's Active Offer. Store the explicitly targeted Counter / Revise comparison basis separately from the actor's replaced version. Listing-first locking must remain shared with Confirm.                             |
| Confirm                   | `202610120004_offer_accept.sql`: preflight, immutable media binding, Listing lock, sorted Offer locks, one Order winner | Keep recipient-only authority and idempotency; qualify dual-Active and cross-command races. Close competing Offers without reactivating them.                                                                                           |
| Deny / expiry             | Request guard, event enum, `emit_offer_event`, notification projection and due worker                                   | Add recipient-only Declined transition and own scheduled Campus Offer expiry. Delivery gets no arbitrary Offer TTL.                                                                                                                     |
| History / changed terms   | `marketplace_offer_history`, `lib/server/offers-service.ts`, `types/offer.ts`                                           | Authoritative immutable comparison metadata, server withdrawal eligibility and per-Order milestones. Initial Listing fulfillment baseline needs a product decision because that field does not exist.                                   |
| Financial authority       | Private `v2_order_economics`, `freeze_v2_order_economics`, `v2_order_money`                                             | New Orders use item-only 1%, maximum 500 cents, no minimum; retain existing rule-tagged historical amounts and V1 `order_money`.                                                                                                        |
| Message withdrawal        | Immutable `public.messages`; direct participant SELECT; `supabase-messages-repository.ts`; `message-image-service.ts`   | Authoritative five-minute sender-only transition, tombstones, redacted TEXT/IMAGE read/signing paths, durable audit and invalidation. Storage retention unchanged; existing signed URLs cannot be retrospectively revoked by hiding UI. |
| Message interaction       | `message-history.tsx`, `messages-chat.tsx`, `offer-ui.tsx`                                                              | Compact changed-name-only Offers, withdraw context actions, recipient Cancel / Deny / Confirm without second confirmation; no automatic Order navigation. Reuse existing timeline alignment and dialogs.                                |
| Agreement history         | Offer events currently projected without independent per-Order cards                                                    | Centered milestones keyed by persisted Order ID; Accepted Offer remains Accepted even if the Order terminates. Preserve multiple negotiation rounds.                                                                                    |
| Listing CTA / composer    | `published-listing-card.tsx`, `pages/listings/[id].tsx`, `use-message-seller.ts`; editor initializes mode to null       | Read authenticated history to choose Make / Revise / Make New / View Order. Listing fulfillment source is absent; do not invent it. Add Delivery coarse-area entry and exclude hidden mode values.                                      |
| Notifications / realtime  | `project_transaction_notification`, private Messages invalidation                                                       | Exactly-once recipient notices for Deny and accurate Counter source; preserve actor suppression and invalidation-only broadcasts.                                                                                                       |
| Existing flows            | D1 scheduling, Delivery checkout, payment attempts, handoff, Protection, Orders history                                 | Preserve all locked timers, privacy, state transitions and provider boundaries. Regression tests must distinguish V1 legacy fee from the new V2 fee.                                                                                    |

Applied migration sources are immutable. All database revisions must use new
additive migrations. Destructive qualification uses isolated disposable staging
fixtures, never manual or Nike history. Production and `.env.local` are excluded.

## Resolved decisions

1. **V1/V2 ACTIVE COEXISTENCE:** retain cross-protocol exclusion. An Active V1
   Request blocks V2 creation; either participant's Active V2 Offer blocks V1
   creation. Two V2 senders may each hold an Active Offer.
2. **LISTING FULFILLMENT BASELINE:** add Seller-managed `preferred_fulfillment`
   with `ON_CAMPUS` / `DELIVERY`. Backfill existing Listings to `ON_CAMPUS`.
   This is a default, not a restriction: Buyer may propose the other mode.
   Preserve `pickup_area`. Initial changed terms compare against the captured
   Listing preference; choosing the same mode does not mark Fulfillment changed.

These answers remove the two identified product blockers.

## Qualification record

All eight migrations are applied exactly once to staging. Live function bodies,
empty search paths, the due-work job and exact archival source hashes were verified.
Previously applied migration files and records have not been rewritten.

| Migration                                                  | SHA-256                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `202610130010_offer_revision_economics.sql`                | `3f66dba88c9b82c24a7010b383556419f08d147a901a34553dc0dec85abd8d31` |
| `202610130011_offer_revision_domain.sql`                   | `1de35791dd23541ee914a537086265f2ab08fbf8bc9fc6ea74c2762f0716a28f` |
| `202610130012_message_withdrawal.sql`                      | `ebd3475836009cf8ee5489043b27fe05d651708ac416400ed0c173872383871f` |
| `202610130013_offer_revision_guards.sql`                   | `9afd29bee3e726060114a3cbf7e5b8d4bc1f579c23c446bf148d29a15a420a1e` |
| `202610130014_offer_revision_lint.sql`                     | `146884f071e697750c891faecdac0d22021cc295cb3e273cbcdf597521c3d937` |
| `202610130015_offer_revision_inspection_economics.sql`     | `7ff8a860a934355e2c70b63f280de6cc793a3ba3b6211b5eb4e4d8fda4735898` |
| `202610130016_listing_fulfillment_permission.sql`          | `50986b261dc56059cbdb533c6ce309dd3aec35fa37ca2f3f8e2d9ae058af6c69` |
| `202610130017_listing_fulfillment_creation_permission.sql` | `75b8cc40fc9101ac6bbed821ea6f4b0e50582845e09080f84f10b9194a104258` |

New V2 Orders freeze `item_only_1pct_max500_v2`. Existing rule-tagged economics
and V1 amounts remain historical transaction evidence; no retrospective recalculation.
Hosted Completed milestone qualification exposed the legacy inspection receipt
minimum. Migration 0015 permits new rule-tagged 1% receipts and copies the frozen
Order rule; historical `preview_cad_v1` receipts remain unchanged. Deployed fee,
handoff and Protection rollback regressions passed after this additive correction.
Real Listing edit qualification exposed a missing column-level UPDATE grant.
Migration 0016 grants only preference updates; authenticated owner RLS and the
Available state guard remain. Rollback tests prove owner update and outsider denial.
Migration 0017 grants INSERT on that same field for new Listing creation. The
rollback test verifies explicit Delivery preference, automatic Seller identity and
unpublished state; no broad table INSERT/UPDATE privilege was added.

## Implemented authority and presentation

- Each sender may have one Active V2 Offer. Create/Revise/Counter replace only
  that sender's prior Active Offer. Cross-protocol Active exclusion remains.
- Initial comparisons capture the Listing asking price/preference; Counter
  captures its targeted Offer; Revise captures the previous own Offer. Compact
  cards display server-derived changed field names, with full terms in Review/detail.
- Only the recipient may Deny/Confirm. Cancel is zero writes. Deny produces
  Declined. Confirm retains existing atomic Accept/media/inventory authority,
  creates one Order and closes competing Offers as "No longer available".
  It leaves the viewer in Messages; View Order is explicit navigation.
- On Campus unaccepted Offers expire at their proposed time. Delivery has no
  invented Offer TTL. Terminal Offers never reactivate after an Order ends.
- Message and own Active Offer withdrawal are server-authorized strictly before
  five minutes. TEXT/IMAGE content is hidden behind chronological tombstones;
  private audit remains. Withdrawn IMAGE metadata is unavailable for new signing.
  Storage retention and already-issued signed URL lifetime remain unchanged.
- Centered Agreement cards use immutable Order IDs, independently of Accepted
  Offer status. Cancelled/Expired/Completed history retains each negotiation round.
- Seller Listing create/edit uses the existing select for preferred fulfillment;
  existing Listings default On Campus and keep pickup area. First Make Offer uses
  current asking price and preference; either participant may propose the other mode.
- Listing CTA is Make Offer / Revise Offer / Make New Offer / View Order according
  to authenticated authoritative context. No preview-role controls participate.
- Review/detail share the 1% item-only, no-minimum, CA$5-cap display estimate;
  financial authority remains frozen integer-cent server economics. Seller fee is zero.
- Notifications retain actor suppression and transition-key idempotency. Realtime
  carries invalidation only; participants refetch authoritative state.

The existing Listing, ActionRow, FadingDialog, date picker, wheel time picker,
message alignment and Orders navigation are reused. No payment provider, Maps,
carrier integration or external delivery channel was selected by this revision.

`tests/offer-revision-economics-db.cjs` passed against isolated local PostgreSQL:
all supplied fee examples, half-cent rounding boundaries, no minimum, Delivery
exclusion, historical row equality, immutable snapshots, V1 exclusion and safe
integer overflow rejection. This is not a substitute for full hosted staging
qualification of the complete revision.

Hosted rollback qualification passed for dual Active, same-sender replacement,
explicit comparison baselines, Deny/idempotency/notifications, withdrawal and the
five-minute boundary, TEXT retry redaction, Campus expiry, Delivery no-TTL,
frozen economics, participant authorization and Agreement projection.

Eighteen independent overlapping concurrency runs passed: both Confirm winner
orders, both Withdraw/Confirm winner orders, and both Revise/Confirm winner orders,
repeated twice initially, then six fresh races against the final deployed schema.
The barrier held a real first transaction lock until the competing
database PID was observed waiting on it. Zero deadlocks, lock timeouts or invariant
failures. This is not sequential call ordering disguised as concurrency.

Real Buyer/Seller browser qualification at 390/430/1280/1536 passed dual Active,
alignment, recipient actions, role economics, Review, keyboard focus and zero-write
Discard/Cancel. Both roles render Active/Replaced/Expired, then Declined/Accepted/
No longer available and redacted withdrawal history. Real Deny, FileDrop IMAGE
upload/withdrawal, Offer tombstone, Confirm remaining in Messages, Agreement
cancellation and private Realtime passed with zero runtime errors.

Genuine CDP touch input verifies Buyer TEXT long press at 390 and Seller Offer
long press at 430: the action is visible before finger release and remains visible
after release. Qualification exposed a compatibility click on the portal backdrop
which immediately dismissed the dialog. The fix is confined to WithdrawContext's
release-click suppression; shared dialogs and backend semantics are unchanged.

The final browser run exercised a recoverable snapshot-upload 503. A retry from
the actual Confirm dialog retained its original client command, with zero Orders
after the failed upload and exactly one Agreement after success. Only this specific
transport error is retried; domain rejection/deadlock is never masked. A separate
Supabase control-plane 502 interrupted a prior SQL test/cleanup; exact journal-scoped
recovery completed and the canonical/manual/media fingerprint was unchanged.

Listing qualification passed all four widths: real Create/upload/publish and
authenticated edit persist Delivery preference, keep pickup area, initialize
Make Offer with asking price/preference, normalize FSA and exclude delivery from
the fee base. Contextual Make/Revise/Make New/View Order navigation passed.
Multi-round milestone qualification passed both roles/all four widths for
Cancelled, Expired and Completed Orders in one conversation, retaining three
Accepted Offers and three distinct Order-ID milestones. The synthetic Completed
path exercised inspection, staging payment, paid handoff and Protection authority.

Final deployed verification confirms all eight migrations exactly once, exact
archival hashes, 56 live function bodies with empty search paths, 13 private RLS
tables and the active minute due-work job. Migration inventory has no pending files.

V1 hosted synthetic regression passed Create/Replace/Cancel/Accept, its original
30-minute deadline, payment simulator, cancellation/inventory release, rollback-only
expiry and D1 exclusion. V1 fixtures were removed and the full canonical/manual/
media fingerprint remained unchanged.

Market image regression passed 390/430/1280/1536: collapsed first image/no controls,
expanded first image/arrows/mobile swipe, single-image no controls, close/reopen
reset, stable card dimensions and zero runtime errors. Scroll-lock qualification
at the same widths records zero horizontal shift, stable gutter without double
compensation, and restored scrolling after close.

## Final regression and security audit

- TypeScript, focused changed-file ESLint and staging-configured optimized build
  passed. Browser bundles contain the staging endpoint and no privileged secrets.
- Local Request/Offer/Accept/winner/static migration, D1, Payment, Progress,
  cancellation, financial snapshot, Auth/session, Messages TEXT/IMAGE/Realtime,
  Notifications, media and project-target guard regressions passed.
- Hosted rollback regressions passed Delivery area/economics, checkout/payment,
  paid handoff/Protection, Courier possession, Notifications/reminders and Listing
  owner preference permissions. Five-minute Message/Offer boundaries reject at
  or beyond the deadline; unauthorized users and non-Active Offer withdrawal are
  rejected. Existing rule-tagged money was not recalculated.
- Staging DB lint has zero errors and two pre-existing volatility warnings in
  `marketplace_private.order_money`; no unrelated auto-fix was applied.
- Secret/prohibited-file scans, documentation links, migration hashes and
  `git diff --check` passed. The Git index remains empty; source/test/docs changes
  are unstaged. Environment files, credentials, tokens, dumps, generated caches,
  sessions and test artifacts are excluded from commit eligibility.
- All disposable fixture users, Listings, conversations/messages, Offers/Orders,
  events/notifications, financial/media sidecars and Storage objects were removed.
  Exact scope cleanup assertions and canonical/manual fingerprints passed. Local
  fixture journals, SQL diagnostics and screenshots were removed after visual QA.

No unresolved product decision remains for this revision. Real Payment/Payout/
Carrier providers, Maps, email/push delivery and hosted media cleanup execution
remain explicitly deferred external integrations.
Production was not contacted by this revision; `.env.local` was not modified.
Manual/Nike transaction history was not consumed or changed. No commit or push.

The existing global GlideSelect.jsx lint parser issue remains pre-existing debt;
focused changed TypeScript component lint passes without rewriting that component.
