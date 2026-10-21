# B16 — Shop-entity Favorites plan

2026-10-19. **PLANNING STARTED. Implementation NOT authorized or started.**
Only this plan and the task-progress document change in this round. No remote
investigation, application changes, migration file, database operation or Git
operation is part of this planning task.

## A. Current foundation and official scope

The B16 row in `BUSINESS-V1-TASK-BREAKDOWN.md` explicitly concerns Shop-ENTITY
favorites, independent of Listing favorites. It also refers to an approved
Master–Detail Favorites UI. The current worktree does not contain a Shop-entity
Favorites master/detail implementation: its destination renders a Listing grid.
Do not invent a master/detail redesign or silently reinterpret existing records.
The integration exception in F needs an explicit decision before implementation.

| Current source | Actual meaning / reusable behavior |
|---|---|
| `components/shops/shop-card.tsx` | Real Shop card, canonical `/shop/<username>` navigation; does NOT pass a favorite callback |
| `components/shops/shop-card-presentation.tsx` | Existing optional controlled heart, shown only with `onFavorite`; reuse its exact icon, placement, labels and animation |
| `components/shops/shop-directory-workspace.tsx` | Live directory uses B15 reads and real ShopCard without a heart. Separate explicit Demo branch owns local `favorite`, `directoryFavorites`, and product favorites |
| `components/shops/recommended-shops-slider.tsx` | Explicit illustrative Demo carousel and local boolean map; not real persisted recommendations. Live B15 Recommended Shops is pending-recommendations copy |
| `components/shops/shop-detail-demo.tsx` | Rich Luna Demo has local Shop and product hearts; it is NOT the canonical real Shop page |
| `components/shops/shop-page.tsx` | Canonical real Shop header/products, actual tier and B15 refresh/unavailable handling; currently NO Shop favorite control |
| `components/listings/home-listings.tsx` | `favorites` renders `<Favorites channel="resale" />`; `shop-favorites` renders `<Favorites channel="shop" />` |
| `components/home/animated-sidebar-demo.tsx` | Shared desktop/mobile navigation labels Resale Favorites and Shop Favorites; despite its filename this supplies current Home destinations |
| `components/listings/favorites.tsx` | Both destinations fetch favorite LISTINGS and render PublishedListingCard, not ShopCard. Existing loading/error/retry/empty/pagination and focus/visibility refresh can be reused |
| `lib/favorites-api.ts`, `pages/api/favorites/[[...segments]].ts` | Existing Listing-only GET list/state, POST add and DELETE remove, authenticated request context, same-origin writes, private/no-store |
| `lib/server/supabase-listings-repository.ts` | Listing PK checks, server-derived user, own-row state/delete, eligible other-seller Listing insert, duplicate insert handling |
| `202610050001_marketplace_publication_favorites.sql` | `listing_favorites(user_id,listing_id,created_at)`, unique pair, FKs, owner RLS and eligibility trigger. No Shop-entity relation found in local migrations |
| `components/listings/marketplace-session.tsx`, `lib/server/marketplace-auth.ts`, `components/auth/auth-modal.tsx` | Existing session, verified Western identity, same-origin/custom-header checks and sign-in UI; reuse, no second identity system |
| `lib/server/public-shop.ts`, `types/shop.ts`, `hooks/use-public-shop-read.ts` | Anonymous public DTO validation, stable public Shop ID, canonical username, bounded refresh and stale-response rejection |
| `202610190005_public_shop_projection.sql` | Existing B15 eligibility/profile whitelist helpers and public read RPCs. Reuse them without replacing their authority |

Important current limit: Shop PRODUCT favorites are not newly functional merely
because B15 public RPCs exist. B15 intentionally hides live Shop product hearts.
The existing Listing favorite INSERT policy reads RLS-scoped Listings, whose
anonymous public policy is Resale-only; non-owner Shop inserts therefore remain
ineligible. Existing Shop Listing favorite rows and the channel-scoped interface
must be preserved. Enabling those product writes is a separate qualification,
not a reason to broaden Listing SELECT/RLS inside B16.

B15 context: its Staging migration was deployed/read-only verified; anonymous
empty-data smoke succeeded where exercised. The subsequent 390px navigation fix
passed 10/10 LOCAL interaction cases. Populated Shop, membership transitions,
hosted private media and CDN acceptance remain deferred. The older B15 local
qualification document retains its historical pre-deployment milestone; do not
read that heading as the current deployment status or claim full acceptance.

## B. Current gaps

- No local schema/API/repository stores account-to-Shop favorite relationships.
- Live Shop cards and canonical detail omit hearts; Demo hearts are local only.
- The existing Shop Favorites label currently means Shop PRODUCT Listing
  favorites. It does not supply the B16 entity destination.
- No shared Shop favorite state, mutation failure handling or reload persistence.
- No real Recommended feed exists to wire in B16; leave Demo and B17 separate.

## C. Minimal persistent model and commands (proposal only)

One forward-only migration, assigned the next unused version at implementation:

`public.shop_favorites`

| Column / constraint | Proposal |
|---|---|
| `user_id uuid NOT NULL` | FK `auth.users(id) ON DELETE CASCADE`, matching Listing favorite convention |
| `shop_id uuid NOT NULL` | FK `public.shops(id) ON DELETE CASCADE`; never username or seller UUID as a substitute |
| `created_at timestamptz NOT NULL DEFAULT now()` | Immutable save time; duplicate add preserves it |
| primary key `(user_id,shop_id)` | One relationship, no duplicate-click records |
| supporting indexes | `(shop_id)` for FK cleanup; `(user_id,created_at DESC,shop_id)` for bounded deterministic favorite-list pagination |

No counter, enabled flag, command history, new membership state, job or notification.
Hard deletion of a Shop/account removes its references through ordinary FKs;
suspension/expiry does NOT delete a row. Existing historical data is not migrated.
If immutable upstream history prevents an account deletion, B16 does not bypass it.

Use three narrow authenticated RPCs, with final names/signatures reviewed locally:

1. `marketplace_favorite_shops(p_query jsonb DEFAULT '{}')`: own eligible favorite
   Shop DTOs only, page 1–1000 / pageSize 1–100 (UI 20), no arbitrary sort/owner
   filters; `created_at DESC,shop_id` and pageSize+1; hasNextPage, refreshAfterMs.
2. `marketplace_shop_favorite_states(p_shop_ids uuid[])`: bounded unique batch,
   at most 100 IDs; returns only requested IDs saved by the current user. No owner
   IDs, other users, private Shop fields or existence/entitlement descriptions.
3. `marketplace_set_shop_favorite(p_shop_id uuid,p_enabled boolean)`: explicit
   desired state, returns `{shopId,favorited}`; never a server-side toggle.

Derive actor from `auth.uid()`, require existing verified-Western helper, validate
non-null Boolean/UUID and bound all inputs. No user ID parameter. SECURITY DEFINER
owner postgres, empty search_path, qualified relations. Revoke default PUBLIC,
anon and service_role EXECUTE; grant authenticated only. No new service-role key.

Enable RLS with own-actor policies as defense in depth, but grant no direct table
SELECT/INSERT/UPDATE/DELETE to application roles: the RPCs provide the capability.
Definer bypass means every query MUST explicitly predicate by authenticated UID;
RLS is not a substitute for this check. No broad Shop/member table grants.

Serialize set operations for the same actor/Shop with a transaction advisory lock
over a namespaced hash of the pair (existing B12 uses advisory locks). A hash
collision can only serialize unrelated work, never authorize it. Add: lock Shop
FOR KEY SHARE, then existing membership row FOR SHARE, consistent with B12's
Shop-before-membership order. Check B15 public_shop_eligibility plus fresh B12
shop_entitlements(owner,clock_timestamp()) after waits, so elapsed expiry cannot
be accepted from statement-start time. Insert ON CONFLICT DO NOTHING. No membership
mutation. Remove: pair lock then own-row DELETE; no eligibility requirement.
Repeated absent remove succeeds false, including after Shop deletion; invalid UUID
is 400. Missing/ineligible add uses the same safe unavailable response, not private
membership details. Errors 401/403/400/404/503 are explicit, never false success.

Recommendation for explicit implementation approval: permit a verified user to
save their own otherwise publicly eligible Shop too. No existing Shop-entity rule
prohibits this; do NOT silently inherit the other-seller Listing rule. This is a
proposed decision, not an already-established product rule.

## D. Entitlement, suspension and visibility

Favorite-list reads join ONLY the actor's relationships to real Shops; apply B15
eligibility BEFORE LIMIT/OFFSET and call the existing private public_shop_profile
whitelist helper. Do not assemble an unrestricted owner Shop DTO. Current public
Shop fields/media URLs only; stable stored Shop ID resolves today's username.
The relation scoping is authenticated; the projected Shop remains public data.

| State | Stored relationship / presentation |
|---|---|
| Active Plus/Pro, Pro Trial, full Grace | Save allowed; visible with actual tier, even with zero products |
| Suspended/no effective entitlement | Existing relationship retained; exclude from visible saved-Shop list; new add denied |
| Reactivated same Shop | Existing relationship reappears on refresh; no new save necessary |
| Username renamed | Stable FK unchanged; current authorized canonical URL, old alias not invented |
| Hard-deleted Shop | FK cascade; no ghost public card or private tombstone |

No global unavailable count, expiry reason or hidden profile is exposed. Bounded
own-ID state reads do not grant public access to an unavailable Shop. Previously
saved hidden Shops may be removed by their owner via DELETE, but B16 need not
invent a hidden-record management UI. A truthful empty list must not claim that
the stored relationships were deleted. No auto-cleanup on expiry.

Return next-boundary-aware refresh delay like B15; refresh focus/visibility and
clear stale eligible content on denial/failure. No ISR or stale public fallback.
All API reads are private/no-store. Extend existing PWA NetworkOnly API route
allowlist for shop-favorites; no service-worker redesign or manual cache purge.
Previously delivered bytes cannot be recalled. Existing protected media authority
remains untouched; no Storage read grants, signed links or private-image downloads.

## E. API, shared state and existing surfaces

Propose `pages/api/shop-favorites/[[...segments]].ts`:

- GET collection with bounded pagination, or bounded `ids` state batch; reject
  ambiguous combinations, duplicate parameters and unknown keys.
- POST `/api/shop-favorites/<shopUUID>` to set true; DELETE to set false.
- Reuse createMarketplaceClient, requireMarketplaceUser, requireSameOriginWrite,
  custom request header, marketplaceRequest and normal sanitized error handling.
- Repository uses the actor's JWT client and authenticated RPCs, never admin.

Use one Shop-specific hook/atom module with the EXISTING Jotai provider. Key all
state by current actor AND stable Shop ID; batch-load displayed hearts. No new
state library, generic Favorites framework or realtime subscription. Account
change/logout invalidates requests and clears visible state before reuse; old
responses cannot populate another account. No localStorage persistence.
Require the real B15 `shop.id` UUID: its current TypeScript field is optional for
legacy previews. Never fall back to sellerProfileId, username or a Demo string
as a Shop foreign key. Missing canonical ID is an unavailable control/error,
not a reason to infer identity or write an unrelated relation.

Recommend the existing Listing favorite confirmed-save strategy, rather than
adding optimistic complexity: keep last confirmed liked state, one in-flight
mutation per actor/Shop, and gate only that Shop's heart (including other mounted
instances). No spinner or global lock. On success update shared state, invalidate
favorite-list reads and dispatch a Shop-specific refresh event. On failure retain
last confirmed state, use existing inline alert/retry; no permanent success pulse.
For lost responses, re-read own state before retrying; do not automatically replay
an old write after a newer accepted command. Stale read versions are ignored.
This does not promise universal wall-clock latest-intent ordering across devices:
database serialization determines concurrent device operations. Test that contract.

Unauthenticated click uses existing openAuth({mode:'signin',intent:'login'}), no
favorite write or fake account persistence. After login re-read server state; no
implicit delayed save. Initial read failure is not interpreted as false. Confirm
PulseHeart's controlled animation, disabled behavior and error reconciliation in
browser tests without changing its shared design.
Anonymous hearts remain usable for opening Login; authenticated initial-read
pending treatment must not accidentally disable that anonymous entry point.

- Real ShopCard passes controlled favorite/onFavorite to existing presentation.
- Canonical ShopPage uses the same hook/heart only inside its available-data
  branch. Do not replace it with Luna Demo, add Contact, or change product hearts.
- Live Recommended section remains a truthful B17 placeholder. Future real cards
  may consume this same hook; Demo fake IDs MUST never hit persistence.
- Existing Favorites destination gets the approved split described below; reuse
  ShopCard and existing workspace/grid/empty/error/pagination components.

## F. UI V1 exceptions requiring explicit approval

1. Show the existing optional image-overlay heart on live ShopCard. For canonical
   ShopPage, propose the far right of its existing headingRow, after the name/tier
   area; no new header row. Approve that placement before coding, because the real
   ShopPage currently has no such control.
   Reuse PulseHeart without shared icon/color/size/animation redesign. Forward its
   existing disabled behavior for initial reads and one in-flight mutation only.
2. Preserve `shop-favorites` navigation ID/label/order. Within that page recommend
   existing FluidTabs with **Shops / Products**: Shops shows saved ShopCards;
   Products keeps `<Favorites channel="shop" />`, existing records and API meaning.
   Never convert Listing rows into Shop favorites. No new permanent nav item.
   Whether Shops should be the default must be approved explicitly; recommend it
   to match B16's user goal, while retaining Products access.
3. Reuse existing empty/error/retry components, with minimal truthful copy:
   "No available favorite shops." and a Shop-specific save failure alert. No
   unavailable private Shop details, fabricated stats, counts or new toast system.
4. The backlog's Master–Detail wording lacks a corresponding implemented surface.
   Recommend existing card grid -> canonical ShopPage navigation as the smallest
   current-worktree integration. It is a proposal requiring approval, not proof
   that a new Master–Detail layout is authorized. If Master–Detail is mandatory,
   obtain the exact existing approved design before implementation.

All other layout, navigation, card dimensions, CSS tokens, responsive geometry,
animations, Listing favorite behavior, Profile/Settings/Analysis stay unchanged.
No UI exception is implemented in this planning round.

## G. Security and compatibility boundaries

- Viewer needs verified login, NOT a Shop subscription or their own Shop. Target
  seller's public entitlement remains B12/B15-controlled.
- No public favorite-owner list, count, billing/trial/command metadata, raw media
  path, service credential or unpublished product. Default PUBLIC function grants
  explicitly removed; private table access denied to anon and other users.
- Every own read/write scopes to auth.uid; API body cannot select an actor. Same
  origin protects authenticated writes; RLS plus RPC predicates protect raw calls.
- Duplicate adds preserve timestamp; repeated removes are safe. Lock waits use
  fresh authority; error/retry never creates another Shop or bypasses expiry.
- Existing listing_favorites rows, policies, notifications and product hearts are
  NOT changed. Shop product favorite INSERT qualification stays separately scoped.
- B11 ownership, B12 entitlement, B14 publication/quota/transaction guards and B15
  public projection/media remain unchanged. No Contact/Offer/Order/financial writes.
- No favorite-count analytics, recommendation weights, new notifications or
  outbox jobs. B17 could later read separately authorized aggregate facts; no
  aggregate/public-count endpoint is built here.

## H. Local qualification plan (not run in this planning round)

Native isolated PostgreSQL with actual migrations plus the proposed forward file:

- Add/state/list/reload/remove; duplicate and concurrent adds, repeated removes,
  same-pair opposite commands and lost-response reconciliation; uniqueness and
  stable pagination/limits, invalid/null inputs and immutable original save time.
- Anonymous/unverified rejection; A cannot read/change B via raw table, RPC or
  forged API user fields; private helper/member access and grant/search_path checks.
- Missing Shop, owner-save approved policy, eligible Plus/Pro/Trial/Grace,
  suspension record retention, exclusion and removal; reactivation without insert,
  rename with same FK/new link, ordinary hard-delete cascade in disposable fixtures.
- B15 field whitelist and no private information in own favorites projection;
  expiry/renewal races and lock ordering with real B12 command fixtures.
- Existing Resale/Listing favorites, B12 membership isolation, B14 publication and
  closed new transactions, B15 discovery/media regressions; no side-effect events.

API tests: auth/same-origin, strict method/UUID/query bounds, own batch states,
sanitized errors, no-store/NetworkOnly, duplicate desired states, unavailable add
versus permitted remove, transport failure/ambiguous response and no stale replay.

Browser: real shared components, isolated local fixtures, five widths
390/430/820/1280/1536 x normal/reduced motion. Card/detail/favorite-list state
agreement, cross-page reload/re-login, login-required existing modal, initial
loading, pending only own Shop, failure/retry, account switch/late response,
Shop/Products split preserving Listing Favorites and optional heart appearance.
Run the new `market-navigation-hit-targets.browser.cjs` regression unchanged.
Never force click. No dummy record enters the live dataset, and no remote media.

Then TypeScript, focused ESLint/Prettier and diff/whitespace checks. Native/API/UI
results are local evidence only. Any Staging preflight/deployment/accounts,
membership transitions, media or runtime writes require separate authorization;
do not create permanent fixtures to turn missing coverage into PASS.

## I. Exact likely implementation files (not changed now)

| Proposed file | Small purpose |
|---|---|
| `supabase/migrations/<next>_shop_favorites.sql` (new) | Single relation, indexes, RLS, three narrow RPCs/grants; no B15 rewrite |
| `lib/server/shop-favorites.ts` (new) | Existing JWT context/auth + RPC repository, safe DTO validation |
| `lib/shop-favorites-api.ts` (new) | Existing marketplaceRequest transport and typed responses |
| `pages/api/shop-favorites/[[...segments]].ts` (new) | Strict collection/state/add/remove namespace |
| `hooks/use-shop-favorites.ts` (new) | Shared existing-Jotai atom/hook, actor boundaries, batching and single-flight |
| `components/shops/shop-favorites.tsx` (new) | Approved destination wrapper/split + eligible ShopCard grid, reuse existing primitives |
| `components/shops/shop-card.tsx`, `shop-card-presentation.tsx`, `shop-page.tsx` | Pass existing controlled heart and pending/error wiring; approved real-detail placement |
| `components/listings/home-listings.tsx` | Point existing shop-favorites destination at wrapper; Products still existing Favorites |
| `next.config.js` | Only add shop-favorites API to existing NetworkOnly rule |
| `tests/shop-favorites-b16-db.cjs` / `.sql`, `tests/shop-favorites-b16.cjs`, `tests/shop-favorites-b16.browser.cjs` (new) | Focused native/API/browser coverage above |
| B16 qualification doc (future), task breakdown | Record actual local results, no cloud acceptance claim |

Use local response types inside the API module unless an existing type needs a
minimal extension. No planned edit to Listing favorites, shared PulseHeart,
navigation source, Recommended Demo, historical migrations or `_app.tsx`.
Do not create a new heart component unless the actual approved integration needs
it; an existing component prop is preferable.

## J. Separate local implementation approval required

Approve one local forward migration + authenticated repository/API/state and the
specified tests/documents, and explicitly approve F's UI integration decisions
(Shops/Products/default, canonical-detail heart placement, existing pending/error
treatment, grid/canonical navigation versus backlog Master–Detail). Confirm the
recommended self-save policy. Existing product favorite data/access is retained;
enabling currently hidden live Shop PRODUCT hearts is not bundled into B16.

Only then implement locally. No Staging deployment, account creation, data write,
membership activation, private-image download, payment, Git mutation or B17 is
implied. **B16 PLANNING COMPLETE — IMPLEMENTATION NOT STARTED.**
