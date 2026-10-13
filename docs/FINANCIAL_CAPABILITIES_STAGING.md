# Financial capabilities — Phase A staging record

> **CURRENT STAGING V1 / historical implementation reference.**
> The approved [Marketplace V2 product contract](MARKETPLACE_V2_PRODUCT_CONTRACT.md)
> supersedes conflicting future product rules in this document. Current V1 code,
> applied-state records and historical transaction facts remain unchanged.
> V2 implementation has NOT started. Check the V2 contract before further V1
> feature expansion; this notice authorizes no implementation or data operation.

## Phase C - Seller payout gate (2026-10-11)

Target only `western-marketplace-staging` / `pcaqxezdfxofysghssyo` in the real
localhost:3000 app. Migration `202610110001_order_payout_gate.sql` is applied once.
SHA-256: `9d3c8894cfcbe9c0c8a9ad5daa33936c26c5eb3ec7d4e6f8bef64c201b997294`.
Old migrations remain byte-for-byte unchanged. No table/column, readiness snapshot,
backfill, historical Request rewrite or existing Order invalidation.

Updated authority: `marketplace_private.mutate_order_request`,
`public.marketplace_accept_order_request`, and
`public.marketplace_record_financial_capability`. New private helpers
`lock_financial_capability(uuid,text)` and `require_seller_payout_ready(uuid)` have
empty search_path, security-definer execution and no client/service-role EXECUTE.
Public function grants/ownership are retained by CREATE OR REPLACE.

Before Phase C, mutations acquired command-idempotency advisory lock, listing,
conversation, then Request/Order locks. Financial mutation acquired only its row.
Now the order is command lock -> user/capability transaction advisory lock ->
financial row (if present) -> listing -> conversation -> Request/Order. Trusted
financial mutation takes the same capability advisory lock before deleting or
upserting its row, and never takes trading locks. The lock key namespaces UUID
and capability (`marketplace:financial:<UUID>:payout_account`); payment_method has
its own namespace. Absence is serialized too: Unset/delete and absent -> Ready
cannot escape the common lock. Ready rows are additionally selected FOR UPDATE.

Create/Replace and first Accept check authoritative `financial_capabilities`
`payout_account.status=ready` before transaction writes. Cancellation has no gate.
Completed command retries return before the new check, so subsequent readiness
loss cannot retroactively reject the same successful command or destroy its Order.
The stable domain failure is SQLSTATE P0001 / `seller_payout_not_ready`, mapped to
HTTP 409 and safe copy. Unknown errors are sanitized. No institution/last4/provider
references are attached to Request, Order, transaction event, or Buyer error.

Seller Send remains discoverable. On attempt, GET /api/financial-capabilities reads
only the authenticated Seller's safe projection. Unset/Needs attention use the
existing FadingDialog/CardAction/ActionRow and approved copy; their Settings action
opens the existing Payments & payouts section. Ready opens the unchanged editor.
DB recheck also blocks stale editor submissions/replacement. Buyer Active Request
remains visible; its existing Accept confirmation renders the safe domain failure.
No financial realtime stream, broad poll, or client financial authority was added.

Verification commands:

- `node tests/order-payout-gate.cjs`: immutable source hashes, minimal function
  changes, lock/idempotency ordering, API domain mapping and privacy.
- `node tests/order-payout-staging-admin.cjs test`: rollback-only Create/Replace/
  Cancel/Accept matrix, existing Accept suite and Phase A financial security suite.
- `node tests/order-payout-staging-admin.cjs race`: isolated synthetic identities,
  listings and conversations; deterministic two-transaction overlap, observed
  advisory waiting, capability and transaction winners, absent row/Clear, repeated
  Accept/Replace, competing Buyers. Always scopes cleanup and checks canonical
  fingerprints. Never runs Accept on the manual Monitor Request.
- `node tests/order-payout-staging-admin.cjs verify`: migration recorded once,
  unchanged unrelated RPCs/manual fingerprints, financial grants/RLS and zero rows.
- `tests/order-payout.browser.cjs` with existing external Playwright/Chrome:
  independently authenticated Seller B/Buyer A, all four dialog widths, Ready
  editor and Settings navigation. Buyer error transport is intercepted (no actual
  Accept of Monitor); actual RPC rejection/zero-write proof comes from rollback SQL.
  Message-read transport is also intercepted to preserve manual watermarks.

The first race-run's 8-second observation window elapsed before the third overlap
could be observed through CLI startup/inspection. Fixtures were cleaned; no DB
invariant failure/deadlock was observed. The test hold was extended to 25 seconds,
without application retry or lock-code changes. Responsive branch changes initially
returned to the mobile conversation list; the test now selects the same conversation
in that normal navigation branch. These are test synchronization corrections.

Hosted concurrency evidence: all ten overlap scenarios passed (five capability
winners, four repeated transaction winners, competing Buyers). The competing
case was additionally rerun with strict P0001 assertions: both Requests Active,
zero Orders/Order events and available inventory, excluding deadlock/timeout as
an apparent denial. Synthetic fixture cleanup completed after both race runs;
race-scope file is removed and canonical fingerprints/zero financial rows verified.
Create/Replace successful-key retries after readiness loss also passed in the
post-apply rollback matrix. All five affected/new functions were verified with
postgres ownership, security-definer execution, empty search_path and exact
anonymous/authenticated/service_role EXECUTE grants.

Final validation: TypeScript and focused ESLint passed. Financial API/environment,
Request API/static, Accept static/hosted rollback, Auth/session, Orders qualification/
interaction/workspace and TEXT/IMAGE/Realtime API/client/migration regressions passed.
Seller blocking dialogs at 390/430/1280/1536, Ready editor, Settings navigation and
Buyer safe-error rendering passed in independent real staging sessions; no runtime
errors. Phase B actual Settings controls, refresh/Overview persistence, identity
isolation, skeleton/background-error/Retry passed at all four widths with zero
runtime errors/rejections, followed by restoration. Hosted authority ownership,
empty search_path, exact grants, RLS/policies, schema metadata and unrelated RPCs
were verified. Canonical fingerprints match preflight and financial table is empty.
The new migration hash was rechecked. Eligible-file configured-secret/demo-password/
privileged-JWT scan, local environment/artifact exclusions, focused documentation
links/anchors and git diff --check passed; Git index is empty. The wider working tree
contains earlier uncommitted work, which this Phase C pass does not commit or reset.

The preserved Monitor Active Request is `88260b5b-0851-4bf2-a100-8a5c11edd8c9`.
All canonical demo capabilities are restored to Unset; do not automatically Accept,
Replace or Cancel that Request. Historical Phase A/B statements about Phase C below
are superseded by this section. No payment/payout lifecycle, Pay/success simulation,
provider integration, handoff/protection/refund engine is included. The five known
unrelated UI issues (Seller Payment panel, shared Stepper, Accept modal surface,
stale eligibility after accepted/refetch failure, Homepage financial copy) are
unchanged. No production access, email, commit or push.

## Phase B ? Settings integration (2026-10-11)

Implemented in the real localhost:3000 staging app. `ProfileOverview` now embeds
`FinancialSettings`: Settings contains Payments & payouts with independent Payment
method / Payout account rows; Overview contains statuses only and uses existing
section navigation to Settings. Existing profile rows, buttons, typography and
Skeleton/StatefulButton patterns are reused. Mobile financial rows have scoped
spacing to keep labels and masked metadata readable. No new sidebar destination.

`useFinancialCapabilities` reads the real safe API, scopes cached presentation to
the authenticated user, invalidates stale responses on identity/unmount/logout,
and refetches on focus or successful capability mutation. Initial load displays
skeleton badges rather than Unset; background fetch retains data; errors expose
Retry. No local authoritative financial state or artificial wait.

The clearly separate STAGING ONLY controls simulate Set/Ready/Needs attention or
Clear. Frontend visibility requires both staging designation and exact staging
URL. `POST /api/financial-capabilities/test-state` additionally enforces the existing
exact-ref/public-key environment guard, cookie-authenticated verified user,
same-origin/custom-header write protection, allowed capability/status pair and
exact staging service-role key. Production/mismatched configuration refuses before
network access. Query/body userId and all provider metadata are ignored.

The endpoint invokes the Phase A trusted mutation boundary only for the current
user. Fixed marker `provider_key=staging_test`, opaque `staging_test_*` references,
`Test Card`/last4 `4242` and `Test Bank`/last4 `6789` distinguish fixtures from future
real provider accounts. No schema change or new migration. Future real adapters
must never use the reserved staging_test marker. These controls are not real
onboarding and no normal Set up/Manage-provider button has been added.

Validation:

- Four real demo accounts were Unset/Unset before controlled mutations.
- Buyer A tested through actual Settings controls: Payment Set, Payout Ready,
  both Needs attention, Clear; safe read and refresh persistence; Overview status
  synchronization. Seller A remained Unset/Unset, including identity/reference
  injection attempts. Helpers' Set/Ready predicates and clear behavior passed.
- 390/430/1280/1536 Settings and Overview: no overflow, readable statuses/masked
  metadata, separate test section, mobile navigation retained. Ignored screenshots
  inspected at mobile and desktop. Browser recorded zero runtime errors/rejections.
- Initial skeleton/no premature Unset; background-error content retention; Retry
  recovery tested with controlled read transport. Semantic buttons/status text
  preserve existing reduced-motion patterns. Real keyboard Tab focus and visible
  focus outline passed. An additional keyboard probe initially timed out during
  localhost navigation; rerunning with a suitable dev navigation timeout passed,
  with no application changes or extra capability mutation.
- API tests cover anonymous rejection, invalid states, CSRF/cross-origin denial,
  identity/reference injection, missing/mismatched privileged configuration and
  production hard block without accessing production. UI rendering tests cover
  all statuses and production/mismatched simulator visibility.
- TypeScript, focused ESLint, Auth/session, Request/Accept/Orders and
  TEXT/IMAGE/Realtime regressions passed. Hosted rollback tests reconfirm direct
  writes denied; original RPC definitions and manual data fingerprints unchanged.
- Buyer A restored to Unset/Unset in finally cleanup; all four demos verified
  Unset/Unset and financial table empty. No test financial rows remain.

Tests: `node tests/financial-settings.cjs`, `node tests/financial-capabilities.cjs`,
`tests/financial-settings.browser.cjs` (existing external Playwright/Chrome and
ignored demo credentials). The browser flow always restores controlled account
capabilities and does not enter transaction workspaces.

Phase C Seller payout gate remains NOT IMPLEMENTED. No Order payment state,
Buyer/Seller Payment tab changes, payment simulator, provider SDK, money movement
or fixes to the five known bugs. Manual Active Request untouched; production and
production .env.local untouched; no emails, commit or push.

The Phase A record below describes the earlier infrastructure-only delivery.

Implemented on 2026-10-10. Scope: account capability infrastructure only.
Authoritative product rules: [Payment/Payout contract](ORDER_PAYMENT_PRODUCT_DESIGN.md).

## Environment and migration

Only `western-marketplace-staging` / `pcaqxezdfxofysghssyo` was inspected and changed.
The real `localhost:3000` application was verified to use staging before real
cookie-session tests. Production `.env.local` was not modified and production was
not accessed. No commit or push.

Migration: `202610100003_financial_capabilities.sql`.
SHA-256: `ad437a1b2f40324c2bae4932dfc444027d525b757216352bbc694970ff921e6f`.
It was executed with all security tests in a rollback transaction first, then only
this migration was applied and recorded exactly once. Existing migrations are
unchanged. Staging preflight found no existing financial account schema or
conflicting migration. Ignored artifacts contain preflight, checksum and apply
manifest; they contain no new credentials and are not commit candidates.

## Persisted model

One private `marketplace_private.financial_capabilities` table with composite
primary key `(user_id, capability)`. This matches existing private data / guarded
RPC conventions and avoids duplicated payment/payout lifecycle machinery. Each
account has at most one `payment_method` and one `payout_account`; they are
independent rows, not a shared readiness flag.

Persisted payment statuses: `set`, `needs_attention`.
Persisted payout statuses: `ready`, `needs_attention`.
Absence of the respective row derives `unset`. No backfill and no demo readiness.

`user_id` references `public.profiles(id) ON DELETE CASCADE`, following the
profile-to-Auth ownership lifecycle and preserving existing deletion guards.
Other constraints validate capability/status combinations, lowercase generic
provider keys, trimmed/nonempty opaque references of at most 255 characters,
optional trimmed display label of 1–80 characters without control characters or
long digit strings, and optional last4 containing exactly four digits.
Created/updated timestamps are server-assigned; updating one capability leaves
the other unchanged.

No full card numbers, CVV/CVC, raw bank account/transit numbers, login credentials,
provider secrets or unrestricted financial metadata JSON are stored. The future
adapter owns tokenization and must pass only opaque references and safe display
metadata. Opaque references remain private and never enter the safe projection.

## Authorization and API

RLS is enabled. There are no direct table grants or policies for public, anon,
authenticated or service_role. Table access is denied even to the owning browser
user. SECURITY DEFINER functions use empty `search_path` and qualified references.

`marketplace_financial_capabilities()` is the only authenticated read RPC. It has
no userId parameter and checks `auth.uid()` plus authoritative verified Western
Auth state before projecting that user's data. Anon has no execution privilege.
No browser-accessible write or arbitrary-user read RPC exists.

`GET /api/financial-capabilities` uses existing SSR cookie/session authentication,
ignores query/body identity fields, and returns private `no-store` JSON. Other
methods return 405. Anonymous reads return 401. No UI consumes this endpoint yet.
The endpoint is explicitly included in the existing PWA NetworkOnly API rule.

```json
{
  "paymentMethod": { "status": "unset", "brand": null, "last4": null },
  "payoutAccount": { "status": "unset", "institution": null, "last4": null }
}
```

The server repeats the field allowlist rather than forwarding raw RPC data.
Errors are sanitized; provider references and upstream diagnostics are not returned.

## Trusted server contract

`lib/server/financial-capabilities-service.ts` provides own-session read plus
`getFinancialCapabilities(userId)`, `hasUsablePaymentMethod(userId)` and
`isPayoutReady(userId)`. Arbitrary-user helpers require an exact staging service-role
configuration. Missing, mismatched or production configurations fail closed before
network access. The module is not imported by components or hooks.

`recordFinancialCapability` wraps
`marketplace_record_financial_capability`; only service_role can execute the
mutation RPC. Its generic adapter input records Set/Ready/Needs attention, or
clears one capability with Unset and null metadata. Database constraints validate
every update and the upsert maintains the V1 uniqueness invariant. The trusted
arbitrary-user read RPC is also service_role-only.

This is a future adapter boundary, not a callback implementation. Future provider
code must authenticate provider evidence before invoking it; holding a browser
session cannot establish financial readiness. No fake provider, public setup/write
endpoint, callback route or provider SDK was introduced.

## Verification

- Pre-apply and post-apply rollback SQL tests: default projection; anonymous denial;
  direct read/insert/update/delete denial; arbitrary-user read/mutation denial;
  authenticated self-promotion denial; trusted Set/Ready/Needs attention/Clear;
  exact safe projection and cross-user isolation; both duplicate PK failures;
  invalid status/last4/display and orphan ownership rejection; deletion cascade.
- Applied-state review: migration once, RLS/grants/owner, original RPC definitions
  unchanged, canonical profiles/listings/Requests/Orders/events fingerprints
  unchanged, zero persistent financial rows after tests.
- Real independent staging sessions for Buyer A/B and Seller A/B: 200, Unset/Unset,
  exact safe fields, no-store, query identity cannot impersonate. Anonymous: 401.
  No fixture/Order/Request mutations or emails during the session checks.
- Local API tests: auth, GET-only, query/body impersonation, safe response
  allowlist, sanitized errors, trusted helper predicates/clear, exact project guards,
  missing/mismatched service-role key rejection and server-only import scan.
- TypeScript and focused ESLint; Request/Accept static/API and Orders regressions;
  Auth/session and TEXT/IMAGE/Realtime API/client/migration regressions; served
  browser privileged-secret scan; documentation links; `git diff --check`.

Repeat local tests: `node tests/financial-capabilities.cjs`.
Hosted rollback tests: `node tests/financial-capabilities-staging-admin.cjs test`.
Hosted read/permission review: same command with `verify`.
Real-session test: `tests/financial-capabilities.browser.cjs`, using the same
external Playwright/Chrome tooling and ignored demo credentials as existing tests.
Never run these commands against production; the project guards are mandatory.

## Deliberately deferred

No Payment/Settings UI, onboarding, payout-ready Request gate, payment transition,
payment simulator, Order financial lifecycle, cancellation, shipping quotes,
address/tracking/handoff/Protection/issue handling, payout/refund execution or
provider integration. The five documented UI bugs remain separate work. Phase A
does not change any existing Auth/Listings/Messages/Realtime/Request/Accept/Order
semantics or consume the manual Active Request.

## Phase D - Order financial state (2026-10-11)

The [Phase D record](ORDER_FINANCIAL_STATE_STAGING.md) extends the existing Orders
financial fields and adds a service-role-only staging success function. Its API
binds the Buyer to the authenticated session; first payment requires persisted
payment_method=Set, using the same capability advisory lock as capability updates.
Seller payout readiness is a Request/Accept gate, not a second gate after Order
creation. Paid and payout Not eligible remain separate. Shipping pending and
expired Orders cannot become Paid. Earlier deferred lists describe historical
phase scope and are superseded by this entry for Phase D only.

Rollback tests, real independent Buyer/Seller API/refresh reads and both committed
payment-versus-expiry race orders passed. Synthetic fixtures were removed and
canonical capability rows returned to zero. No provider/payment control/payout
execution was added; production and the five known UI bugs remain untouched.
