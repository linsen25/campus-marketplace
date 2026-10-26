# Open Registration Permission Batch

## 2026-10-26 investigation and local fix

`202610260008_verified_account_core_permissions.sql` is a forward-only,
service-free permission migration. It changes only the final definitions and
policies for username confirmation, core messaging, message Realtime topics,
notifications, Shop Favorites, and listing media to use the confirmed-login
predicate `marketplace_private.is_verified_user()`.

Ownership, participant, recipient, path, listing-channel, publication and
resource checks remain unchanged. `is_western_user()` is not modified. Offer,
Order, Shop approval, membership, payment, refund, Transfer and payout paths
are intentionally outside this batch.

The migration still requires isolated PostgreSQL verification before any
remote application. Remote Staging was not modified in this batch.

The dynamic function rewrite now uses an explicit 23-entry `regprocedure`
signature manifest (including expected legacy-predicate counts), fails closed
on a missing or unexpected definition, and raises if any selected function
still contains the old `is_western_user()` predicate after replacement. On Windows, the current
workspace could not start a new disposable PostgreSQL instance because
`pg_ctl` returned restricted-token error 87; SQL/RLS behavior remains
NOT TESTED until a local PostgreSQL, Docker, or WSL test runtime is available.

## Second-batch wiring (local only)

`/api/shop/application` now accepts a same-origin `POST {}` and derives the
actor from the authenticated server session before calling
`marketplace_request_shop_application`. The Shop Profile surface exposes the
request, pending, approved and rejected states without adding browser approval
authority.

UWO Settings now distinguishes loading, unavailable, unverified and verified
states, offers Retry and changing the pending address, and fences stale
responses across account changes and unmounts. It offers both Change UWO email
and Resend verification code; server-side rate limiting remains authoritative.
It still reports only the server's verification result; no mail provider was
configured or contacted.

## Focused acceptance (2026-10-26)

- `tests/verified-account-008-static.cjs`: PASS. All 23 targets are checked by
  schema/name/signature manifest; each historical definition has an explicit
  legacy-predicate count, fixed `search_path`, and no ACL rewrite. Four image
  lifecycle functions intentionally have zero legacy predicate occurrences and
  are documented as explicit no-op manifest targets. Live SQL execution is
  NOT TESTED because the disposable PostgreSQL runtime remains unavailable.
- `tests/shop-profile.cjs`: PASS. The mock now models authoritative approval:
  confirmed-but-unapproved ordinary email receives 403 through the RPC, while
  an approved ordinary confirmed account receives 201. The fixture no longer
  treats a UWO address as Shop approval.
- `tests/shop-application.cjs`: PASS (HTTP/mock contract only). Anonymous,
  unconfirmed, cross-origin and forged fields are rejected; session identity,
  status responses and database approval denial are covered. Database/RLS and
  admin approval remain NOT TESTED.
- `tests/uwo-verification-recovery.cjs`: PASS (HTTP/UI mock contract only) for
  same-origin send/verify, account-scoped requests, Retry, Change/Resend and
  stale-response fencing. Database rate limits, hashed-code behavior and real
  email delivery remain NOT TESTED.
