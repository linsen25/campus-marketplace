# B11: authoritative Shop provisioning — local qualification

2026-10-19. **Local B11 implementation complete; remote deployment/acceptance
NOT AUTHORIZED / NOT EXECUTED.** B12 and UI creation wiring not started.

## A. Exact migration and authority

Created only `supabase/migrations/202610190002_shop_profile_provisioning.sql`, a
forward migration from the explicitly reviewed/approved SQL proposal. Historical
migrations were not changed. It adds `marketplace_create_shop(p_input jsonb)` and
its EXECUTE ACL only, in one transaction. No new table, index, membership field,
backfill, policy, trigger, existing-row update or table INSERT/DELETE grant.

The SECURITY DEFINER RPC has empty search_path and schema-qualified application
references. Owner comes from auth.uid(); existing verified-Western eligibility and
the caller's Profile are checked. A key-share lock protects that Profile against
concurrent removal. Input must be a JSON object containing exactly the three
required string fields name/category/description. It rejects owner/Shop IDs and
all additional authority or timestamp fields. Name/description trim uses the same
Unicode set as the foundation; UTF-16 lengths reuse shop_profile_text_length.
Category must exactly match an existing category. Database ID/timestamps are defaulted.

`ON CONFLICT ON CONSTRAINT shops_owner_id_key DO NOTHING` preserves the existing
atomic unique authority. Missing RETURNING row raises SQLSTATE 23505. There is no
implicit PATCH, deletion/replacement, check-then-insert race or overwrite. Only
authenticated receives EXECUTE; PUBLIC/anon/service_role execute is revoked.
The seven explicit return columns cannot expose later-added private columns.

## B. Files changed

Application:

- `lib/shop-profile.ts`: validateCreateShopProfile requires all three fields,
  rejects extra/non-text fields, trims name/description and reuses shopIdentityError.
  Existing PATCH validator unchanged; creation category remains exact.
- `types/shop.ts`: CreateShopProfileInput Pick type only; OwnerShop unchanged.
- `lib/server/shop-profile-repository.ts`: session-based createOwnShop invokes the
  actual RPC and maps the fixed OwnerShop DTO; creation conflict ->safe409.
  No broad privileged INSERT or service-role client. GET/PATCH retained.
- `pages/api/shop.ts`: POST plus same-origin guard, 201 only for successful result;
  existing 4kb limit, private/no-store, query restriction and safe errors preserved.
  GET/PATCH unchanged; DELETE unsupported; Allow includes GET, POST, PATCH.

Tests:

- `tests/shop-profile.cjs`: retain all previous GET/PATCH/security assertions;
  update only obsolete POST-405 and repository method-shape assumptions, then add
  creation/status/forgery/auth/normalization/response-loss/DTO tests. The offline
  transport deliberately returns an extra isPro field and proves it is not exposed.
- `tests/shop-provisioning-b11-db.cjs`: established native PostgreSQL harness pattern,
  random loopback port, real schema/migration and two independent sessions.
- `tests/shop-provisioning-b11-db.sql`: pre-migration data/ACL/policy/constraint
  snapshots, actual RPC authorization/input/uniqueness/read/update tests,
  rollback/retry, fail-closed public/product and side-effect checks.

Documentation: this report, initial proposal current-status annotation, and B11
task progress. Final B10 contract, PricingCard/UI/CSS and unrelated work unchanged.

## C. API behavior — offline actual handler/repository tests

PASS:

- Valid POST201, exactly seven OwnerShop fields; owner derived from verified session.
- Invalid/missing/null/non-string/extra fields400; exact categories, name/description
  Unicode trim and bounds; forged owner/Shop/tier/state/trial/expiry/metrics rejected.
- No session401; unverified/non-Western403; wrong origin/missing header403;
  query-selected owner400. Invalid/auth failures never call the RPC.
- Existing Shop409 with stable `Shop already exists.`; original Shop unchanged.
- Unavailable/missing RPC or database, including lost response and null result503;
  no SQL/provider diagnostics exposed, no fake successful response.
- Committed response loss: retry409 then GET recovers original Shop identity.
- GET after creation and PATCH on the new profile work; DELETE/PUT405.
- Body limit4kb and no-store retained. Create payload contains only p_input,
  no browser owner or financial fields. No network or actual provider called.

These are actual application modules with mocked transport, not managed database
permission proof; the following separate native tests exercise the real SQL.

## D. Native PostgreSQL permissions, constraints and concurrency

`node tests/shop-provisioning-b11-db.cjs` PASS (exit0; server stopped in finally):

1. Applied actual migration after recording a pre-existing Shop fixture. Shop data,
   Profile data, policies, table ACL, column ACL and every Shop constraint unchanged.
2. SECURITY DEFINER/empty search_path and authenticated-only EXECUTE verified;
   RLS still enabled; direct authenticated INSERT/DELETE remains denied.
3. Actual RPC rejects malformed/unknown/forged input, missing fields, wrong category,
   oversized text, Unicode whitespace-only names and 21 astral emoji; accepts
   20 emoji (40 UTF-16 units), description200 and all four existing categories.
4. Authenticated owner creates exactly one profile and reads only their own row;
   cross-owner SELECT hides rows and UPDATE touches zero rows. Immutable owner/ID
   authority and created_at grants remain restricted. Existing editable fields work.
5. Actual function rejects no identity, unverified and non-Western identity;
   anonymous lacks execute and Shop SELECT. Non-Western fixture was inserted in
   the empty Auth stand-in BEFORE installing backstop triggers, never by disabling
   a trigger or altering a real user. Eligibility rejects it before Profile lookup.
6. Duplicate request cannot overwrite fields/timestamps. One real two-connection
   same-owner race observes the second connection waiting on a PostgreSQL Lock
   before first commit; first succeeds, second fails23505, exactly one Shop exists.
7. Fresh-session retry remains23505; GET row payload exactly matches initial result.
   Two different users also create concurrently and receive distinct owned Shops.
8. A test-owned rolled-back transaction creates no persistent Shop; subsequent
   actual RPC retry succeeds. No history trigger disabled or security bypass.
9. A profile owner with a Shop still cannot finalize a Shop-channel Listing;
   published_at stays null. Anonymous cannot read Shops. Current public getters
   independently retain empty/null sources in offline regression.
10. No extra membership/trial/status/financial columns, Orders, Offers,
    notifications, domain notification events, financial capabilities or Stripe
    setup operations were created by provisioning tests. No auto-activation.

## E. Existing GET/PATCH compatibility

`node tests/shop-profile.cjs` PASS: original current/null reads, partial PATCH
without stale full-object overwrite, validation, field whitelist, owner isolation,
origin/header/session guards and safe errors all retained. POST tests are additive
except expected allowed-method/method-list updates. `shop-presentation.cjs` and
`public-shop.cjs` PASS; no public entitlement inference or fixture activation.

## F. Static validation

PASS application TypeScript (`--noEmit --incremental false`) and focused ESLint
for the four changed application files and the two JS test files. Focused Prettier
checks PASS. `git diff --check` PASS (existing line-ending notices only); explicit
UTF-8/trailing-whitespace checks include all new migration/test/document files.
Final comparison confirms executable migration SQL exactly matches the reviewed
proposal, apart from its explanatory file-header comment. Native runner exited0
and stopped its scratch server; no application/SQL defect or pending local failure.

## G. No entitlement/public activation

Provisioning writes only public.shops (owner/name/category/description plus default
UUID/timestamps). It does not call pricing, billing, Stripe, Trial, membership,
publication, promotion, discovery or notification commands. Creating/reading a
Shop does not start a billing period or change Resale. Public Shop getter and
publication guard remain unchanged. Existing Continue/Trial buttons not wired.
No UI interaction exception was used or needed for backend-only provisioning.

Idempotency is at the identity/effect level: repeated POST conflicts, rather than
returning201 again. The B11 contract explicitly requires409 for an existing Shop;
GET is canonical recovery after an ambiguous committed result. No command table
or client-controlled ownership key is needed for this single-owner creation.

## H. Safety

No remote operation, env/key/config read or change, Supabase CLI, Staging write,
Production access, real email/payment/refund/payout, membership grant or public
Shop activation. No existing data or user/dev database was modified/deleted/reset.
No immutable trigger was disabled. All data-changing tests are disposable scratch
fixtures in the existing native local test infrastructure, not user demo content.
No new persistent/remote environment was created. Auth/Storage/Realtime/cron are
local stand-ins, cron inert and external transports excluded. Scratch files/data
retained rather than destructive cleanup. Only Git read-only diff checks/review;
no stage/commit/push/reset/clean/rebase/branch operations.

## I. Accurate status

- Local planning/code/migration: COMPLETE.
- Native authorization/concurrency and offline application validation: PASS.
- Full hosted Supabase/API/PostgREST/Auth acceptance: NOT EXECUTED.
- Staging migration deployment: NOT AUTHORIZED / NOT EXECUTED.
- UI creation trigger: NOT AUTHORIZED / NOT IMPLEMENTED.
- B12 membership/Trial/billing: NOT STARTED.

Local B11 implementation is complete. This does not claim deployed availability
or cloud acceptance. No additional database privilege/design correction to the
reviewed SQL was necessary; approved design passed as written.

## J. Before separately approved Staging deployment

Do not run yet. First obtain explicit authorization for narrow read-only target
preflight and then deployment of ONLY 202610190002, with any test writes separately
identified. Use explicit `pcaqxezdfxofysghssyo`, never cached default CLI target.
Compare real schema/UNIQUE helper/ACL/RLS/prerequisites and ensure new RPC name is
unused; stop on drift. Verify deployment modifies only this function/EXECUTE grant,
with no data backfill, broadened table access or unrelated migrations.

Managed acceptance would need specifically approved new no-email Auth/Profile/Shop
fixtures and exact resources. Enumerate Auth audit/session residue and actual FK
removability before writes; no permanent/uncleanable records presumed acceptable.
Do not use real/manual users, create Orders/Offers, activate subscriptions or remove
existing data. Rollback of a deployed function, if ever needed, is a separately
reviewed forward revoke/drop with RESTRICT, not deletion of provisioned Shops.

Stop after local B11; no remote deployment or B12 without separate instruction.
