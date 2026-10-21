# B17 — Discovery / Analytics Facts Plan

2026-10-19. **PLANNING STARTED. IMPLEMENTATION NOT STARTED.**
Local source inspection and documentation only. No data collection, tests,
application/UI changes, migration creation or remote access in this round.

## 1. Exact official scope and responsibility

The authoritative task row remains unchanged:

> Define/record real Shop discovery and analytics facts (views/sales/cost linkage); reuse existing account events/provenance.

Dependency/schema wording:

> B14/B15/B07. Schema:extend only missing fact/index/projection contracts.

Security/acceptance wording:

> Server seller/Shop/channel attribution, owner exclusion, event retry same UUID; sold/listing/manual versus completed Order distinction explicit. Exit: facts reconcile to authoritative transactions, not visual counters.

The user has confirmed this original scope. B17 establishes truthful source facts
and linkage; it does not calculate expenses/profit or build Shop Analysis.
B18 retains expense/product-cost persistence; B19 retains owner/tier-authorized
aggregates/dashboard integration. B07/B09/B26 and provider tasks retain actual
transaction qualification and execution. B27 retains notification/outbox fanout.

The B01–B30 rows contain no other explicit owner for the full Recommendation &
Ranking package. B10 section 1 refers promotion parameters to B17, but the latest
explicit task decision supersedes that allocation, without changing membership
benefits. Ranking is an **unassigned future package requiring scheduling approval**.
Preserve its [draft](BUSINESS-V1-B17-RECOMMENDATION-RANKING-PLAN.md), with all
weights/block sizes/128-candidate choices provisional. No task renumbering.

## 2. Source inventory and quality

"Stored reliably" below describes inspected local constraints/producer semantics,
not fresh cloud acceptance or complete historical coverage. No business rows were
read. Per prior reports, B15/B16 cloud populated-data runtime acceptance and
transaction runtime gaps remain deferred.

| Source / exact implementation                                                                                                                                                   | Reliable fact / grain                                                                                                                                                                                                                       | Limit / classification                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.listing_favorites`, `202610050001_marketplace_publication_favorites.sql`; `lib/favorites-api.ts`, repository and `/api/favorites`                                       | Current unique `(user_id, listing_id)` relationship, owner authorization, created_at; duplicate insert does not create a second row.                                                                                                        | **Current state**, not lifetime favorite events. Unfavorite deletes; refavorite gets a new time; FK cascades erase relationships. Cannot reconstruct removals or past growth. Live Shop product favorite writes are not enabled/qualified by B15. No B17 rewrite.                                   |
| `public.shop_favorites`, `202610190006_shop_favorites.sql`; `lib/server/shop-favorites.ts`                                                                                      | Current unique account/Shop UUID relationship, saved time, explicit idempotent intent; B16 preserves relationship on suspension, hides ineligible Shop DTO.                                                                                 | Current state only; own eligible Shop favorites are allowed. Not buyer-only endorsement, review/rating or anti-abuse-qualified popularity. No public relationship reads or B16 write changes.                                                                                                       |
| `marketplace_private.account_activity_events`, `202610160003_account_activity.sql`                                                                                              | Private event UUID and unique identity; seller owner, Listing origin ID, server occurred_at, optional viewer. First publish and first Sold identities dedupe per Listing.                                                                   | No frozen `listing_channel` or Shop UUID; Listing deletion leaves origin ID but removes a possible attribution join. Auth deletion sets viewer NULL, owner/profile deletion cascades facts. Not an everlasting complete ledger. The "immutable" comment is not by itself a SQL immutability guard.  |
| `capture_listing_activity()` and Listing trigger, same migration                                                                                                                | First publication uses published_at; first Sold transition uses server time.                                                                                                                                                                | `listing_sold` records a status transition, including manual Sold. It is not a completed Order, paid sale, payout or revenue. Unique `listing:sold` is not every repeated Sold transition. updated_at is not Sold time. Historical backfill covered known completed Orders, not all manual history. |
| `lib/record-marketplace-view.ts`, `pages/api/listings/view.ts`, `marketplace_record_listing_view(uuid,uuid)`                                                                    | One UUID per intentional open; immediate retry reuses UUID; RPC pair validation/advisory lock dedupes. Server resolves Listing/owner; authenticated owner is excluded. API limits body to 1KB, same-origin/custom header, UUID-only fields. | See view quality gaps in section 3. Not an impression, unique person, purchase intent or proof of human attention. Failure after the bounded retry is dropped, so browser delivery is best effort.                                                                                                  |
| `MarketLayout` -> `PublishedListingCard` -> `ExpandableCard.onIntentionalOpen`                                                                                                  | The current Resale Market wires the event to a closed-to-open click/keyboard action, not render/hydration/filter/page changes.                                                                                                              | ShopProducts/ShopPage do not pass the callback today; normal Shop card navigation is not a separate recorded Shop visit. No comprehensive coverage of direct product routes/Favorites.                                                                                                              |
| `public.listings`, `202610160007_listing_channel_authority.sql`, B14 `202610190004_shop_product_publication.sql`                                                                | Immutable channel, seller and stable ID; published_at/current status; B14 publication and inventory authority.                                                                                                                              | Current state is not complete transition history; no exact historical manual Sold time may be inferred from updated_at. Quota state and public availability differ.                                                                                                                                 |
| `public.orders`, `public.transaction_events`, command tables                                                                                                                    | Stable Order/Listing/seller/buyer origin IDs, frozen terms/Listing snapshot and immutable transition_key; lifecycle/payment/fulfillment facts from guarded operations.                                                                      | Authoritative transaction facts, not notification delivery or inferred Sold counts. Financial provider execution/acceptance is separate. Do not count pending/accepted/cancelled/expired as completed.                                                                                              |
| `202610160008_order_shop_provenance.sql`, `types/order.ts`                                                                                                                      | New V2 Order snapshot stores listingChannel and Shop name, with seller/Listing origin IDs; current Listing deletion/rename must not rewrite it.                                                                                             | Snapshot does not freeze a Shop UUID; name is a label, not identity. Legacy missing-channel records require explicit legacy/unknown handling, not joining today's Shop to assert historical origin. B17 must not rewrite frozen snapshots/hashes.                                                   |
| Protection completion in `202610130004_handoff_protection.sql`; external exchange in `202610160005_dual_payment_paths.sql`                                                      | UU path completes after guarded Protection; external path completes after both attestations. Server completion boundary and linked events are available.                                                                                    | External may emit both lifecycle `order_completed` and `external_exchange_completed`. Count one completed **Order ID**, not both events. External completion is not UU Paid, provider verification, protection or payout. Manual Sold without Order remains separate.                               |
| `marketplace_private.v2_order_economics`, Order amounts, external exchange records                                                                                              | Versioned frozen monetary terms/authorizations and external attestations.                                                                                                                                                                   | These are not product acquisition cost, expense receipts, realized profit or necessarily executed provider payments. B18 cost data is absent; NULL/unknown is not zero.                                                                                                                             |
| `notification_events`, `notification_deliveries`, `transaction_events` projectors: `202610130001_notifications_domain.sql`, `202610150004_notification_delivery_foundation.sql` | Unique notification source keys and delivery attempts/leases already exist; they derive from transaction facts.                                                                                                                             | Outbox/realtime are delivery mechanisms, not independent sales/views. Recipient duplication, preferences and retries make notification counts invalid analytics. Do not add discovery events to the email outbox.                                                                                   |
| `lib/shop-analysis.ts`, `lib/fixtures/shop-analysis-fixture.ts`, Shop demo fixtures                                                                                             | Explicit fixture calculation types and demo data only.                                                                                                                                                                                      | `quantity`, revenue, `unitCostSnapshotCents`, Featured impressions/visits in these structures do not prove persisted real facts. Never backfill them into B17.                                                                                                                                      |

## 3. Actual missing facts and source gaps

1. **Frozen source attribution:** activity rows lack event-time channel/Shop UUID.
   Surviving Listings can provide immutable channel/seller, but a current owner
   Shop join cannot prove the original Shop after deletion/recreation. Need narrow
   forward attribution for new facts, with unknown historical attribution retained.
2. **Qualified Shop product-open coverage:** an existing intentional-open seam is
   available, but Shop producers do not use it. Recording that intent is business
   instrumentation, not a new visual interaction; it still needs implementation
   authorization and unchanged UI behavior tests.
3. **View authorization gap in existing SQL:** the view RPC is executable by anon
   and checks published/available plus `l.seller_id=actor`, but not channel/B15
   membership eligibility. For anonymous actor NULL, SQL three-valued logic does
   not reject a valid available Listing. A known Shop Listing ID can therefore
   be submitted without the B15 eligibility predicate. This is a source-confirmed
   validation gap, not evidence of actual abuse or a cloud exploit test. Do not
   start collecting Shop views until authoritative Shop eligibility is enforced.
4. **Completed-order/cost linkage:** source IDs already exist; a narrow private
   factual projection can join authoritative completion to frozen Order terms and
   Listing/seller identity. Exact Shop UUID for historical orders and product cost
   are not present in the frozen snapshot. Preserve unknown Shop and unknown cost;
   B18 owns cost persistence/snapshot policy. No sales-total duplicate table needed.
5. **Storefront visits / promotion impressions:** not currently recorded with a
   defined intent/visibility/source contract. Their collection is not automatically
   required just because the B17 row says discovery facts. Define separately if
   desired; do not silently log route mounts, carousel rotations or all pageviews.

Current favorites need no extra event history to truthfully supply current-state
facts. Historical add/remove trends, impression attribution and unique viewers
are not prerequisites for the minimal design below.

## 4. Recommended smallest design — proposal, not implementation

### 4.1 Reuse current relationships and transaction sources

Keep both Favorites tables and APIs unchanged. Reconcile current rows, not a new
counter/event mirror. Distinguish Shop favorites from Listing favorites; preserve
the B16 own-Shop policy and private user identities.

Keep Orders/transaction_events as completion authority. A private, read-only
fact adapter should expose only normalized source identities/types/timestamps,
payment mode and references needed for future consumers. One completed fact per
Order ID; lifecycle event time checked against guarded completion state/receipts.
If both completion event types exist, they corroborate one Order, not two sales.
Conflict/missing event evidence is reported as incomplete, not repaired or guessed.
No new transaction state, payment operation, sale insert or existing history rewrite.

Use frozen channel provenance where present, seller_origin_id and
listing_origin_id. Keep manual first-Sold and completion separate facts; no
revenue/refund/profit interpretation. Cost linkage contract is Order ID + Listing
origin ID + seller origin ID + currency; B18 later supplies an approved versioned
cost reference. Do not create a fake zero cost or reserve a new cost table here.

### 4.2 Extend only the existing activity fact boundary

Propose one future forward migration (no filename/version reserved now):

- Add nullable event-time channel and Shop-origin UUID metadata to the **existing**
  private account activity relation. Names provisionally `listing_channel_snapshot`
  and `shop_origin_id`; narrow CHECKs, no cascade FK to mutable/deletable Shop.
  They preserve source identity, not public Shop access. Existing rows remain
  NULL/unknown unless a separate exact historical proof/backfill is approved.
- Have a narrow private INSERT attribution/validation trigger resolve the source
  Listing seller, immutable channel and current authoritative Shop ID for **new**
  rows. This central seam avoids duplicating account and Shop event tables and
  avoids changing publish/Sold domain semantics. Reject forged new ownership,
  event kind/channel mismatches and missing Shop identity for new Shop facts.
  Retain existing Auth/profile cleanup semantics; do not add an overbroad UPDATE
  guard that breaks `viewer_id ON DELETE SET NULL`.
- Replace only the view command's validation body as needed: source-derived
  attribution; published/available; signed-in owner excluded; B15 eligibility for
  Shop; same-event validation, locks and retry semantics maintained. Do not modify
  B15 eligibility helpers or B16. A retry of an already accepted UUID acknowledges
  the existing fact without inserting another, even after public visibility changes;
  it must not disclose a hidden product.
- Preserve current account aggregate output and historical totals. An index on
  `(shop_origin_id, occurred_at, kind)` is justified only if the actual narrow
  B17 reconciliation queries need it; existing owner/time/kind already supports
  owner attribution. No global aggregation index or counters without a query need.

An internal source projection/helper can normalize these facts and completion
references for qualification, with no browser EXECUTE or broad table grant. It
must not become a B19 summary endpoint. There is no need for a general event
platform, JSON payload catalog, worker, outbox, queue, cron or materialized counter.

### 4.3 Smallest collection scope

Recommend reusing the existing product closed-to-open callback only for genuine
Shop product opens in Shop discovery/canonical Shop product lists, alongside the
existing Resale source. No double hook in both child and parent. One UUID per
intentional open; immediate retries retain UUID; closing/reopening creates a new
intent. Render/hydration, sorting/filtering, pagination, focus refresh, image reads,
API polling, carousel clones and direct route loading do not count.

There is no new standalone Shop-visit endpoint, impression logger, view on favorite
click or dashboard instrumentation in this minimal proposal. If a product-wide
metric must include direct route/Favorites opens too, confirm a separate producer
coverage definition before extending collection. Record a rollout coverage start;
missing historic coverage is not zero activity. Browser delivery remains best
effort, never "exactly once" end-to-end; persistence is idempotent for accepted IDs.

### 4.4 Historical linkage and identity

Do not mutate existing activity rows or frozen Order JSON/hash to fill gaps. A
private compatibility projection may show independently proven channel plus an
explicit attribution-quality marker. Current Listing/Shop matches can be labeled
current linkage, never fabricated event-time Shop identity. Deleted/unclassified
legacy sources stay unknown; no default Shop channel, no username/name joins.

For future Order-level Shop UUID freezing, the narrow additive design and its
freeze point belong in a separately approved transaction/provenance change
coordinated with B26/B18. B17 qualification must report this gap if strict
event-time Shop UUID for completed Orders is part of acceptance. Do not enable
currently blocked Shop transactions just to manufacture facts.

## 5. Privacy, authorization, duplication and data quality

- Browser submits bounded Listing/event UUIDs only, never owner/Shop/channel,
  timestamp, money or entitlement. Reuse same-origin, session and RPC boundaries;
  no service credentials in clients. Definer functions use empty search_path and
  explicit actor/source predicates; direct private table grants remain revoked.
- Existing anonymous view writes mean owner exclusion is provable only for an
  authenticated owner. Anonymous viewer, deleted viewer and unavailable identity
  are not a known distinct person. Do not infer signed-in identity from a device,
  IP, email or fingerprint. No unique-viewer claim or anti-bot guarantee.
- Preserve event UUID conflict checks across Listing/actor reuse and concurrent
  retries. Separate new intentional opens from duplicate delivery. Request logs
  or UI optimistic heart state are not persisted fact evidence.
- Do not collect raw search text, navigation trails, precise location, IP/device
  fingerprints, card dwell/hover, keystrokes, private messages, payment details or
  promotion impressions without an independently justified and approved contract.
- Owner-only future source reads must validate the current actor and stable source
  ownership; current public visibility is not permission to expose viewer identities
  or historic private analytics. Raw fact fields remain private. B19 alone designs
  owner/tier aggregate output; historical Order participant rights stay intact.
- Favorite rows are removable current relationships, event facts have Auth deletion
  effects, and transaction audit has separate immutable retention. Do not change
  retention or replicate personal IDs into new permanent history casually.
- Fact timestamps use the server; retain timestamptz, use Toronto only when a later
  consumer buckets. No client date, updated_at sale inference, fictional quantity,
  lifecycle-to-payment substitution, notification-count metrics or metric backfill
  from fixture dates. Failed/refunded/cancelled/expired states stay distinguishable;
  refund accounting and actual provider reconciliation remain later scope.

## 6. Necessary decisions before implementation

Official task ownership is now resolved; ranking is unassigned. The following
**data semantics/approval gates**, not UI redesigns, remain:

1. Confirm the minimum Shop product-open producer coverage and start date. The
   recommendation above is discovery/canonical-Shop product expansion only, with
   no new storefront visits/impressions or historical estimates.
2. Decide anonymous Shop view policy: retain anonymous raw opens with explicitly
   unverified owner exclusion, or accept only authenticated non-owner opens for
   new Shop facts. Recommend authenticated non-owner Shop opens initially to meet
   the original "another user"/owner-exclusion criterion; preserve Resale behavior.
   This is proposed, not an approved silent change to the anonymous RPC contract.
3. Confirm unknown historical Shop attribution is acceptable as a documented gap;
   if completed-Order event-time Shop UUID must be guaranteed, approve a narrow
   future transaction provenance extension separately. Never rewrite old snapshots.
4. B18 must settle cost valuation/freeze/correction semantics before real cost
   facts; B17 only defines source linkage. Missing costs remain unknown.
5. Any migration/private helper/instrumentation changes require subsequent local
   implementation authorization; Staging deployment/writes require separate approval.
   If instrumentation requires changing existing visual/interaction behavior, stop
   for an explicit UI exception. None is authorized or made in this round.

## 7. Proposed files and focused qualification

No implementation files or migrations are created now. Expected smallest set,
subject to decisions above:

- One forward migration extending private activity metadata/INSERT attribution,
  tightening the existing view command and, only if necessary, adding a private
  source-fact adapter/index. Do not edit historical migrations.
- `pages/api/listings/view.ts`, `lib/record-marketplace-view.ts` only if the agreed
  policy/coverage requires a bounded contract adjustment; existing UUID transport
  may already suffice. No new public analytics endpoint.
- `components/shops/shop-products.tsx`, `components/shops/shop-page.tsx`: existing
  intentional-open callback wiring only, subject to coverage approval. Reuse
  `PublishedListingCard`/`ExpandableCard` seam without changing visuals.
- Focused future `tests/discovery-facts-b17.cjs`, native PostgreSQL `.cjs`/`.sql`
  and offline producer browser tests, plus a later qualification document.

Qualification plan (not executed):

1. Native actual migration and owner/anonymous/outsider rules, forged actor/source,
   malformed UUID/kind, draft/Sold/pending/reserved, eligible/Grace/Suspended Shop.
2. Same UUID retries and two-connection races produce one fact; conflicting
   Listing/actor fails; new reopen gets a new UUID; authenticated owner produces
   none; exact anonymous policy and later Auth deletion are tested explicitly.
3. Frozen new channel/Shop attribution survives Listing deletion, Shop rename and
   current Shop replacement without inventing historical attribution. Legacy
   NULL rows remain unknown and existing account outputs remain compatible.
4. Publish and Sold trigger idempotency: first publication, manual Sold without
   Order, completed UU Order, external two-party completion; two external/lifecycle
   events normalize to one completed Order. One external confirmation/dispute,
   cancelled/expired/unpaid Orders never become completed/paid sales.
5. Prove current Favorites counts reconcile to rows without a history claim;
   B16 self-save/suspension/isolation and Listing Favorites remain unchanged.
6. Source adapters expose no viewer/private financial details to public callers;
   cost NULL stays unknown, no expense/revenue/profit calculation or Order rewrite.
7. Browser producer tests at 390/430/820/1280/1536 and both motion modes: explicit
   open only, no render/filter/hydration counts, same-ID retry, no UI/layout change.
8. Relevant Account Activity, B12/B14/B15/B16, Order provenance/history/transaction
   regressions; TypeScript/lint/diff. Index plans only for demonstrated source
   queries. No real scheduler/payment/email or cloud data creation.

Local tests cannot certify cloud ingestion/coverage. B07/B09/B26 runtime and
immutable-history constraints remain explicit acceptance limitations. No historical
snapshot byte download request is reopened.

## 8. Separation, dependencies and stop

B17 facts reuses B14 publication, B15 public eligibility and B07 transaction facts;
B12 supplies current eligibility where collection needs it. B16 is only a reused
relationship source, never modified. B18 costs consume stable source keys, B19
aggregates consume qualified facts/costs; neither is implemented here. B27 can
later hook authoritative domain producers, without routing analytics via email.

Future ranking retains its separate unassigned proposal, scheduling and parameters.
B17 has no Recommended/Featured rotation, Pro weights, search ordering, public
popularity counters, Shop dashboard, expense/profit calculation, payment execution
or new Shop transaction opening. All existing task IDs are preserved.

This round changes only this plan, the preserved future ranking proposal and the
task breakdown. No application/UI, migration, business-data, environment, Git or
remote operation. Documentation formatting only; no implementation tests run.

**B17 OFFICIAL SCOPE PLANNED — IMPLEMENTATION NOT STARTED**
