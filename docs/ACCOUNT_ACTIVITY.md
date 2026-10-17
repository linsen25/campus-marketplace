# Account Activity

`Your Activity` uses authenticated `GET /api/profile/activity?period=1D|7D|30D`.
The response contains `{ period, points: [{ timestamp, label, views, listings,
sold, overall }] }`; `overall = views + listings + sold`. It is an activity
count, not revenue or conversion. No raw viewers or other users' data are exposed.
Marketplace Trends remains on its separate categories API.

The private `account_activity_events` ledger freezes seller ownership, Listing
origin ID, event kind and server timestamp. It has no Listing foreign key, so
deleting a Listing preserves its history. Account deletion removes that account's
ledger via the profile foreign key. Client roles have no direct ledger access.

Only Marketplace passes `onIntentionalOpen` to the shared expanded card. A click
or keyboard activation creates one command UUID, asynchronously recorded with
at most one transport retry using that same UUID. Closing and reopening creates
another UUID. Layout callbacks, restored previews, reads, hydration and filtering
do not record Views. Recording failure never prevents opening. The database
loads the Listing and excludes its authenticated owner. Anonymous visitors have
no invented identity; an owner browsing while signed out cannot be identified
as the owner. Client intent telemetry is not a bot-proof measurement system.

An AFTER Listing trigger records first publication using immutable `published_at`
and the first future transition to Sold using server time. Both manual Sold and
transaction completion share this trigger. Paid/Accepted alone do not count Sold.

Historical backfill is limited to existing published Listings' `published_at`
and retained authoritative `order_completed` facts. Earlier publication migrations
backfilled old `published_at` values from creation time. Exact old manual Sold
times, old Views and already-deleted Listings' missing publication history cannot
be reconstructed and are not fabricated from `updated_at`.

UTC timestamps are bucketed in America/Toronto. 1D is 24 consecutive real hours:
the current partial hour and 23 preceding hours. Hour labels include UTC offset,
so fall-back repeated hours remain distinct. 7D/30D include the current Toronto
local date and preceding 6/29 local dates, with DST-aware 23/25-hour days. Empty
buckets are returned as zero. Time boundaries come from PostgreSQL, not a browser
clock. The private bucket helper accepts a test anchor; the public RPC does not.

Metric changes redraw only the Activity chart without another fetch. Period
changes retain the existing series and its displayed period until authoritative
new points arrive, then redraw once. Errors retain existing data with Retry.
The panel/controls stay mounted. Navigation replay refreshes Activity and preserves
the shared animation hook's consumed-token and reduced-motion rules. There is no
new Analytics realtime subscription.

Migration: `202610160003_account_activity.sql`, staging only. Local PostgreSQL,
rollback/deployed SQL, API, browser View/replay, and disposable live qualification
are in `tests/account-activity-*` and `tests/profile-chart-replay.browser.cjs`.

## Qualification (2026-10-16)

Applied only to staging `pcaqxezdfxofysghssyo`, after local PostgreSQL and hosted
rollback qualification. Migration SHA-256:
`d6d5b997c19941c6a713fecc09aca2d8df1d3e47f6fd14be7c6c782ff17d1219`.
Deployed migration source is checked byte-for-byte against the local file.

Passed:

- Local PostgreSQL migration/ledger, anonymous/authenticated View idempotency,
  owner exclusion, publication once, Sold once, deleted-source retention, private
  grants, own-account aggregates, explicit zeros, Toronto DST and bucket counts.
- Activity/View API validation, methods, own-account restriction, CSRF,
  staging guards, sanitized errors and private/no-store responses.
- Actual Listing component offline View tests at 390/430/820/1280/1536:
  immediate click/keyboard opening with held recording, deliberate reopening,
  lost-ack retry with the same ID, owner/restoration/rerender/resize exclusions.
- Activity browser tests at all five widths: contained initial loading, error
  recovery, zero series, old chart retained during period requests, stale responses
  ignored, controls/panel identity retained, 260px geometry, no overflow.
- Updated actual-app chart replay tests at all five widths: navigation entry,
  repeated entry, local metric replay, held period replay after resolution only,
  error/retry, zero data, no duplicate request for the same period, Trends isolation,
  resize/responsive-remount exclusions and reduced motion.
- Marketplace shared-layout/scroll-lock restoration regression at all five widths.
- Marketplace breadcrumb/filter/search/tab tests at all five widths, asserting no
  View writes from hydration or these non-open interactions.
- Listing builder validation and existing Marketplace Trends API regression.
- Focused ESLint and `git diff --check`.
- Application TypeScript with the existing ignored historical checkout excluded.
  Default full `tsc --noEmit` remains blocked by the previously present
  `tests/artifacts/checkpoint-head-baseline/components/listings/market-layout.tsx`
  calling the current DiscoverButton with its obsolete prop contract.

Hosted disposable qualification verified two real anonymous Marketplace opens,
same-command retry without another event, owner rejection, exact Activity API
buckets, manual Sold, and authoritative Agreement -> Paid -> Handoff -> Protection
-> Completed/Sold. Paid alone counted zero Sold; repeated completion counted once.
All synthetic users, Listings, Offers, Orders, analytics, notifications and public/
private media were cleaned. Original canonical/manual transaction/media fingerprints
were unchanged. The exact fixture journal was removed after successful cleanup.

No production access, environment edits, commit or push.

## Files in this implementation

- `components/home/profile-analytics.tsx`
- `components/home/profile-chart-animation.ts`
- `components/listings/market-layout.tsx` (intentional-open wiring only in this pass)
- `components/listings/published-listing-card.tsx`
- `components/velora/expandable-card.tsx`
- `lib/account-activity.ts`
- `lib/record-marketplace-view.ts`
- `pages/api/profile/activity.ts`
- `pages/api/listings/view.ts`
- `supabase/migrations/202610160003_account_activity.sql`
- `tests/account-activity-api.cjs`
- `tests/account-activity-db.cjs`
- `tests/account-activity-staging.cjs`
- `tests/account-activity-staging.sql`
- `tests/account-activity-live.cjs`
- `tests/account-activity-views.browser.cjs`
- `tests/account-activity.browser.cjs`
- `tests/profile-chart-replay.browser.cjs`
- `tests/market-breadcrumb.browser.cjs` (non-open View exclusion assertion)
- `docs/ACCOUNT_ACTIVITY.md`

Earlier uncommitted Notifications/breadcrumb changes are retained separately.
