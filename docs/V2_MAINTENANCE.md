# V2 staging maintenance

Only `western-marketplace-staging` / `pcaqxezdfxofysghssyo` is permitted.
Use the ignored `.env.staging.local`; do not edit production `.env.local`.
Supabase CLI login and staging database access must already be available.

Run the repeatable hosted synthetic smoke:

```sh
npm run test:v2:staging
```

It creates fresh confirmed synthetic users without sending email, uploads private
snapshot media, verifies Offers/withdrawal/economics, overlapping independent
Confirm transactions and Cancelled/Expired/Completed Agreements, then cleans its
exact UUID graph and checks retained fingerprints. Run it twice to verify
independence. Never run simultaneous smoke processes: an existing fixture journal
blocks startup. Failed qualification keeps an ignored exact cleanup journal;
inspect it before using `node tests/order-meetup-fixtures.cjs recover`. Never
recover an unrelated/ambiguous journal. The protected existing D1 chain is not
part of a new smoke run.

Inspect canonical Demo transactions (default is read-only):

```sh
npm run demo:reset:v2:staging
npm run demo:reset:v2:staging -- --listing <approved-listing-uuid>
```

Apply a reviewed disposable scope explicitly, copying the plan SHA and specifying
**every** Offer UUID from that scope:

```sh
npm run demo:reset:v2:staging -- --listing <approved-listing-uuid> --apply --plan-sha <dry-run-sha> --offer <offer-uuid> --offer <another-offer-uuid>
```

No transactions means zero writes even with `--apply`. Only five explicitly
allowlisted Demo Listings and the four known Demo identities qualify. Nike and
the existing D1 Listing are permanently excluded; all V1, unknown ownership,
external inventory/history references and protected IDs block the operation.
Never designate manual/historical Offer UUIDs as disposable. Register additional
protected history in `scripts/canonical-demo-allowlist.cjs` before resetting a
Listing that acquires such history. Names and creation times grant no authority.

Pause manual testing during an applied reset. Snapshot cleanup is recoverable,
not a single atomic Storage/database transaction: exact bindings detach first;
existing lease/manifest/verified-deletion RPCs remove only those snapshots; a
locked, rechecked transaction removes the remaining graph. Failures retain an
ignored reset journal and stop; inspect/reconcile it before restarting. No global
Storage sweep runs. Listings, live images, Favorites, ordinary Messages, users,
financial capabilities and unrelated Notifications are retained.

Local guards: `node tests/v2-maintenance.cjs`. Hosted zero-write proof:
`node tests/v2-reset-dry-run-staging.cjs`.

Production, providers, Maps and product behavior are outside these tools.

## Qualification (2026-10-13)

Offer/Agreement checkpoint: `20b528c2253cab160e8dd515b05574f47de7d801`,
`feat: complete v2 offer and agreement flow` (67 files; no push). Maintenance
tools and these documentation updates remain separate, uncommitted work.

- Final smoke passed twice independently, including Buyer Revise, recipient
  Deny, withdrawal boundaries/tombstones and both Confirm winner directions.
  Four observed overlapping Confirm races produced one Order each, with no
  deadlocks or lock timeouts. Cancelled/Expired and full Completed/Sold flows
  passed; new Orders freeze 1% item-only fees, zero minimum, CA$5 cap, zero Seller fee.
- Applied reset engine passed against fresh test-injected UUIDs only, including
  Accepted/Replaced history, real bound snapshots and SQL-like free-text notes.
  Checked-in canonical allowlist was never overridden by the CLI or modified.
- Default canonical dry-run changed zero rows across 40 public/private tables;
  quotes, backslashes and dollar delimiters also passed a read-only SQL round trip.
  All disposable qualification fixtures were removed; protected history and
  `.env.local` remained unchanged. No actual canonical reset was needed/applied.
- TypeScript, focused ESLint, local Auth/Request/Orders/Messages/Realtime/financial
  regressions, optimized staging-configured build, 17 deployed migration hashes,
  browser secret scan, documentation links and diff checks passed.

Existing global `GlideSelect.jsx` lint parser debt is unchanged; full global lint
is not claimed passed. Supabase CLI access initialization can fail transiently;
one interrupted smoke was explicitly recovered/requalified, not counted as a
pass or hidden behind a domain/deadlock retry. Applied reset failures retain a
journal because database and Storage cleanup are not one atomic transaction.
