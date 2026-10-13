# V2-C1 private Order snapshot media foundation

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


2026-10-12: **COMPLETE / HOSTED STAGING QUALIFIED** on
`western-marketplace-staging` (`pcaqxezdfxofysghssyo`). The running real main
application at localhost:3000 returned 200 with staging configuration and no
production reference. No production access, emails, frontend deployment, commit
or push occurred. Production `.env.local` was not read or changed.

## Applied scope and authority

Only `202610120003_order_snapshot_media.sql` was applied, exactly once, at
`2026-10-12T19:22:13.192Z`. SHA-256:
`84ed02dde708f077533907a1cd8019ea122e0bb2322af5db4611b49dab909dbf`.
A staging rollback dry-run first confirmed it was the sole pending migration.
The already-applied A1/A2/B migration hashes remain unchanged.

`listing-images` remains public; `chat-images` remains private. Current Listing
uploads use unique paths and no upsert; normal users cannot overwrite source
bytes. Existing public-image cleanup remains available. C1 does not make old
public URLs private or revoke bytes previously downloaded/cached.

The new `order-snapshot-media` bucket is private. Restrictive Storage policies
deny normal client SELECT/INSERT/UPDATE/DELETE for this bucket. Existing bucket
behavior is preserved. Only trusted backend Storage operations can copy/delete
objects. Service credentials stay server-only.

Private RLS tables have no direct client mutation grants:

- `order_media_batches`: exact Offer/Listing/actor/material context, source
  manifest, 24-hour expiry, state, optional bound Order, deletion lease.
- `order_media_commands`: actor/command idempotency journal pointing to a batch.
- `order_media_assets`: immutable source identity, destination identity, ordered
  slot and verified MIME/byte size/SHA-256 receipt.
- `order_snapshot_media`: immutable Order-to-asset ownership and ordered slots.

Preparation, receipt verification and cleanup RPCs are service-role-only.
`bind_order_media` is a private DB helper without a client/service-role execution
grant, for use inside a future guarded Accept transaction. Participant read RPC
uses real `auth.uid()` and verified account checks against the Order's Buyer and
Seller. No preview perspective is involved.

## Prepare, copy, verify and bind

`lib/server/order-snapshot-media.ts` fails closed unless APP_ENV is staging and
the URL resolves exactly to the staging project. Existing privileged-client
validation also checks key role/project. Its preparation helper takes the real
session client, verifies the actor, then calls trusted preparation.

The database derives the ready source-image manifest; callers cannot supply
source/destination paths. A batch and all asset identities exist **before**
external uploads. Each destination is `batch UUID/asset UUID`; new preparations
never recycle keys. Uploads use `upsert: false`. Retry reconciles an existing
object by downloading and verifying it rather than overwriting it.

The backend downloads actual source bytes, validates supported JPEG/PNG/WebP
signature/MIME and the 3 MiB limit, hashes the bytes, copies them, then downloads
the destination and compares SHA-256, size and MIME. The trusted receipt RPC also
checks destination Storage metadata. Paths alone are not integrity proof. A
batch becomes prepared only after every authoritative manifest slot is verified.
Same-command retries and same-context preparations reuse the batch safely;
partial failures cannot bind and remain tracked for retry/cleanup.

The material fingerprint covers seller, title, description, category,
subcategory, condition and the ordered ready-image ID/path/slot set. Asking price
is excluded. There is no included-items field in the current schema. Binding
rechecks this material fingerprint, exact Offer/Listing/participant/Order
relationship, complete verified manifest and Storage object existence under
locks. Same-Order bind replay is idempotent; another Order cannot take the assets.
Binding creates references and bound state in one DB transaction without Storage
I/O. No bound asset is released because its Order becomes terminal.

This is preparation-time context, **not an invented Offer-time baseline**.
Future full V2-C must implement the approved Offer baseline and complete Accept
authority/winner protocol. C1 does not implement user-flow V2 Accept or create
V2 Orders through the application.

## Orphan cleanup and recovery

Preparing/prepared unbound batches expire after 24 hours. Cleanup obtains an
exclusive UUID lease for two minutes and moves the batch to `delete_claimed`.
That state cannot return to prepared or bind. Execution rechecks the current
lease and absence of Order references before deleting exact known paths.
Finalization checks object absence and the lease again. Failed deletes retain
tracking; expired leases can be reclaimed after a worker crash.

Deleted tombstones retain every destination path, permitting reconciliation of
late uploads from an interrupted process. Candidates include expired batches,
expired claims and deleted tombstones due for an hourly recheck. Bound batches
are never cleanup candidates, including Cancelled/Expired/Completed Orders.

`sweepOrderSnapshotMedia()` is the reusable trusted worker entry point. A trusted
periodic orchestration must invoke it; C1 does not deploy a scheduler/cron or
expose a client cleanup endpoint. No untracked upload path is permitted.

Participant signing uses a real session plus the participant RPC and returns
ordered short-lived presentation URLs (300 seconds), without exposing privileged
credentials or accepting arbitrary paths. No public C1 UI/API route is added;
these server helpers are available for future integration.

## Hosted qualification evidence

Actual staging tests used three confirmed synthetic users, their independent
authenticated clients, synthetic Listing/Offer/conversation records, valid local
JPEG/PNG bytes, real Storage upload/download and SHA-256 comparisons. No Auth
email was sent. Isolated bound-Order test scaffolding used the existing schema;
it is not evidence of full V2 Order creation. Scoped trigger bypasses in this
test scaffolding were restored in the same transaction, with deferred FK checks
completed first; no canonical/manual record was modified.

Passed:

- Source overwrite denial; private destination direct read/write/update/delete
  denial; outsider signing denial; forged actor/source-context rejection.
- Three-image byte integrity, authoritative completeness, idempotent retry and
  partial second-copy failure followed by recovery without new destination keys.
- Incomplete-batch bind rejection, stale-material bind rejection and expired
  never-uploaded/preparing cleanup.
- Buyer and Seller authorized signed reads; outsider denied.
- Live A-to-B replacement with public A deleted and private A' retained. The
  supplementary case atomically swapped a complete three-image A gallery for a
  complete three-image B gallery, then verified independent source cleanup.
  This was scoped synthetic metadata setup, not a new published-photo editor.
- Bound and representative terminal-Order retention, crashed cleanup lease
  recovery, injected Storage deletion failure/recovery and late-upload tombstone
  reconciliation.

Four truly overlapping independent database transaction cases passed:

| Race | First lock holder | Result |
| --- | --- | --- |
| Bind vs cleanup | Bind | Bound references and private bytes retained; cleanup denied |
| Bind vs cleanup | Cleanup claim | Bind rejected; unbound bytes cleaned |
| Bind vs Listing material edit | Bind | Bound A' retained despite subsequent live edit |
| Bind vs Listing material edit | Edit | Stale bind rejected; no bound references created |

Each first transaction held its authoritative lock during `pg_sleep(40)`. A
separate process/DB transaction issued the competing operation. The test observed
`pg_stat_activity` lock waits and `pg_blocking_pids` before releasing/awaiting the
transactions, proving overlap rather than sequential calls. No generic retry
masked a failure: **0 deadlocks, 0 lock timeouts, 0 invariant failures**.

All synthetic Auth users, Listing/Offer/Order/event rows, private media records,
command journals and uploaded objects were removed. Canonical fingerprints
matched before/after for eight tables: 4 Requests, 3 Orders, 14 events, 6 Listings,
7 Listing images, 0 Offer commands, 9 Order commands and 1 financial capability.
The existing Accepted Nike Request / Expired Nike Order remains unchanged.

## Local validation and reusable commands

TypeScript and focused ESLint passed. Twenty-one local suites passed covering C1,
Listing/domain/API/session/taxonomy, Request/Accept, cancellation/Orders, Payment
UI/Progress, Offer mutations/terms/API and TEXT/IMAGE/Realtime regressions.
The additional PGlite-based `marketplace-security.cjs` could not run because its
separately provisioned `@electric-sql/pglite` module was absent; it is not counted
as passing. Hosted C1 security tests passed. No dependencies were installed or
changed for C1. The pre-existing global `GlideSelect.jsx` parser debt is unchanged.

Reusable staging-only commands (each validates exact project/environment):

```text
node tests/order-snapshot-media-staging-admin.cjs inspect
node tests/order-snapshot-media-staging.cjs
node tests/order-snapshot-media-staging.cjs supplement
node tests/order-snapshot-media-staging-admin.cjs verify
node tests/order-snapshot-media.cjs
npx.cmd --no-install tsc --noEmit
npx.cmd --no-install eslint lib/server/order-snapshot-media.ts
```

`inspect` captures a local ignored baseline; do not recapture it during fixtures.
`dry-run`/`apply` are pre-application modes, not rerun commands. `recover` removes
only this harness's exact synthetic marker/identities if qualification is
interrupted. Credential material stays in memory; local reports/SQL scratch are
Git-ignored and removed after recording qualification. Documentation links,
sensitive-value audit, clean index and `git diff --check` passed.

## Scope boundary

No full V2 Accept, Listing Pending/winner, competing-offer closure, payment,
On Campus/Delivery fulfillment, timers or Notifications were implemented. Public
V1 Listing and chat architecture is unchanged. Production is untouched. C1
unblocks media retention only; full V2-C requires a subsequent explicit task.
The required stable checkpoint before V2-G remains in force.

V2-C MEDIA RETENTION FOUNDATION COMPLETE.

V2-C ACCEPT / LISTING WINNER IMPLEMENTATION MAY RESUME.
