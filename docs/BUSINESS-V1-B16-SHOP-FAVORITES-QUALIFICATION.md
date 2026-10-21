# B16 — Shop Favorites local qualification

2026-10-19. **B16 LOCAL IMPLEMENTATION COMPLETE.**

**B16 STAGING NOT DEPLOYED.**
**B16 STAGING RUNTIME ACCEPTANCE NOT PERFORMED.**
**B17 NOT STARTED.**

## Implemented boundary

Shop Favorites saves a Shop UUID, independently of Listing Favorites. Existing
Listing favorite records, APIs, product channel filtering and Resale behavior
remain unchanged. No counters, ranking/events, subscription/payment integration,
notifications, realtime subscription or Shop transaction path were introduced.

The approved UI exceptions are the existing Shop Card heart, a matching heart on
the real Shop Detail title row, and Shops / Products in the existing Shop Favorites
destination (Shops default). Products renders the original `<Favorites channel="shop" />`; this does not enable the Shop product hearts/transactions
which B15 intentionally keeps closed. Demo/prototype favorites stay local.
There is no new Master–Detail layout or navigation redesign.

## Database and authorization

One new, local-only migration:
`supabase/migrations/202610190006_shop_favorites.sql`.

- `public.shop_favorites(user_id, shop_id, created_at)`, composite primary key,
  actual Auth/Shop UUID foreign keys with deletion cascades, Shop lookup and
  per-account newest-first indexes. No expiry-triggered deletion.
- RLS owner/verified-account predicates; no direct table grants for PUBLIC,
  anon, authenticated or service_role. Application operations use the narrow RPCs.
- `marketplace_favorite_shops(jsonb)`: current actor's eligible Shops, bounded
  pagination and stable timestamp/UUID ordering; eligibility filtering precedes
  pagination. Uses the exact B15 public profile whitelist and refresh boundary.
- `marketplace_shop_favorite_states(uuid[])`: at most 100 requested IDs; only
  the current account's relationships, with no unavailable Shop detail fallback.
- `marketplace_set_shop_favorite(uuid, boolean)`: explicit idempotent intent,
  pair advisory lock, unique key, Shop/membership locking in existing B12 order,
  fresh entitlement time after lock waits. Repeat adds preserve `created_at`.
  Removing an owned relationship does not require current Shop eligibility.
- SECURITY DEFINER, empty search_path, authenticated EXECUTE only, verified
  `auth.uid()` authority, no caller-selected account argument or admin client.

Own eligible public Shop saving is allowed. Suspension/expiry preserves the
relationship but removes the Shop from the list; reactivation restores it.
Username changes retain the UUID and return the current canonical username.
Existing B12/B14/B15 functions, grants, history and transaction authorities are not
modified by this migration.

## API and client consistency

`GET /api/shop-favorites?page=1&pageSize=20` lists eligible saved Shops;
`GET /api/shop-favorites?ids=<UUIDs>` batch-reads own states;
`POST /api/shop-favorites/<UUID>` adds and `DELETE` removes.

Existing cookie/JWT authentication, verified Western account validation,
same-origin write guard and request header are reused. Unexpected keys, actor
spoofing, malformed IDs/bodies and invalid pagination are rejected. Public Shop
fields are projected through the existing B15 mapper; errors are sanitized.
Responses are private/no-store, and the existing PWA NetworkOnly rule now covers
this API.

One cache resource per existing Jotai provider is keyed by account and Shop UUID.
Displayed hearts batch reads, share one synchronous mutation gate per Shop, and
show only server-confirmed state. Ambiguous writes re-read state before allowing
another write. Failed reads retain the confirmed state and require Retry.
Account generations/version checks discard stale reads/writes; logout clears the
resource through the existing session-ended event. Focus refresh and saved-list
invalidation use existing patterns, without a new event bus or state library.

PulseHeart gained an optional `confirmOnChange` prop, default false, solely to
defer its existing animation until a controlled value is confirmed. Only the new
real Shop integrations enable it. Existing Listing/demo interaction defaults and
animation implementation remain unchanged. This is a minimal persistence
integration adjustment under the approved UI exception, not a heart redesign.

## Local verification

| Check                                                                                                                      | Actual result / boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node tests/shop-favorites-b16-db.cjs`                                                                                     | PASS on disposable native PostgreSQL: actual migrations, uniqueness/idempotency, persistence across SQL sessions, own eligible Shop, spoof/cross-account/unverified denial, raw-table and EXECUTE restrictions, Plus/Pro/Trial/Grace eligibility, suspension/elapsed expiry/reactivation, real username RPC, cascade, unchanged prior function definitions. Two actual connections prove lock waits for duplicate/opposite intent and fresh expiry after membership-lock contention. |
| `node tests/shop-favorites-b16.cjs`                                                                                        | PASS actual API/repository and client cache with controlled transport: bounds, auth/origin, whitelist, explicit intent, batching, pending-state gate, failure rollback, committed/lost response recovery, uncertain-state retry and late prior-account response exclusion.                                                                                                                                                                                                           |
| `node tests/shop-favorites-b16.browser.cjs`                                                                                | PASS at 390/430/820/1280/1536, normal and reduced motion: actual ShopCard/ShopPage/ShopFavorites/PulseHeart and Listing Favorites; unforced clicks, confirmed state, reload, cross-view consistency, removal, Products channel, failure/Retry, lost response, suspension/reactivation, account switching/login and Resale removal. HTTP/session fixtures are local; this is not cloud persistence acceptance.                                                                        |
| `node tests/market-navigation-hit-targets.browser.cjs`                                                                     | PASS 10/10 against an isolated actual Next app: normal Shop/Resale, Filter/Sort clicks and hit tests; 390px fix preserved, no overflow. Empty offline public data only.                                                                                                                                                                                                                                                                                                              |
| B12/B14/B15 native PostgreSQL regression suites                                                                            | PASS. B14 includes prior historical Order/snapshot and new Shop transaction denial checks. No historical cloud image was downloaded.                                                                                                                                                                                                                                                                                                                                                 |
| `tests/public-shop-b15.cjs`, `tests/public-shop.cjs`, `tests/listing-channel.cjs`, `tests/listing-media-isolation-api.cjs` | PASS public projection, bounded transport, Listing/Resale/channel compatibility and media permissions.                                                                                                                                                                                                                                                                                                                                                                               |
| B15 component browser regression                                                                                           | PASS 10/10 at the same five widths and both motion modes. Only its obsolete no-Shop-heart assertion changes to a positive B16 heart assertion; product transaction prohibitions and Resale assertions remain intact.                                                                                                                                                                                                                                                                 |
| Application TypeScript                                                                                                     | PASS `tsc --noEmit --incremental false`; existing tsconfig excludes generated tests/artifacts.                                                                                                                                                                                                                                                                                                                                                                                       |
| Focused ESLint / Prettier / diff checks                                                                                    | PASS for the B16 source and test set; final check includes the new files and documents.                                                                                                                                                                                                                                                                                                                                                                                              |
| Normal Next production build                                                                                               | PASS in `tests/artifacts/b16-production-build-lqWBUV`, source copy without env files, dummy local-only build configuration and denied outbound network. Original .next/public/sw.js unaffected. Existing hero array-key, CSS start compatibility and Browserslist warnings remain; font optimization was intentionally denied.                                                                                                                                                       |

An initial native rerun was blocked by Windows sandbox `pg_ctl` restricted-token
creation; the identical isolated loopback test passed outside that process sandbox.
Browser harness issues corrected locally included aliasing the same session for
relative imports, process initialization, selectors for actual accessible names,
waiting for the existing heart animation, and retaining Listing removal in the
controlled server fixture. No application behavior or assertion was weakened.

Evidence screenshots: ignored `tests/artifacts/message-payload-qualification/`
`b16-{card,detail,favorites,products}-<width>-<normal|reduced>.png`.
Market hit-test evidence: ignored `tests/artifacts/b15-readonly-runtime-P48hOa/`
`navigation-results.json` and `navigation-<width>-<motion>.png`.
These use isolated fixtures, never real merchant claims.

Known unrelated legacy aggregate browser blockers remain outside B16: the old
PublishedListingCard management selector assumes the former Manage Resale card;
the old shop-surfaces browser harness has a Webpack/Radix loader limitation.
Neither is represented as passing. B16-specific and targeted B15 regressions
exercise the current components instead.

## Exact B16 files

New migration:

- `supabase/migrations/202610190006_shop_favorites.sql`

New application files:

- `lib/shop-favorites-api.ts`
- `lib/server/shop-favorites.ts`
- `pages/api/shop-favorites/[[...segments]].ts`
- `hooks/use-shop-favorites.ts`
- `components/shops/shop-favorites.tsx`

Existing application files (B16 changes only):

- `lib/server/public-shop.ts` — export the existing projection unchanged.
- `components/shops/shop-card-presentation.tsx` — optional disabled/error/confirmed props.
- `components/shops/shop-card.tsx` — shared authenticated heart integration.
- `components/shops/shop-page.tsx` — matching title-row heart and error/retry.
- `components/listings/home-listings.tsx` — existing Shop Favorites destination wrapper.
- `components/react-bits/pulse-heart.tsx` — optional confirmed-animation mode.
- `next.config.js` — add Shop Favorites to existing NetworkOnly API matcher.

New tests:

- `tests/shop-favorites-b16-db.cjs`
- `tests/shop-favorites-b16-db.sql`
- `tests/shop-favorites-b16.cjs`
- `tests/shop-favorites-b16.browser.cjs`

Existing test: `tests/public-shop-b15.browser.cjs` — positive approved Shop heart
assertion, without changing product/Resale constraints.

Documentation: this qualification and `docs/BUSINESS-V1-TASK-BREAKDOWN.md`.
The earlier planning document is preserved as a dated planning record, superseded
by the explicit implementation authorization and this qualification.

## Environment safety and remaining acceptance

Only task-owned temporary native PostgreSQL clusters and offline browser/build
fixtures were used. Native servers stop in finally; the task-owned offline Next
server is stopped after browser tests. Ignored local evidence/build files remain.
No existing data/media cleanup, remote call, Staging write/deployment/account,
Production access, provider/payment/email operation, env/credential edit, Git
mutation or B17 implementation occurred. Unrelated worktree changes are preserved.

Next approval is needed for an explicit Staging read-only prerequisite check,
comparison of the exact B16 migration/table/function dependencies and permissions,
then separate deployment and runtime-test authorization. Deploy only this forward
migration; do not use the Production-linked CLI default. Real authenticated cloud
sessions, live saved-Shop eligibility/media refresh and hosted cache behavior
remain untested. Any future test-data retention/cleanup must honor existing
immutable transaction history; B16 needs no Offers/Orders/payment data.
