# B18 — Costs & Expenses local qualification

Local implementation record, 2026-10-19. This report supersedes the implementation
status in the earlier planning document; that document is retained as the approved
design history. No remote environment was contacted in this implementation round.

**B18 LOCAL IMPLEMENTATION COMPLETE**

## Implemented authority

- Product acquisition cost is private, nullable CAD integer cents. NULL/missing
  means Unknown; explicit 0 is a known zero. It is independent of selling price,
  Order economics, payment, refunds, revenue and quantity/inventory.
- Current cost belongs to the authenticated, verified Western owner and the
  authoritative Shop/product. The server accepts no caller-supplied owner or Shop.
  Owners can manage private costs/expenses while Suspended; this grants no public
  eligibility or transaction permission.
- Operating expenses support create, bounded list, edit and soft delete. Existing
  Packaging/Marketing/Other categories only, positive CAD integer cents, description
  at most 500 characters, valid non-future Toronto calendar date. No automatic
  subscription-charge ingestion or invented sales/expense records.
- Stable expense UUID + original canonical payload digest deduplicates creation,
  including lost-response retries after edit/deletion. Revisions guard edits and
  deletes; stale different writes conflict. Deleted rows remain stored and never
  resurrect through create retries. No generic event/version framework was added.
- A Listing-first row lock serializes cost mutation with existing Accept. An
  AFTER INSERT trigger freezes current cost in the same transaction that creates
  the initial Shop Order. Snapshot creation failure rolls back the Order, Accept
  command and inventory reservation. Accept replay does not reinsert an Order or
  recapture cost. A previously unknown frozen cost stays unknown.
- Snapshot Shop identity is resolved from the real Listing/seller/Shop **at new
  Order creation**, not reconstructed for an old Order. Existing frozen Order JSON,
  hashes, economics and B17 facts are untouched. No backfill; no snapshot from
  manual Sold, failed Accept, payment status or revenue inference.

## Exact local database proposal

Only new forward migration:
`supabase/migrations/202610190008_shop_costs_expenses.sql`.

| Object                                             | Change                                                                                                                                                                                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marketplace_private.shop_product_costs`           | 8 columns; `(shop_origin_id, listing_origin_id)` key; nullable bounded bigint cents; CAD; revision/timestamps.                                                                                                                                  |
| `marketplace_private.shop_expenses`                | 13 columns; stable UUID; owner/Shop origins; positive bounded bigint cents; date/category/description; revision/timestamps; `deleted_at`; initial `create_hash`. Active date/ID index.                                                          |
| `marketplace_private.shop_order_cost_snapshots`    | 8 columns; restrictive Order FK/primary key; immutable Listing/seller/Shop origin, amount, currency, source revision and capture time.                                                                                                          |
| `public.marketplace_shop_product_cost(uuid,jsonb)` | Narrow authenticated owner get/save/clear RPC.                                                                                                                                                                                                  |
| `public.marketplace_shop_expenses(text,jsonb)`     | Narrow authenticated owner list/create/update/delete RPC. Lists 20 rows with date/UUID cursor; no offset counter.                                                                                                                               |
| Three private functions                            | Explicit expense DTO projection, atomic snapshot capture, immutable snapshot update/delete guard.                                                                                                                                               |
| Two triggers                                       | New Order INSERT capture; snapshot UPDATE/DELETE rejection.                                                                                                                                                                                     |
| Permissions                                        | RLS on all three relations; owner SELECT policies, but no raw table grants to PUBLIC/anon/authenticated/service_role. Only the two public RPCs receive authenticated EXECUTE. Empty search paths; trusted-owner definer functions where needed. |

No existing RPC is replaced, no historical migration is edited, no public DTO is
extended with cost, no cascade from Listing/account/Shop deletes erases cost facts.
Retained Listing/Shop/account UUIDs are historical origins, not new mutable identity
systems. Deleted Listing cost can be read by its retained owner/current Shop but
cannot be rewritten through the normal cost RPC. Snapshot Order deletion is
restrictive and snapshot mutation is prohibited even through direct SQL paths
unless a privileged operator deliberately changes database protections.

SQL diff reviewed: only these three tables, one index, RLS/policies, five functions,
two triggers and narrow grants/revokes inside one transaction. No B14 guard,
transaction expiry, scheduler, payment, inventory rule or B17 producer modification.

## Application and UI integration

Reuses existing Auth/session validation, `createMarketplaceClient`, same-origin
custom-header validation, `ListingApiError`, shared `marketplaceRequest`, BigInt
`parseOfferAmount`, existing `FadingDialog`, Sort select, ShiningButton and
ListingConfirmation. No service-role credential is required or exposed.

Private responses use `private, no-store`; the existing PWA NetworkOnly API rule
now covers singular `/api/shop` as well as existing plural `/api/shops` routes.
DTOs explicitly omit internal owner/digest fields. SQL authorization errors become
uniform 404s, stale writes 409s, invalid input 400s and infrastructure errors safe
503s, without raw database details.

Approved B18 UI exceptions only:

- Real Shop product More menu: Product cost dialog; Unknown/0 explanation,
  asynchronous Save and Reload after a conflict. Sold products retain cost access,
  while existing disabled destructive/mark-sold actions remain disabled.
- Manage Products: Expenses opens private list, Add/Edit existing ExpenseDialog,
  and existing confirmation for retained soft deletion. Failure stays visible;
  submissions are blocked while pending, create retries keep the same UUID.
- ExpenseDialog extracted into a shared module. Demo Analysis keeps its fixture
  date, local expense state and Demo wording; real management uses the live owner
  APIs. Real expenses are **not** mixed with fake revenue/charts.
- Live owner submit buttons explicitly use form submission rather than
  ShiningButton's default login action; shared button and original Demo submission
  behavior are unchanged.

No CSS files, design tokens, card geometry, navigation, Analysis chart design,
payment UI or Resale behavior were redesigned. No B19 aggregates were implemented.

## Files in this implementation

New:

- `supabase/migrations/202610190008_shop_costs_expenses.sql`
- `types/shop-costs.ts`
- `lib/shop-costs.ts`
- `lib/shop-costs-api.ts`
- `lib/server/shop-costs-repository.ts`
- `pages/api/shop/costs.ts`
- `pages/api/shop/expenses/[[...segments]].ts`
- `components/shops/shop-costs-manager.tsx`
- `components/shops/shop-expense-dialog.tsx`
- `tests/shop-costs-b18.cjs`
- `tests/shop-costs-b18.browser.cjs`
- `tests/shop-costs-b18-db.cjs`
- `tests/shop-costs-b18-db.sql`
- `tests/shop-costs-b18-capture.sql`
- `tests/shop-costs-b18-guards.sql`
- This qualification document.

Updated:

- `components/listings/home-listings.tsx`
- `components/listings/resale-management-card.tsx`
- `components/shops/shop-analytics.tsx`
- `next.config.js`
- `docs/BUSINESS-V1-TASK-BREAKDOWN.md`

Local logs/screenshots/build copies reside only in ignored `tests/artifacts` or the
temporary evidence directory. Existing unrelated work and environment files were
preserved. No Git mutations were performed.

## Local evidence and precise limitations

| Check                                                             | Result                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node tests/shop-costs-b18.cjs`                                   | PASS: actual API/repository with controlled Auth/RPC transport; strict inputs, privacy projections, authentication, same-origin and safe errors. Not cloud persistence evidence.                                                                                                                                   |
| `node tests/shop-costs-b18-db.cjs`                                | PASS: actual forward SQL on isolated localhost native PostgreSQL/current schema; owner/Suspended CRUD, NULL/0, revisions/idempotency, soft deletion, privacy, stable pagination, legacy preservation and lock-observed write races.                                                                                |
| `node tests/shop-costs-b18-db.cjs --capture-fixture`              | PASS: actual Accept in separate historical pre-B14 fixture phase; first snapshot, atomic rollback, unknown/zero, replay, immutable capture and three lock-observed Accept/cost races. Actual B14 guards are then installed and all three new-Shop initiation boundaries verified CLOSED.                           |
| `node --openssl-legacy-provider tests/shop-costs-b18.browser.cjs` | PASS: actual Manage Products/cards/dialogs, controlled local transport; 390/430/820/1280/1536 × normal/reduced motion. Unknown/0, save failure, stale cost/reload, same-ID lost-response expense retry, pending disable, edit, reopen, soft deletion, list failure/retry, Escape/focus and no horizontal overflow. |
| Offline regression scripts                                        | 12 PASS: `shop-analysis`, `shop-settings-b13`, `shop-products-b14`, `public-shop-b15`, `shop-favorites-b16`, `discovery-facts-b17`, `order-shop-provenance`, `transactions-b09-static`, `dual-payment`, `resale-recovery-b05`, `listing-channel`, `listing-media-isolation-api`.                                   |
| Additional qualification                                          | See the final verification section below.                                                                                                                                                                                                                                                                          |

Native fixtures create fresh disposable loopback clusters; no CLI-linked target,
environment secrets, existing local development database or hosted records are
used. Browser tests use local controlled transports, not real cloud sessions.
The snapshot seam fixture **does not enable new Shop transactions in the current
application or Staging**. It qualifies future atomic integration locally, not a
claim of real Shop Order acceptance. Real transaction acceptance remains separately
authorized work (B26 or the applicable transaction task).

Initial local check failures were corrected: TypeScript category state typing;
lint ordering/complexity/formatting; browser test trigger-role locator; B18 submit
buttons falling back to the shared login handler. Legacy Webpack fixtures require
the existing `--openssl-legacy-provider` compatibility flag under Node 24. No
assertion was weakened or existing business guard disabled to obtain a pass.

## Final verification

- Six native regression suites PASS: `transactions-b09-db`,
  `shop-membership-b12-db`, `shop-products-b14-db`, `public-shop-b15-db`,
  `shop-favorites-b16-db`, `discovery-facts-b17-db`. Fresh loopback clusters only.
- `shop-products-b14.browser.cjs` PASS: all five widths × both motion modes;
  shared wizard, lost-create/upload/quota recovery, edit, Shop Sold, Discard and
  no overflow. No existing test edits.
- `shop-analysis.browser.cjs` PASS: all five widths × both motion modes and
  additional loading/retry/unauthorized/empty/missing-cost/loss cases. Demo UI
  remains separate.
- `market-navigation-hit-targets.browser.cjs` PASS: all five widths × both motion
  modes in an actual isolated offline Next application; normal clicks and hit
  tests for Shop/Resale/Filter/Sort, no forced interaction or overflow.
- `shop-settings-b13.browser.cjs`: initial run 9/10; 1536px reduced-motion
  screenshot-time assertion found no dialog. Unchanged targeted 1536px rerun
  passed both motion modes. The subsequent complete unchanged rerun PASSed all
  five widths × both motion modes (exit 0). Initial screenshot-time instability
  remains recorded; no Settings component or old test was modified and no
  unrelated visual repair was attempted.
- Application TypeScript PASS:
  `node node_modules/typescript/bin/tsc --noEmit --incremental false`.
- Focused ESLint/Prettier PASS on changed application files; Prettier also checks
  new test scripts and documentation. No global lint suppression.
- Whitespace PASS: `git diff --check` and `git diff --no-index --check NUL <file>`
  for new/untracked B18 candidates, with normal Windows CRLF whitespace handling.
- Isolated production-mode build PASS, exit 0, including final live-only submit
  scoping. Source copy/no environment files, fake loopback configuration, external
  HTTP/fetch blocked; generated SW/build files stay in the ignored test copy.
  Existing hero-parallax index-key, Browserslist and CSS `start` compatibility
  warnings plus deliberately blocked font optimization are non-failing warnings,
  not new B18 defects.

## Future Staging deployment and acceptance — NOT authorized/executed here

1. Obtain separate approval. Explicitly verify target `pcaqxezdfxofysghssyo`; never
   use the Production-linked CLI default. Compare prerequisite schema/migration
   history, current B14 guards, function definitions and grants read-only first.
2. Review only `202610190008_shop_costs_expenses.sql`, no backfill/other pending
   migrations. Stop on drift. Deploy only this migration in one transaction after
   explicit approval; verify all objects/grants/policies and unchanged guards.
3. Separately authorize uniquely marked temporary owner/other-owner accounts and
   products. Verify actual Auth/API persistence after refresh/re-login; Unknown/0,
   stale edits/deletes, lost-response retries, Suspended private access, public DTO
   non-exposure and expense tombstone retention. No email, payment or scheduler.
4. Do not create new Shop Orders to test snapshots while B14 blocks initiation.
   Do not disable guards, alter history or promise deletability of retained rows.
   Agree test-data retention/cleanup scope before creating immutable facts.
5. Preserve all existing users, Listings, historical Orders, Storage and environment
   configuration. B19 consumes these private facts later under its own approval.

**B18 STAGING NOT DEPLOYED**

**B18 STAGING RUNTIME ACCEPTANCE NOT PERFORMED**

**B19 NOT STARTED**

**RECOMMENDATION & RANKING NOT IMPLEMENTED**
