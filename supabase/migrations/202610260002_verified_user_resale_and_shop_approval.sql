-- Ordinary verified-account access and Free Beta Shop approval foundation.
-- Shop transaction triggers remain fail-closed; this migration does not enable
-- Shop Offer/Order/payment flows.
begin;

create table if not exists marketplace_private.shop_applications (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  invitation_code_hash text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'rejected') = (rejection_reason is not null))
);
alter table marketplace_private.shop_applications enable row level security;
revoke all on marketplace_private.shop_applications from public, anon, authenticated;

create or replace function marketplace_private.is_shop_approved(p_owner_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=''
as $$
  select exists (select 1 from marketplace_private.shop_applications
    where owner_id=p_owner_id and status='approved');
$$;
revoke all on function marketplace_private.is_shop_approved(uuid) from public, anon;
grant execute on function marketplace_private.is_shop_approved(uuid) to authenticated, service_role;

-- Service-role-only review boundary. No browser role can grant approval.
create or replace function marketplace_private.review_shop_application(
  p_owner_id uuid, p_status text, p_reviewer_id uuid, p_reason text default null
) returns void language plpgsql security definer set search_path=''
as $$
begin
  if p_status not in ('approved','rejected') or p_reviewer_id is null
     or p_reviewer_id = p_owner_id
  then raise exception 'Invalid Shop review.' using errcode='42501'; end if;
  update marketplace_private.shop_applications
  set status=p_status, reviewed_by=p_reviewer_id, reviewed_at=now(),
      rejection_reason=case when p_status='rejected' then nullif(trim(p_reason),'') else null end,
      updated_at=now()
  where owner_id=p_owner_id;
  if not found then raise exception 'Shop application not found.' using errcode='P0002'; end if;
end;
$$;
revoke all on function marketplace_private.review_shop_application(uuid,text,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function marketplace_private.review_shop_application(uuid,text,uuid,text)
  to service_role;

create or replace function public.marketplace_request_shop_application()
returns text language plpgsql security definer set search_path=''
as $$
declare actor uuid:=auth.uid(); current_status text;
begin
  if actor is null or not coalesce(marketplace_private.is_verified_user(),false)
    then raise exception 'Verified account required.' using errcode='42501'; end if;
  insert into marketplace_private.shop_applications(owner_id)
    values(actor) on conflict (owner_id) do nothing;
  select status into current_status from marketplace_private.shop_applications where owner_id=actor;
  return current_status;
end;
$$;
revoke all on function public.marketplace_request_shop_application() from public, anon;
grant execute on function public.marketplace_request_shop_application() to authenticated;

-- Ordinary verified users may manage their own resale/profile/favorite rows;
-- ownership and participant predicates remain unchanged.
drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update on public.profiles for update to authenticated
using (id=(select auth.uid()) and (select marketplace_private.is_verified_user()))
with check (id=(select auth.uid()) and (select marketplace_private.is_verified_user()));
drop policy if exists listings_owner_insert on public.listings;
create policy listings_owner_insert on public.listings for insert to authenticated
with check (seller_id=(select auth.uid()) and (select marketplace_private.is_verified_user())
  and listing_channel='resale');
drop policy if exists listings_owner_update on public.listings;
create policy listings_owner_update on public.listings for update to authenticated
using (seller_id=(select auth.uid()) and (select marketplace_private.is_verified_user()))
with check (seller_id=(select auth.uid()) and (select marketplace_private.is_verified_user()));
drop policy if exists listings_owner_delete on public.listings;
create policy listings_owner_delete on public.listings for delete to authenticated
using (seller_id=(select auth.uid()) and (select marketplace_private.is_verified_user()));

drop policy if exists favorites_eligible_insert on public.listing_favorites;
create policy favorites_eligible_insert on public.listing_favorites for insert to authenticated
with check (user_id=(select auth.uid()) and (select marketplace_private.is_verified_user()));
drop policy if exists favorites_own_read on public.listing_favorites;
create policy favorites_own_read on public.listing_favorites for select to authenticated
using (user_id=(select auth.uid()) and (select marketplace_private.is_verified_user()));
drop policy if exists favorites_own_delete on public.listing_favorites;
create policy favorites_own_delete on public.listing_favorites for delete to authenticated
using (user_id=(select auth.uid()) and (select marketplace_private.is_verified_user()));

commit;
