# B11 Shop provisioning: schema approval proposal

2026-10-19. This document preserves the initial reviewed proposal below.
**Subsequent explicit approval authorized local implementation and isolated native
PostgreSQL testing. Those are now complete; remote deployment remains unapproved.**
See [B11 local qualification](BUSINESS-V1-B11-PROVISIONING-QUALIFICATION.md).
The historical proposal's NOT CREATED/NOT EXECUTED/approval-pending statements
describe the earlier preparation point, not current local implementation status.
The approved SQL was implemented unchanged in the new forward migration and
validated in real isolated local PostgreSQL. No Staging write occurred.

## A. Current local foundation

The finalized B10 v1.0 contract is authoritative and unchanged. The older B10
source review is historical; none of its former pricing/trial questions is reopened.

- `202610160006_shop_profile_foundation.sql`: existing `public.shops` UUID PK,
  `owner_id UNIQUE REFERENCES profiles(id)`, database timestamps, constraints,
  updated_at trigger and verified-Western owner SELECT/UPDATE RLS. Authenticated
  users can SELECT and update only name/category/description. No general
  INSERT/DELETE grant or policy; no membership/public visibility authority.
- `lib/server/shop-profile-repository.ts`: session-bound `getOwnShop` and
  `updateOwnShop`, using `createMarketplaceClient`, `requireMarketplaceUser`,
  `mapOwnerShop`, fixed selection and safe errors. No service-role client.
- `pages/api/shop.ts`: GET/PATCH, query rejection, same-origin PATCH, 4kb body,
  private/no-store, safe error mapping; DELETE unsupported.
- `lib/shop-profile.ts`, `lib/shop-presentation.ts`: object/field whitelist,
  trim/shared identity validation; JS UTF-16 length bounds and four exact categories.
- `types/shop.ts`: existing OwnerShop seven-field DTO, not entitlement.
- `tests/shop-profile.cjs`: offline real API/repository/validator tests.
  `tests/shop-profile-staging.sql`: existing constraint/ACL/RLS expectations read
  as source only; it was NOT run, and its privileged synthetic inserts are not
  an application provisioning mechanism.
- Source index/audit and exact B11 task row inspected only for these boundaries.
  No B01–B10 re-audit, environment inspection or remote schema assertion.

## B. Minimum missing functionality

An explicit authenticated creation command that inserts one Shop for the caller,
validates all three required fields and safely returns the existing OwnerShop DTO.
No automatic provisioning on GET/login/Plans/Trial/Settings. Provisioning must not
start membership, trial, period, payment, public visibility, promotion or publishing.

A POST handler alone cannot insert with current permissions. A broad service-role
insert, general INSERT policy or temporary frontend entitlement would bypass the
approved boundary. Therefore stop before a partial application implementation.

## C. Exact proposed database authority (NOT CREATED / NOT EXECUTED)

Proposed future filename, subject to approval and rechecking local sequence:
`supabase/migrations/202610190002_shop_profile_provisioning.sql`.

Only one new RPC and its EXECUTE grants. No new table, command ledger, policy,
trigger, column, backfill, existing-row update or general INSERT grant. Keep
`shops_owner_id_key` and every existing constraint intact. Preconditions include
that unique constraint name, current seven columns, helper functions and existing
ACL/policies as shown by the local foundation. Do not assume deployed state matches;
future remote application needs separately authorized preflight/deployment.

```sql
begin;

create function public.marketplace_create_shop(p_input jsonb)
returns table (
  id uuid,
  owner_id uuid,
  name text,
  category text,
  description text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_name text;
  v_category text;
  v_description text;
  v_trim_chars constant text :=
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if v_actor is null
     or not coalesce(marketplace_private.is_western_user(), false) then
    raise exception 'Verified Western account required.' using errcode = '42501';
  end if;

  -- Lock only the current caller's existing Profile against concurrent removal.
  perform 1 from public.profiles p where p.id = v_actor for key share;
  if not found then
    raise exception 'Eligible profile required.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_input) is distinct from 'object' then
    raise exception 'Provide valid Shop profile fields.' using errcode = '23514';
  end if;
  if not (p_input ?& array['name', 'category', 'description'])
     or exists (
       select 1 from jsonb_object_keys(p_input) as fields(key)
       where fields.key not in ('name', 'category', 'description')
     ) then
    raise exception 'Provide only name, category, and description.'
      using errcode = '23514';
  end if;
  if jsonb_typeof(p_input->'name') is distinct from 'string'
     or jsonb_typeof(p_input->'category') is distinct from 'string'
     or jsonb_typeof(p_input->'description') is distinct from 'string' then
    raise exception 'Shop profile fields must be text.' using errcode = '23514';
  end if;

  v_name := btrim(p_input->>'name', v_trim_chars);
  v_description := btrim(p_input->>'description', v_trim_chars);
  -- Creation requires an exact allowed category, not normalization of a new enum.
  v_category := p_input->>'category';
  if marketplace_private.shop_profile_text_length(v_name) not between 1 and 40
     or marketplace_private.shop_profile_text_length(v_description) not between 1 and 200
     or v_category not in (
       'Clothing & Accessories', 'Electronics', 'Collectibles', 'Home & Living'
     ) then
    raise exception 'Check the Shop profile fields.' using errcode = '23514';
  end if;

  return query
    insert into public.shops as created (owner_id, name, category, description)
    values (v_actor, v_name, v_category, v_description)
    on conflict on constraint shops_owner_id_key do nothing
    returning created.id, created.owner_id, created.name, created.category,
              created.description, created.created_at, created.updated_at;
  if not found then
    raise exception 'Shop already exists.' using errcode = '23505';
  end if;
end;
$function$;

revoke all on function public.marketplace_create_shop(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.marketplace_create_shop(jsonb) to authenticated;

commit;
```

Security conditions:

- Trusted migration/function owner retains required privileges, following existing
  command conventions; not an authenticated/app-owned function. No grant of table
  INSERT or role membership. Function has empty search_path and fully qualified
  application relations/helpers; no dynamic SQL or client-selected owner/path.
- Direct RPC and API both enforce identity/input; no owner/Shop ID parameter.
  Required fields plus no unsupported keys means exactly three fields. JS trim
  parity uses the foundation's Unicode trim set and UTF-16-length helper.
- Owner-column unique constraint is the atomic authority. Two concurrent requests
  contend at the unique key: exactly one inserts; the other returns no row and
  raises 23505, mapped by the future POST path to safe HTTP 409. No check-then-insert
  race or overwrite/implicit PATCH. Different owners do not share that key.
- Existing default UUID/timestamps generate on the database; successful insertion
  returns explicitly whitelisted columns, not a future-expanded row shape.
- Retry after a committed response loss returns 409; existing authenticated GET
  retrieves the created Shop. If the transaction never committed, retry can insert.
  This is idempotency of identity/effect, not guaranteed repeated HTTP 201. The
  exact B11 specification requires 409 for an existing Shop, so no new action UUID,
  artificial success receipt, duplicate command table or overwritten profile.
- No read/update/delete policy changes, anonymous grants, public Shop exposure or
  activation side effects. Existing `marketplace_finalize_listing` denial stays.

Rollback considerations: transactionally install function and grants only after
approval. A failure rolls back those definitions; no data migration is involved.
If removal later becomes necessary, separately approved forward rollback would
revoke EXECUTE then drop only this function with default RESTRICT, coordinated
with POST rollback. Never CASCADE, delete created Shops or rewrite existing data.
No rollback SQL/migration file is created now.

## D. Application file plan (all PROPOSED, none changed)

| File | Minimum later change |
| --- | --- |
| `lib/shop-profile.ts` | Add `validateCreateShopProfile`, require exactly all three string fields; trim name/description; exact category; reuse listingInputRecord and shopIdentityError; keep PATCH semantics unchanged |
| `types/shop.ts` | Add `CreateShopProfileInput = Pick<OwnerShop, 'name' | 'category' | 'description'>`; keep OwnerShop unchanged |
| `lib/server/shop-profile-repository.ts` | Add createOwnShop using verified session then validator and session-client RPC; explicit safe DTO mapping; creation-only 23505 -> stable 'Shop already exists.' 409; no service-role insert or implicit update |
| `pages/api/shop.ts` | Allow POST, same-origin guard, same query/body-size/cache protections, 201 only on successful returned creation; GET/PATCH unchanged; DELETE 405 and updated Allow header |
| `tests/shop-profile.cjs` | Add actual API/repository mocked transport tests only after RPC contract approval; change only existing POST-405/method-shape assumptions directly affected by implemented POST, retain all other protections |
| New focused local provisioning DB tests | Once authorized, run actual new migration/RPC with real SQL roles and two connections through the existing isolated native harness; no new persistent environment |

No shared UI, PricingCard, CTA, navigation, Shop URL/username authority, public
source, Listing/Order/Message provenance or B10 contract changes. A future UI
creation trigger needs separate interaction approval; no such exception is needed
to design the backend command now. B12 activation remains separate.

Actual changes in this preparation: this proposal and B11 task-progress entry only.
No application, validator, type, test or migration file was changed/created.

## E. Validation plan and evidence boundaries

Actually executed: existing offline `shop-profile.cjs`, `shop-presentation.cjs` and
`public-shop.cjs` all PASS. Application TypeScript (`--noEmit --incremental false`)
and focused ESLint for those tests PASS. Documentation UTF-8/whitespace checks PASS;
the proposed migration file's absence was checked. No Git command was executed.
These results verify unchanged existing behavior, not the proposed RPC or POST.
No new local database tests are run before explicit migration/test approval.

Required future matrix (all new provisioning cases currently NOT EXECUTED):

1. API absent/expired session ->401; non-Western/unverified ->403; direct anon
   cannot execute function; direct unverified authenticated invocation ->42501.
2. Valid request ->201, exactly one DB Shop and seven-field OwnerShop; GET sees it.
3. Missing/extra/null/non-object/non-string fields rejected at API and direct RPC;
   forged owner/Shop UUID/status/tier/trial/expiry/metrics/timestamps ->400.
4. Four exact categories; trim/empty/max/astral/Unicode whitespace boundaries agree
   between JS and PostgreSQL. Category with padding remains invalid on create,
   while existing PATCH behavior remains unchanged.
5. Existing Shop and repeated POST ->409, same identity/data/timestamps unchanged;
   two actual concurrent connections ->one 201/insert and one conflict; two owners
   each get their own row; GET cannot read another owner; no direct INSERT/DELETE.
6. Failure before commit creates no Shop; lost committed response ->retry409 plus
   owner GET recovers exactly that row. No broad error/unique diagnostic leakage.
7. Existing PATCH, same-origin/header, query, cache, size/method and safe-error tests
   retained; unavailable RPC/database ->sanitized retryable503, never fake201.
8. No entitlement/trial/payment period/grant, public exposure, listing publication,
   notification/email or billing side effect. Source and native tests verify
   profile creation leaves public getters empty and finalize fail-closed.
9. Local tests only create their own fresh native scratch fixtures, preserving all
   pre-existing user/dev/manual data. Never run the old Staging SQL merely because
   it says rollback-only. No cloud acceptance claim from mocked tests.

## F. Data and environment safety

Current work is local source inspection and documentation only. No credentials or
env files read, Supabase CLI/remote calls, SQL execution, new environment, existing
data modification, demo fixture creation, UI change, payment/email or Git mutation.
B10 contract and existing source files remain unchanged. No B12 started.

Future Staging deployment/testing is NOT part of the requested next local approval.
It would add one RPC/grant and create Auth/Profile/Shop test records; Auth/account
audit/session records may persist despite logical test cleanup. New Shop creation
should have no Order/Offer/media/billing history by design. Precise side effects,
references and removability must be rechecked before separately requesting any
remote write, with exact resources and preservation of all existing data.

## G. Approval required

Approve creation of the single proposed forward migration and RPC/EXECUTE grant
design, then its validation in the existing safely isolated native PostgreSQL
test infrastructure and corresponding local API/repository/validator/type tests.
This approval must explicitly remain local-only: no remote deployment, Staging
account/Shop writes, membership/trial/billing/publication or UI wiring.

If this design changes during implementation, return to the applicable approval
boundary before any new policy/table/trigger/authority change. No general INSERT
policy or service-role shortcut is proposed.

## H. Status

- Local planning: COMPLETE.
- Local application code: NOT IMPLEMENTED (intentionally stopped at schema gate).
- Database authority: PROPOSED; approval pending, no migration file created.
- Full B11 provisioning: NOT COMPLETE.
- Cloud deployment/acceptance: NOT AUTHORIZED / NOT EXECUTED.

Stop here for the explicit local schema/implementation approval; do not begin B12.
