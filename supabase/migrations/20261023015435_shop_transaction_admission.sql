-- B26-A: default-closed Shop admission into the existing shared transaction stack.
-- This migration adds no Shop-specific Conversation, Offer, Order or payment state.
begin;

create table marketplace_private.shop_transaction_admission (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  check(not enabled or updated_at is not null)
);
insert into marketplace_private.shop_transaction_admission(singleton,enabled)
values(true,false);
alter table marketplace_private.shop_transaction_admission enable row level security;
revoke all on marketplace_private.shop_transaction_admission from public,anon,authenticated,service_role;

-- The B14 trigger names remain installed. Only their private implementation is
-- replaced. Every new Shop transaction therefore crosses this database boundary,
-- including SECURITY DEFINER RPCs and direct INSERT attempts.
create or replace function marketplace_private.guard_new_shop_transaction()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  source public.listings;
  shop public.shops;
  entitlement jsonb;
  admission boolean:=false;
  actor uuid:=auth.uid();
  row_data jsonb:=to_jsonb(new);
begin
  if new.listing_id is null then return new;end if;
  -- All transaction paths already take the Listing first. Keep that shared lock
  -- while membership is checked so publication/Sold/reservation cannot race it.
  select * into source from public.listings where id=new.listing_id for share;
  if source.id is null or source.listing_channel<>'shop' then return new;end if;

  select enabled into admission
    from marketplace_private.shop_transaction_admission
    where singleton for share;
  if admission is distinct from true then
    raise exception 'New Shop transactions are not available.' using errcode='42501';
  end if;
  if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
    raise exception 'Verified Western account required.' using errcode='42501';
  end if;
  if source.published_at is null or source.status<>'available'
    or source.reserved_order_id is not null then
    raise exception 'Published available Shop product required.' using errcode='23514';
  end if;
  if (row_data->>'seller_id')::uuid is distinct from source.seller_id
    or (row_data->>'buyer_id')::uuid is null
    or (row_data->>'buyer_id')::uuid=source.seller_id
    or actor not in((row_data->>'buyer_id')::uuid,(row_data->>'seller_id')::uuid)
    or (row_data->>'listing_origin_id')::uuid is distinct from source.id then
    raise exception 'Trusted Shop transaction participants required.' using errcode='42501';
  end if;

  -- Match the established B12/B14 lock order after the Listing lock:
  -- Shop -> membership -> entitlement evaluated after the serialization lock.
  select * into shop from public.shops where owner_id=source.seller_id for key share;
  if shop.id is null then
    raise exception 'Owned Shop required.' using errcode='42501';
  end if;
  perform 1 from marketplace_private.shop_memberships
    where owner_id=source.seller_id for update;
  if not found then
    raise exception 'Operating Shop membership required.' using errcode='42501';
  end if;
  entitlement:=marketplace_private.shop_entitlements(source.seller_id,clock_timestamp());
  if not coalesce((entitlement->>'canOperateShop')::boolean,false) then
    raise exception 'Operating Shop membership required.' using errcode='42501';
  end if;
  return new;
end;$$;

revoke all on function marketplace_private.guard_new_shop_transaction()
  from public,anon,authenticated,service_role;

commit;
