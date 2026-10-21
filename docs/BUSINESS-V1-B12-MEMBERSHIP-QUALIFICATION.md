# B12 — local membership authority qualification

2026-10-19. **Local backend implementation and isolated validation only.**
Authority: B10 v1.0, the B12 design, and the user's final previously-paid Trial
decision. No UI, external provider, remote deployment or managed acceptance.

## Architecture and actual files

New files:

- `supabase/migrations/202610190003_shop_membership_authority.sql`
- `types/shop-membership.ts`
- `lib/server/shop-membership-repository.ts`
- `pages/api/shop/membership.ts`
- `pages/api/shop/trial.ts`
- `tests/shop-membership-b12.cjs`
- `tests/shop-membership-b12-db.cjs`
- `tests/shop-membership-b12-db.sql`
- This qualification document.

Updated only B12 design policy/status and the relevant task progress document.
Historical migration files, B11 function/repository/API, React, CSS, and other
business modules unchanged by this task. Existing unrelated work preserved.

The migration adds exactly three private tables: account/lifetime Trial and
scheduling facts, coverage terms, immutable command receipts. No mutable
Active/Grace/Suspended/isPro flags. Coverage plus captured database time determines
rights. Timestamp ranges exclude overlap, owner/cycle/ordinal is UNIQUE, and a
partial UNIQUE index permits only one Trial term per account. Trial marker cannot
be cleared/reassigned; account and command history cannot be casually deleted.
Account deletion/retention requires a future explicit policy; no deletion bypass.

Foreign keys bind existing Auth identity, not a new user or cascading Shop identity.
Original Toronto anchor and cycle survive normal renewal; reactivation starts a
new cycle. Fixed CAD prices 199/299 and 499/599, quotas 40/100, and B10 version are
server constants. Paid term base price/boundaries remain frozen on upgrade;
the immutable upgrade command retains pricing evidence and before/after projections.

`btree_gist` is required for range exclusion; the migration creates it in the
existing extensions schema if missing. Existing `extensions.digest` from pgcrypto
provides SHA-256 request digests. Both dependencies passed actual local PostgreSQL;
remote availability/installation privileges remain a later read-only preflight.

## Server interfaces and security

- GET `/api/shop/membership` -> `marketplace_shop_membership()` derives auth.uid;
  verified Western identity, fixed DTO, no owner/time query, private/no-store.
- POST `/api/shop/trial` -> `marketplace_claim_shop_trial(p_action_id)`; same-origin
  custom-header guard, verified Western session, body only `{actionId}`, 1kb limit.
  Existing Shop required, no implicit provisioning. No Trial CTA or frontend wiring.
- Private `shop_entitlements(owner, at)` is the single evaluator. Private
  `shop_membership_command(owner, action, action_id, value, at)` implements domain
  transitions, but is executable only by its trusted database owner. No paid RPC
  grant to authenticated/service_role, no paid HTTP route or provider adapter.
- Public wrappers are SECURITY DEFINER with empty search_path and qualified
  dependencies, authenticated-only EXECUTE. Private helpers are not publicly
  executable. All three tables have RLS and no direct app-role table grants.
- Trial never accepts tier/expiry/owner/time. The wrapper supplies database time
  after the account lock; the internal explicit clock parameter is accessible only
  to trusted SQL and used in isolated deterministic tests. No user-configurable
  clock or environment shortcut is installed.
- Action/digest receipt handles same-request retry; proof UNIQUE handles the same
  paid fact under different request UUIDs. A mismatched request conflicts. Account
  locks serialize same-owner changes, with a proof lock for cross-owner collisions.
  Duplicate/stale paid requests do not double-grant; stale revisions retain a
  reconciliation-required receipt. No fake refund or extra funded period.
- Public Trial retry recomputes current rights rather than returning expired
  entitlement values from an old receipt. The stored original receipt is immutable.

## Real isolated PostgreSQL results

`node tests/shop-membership-b12-db.cjs`: PASS. Native PostgreSQL, explicit random
127.0.0.1 port, existing test bootstrap, actual new migration and current schema.
No Supabase CLI, env files, remote connection or active external scheduler/transport.
Servers stop in finally; scratch artifacts are retained, not user-data cleanup.

| Qualification group | Actual local evidence |
|---|---|
| Identity/eligibility | Owned Shop required; Shop existence alone gives no membership; public wrapper derives current actor; absent/unverified/non-Western rejected; private reads/writes and paid operations denied to app roles |
| Trial | First claim, exact response-loss retry, different UUID repeat rejection, irreversible lifetime marker and one-term index; Shop recreation does not reset usage |
| Previously paid | Active and full paid Grace block claim; unused Trial becomes eligible at Suspended; authorized recurring consent and unresolved renewal block it independently; resolution/cancellation preserve covered rights |
| Time/quotas | Two calendar-month Pro Trial; Plus40/Pro100; exact expiry -> Grace, full prior rights until 120 elapsed hours, then denied without cron; DST Grace uses elapsed seconds |
| Calendar | January31 -> February28 -> March31, leap February29, Toronto spring gap -> first valid03:00, autumn overlap -> earlier instant; different session timezone produces same instant |
| Paid lifecycle | Both modes/prices, advance renewal, adjoining funded periods, Grace original anchor and cross-plan immediate tier, exact Grace end starts a new cycle, reactivation preserves the Shop |
| Plan changes | Half-up 155-cent proration, original end/base price retained, trusted minimum-based waiver; missing waiver minimum rejected; scheduled downgrade preserves current/funded rights; mode/consent changes create no term/charge |
| Integrity | Same payment under another UUID has one effect; altered payload conflicts; rollback removes marker/term/receipt atomically; overlapping period insertion rejected; wrong-cycle and unauthorized/incorrect-amount paths denied |
| Native races | Second connection observed waiting on a PostgreSQL Lock: competing first Trial claims, renewal versus upgrade, unresolved renewal versus Trial after paid suspension and consent cancellation, duplicate upgrade, and renewal versus Trial at exact Grace expiry |
| Concurrent reads | Separate reader sees no uncommitted Trial; after commit canonical coverage/receipt is present, no partial marker/term visibility |
| Existing authority | All pre-existing public/private function definitions and policies unchanged; existing Shop data unchanged by migration; Pro owner still rejected by existing Shop finalize; no Offers/Orders created by membership operations |

Public wrappers are additionally exercised under real authenticated PostgreSQL
roles; deterministic historical/future domain transitions use privileged test
fixtures only. These are not real managed Auth/PostgREST/provider acceptance.

## Regression and static validation

PASS:

- `node tests/shop-membership-b12.cjs`: actual API/repository/guards, mocked transport;
  current Auth/actor, strict fields/UUID, forged owner/tier/time rejection, query and
  cross-origin rejection, fixed allowlist, 400/401/403/405/409/503 safe responses.
- `node tests/shop-provisioning-b11-db.cjs`: existing native provisioning, uniqueness,
  observed races, owner permissions, GET/PATCH SQL, unchanged data/ACL/constraints.
- `node tests/shop-profile.cjs`: existing GET/PATCH/POST and failure/retry API tests.
- `node tests/shop-presentation.cjs`, `node tests/public-shop.cjs`: existing identity
  presentation contract and fail-closed public source; no UI changes.
- `node tests/transactions-b09-db.cjs`: existing native external/UU transaction,
  handoff/Protection authorization and six observed lock races; no scheduler invoked.
- `node tests/transactions-b09-static.cjs`, `node tests/order-financial.cjs`.
- Application TypeScript `--noEmit --incremental false`, focused ESLint and Prettier
  on the six new TS/JS source/test files, `git diff --check`; explicit new-file
  UTF-8/trailing-whitespace checks include the SQL and documentation.

During development, local tests caught a new SQL variable reference error, invalid
Listing test-fixture fields, and TS/lint issues; these were fixed within new B12
files. The first sandboxed native launch failed on Windows pg_ctl token creation;
the authorized loopback test then ran with process permission. No test was skipped
or weakened, and no production code/import workaround or remote fallback was used.

## Accurate boundaries and next authorization

- B12 LOCAL IMPLEMENTATION COMPLETE after the recorded local checks.
- B12 STAGING NOT DEPLOYED. No Staging read/write/fixture or managed Auth/API test.
- B12 REAL PAYMENT NOT INTEGRATED. Internal fixtures do not verify any real charge,
  recurring mandate, provider minimum, signed webhook, refund or billing reconciliation.
- No Shop publication, quota transaction, public discovery, recommendation, Analytics,
  Messages/notification/Offer integration or scheduler dispatch enabled. Later tasks
  must consume the evaluator transactionally and preserve existing Order exceptions.
- No UI/CSS/CTA change, existing data deletion/backfill, env/key change, Production,
  real payment/email, Git stage/commit/push/reset/clean or B13 work.

Next step requires separate approval: read-only Staging prerequisite review followed
by approval for this exact migration, with deployment and any temporary runtime
fixtures separately scoped. B11 managed creation acceptance remains deferred.
Do not infer functional cloud acceptance from these native/offline PASS results.
