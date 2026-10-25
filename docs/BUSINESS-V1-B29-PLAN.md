# Business V1 B29 — Bounded Discovery and Notifications

Status (2026-10-24): **B29 LOCAL DEVELOPMENT COMPLETE — STAGING SCALE ACCEPTANCE DEFERRED TO B30**.

This qualification covers the public Resale feed and bounded Notification reads.
It does not change Shop discovery, recommendation/ranking, Favorites ownership,
historical Order snapshots, Notification producers, outbox delivery or retention.

## Confirmed problem

The real Market SSR read one filtered page, then the browser repeatedly requested
every 100-row Resale page without the active filters. It retained the complete
catalog and applied search, filters, sorting and desktop/mobile pagination in
JavaScript. Database round trips and browser memory therefore grew with the entire
catalog, and the post-hydration result could differ from the validated SSR query.

The existing database already had an effective partial newest index. It had no
matching public Resale price, category-empty-result or substring-search index.
Sorting by either price direction scanned and sorted the eligible catalog.

## Reproducible baseline

`tests/resale-discovery-b29-db.cjs` creates 120,000 mixed rows: published Resale,
Shop, drafts, sold/reserved rows, multiple sellers, categories, conditions, pickup
areas, prices, ties, sparse text and Favorites. Timings below describe one local
isolated PostgreSQL run and are not Staging/Production promises.

| Query                         | Before plan / rows visited / time              | After plan / rows visited / time                  |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| Newest                        | existing index-only scan / 40 / 0.132ms        | unchanged / 40 / 0.143ms                          |
| Price low                     | parallel seq scan + sort / 120,061 / 86.634ms  | `listings_resale_price_low` / 40 / 0.154ms        |
| Price high                    | parallel seq scan + sort / 120,061 / 92.756ms  | `listings_resale_price_high` / 40 / 0.144ms       |
| Category + subcategory        | newest index + filter / 208 / 0.147ms          | category index / 40 / 0.192ms                     |
| Empty category                | parallel seq scan / 120,000 / 220.016ms        | category index / 0 / 0.120ms                      |
| Sparse literal search         | parallel seq scan + sort / 120,061 / 118.343ms | trigram bitmap scan / 213 / 2.701ms               |
| Combined search/filters/price | parallel seq scan + sort / 120,061 / 125.638ms | trigram bitmap candidate scan / 26,696 / 19.341ms |
| Deep newest, offset 50,000    | existing index scan / 50,040 / 17.622ms        | unchanged / 50,040 / 18.832ms                     |
| Favorites                     | newest + Favorites PK / 598 / 0.870ms          | unchanged                                         |

Condition/pickup (423 visited rows), ordinary common search (171) and Favorites
were already efficient for a first page and did not justify extra indexes.

## Implemented query boundary

`20261024012808_resale_discovery_query.sql` adds four narrowly scoped partial
indexes and `marketplace_browse_resale`. The RPC is `SECURITY INVOKER`; direct calls
remain under Listing RLS. Its predicates are fixed to `listing_channel='resale'`,
published, available rows, and the response contains only an ordered UUID page and
exact count. The existing RLS-protected Listing projection still supplies cards,
Seller summaries and image manifests.

The query validates a maximum page size of 100 and uses parameterized values only.
Search normalizes case/outer and repeated whitespace, escapes `%`, `_` and
backslash literally, supports Unicode text, retains the existing ASCII word-boundary
prefix behavior and ranks title exact/prefix/phrase before subcategory, category and
description. Seller identity remains excluded. Filters combine with AND. Newest and
both price sorts finish with `created_at DESC, id ASC`.

The HTTP endpoint remains an array for compatibility. Opt-in `paged=true` adds the
exact `X-Total-Count` header. Market SSR and refresh use 15-row pages. Desktop keeps
the same page controls and scroll return; large page counts render a bounded page
window. Mobile keeps the same sentinel behavior but requests one 15-row page at a
time and deduplicates IDs. Errors remain visible and stop automatic load-more retry.
Search suggestions use a debounced five-row server query instead of an in-memory
catalog.

The isolated correctness run also verifies disjoint adjacent pages under an
unchanged snapshot, deterministic first-page results after an insert and its
deletion, exact totals, literal `%`, `_` and backslash handling, and a Chinese
search term. If a row changes between the ordered-ID RPC and the existing Listing
projection read, the repository returns an explicit retryable conflict instead of
silently shortening the page.

Offset pagination remains because the measured 50,000-row deep read completed with
the existing index and changing to a cursor would break the approved numbered-page
contract. Its scan cost is linear, and cross-request snapshot consistency is not
claimed. Each query has deterministic ties; concurrent inserts/deletes can shift a
later offset page and must be remeasured on real B30 data before reconsidering a
cursor-compatible design.

## Security and compatibility

- Anonymous/authenticated callers receive only rows already allowed by public
  Listing RLS; Shop, draft, unpublished, reserved, pending and sold rows are fixed
  outside the browse predicate.
- Seller management queries and cross-channel Favorites continue through their
  existing repository paths.
- Historical Orders continue reading frozen snapshots; no Order or financial table
  changed.
- The API never accepts Seller or Shop identity for the Resale feed. Invalid channel,
  status, taxonomy, price, sort and pagination inputs fail explicitly.
- Shop Directory and public Shop projections are unchanged.
- No layout, CSS, animation, card, toolbar or navigation design changed.

## Local verification

Passed: the isolated 120,000-row PostgreSQL qualification, the focused B29
repository/API test, Listing channel regression, B05 publication and image
recovery regressions, B15 public Shop regression, B26 default-closed Shop
transaction regression, TypeScript, focused ESLint, Prettier, Node syntax,
`git diff --check`, and the production build. The build retained existing
Browserslist and Autoprefixer warnings.

Three unrelated fixtures remain red and were not broadened into B29 work:
`market-search.cjs` resolves the relative TypeScript `test-pictures` import as a
Node CommonJS module, `marketplace-taxonomy.cjs` omits the meeting location that
was already mandatory at the current Git baseline, and
`marketplace-foundations-api.cjs` only accepts the finalize RPC although the
baseline repository already performs its public-Shop fallback RPC.
The remote-data Market browser suite was not run because B29-A forbids remote
access; responsive and real-data browser acceptance remains in B30.

## B29-B confirmed problem and baseline

The service previously fetched recipient-scoped 50-row pages through
`marketplace_notifications`, then applied Category and Read/Unread filters in
Node.js until it found 51 matches or exhausted the inbox. A 180,000-row recipient
fixture with one matching System event per 1,000 rows required an estimated 1,020
RPC calls to produce the first 51 matches.

The isolated 200,000-row PostgreSQL baseline and optimized plans were:

| Query                  | Before                                           | After                               |
| ---------------------- | ------------------------------------------------ | ----------------------------------- |
| All, first 51          | existing newest index / 102 visited / 0.103ms    | unchanged / 102 / 0.104ms           |
| Sparse System + Unread | existing newest index / 51,051 visited / 8.623ms | category/read index / 102 / 0.246ms |
| Read-only              | existing newest index / 552 visited / 0.141ms    | unchanged / 552 / 0.130ms           |

Times describe one local run and do not predict Staging or Production latency.
The original application algorithm also paid network and RPC overhead for every
50-row source page, which the SQL plan timing does not include.

## B29-B implementation

`20261024052628_notification_filtered_pagination.sql` preserves the original
two-argument RPC and adds the separately named
`marketplace_notifications_filtered`. It derives the actor only from `auth.uid()`,
retains the verified-account and 90-day boundaries, filters before `LIMIT`, reads
51 rows, returns at most 50, and continues by `(created_at DESC, id DESC)`.
`unreadCount` remains the global current-user count regardless of Category or
Status.

The database category function mirrors the current TypeScript precedence exactly,
including all B27 membership, refund, transfer and bank-payout events. Unknown
valid historical events remain visible and fall back to System unless their safe
destination establishes Message, Order or Listing. Two measured indexes cover
Category and Category+Read state. Status-only reads keep the existing newest index;
an additional status index was tested and removed because the planner and measured
work did not justify its write cost.

The RPC is a narrow `SECURITY DEFINER` boundary matching the existing inbox RPC.
It accepts no recipient identity, SQL, column or ordering expression. Four
server-selected filter combinations are planned separately; caller values remain
bound parameters. Default function execution is revoked, and only
`authenticated` can call the filtered RPC. The private category helper is not
client-executable.

`notifications-service.ts` now makes exactly one filtered RPC call per API page.
The public API fields, cursor shape, Notification DTO, enrichment, Provider,
Bell, Realtime, preferences, mutations, email outbox and UI remain unchanged.

## B29-B correctness and compatibility

- Exact 50/51 boundaries, empty/last pages, equal-time UUID ties, category/status
  combinations and global unread count pass.
- Concurrent newer inserts remain before an established cursor; eligible older
  inserts can appear later. Deletes and Read transitions disappear from later
  filtered pages. Cross-request snapshot consistency is not claimed.
- Recipient RLS, anonymous denial, verified-session checks, forged cursor/category/
  status rejection and database-error propagation remain intact.
- Five-width Bell/Provider/feed tests pass at 390, 430, 820, 1280 and 1536px;
  B27 event presentation, reduced motion, preferences, popups, Mark Read, Mark All,
  batch delete and Realtime reconciliation retain their existing behavior.
- No email eligibility, destination whitelist, notification source event, outbox,
  cleanup, Realtime channel or UI file changed.

## B30 acceptance

Deploy the two B29 migrations only after a separate approval and in timestamp
order. On explicit Staging, verify migration/RPC hashes, RLS and grants; compare
`EXPLAIN (ANALYZE, BUFFERS)` on
actual distributions; test common and sparse Unicode/special-character searches;
measure exact-count and deep-offset behavior; exercise concurrent publication,
sale/deletion and page changes; confirm mobile incremental loading, desktop last
page, empty/error recovery, suggestions and all five responsive widths. For
Notifications, verify rare Category+Status plans, one RPC per page, exact 50/51
continuation, global Bell count, account switching, Realtime refresh and existing
90-day retention behavior. No remote operation occurred during B29-A or B29-B.
