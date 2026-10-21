# B18 — Costs & Expenses: minimal local plan

**Planning Started. Plan complete; IMPLEMENTATION NOT STARTED.**
Local source inspection and these two planning documents only. No tests, migration
creation, application/UI changes, remote access or data writes in this round.

## 1. Official scope and prerequisites

The B18 task remains exactly:

> Implement real owner expense/product-cost persistence behind existing UI.

Dependencies/schema:

> B17 + approved accounting definitions/edit/retention rules. Schema:likely expenses/cost snapshot/audit references; do not rewrite Order economics.

Acceptance:

> Integer cents, currency/timezone, immutable completed cost snapshots versus editable expense rows, owner-only CRUD, no secret financial payloads. Exit: reload persists, retries don't duplicate, partial/missing costs visible.

B17 is locally qualified and, per the preceding authorized deployment report,
`202610190007` is Staging-deployed/read-only verified, with 72 applied migrations.
Real cloud event-write acceptance remains deferred. No remote recheck here.
B19 alone owns real aggregates/dashboard wiring. Ranking remains unassigned;
new Shop Contact/Offer/Order creation remains blocked by B14.

## 2. Existing reusable code and actual gaps

| Existing source                                                                           | Reuse / actual limitation                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/shops/shop-analytics.tsx: ExpenseDialog`                                      | Existing FadingDialog, Select, three categories (Packaging/Marketing/Other), CAD amount, date, optional 500-character description, error region and Add/Cancel controls. Submit currently appends to React state and immediately closes. No server save or persistence.                |
| Same file: `ShopAnalysis`, `Dashboard`, `Advanced`                                        | Default `preview` captures content clicks and opens Shop Plans. Explicit `demoAccess` is a test/demo seam, not membership authority. Charts, breakdown and product Cost/Unknown cells are displays, not cost inputs or expense management. No expense list/edit/delete controls exist. |
| `lib/shop-analysis.ts`, `lib/fixtures/shop-analysis-fixture.ts`                           | Useful integer-cent/nullable-cost type conventions and illustrative calculations only. Response requires `source: fixture`. Quantity, unit-cost snapshots, subscription charge references and generated prices are demo facts, not persisted accounting or trusted billing evidence.   |
| `components/listings/home-listings.tsx`, `resale-management-card.tsx`, `listing-form.tsx` | Shop reuses owner management and the Listing wizard. Price is a selling price; there is no product-cost input. Do not put private cost on a public Listing DTO or silently repurpose Price.                                                                                            |
| `pages/api/shop.ts`, `lib/server/shop-profile-repository.ts`                              | Reuse validated session, owner Shop lookup, same-origin writes, explicit DTOs, private/no-store, safe errors and full-precision opaque ETag/CAS pattern. Owner management is separate from public membership eligibility.                                                              |
| `lib/offer-amount.ts`, `lib/listing-validation.ts`, `types/listing.ts`                    | Decimal text parsed with BigInt to safe integer CAD cents; explicit zero supported by `allowZero`. Existing Listing currency is CAD. Reuse, not floating-point multiplication.                                                                                                         |
| B17 `completed_order_facts` / activity source metadata                                    | Reuse Order/Listing/seller origin UUIDs and independently verified event-time Shop provenance where available. Current projection deliberately returns NULL cost and unknown historical Shop UUID. Do not change B17 collection or rewrite this function to invent costs.              |
| Orders, `transaction_events`, `202610160008_order_shop_provenance.sql`                    | Existing immutable transaction identity/snapshots; completion, payment and refund are different facts. Frozen snapshots contain no acquisition cost or guaranteed historical Shop UUID.                                                                                                |

Local migration search found no cost/expense persistence table; the only
`unit_cost_cents` is B17's NULL projection. Order economics, delivery fees and
seller earnings are not product acquisition cost. No existing table can be reused
as writable expenses without mixing unrelated business authority.

The demo date is fixed at `2026-10-17`; its demo copy and immediate-close submit
cannot truthfully represent a live save. Generated Subscription expenses are not
real charges, and must never be imported as account expenses. Keep the demo intact
until a separately approved live interaction exists; never append real costs to
fixture revenue and present that combination as real accounting.

## 3. Smallest proposed persistent model

Names below are proposals, not created objects. Prefer one forward migration.

| Private relation                                | Minimal fields and purpose                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marketplace_private.shop_product_costs`        | Unique `(shop_origin_id, listing_origin_id)`; server-derived `owner_origin_id`; nullable `amount_cents`, CAD currency, monotonic revision, server created/updated timestamps. A missing row or NULL means unknown; explicit 0 is known zero. Current editable cost for the single item/lot represented by the existing Listing. No batches or invented stock quantity.                    |
| `marketplace_private.shop_expenses`             | UUID primary key (also stable create-request identity), server-derived owner/Shop origin UUIDs, positive integer `amount_cents`, CAD currency, `expense_on` date, one of the three existing categories, optional description, revision/timestamps, nullable `deleted_at`, immutable initial-request digest. Real owner-entered operating expenses; no required Listing/Order association. |
| `marketplace_private.shop_order_cost_snapshots` | Order UUID primary key/restrictive Order reference; seller/Listing origins, nullable verified Shop origin, nullable frozen amount and source-cost revision, currency and server capture time. Server-only insert, no owner update/delete. Necessary only for the official immutable transaction-cost requirement, not a second Sales table.                                               |

Why not add `cost` to `public.listings`: selling-price DTOs, public projections,
publication guards and public reads would all become privacy hazards; a separate
small owner-only record keeps Resale/public contracts unchanged. Why the third
relation: mutable current cost cannot truthfully provide immutable completed
cost, and modifying frozen Order JSON/economics is prohibited. No cost-version
ledger or fourth command/audit table is proposed.

Do not add Listing/Shop/profile cascade-delete foreign keys to these private
financial records. Use stable origin UUIDs, as existing Order provenance does,
with database verification when linking a live subject; caller UUIDs alone are
not authority. Retain records when a Listing is deleted. Account/Shop closure
retention is not redesigned here; deleted identities lose access under existing
Auth rules, and no cleanup worker or public recovery path is added.

## 4. Money, dates and lifecycle proposals

- CAD only, matching current Listings/UI; DB bigint bounded to
  `0..9007199254740991` cents (expenses require at least 1). API rejects unsafe
  numbers, negative/overflow/noninteger values, unsupported currencies and unknown
  fields. Decimal UI conversion reuses `parseOfferAmount`; empty cost is NULL,
  never silently 0. No exchange rates, tax engine or revenue calculations.
- `expense_on` is an actual Gregorian `YYYY-MM-DD` business date, validated by
  round trip, no later than server-derived Toronto today. Default live date is
  Toronto today, not fixture time/browser timezone. Audit timestamps are UTC
  timestamptz. Read ranges/page sizes are bounded; no unlimited export endpoint.
- Create expense with one UUID retained across retries. Same UUID + same original
  canonical payload acknowledges the existing record; different payload conflicts.
  Preserve the initial digest even after edits/deletion so retries cannot recreate
  a deleted expense or confuse an edited row with a different original request.
- Edit with required opaque version/If-Match and an atomic conditional DB write;
  stale writes return conflict. Reuse B13 CAS principles, not client-only disabled
  buttons or millisecond-truncated timestamp comparisons. Lost update response:
  reread authoritative record and reconcile; never blindly overwrite a later edit.
- Recommended expense delete is a versioned soft delete. Repeated delete remains
  deleted; no resurrection through a create retry. B19 can later exclude tombstones
  from current totals. This does not create an audited accounting revision ledger.
- Product-cost save/clear uses the same unique subject and expected revision
  (absent revision 0). Concurrent first saves cannot create duplicate cost rows.
  Clearing sets NULL; it does not remove previously frozen Order cost snapshots.
- Mark Sold is not a sale/cost freeze. Editing selling price, unpublishing,
  deleting a Listing or changing current cost never edits a snapshot. Sold cost
  remains privately readable; deletion retains origin/history and denies new cost
  writes against the missing Listing. Operating expenses do not disappear.
- Suspension/reactivation does not erase or recopy any record. Verified owner
  cost/expense CRUD must remain available regardless of `canOperateShop` or
  `canUseShopAnalytics`; this does not unlock the paid Analysis dashboard.
- Manual expenses are owner statements, not provider-verified payments. Do not
  auto-create Subscription expenses from tier, Trial, scheduled purchases or demo
  `chargeReference`. Actual bill ingestion/deduplication needs trusted payment
  evidence in its separate task. No optional Order/Listing expense links initially:
  there is no existing selector or demonstrated requirement for them.

## 5. Historical cost boundary — decision required

**Recommendation, not a finalized product rule:** freeze cost when an authorized
Shop Order is first created by Accept. It then remains immutable if completed,
cancelled, refunded or current product cost changes. Presence of a cost snapshot
is not proof of a completed sale; B19 must still use B17/Orders completion facts.
Freezing at completion instead is a different policy and requires a decision.

If approved, a narrow private AFTER INSERT capture trigger can write the separate
cost snapshot atomically, after existing Order/B14 authorization, without changing
Accept, Protection, settlement, notification or immutable Order functions. Owner
cost updates serialize on the existing Listing before the cost row, consistent
with transaction Listing-first locking; never lock an Order from cost CRUD.
Capture must handle an absent cost as immutable NULL, including the concurrent
first-cost-insert case. No timestamps supplied by the browser or late as-of joins.

Only new, independently attributable Shop Orders qualify. Where usable, B17's
new verified publication fact can corroborate the original Listing/Shop source;
do not use today's owner Shop as proof of an old Order's Shop. If evidence is
missing/mismatched, retain unknown identity/cost. A legitimate transaction must
not be denied merely because cost is unknown. Real unexpected DB errors remain
transaction failures, not silently swallowed snapshot failures.

Existing Orders receive no retrospective row or recalculated cost. A later owner
entry is current product cost, not a historical correction. Already-completed
cost corrections are outside this minimal proposal; no UPDATE of frozen
snapshots, current transaction events or historical hashes.

**Integration limitation:** B14 still blocks all new Shop Orders. B18 must not
remove that guard to exercise capture. Local fixture/helper tests plus guard-denial
checks can qualify the isolated mechanism, but real new-Shop-Order capture/bind
requires the separately approved transaction task (B26). This limitation must not
be marked passed or hidden behind API-only CRUD acceptance. Backend CRUD alone
does not satisfy the full immutable-cost acceptance criterion.

## 6. Minimal API and database authority

Proposed session-bound routes: `/api/shop/costs` (read/save/clear by Listing UUID),
`/api/shop/expenses` (bounded owner list/create), and
`/api/shop/expenses/[expenseId]` (versioned edit/soft-delete). Reuse existing
client transport and auth, small JSON limits, strict keys, same-origin writes,
private/no-store and sanitized 400/401/404/409/503 errors. No service key in browser.

Resolve owned Shop and profile from verified current Auth on the server and again
inside narrow RPC authority. Reject client owner/Shop/channel/tier/time spoofing.
Cost writes verify actual Listing seller, immutable `shop` channel, matching
Shop identity and CAD currency; Resale is excluded. Uniform inaccessible-subject
responses must not disclose another owner's cost/expense existence.

New relations use RLS plus revoked raw application table privileges (including
service_role); narrowly granted authenticated RPCs enforce owner predicates and
CAS under locks. Definer functions have trusted owner, empty search_path and
qualified references. No PUBLIC/anon EXECUTE. Snapshot capture/read helpers stay
private; no owner snapshot-write RPC. Verify effective grants after defaults.
No changes to B15 public DTOs, Listing Favorites, B16, Storage or B17 Activity.

## 7. UI V1 exceptions that must be approved first

There is **no complete frozen-UI route to B18 CRUD**. Backend-only CRUD is possible,
but cannot be presented as finished end-user B18 functionality. Propose:

1. Reuse the current Expense form fields/dialog in an explicitly live owner mode:
   truthful saved-to-account copy/button label, server Toronto date, pending-save
   duplicate prevention, close only on confirmed success, error/retry in existing
   region. Preserve the original demo behavior separately; no fake data migration.
2. Approve one compact owner-only Costs & Expenses entry in Manage Products that
   remains accessible while Suspended, reusing FadingDialog. It needs a minimal
   persisted-record list with edit/delete and a product-cost amount/clear control;
   these controls do not currently exist. Reuse the same expense form, not a
   second form or a new wizard. Exact placement requires approval, not redesign.
3. Do not remove the global Analysis preview capture or unlock paid analytics just
   to reach CRUD. Leave its demo charts/source contract intact until B19. If a
   live expense action is also connected from Analysis, authorize that specific
   action separately, without converting fixture charts into real totals.

No visible changes have been made. No new cost field on the shared ListingForm,
public Listing cards, Shop Detail or Resale is proposed. Any live manager layout
or management-row addition still requires explicit UI approval.

## 8. Focused future qualification

Plan native disposable PostgreSQL tests of the actual one forward migration:
owner CRUD/re-login persistence, anonymous/cross-owner/raw grants, forged UUIDs
and Resale channel denial, Suspended owner access; valid zero versus NULL, money
overflow/currency/date/leap-day/Toronto boundary; same create UUID, mismatched
retry, edit/delete races, missing-row cost race, stale CAS and lost-response
reconciliation; retained deleted Listing data; immutable cost snapshot, unknown
capture and no historical backfill; unchanged frozen Order/Activity hashes and
all B14 new-Shop-transaction denials. Do not claim future transaction runtime
qualification from a helper test or manufacture Orders by disabling guards.

API tests cover strict payloads, origin/session, error sanitization, pagination,
no-store, no client provenance and no secret leakage. B15 privacy projections,
B16 Favorites, Resale, B17 facts and existing Order regressions remain unchanged.
If UI exceptions are approved, use isolated browser data at 390/430/820/1280/1536
in normal/reduced motion for save/failure/retry/reopen, edit/delete conflicts,
Suspended entry, unknown/zero, focus/scroll and no overflow. Preserve the 390px
Market fix. Run application TypeScript, focused lint/Prettier/diff and applicable
local build checks during implementation, not this planning round.

## 9. Likely file-by-file implementation scope

Proposals only; no files below have been created/modified by this planning task:

- One next forward `supabase/migrations/<next>_shop_costs_expenses.sql`: private
  relations, constraints/indexes, RLS, narrow CRUD RPCs; snapshot capture only
  after its exact boundary is approved. No old migration edits or backfill.
- New `types/shop-costs.ts`, `lib/shop-costs.ts`: non-demo DTOs/strict validation.
- New `lib/server/shop-costs-repository.ts`: reuse Auth/owned Shop/ETag patterns;
  no second identity system, financial provider or analytics service.
- New `pages/api/shop/costs.ts`, `pages/api/shop/expenses/index.ts`,
  `pages/api/shop/expenses/[expenseId].ts`, `lib/shop-costs-api.ts`: owner transport.
- UI approval only: `components/listings/home-listings.tsx`, new
  `components/shops/shop-costs-manager.tsx`, and extraction/reuse of ExpenseDialog
  from `components/shops/shop-analytics.tsx` into `shop-expense-dialog.tsx`.
  Reuse existing styles/tokens/FadingDialog; any CSS addition needs that approval.
- `next.config.js` only if needed for the live endpoint cache boundary (existing
  `/api/shop` paths are not covered by B17's `/api/shops` rule); no unrelated PWA work.
- New focused `tests/shop-costs-b18.cjs`, `shop-costs-b18-db.cjs`,
  `shop-costs-b18-db.sql`, `shop-costs-b18.browser.cjs`; qualification doc/progress
  update after implementation. Reuse existing test harnesses, no global refactor.

## 10. Decisions and smallest next approval

Before implementation, explicitly confirm:

1. Cost freeze: recommended first authorized Order creation/Accept, rather than
   completion; unknown stays unknown and no retrospective correction. Approve
   the narrow separate snapshot capture and preserve the B26 runtime gap.
2. Owner expense edit + versioned soft-delete/retention, no manual Subscription
   ingestion and no optional associations initially, as proposed above.
3. The specific minimal UI exceptions in section 7, including Suspended access;
   otherwise approve backend-only local work and retain the user-facing gap.

Smallest next authorization: local backend, one forward migration file and local
tests for this bounded model, with only individually approved UI wiring/snapshot
capture. No Staging deployment, accounts, business writes, payment operations or
transaction guard changes. If those decisions are not approved, stop the affected
implementation instead of inventing accounting semantics or changing UI silently.

**B18 PLANNING COMPLETE — IMPLEMENTATION NOT STARTED.**
**B19 AND RECOMMENDATION & RANKING NOT STARTED.**
