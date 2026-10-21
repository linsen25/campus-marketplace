# B12 — Shop membership and entitlement design

2026-10-19. Initial design subsequently approved for **local backend implementation
and isolated PostgreSQL testing only**. Authority:
[B10 contract v1.0](BUSINESS-V1-B10-SHOP-CONTRACT.md) plus the final Trial decision
in section 9. Remote deployment, provider integration and UI remain unapproved.
See [local qualification](BUSINESS-V1-B12-MEMBERSHIP-QUALIFICATION.md) for actual results;
the future file/approval plan below preserves the original design milestone.

## 1. Existing implementation to reuse

- `public.shops`, its unique `owner_id`, owner RLS and seven-field owner DTO;
  `lib/server/shop-profile-repository.ts`, `pages/api/shop.ts`, and migrations
  `202610160006` / `202610190002`. Provisioning is identity/profile only.
- `lib/server/marketplace-auth.ts`: verified Western session and same-origin writes;
  `lib/supabase/server.ts`: session-bound client, HTTP-only cookies and no-store.
- Existing private RPC conventions: empty search_path, qualified relations, explicit
  EXECUTE ACL, server timestamps, actor/action UUID + input digest, transactional
  locking. See Offer commands in `202610160005_dual_payment_paths.sql`.
- `tests/shop-provisioning-b11-db.cjs` / `.sql`: existing isolated native PostgreSQL
  harness and two-session races; `tests/shop-profile.cjs`: actual API/repository
  tests with offline transport. Extend this testing pattern, not Auth architecture.
- `202610160004_stripe_account_setup.sql`, `lib/server/stripe-setup.ts`,
  `lib/server/stripe-webhook-handler.ts`: existing setup bindings, operations and
  durable inbox patterns. They are scoped to account/payment-method setup, not
  proof of a membership payment. Do not repurpose their records or expand handlers
  during B12. Later provider integration must inventory/reuse the transport where
  compatible, rather than add another webhook/inbox without justification.
- Existing notification events/source-key deduplication in `202610150004` are a
  later integration point. Do not create another Messages/notification system.

B11 migration deployment and read-only verification passed in the preceding task;
runtime Staging creation acceptance remains deferred. The B11 qualification file
records its earlier local-only milestone; it is not current deployment evidence.
No deployed membership authority is claimed by this design.

## 2. Minimum proposed storage

Use three narrowly scoped tables in `marketplace_private`, in a new forward
migration only after approval. No modification of `shops` or the B11 RPC.

| Proposed table | Minimum responsibility / fields | Why necessary |
|---|---|---|
| `shop_memberships` | `owner_id` PK referencing the existing account identity; irreversible `trial_claimed_at`; current billing-cycle UUID, original Toronto local anchor and revision; optional future plan/payment preference with effective boundary and verified recurring-consent reference | One account lock and lifetime Trial marker, surviving Shop deletion/recreation and username changes; one scheduling authority, not a second Shop identity |
| `shop_membership_terms` | UUID PK, owner FK, cycle UUID, term ordinal, source `trial/paid`, effective tier `plus/pro`, `starts_at`, `ends_at`, payment mode for paid terms, contract version, originating command; unique owner/cycle/ordinal | Actual funded/Trial coverage, including advance renewals. Separate intervals avoid overwriting prepaid future terms, losing history or storing an unbounded schedule JSON in the account row |
| `shop_membership_commands` | owner, action, action UUID, canonical input digest, recorded result, server timestamp, before/after revision and affected term IDs; trusted proof identity and frozen CAD integer-cent pricing facts where applicable | Durable retry receipt, grant audit, and deduplication of the same underlying payment across different delivery/event IDs. Existing Offer/Stripe setup ledgers have different domains and cannot safely hold these commands |

The terms are the coverage authority; the membership row owns only account-wide
Trial usage and scheduling. Commands are receipts/audit, not a competing current
status projection. Do not persist `active`, `is_pro`, `shop_status` or another
time-sensitive status flag. Prices/quotas are versioned server constants, not a
fourth plan table: Plus auto 199 / one month 299 cents, quota 40; Pro auto 499 /
one month 599 cents, quota 100; CAD only under contract v1.0.

Constraints: valid tier/source/mode, finite ordered timestamps, Trial=Pro,
nonnegative integer monetary facts, valid command linkage, one account row and
one term per cycle/ordinal. Reject overlapping base terms for an owner with a
database exclusion constraint (GiST + btree_gist if available; a reviewed prerequisite
if not). An upgrade revises the existing period tier under lock, preserving its
boundaries and original payment facts, with the old/new tier and verified upgrade
fact recorded in the command receipt. Do not insert an overlapping upgrade term.

All three tables: RLS enabled, no direct anon/authenticated/service_role table
SELECT/INSERT/UPDATE/DELETE grants. Owner reads use a narrow checked projection RPC;
no public membership-row access. Only trusted function owners mutate via scoped
RPCs; no general-purpose grant/edit function. Command receipts are immutable;
term changes require the authorized command transaction and audit. Account identity
and Trial marker cannot be reassigned, cleared or deleted through Shop commands.
Use account-lifetime ownership (existing `auth.users` UUID), not a cascading Shop
FK. Account-deletion/retention policy is outside B12; do not add an account-delete
path or delete retained records here. Verify FK interaction during migration review.

## 3. One entitlement decision

Proposed internal SQL function:
`marketplace_private.shop_entitlements(p_owner uuid, p_at timestamptz)`.
Only trusted SQL callers can choose owner/time. Public owner projection:
`public.marketplace_shop_membership()` uses `auth.uid()` and one captured database
time; repository/API cannot accept an owner or evaluation timestamp from clients.

Return a fixed allowlist: evaluatedAt, revision, status, effectiveTier,
currentTermStart/End, graceEndsAt, nextBoundaryAt, trialClaimed/trialEligible,
maxActiveProducts, canOperateShop, canUseShopAnalytics, proPromotionEligible,
and current access-cycle identifier. Never return provider credentials/raw proof.
`trialEligible` follows the final paid-coverage/renewal-conflict policy in section 9.

| Coverage at captured server time | Status / rights |
|---|---|
| Current Trial term `[start,end)` | Trial, full Pro, quota 100 |
| Current verified paid term `[start,end)` | Active, that term's tier/quota |
| No current term; latest contiguous coverage ended, `end <= now < end + 120 hours` | Grace, retain full last effective tier/quota, Analytics and promotion |
| `now >= end + 120 hours`, no newer valid coverage | Suspended, operating/paid Analytics/promotion denied; historical data retained |
| No coverage ever granted / no Shop | No membership (`status=null`, explicit reason), deny operating rights; do not fabricate a prior suspension |

A valid adjoining future term takes precedence over Grace at its start. Calculate
Grace as 432000 elapsed seconds, not `interval '5 days'` in a local timezone.
Lookup/storage failure returns unavailable and denies privileged Shop actions;
it must not be misrepresented as a successful membership lookup.

No cron is required for time-based authorization. Mutation gates re-evaluate
inside the same transaction/lock immediately before writing; do not trust an old
API DTO. Owner API uses private/no-store; later public caches must not outlive the
next entitlement boundary. Never use this owner DTO as a public Shop projection.

`canOperateShop` is not a global account/Order/Message gate: owner private management,
Resale and legitimate existing Order access remain separately authorized. Suspended
Shop buyer messages and Order-associated conversations follow the exact B10
exceptions in later integrations. No generic middleware blocking all conversations.
Expose the access cycle so those integrations can detect a missed suspension gap,
invalidate old Offers and dedupe suspension/reopen messages even if no cron ran.
This design alone does not implement those side effects or enable Shop publication.

## 4. Calendar and lifecycle rules

All boundaries are stored as UTC timestamptz; retain the original Toronto local
date/time anchor and calculate each boundary from that anchor plus an ordinal.
Trial ends at anchor + two calendar months. Paid periods use one calendar month;
January 31 -> February last day -> March 31, never repeated clamped-date addition.
Do not rely on session timezone or fixed 30-day arithmetic.

One private calendar helper resolves Toronto wall time: clamp target day; resolve
ambiguous autumn time to the earlier instant; if a spring-gap wall time is absent,
advance to the first valid local instant. Do not assume PostgreSQL's default
`AT TIME ZONE` resolution implements both B10 choices. Test the helper against
known DST fixtures before approval; it is the production calendar authority, not
a second independently implemented browser calculator.

- Trial: explicit authenticated action only; existing Shop required; no card,
  provider call, auto-creation or future charge. Persist lifetime marker and Trial
  term in one transaction. No marker change on expiry or Shop recreation.
- Same-plan advance renewal: create adjoining funded future term(s), extending
  from existing covered end; keep current rights and original monthly anchor.
- Grace payment: verified payment immediately grants the selected tier; the new
  period starts at the original due boundary and retains that cycle's anchor.
  No verified payment means no extension. Grace renewal is not Shop reopening.
- Suspended reactivation: verified successful activation starts a new billing
  cycle/anchor, attached to the existing owner/Shop. No backdated unpaid coverage.
- Plus -> Pro: verified upgrade changes current tier immediately and preserves
  period end/mode; integer-cent half-up proration uses the frozen applicable
  Plus/Pro price difference and actual remaining/total duration. A positive amount
  below a future provider's minimum can only be waived by a trusted, audited,
  idempotent rule. Provider minimum remains deferred; never guess a threshold.
- Pro -> Plus: preserve current Pro until the next applicable funded period;
  scheduled preference alone grants nothing. During Grace, a verified Plus purchase
  changes rights immediately under the Grace rule. Existing over-quota products
  are retained; quota is a limit on new publication, not a deletion instruction.
- Auto-renew -> One month: stop future recurring collection, no repricing, clawback
  or early loss of covered rights. One month -> Auto-renew: verified consent first,
  no current-period charge; earliest collection is the next due boundary.
- A Trial future plan selection is only a preference; no early termination or paid
  grant. Cancelled/failed renewal never truncates already funded terms.

Later billing reconciliation must match each success to its intended owner,
purchase, cycle and period. Late success after reactivation, conflicting purchases
and genuinely duplicate charges must not blindly append months. Record a durable
reconciliation-needed outcome and preserve current rights; later payment work
handles refund/accounting correction, never fake a completed refund.

## 5. Commands, concurrency and trusted payment boundary

Proposed narrow interfaces (names to finalize in implementation review):

| Interface | Caller and authorization |
|---|---|
| `marketplace_shop_membership()` | authenticated verified owner; read-only DTO |
| `marketplace_claim_shop_trial(action_id)` | authenticated verified owner, existing Shop; derives actor; no owner/tier/end input |
| private calendar/evaluator helpers | function owner/internal business RPCs only; no public execution |
| future `marketplace_apply_shop_membership_fact(...)` | server-only verified integration, never authenticated browser; restricted service-role EXECUTE only if separately approved, no table grants |

The paid interface is a future contract, **not an exposed grant RPC in the first
implementation**. No generic POST accepting `paymentSucceeded`, amount, tier or
new expiry. The later adapter must bind environment/provider/account, immutable
payment identity, purchase purpose, owner, plan, mode, CAD amount/price version,
period and verified success/consent. PaymentMethod Set, Connect Ready, browser
redirect, pricing selection or setup webhook cannot satisfy that proof.

Lock the account row first (insert-on-conflict for initial state, then FOR UPDATE),
then affected terms in deterministic order. Capture database time after acquiring
the lock. The same owner serializes; unrelated owners proceed independently.
An immutable owner/action/action-UUID UNIQUE receipt stores canonical input digest
and result: identical retry returns the original result, altered payload conflicts.
Trial marker and receipt prevent even different UUIDs claiming a second Trial.
Receipt, term mutation, marker and revision commit or roll back together.

Future paid commands also need UNIQUE underlying provider-payment/purpose identity,
not just webhook event ID, and owner/cycle/period authority to prevent two valid
charges granting the same renewal twice. A distinct duplicate charge is retained
as a reconciliation fact, not discarded as a harmless request retry. Stale expected
revision or superseded cycle cannot overwrite a newer decision. Replayed historical
events cannot restore expired privileges. Trusted events must carry adequate
evidence to reconcile provider occurrence time versus current processing time.

## 6. Offline validation plan (not executed in this design task)

Reuse the existing native harness, no environment files/network/remote fixtures.
Use explicit time arguments only in internal evaluator tests; public RPC tests
prove browser-controlled time is impossible. Existing data/ACL snapshots must
remain unchanged after applying only the future additive migration.

- Trial first claim, same/different UUID replay, profile/Shop recreation, concurrent
  first claims; wrong actor, unverified/non-Western, no Shop, forged fields.
- Exact end and Grace boundaries (+119:59:59 versus +120h), Trial/Plus/Pro rights,
  both modes, no implicit activation on GET/Shop creation or recurring preference.
- Month-end/leap-year anchor restoration; Toronto spring gap/first-valid instant,
  autumn earlier instant, elapsed Grace across both DST changes; timezone independence.
- Adjacent prepaid periods, current versus future tier, Grace renewal/different
  tier, Suspended new anchor, upgrade proration/rounding, deferred downgrade,
  consent/mode changes and retention of already funded rights.
- Duplicate deliveries with different event IDs, same payment, concurrent renewal
  and upgrade, stale revision, late success/new cycle, timeout-after-commit recovery,
  rollback on constraint/audit failure; no partial marker or silent lost entitlement.
- Direct table writes and unauthorized RPC execution denied; owner projection
  isolation and fixed DTO; effective rights expire without scheduler execution.
- Actual existing Resale and Order RPC regressions prove no membership gate has
  been added to them. Later Shop integrations must additionally prove real expired
  owner/Buyer/Order access cases; do not claim those pass from DTO tests alone.
- App TypeScript, focused ESLint, focused API/security regressions and whitespace
  checks during implementation. No real payment/provider acceptance inferred.

## 7. Exact future file plan and sequencing

| Separately approved change | Proposed files / scope |
|---|---|
| B12 core authority + Trial | New `supabase/migrations/<next_available_version>_shop_membership_authority.sql` with reviewed private tables/constraints/ACL and narrow RPCs; no historical migration edit |
| Owner server projection and Trial API | New `types/shop-membership.ts`, `lib/server/shop-membership-repository.ts`, `pages/api/shop/membership.ts`, `pages/api/shop/trial.ts`; reuse Auth/client/error conventions, no component edits or existing Shop DTO expansion |
| Real local SQL/security/time/race tests | New `tests/shop-membership-b12-db.cjs`, `tests/shop-membership-b12-db.sql`, `tests/shop-membership-b12.cjs`; reuse established harness/loader patterns without global refactor |
| Qualification/progress evidence | New `docs/BUSINESS-V1-B12-MEMBERSHIP-QUALIFICATION.md`; update this design and relevant B12 progress only |

Review exact DDL before implementation approval, especially FK retention, overlap
constraint prerequisites and immutable-command enforcement. The placeholder migration
version is intentional: reserve no file/version during planning; select the next
unused version at approved implementation time.

Initial implementation may locally test paid transitions with explicitly privileged
scratch SQL fixtures/internal functions only. Do not ship an arbitrary paid-grant
API or enable a simulator. Provider proof adapter, service-role paid RPC exposure
and real reconciliation require a later concrete proof/authorization review.

Deferred: Stripe billing/charging/refunds/webhook changes, provider migrations,
recurring mandate changes, UI wiring, B13 editing, B14 publication/quota transaction,
B15 discovery/search, recommendation/Analytics consumers, Offer invalidation,
Messages/system notices, scheduler dispatch and all remote deployment/acceptance.
Current Shop finalize denial and public-Shop empty source remain intact. No Resale
query, Order authority, payment economics or existing B11 code changes.

## 8. Smallest next implementation approval

Approve local-only core schema/RPC/repository/API and focused offline tests above,
after resolving section 9 and reviewing exact forward DDL. No frontend connection,
paid grant endpoint, provider action, Staging deployment or test write is implied.
B11 managed runtime creation remains a documented acceptance prerequisite for a
later end-to-end managed Trial test, not a reason to repeat B11 now.

## 9. Final Trial decision — approved 2026-10-19

Previously paid Plus/Pro owners who never claimed Trial retain their lifetime
eligibility. They cannot start Trial during paid Active or paid Grace, while any
prepaid coverage remains, or while an authorized automatic renewal or unresolved
renewal payment conflicts. Paid coverage and its full 120-hour Grace must finish;
the Shop must reach Suspended. The owner must then explicitly claim Trial.

That claim reactivates the same existing Shop with full Pro for two Toronto calendar
months, requires no card, never auto-charges, and irreversibly consumes Trial use.
Never-paid owners retain the ordinary explicit once-only path, with an existing
owned Shop and no conflicting coverage/renewal. Trial never provisions a Shop.
This decision resolves the former ambiguity; no new product decision is pending.

Local implementation is authorized separately; Staging and later integrations are not.
