-- C2: private, Shop-only inventory foundation.  This migration intentionally
-- does not change Listing creation, public projections, Orders, or UI.  C3
-- must call marketplace_private.initialize_shop_inventory from the final
-- marketplace_create_shop_listing implementation.
begin;

create table marketplace_private.shop_inventory (
  listing_id uuid primary key references public.listings(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  on_hand_quantity integer not null check (on_hand_quantity >= 0),
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
  available_quantity integer generated always as (on_hand_quantity - reserved_quantity) stored,
  low_stock_threshold integer not null default 0 check (low_stock_threshold >= 0),
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (reserved_quantity <= on_hand_quantity)
);

create unique index shop_inventory_shop_listing_owner
  on marketplace_private.shop_inventory(shop_id, listing_id, owner_id);
create index shop_inventory_owner_lookup
  on marketplace_private.shop_inventory(owner_id, shop_id);

create table marketplace_private.shop_inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  inventory_listing_id uuid not null references marketplace_private.shop_inventory(listing_id) on delete restrict,
  listing_id uuid not null references public.listings(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  action_id uuid not null,
  reason text not null check (reason in ('initial_backfill','creation_initialization','manual_adjustment')),
  delta integer not null check (delta <> 0),
  before_on_hand_quantity integer not null check (before_on_hand_quantity >= 0),
  after_on_hand_quantity integer not null check (after_on_hand_quantity >= 0),
  created_at timestamptz not null default clock_timestamp(),
  check (after_on_hand_quantity = before_on_hand_quantity + delta),
  unique (inventory_listing_id, action_id)
);
create index shop_inventory_adjustments_listing_created
  on marketplace_private.shop_inventory_adjustments(inventory_listing_id, created_at desc);

alter table marketplace_private.shop_inventory enable row level security;
alter table marketplace_private.shop_inventory_adjustments enable row level security;
revoke all on marketplace_private.shop_inventory, marketplace_private.shop_inventory_adjustments
  from public, anon, authenticated, service_role;

create function marketplace_private.guard_shop_inventory_subject()
returns trigger language plpgsql security definer set search_path='' as $$
declare l public.listings; s public.shops;
begin
  if tg_op='UPDATE' and row(new.listing_id,new.shop_id,new.owner_id)
    is distinct from row(old.listing_id,old.shop_id,old.owner_id) then
    raise exception 'Inventory identity is immutable.' using errcode='23514';
  end if;
  select * into l from public.listings where id=new.listing_id for key share;
  if not found or l.listing_channel<>'shop' then
    raise exception 'Inventory is only available for Shop products.' using errcode='23514';
  end if;
  select * into s from public.shops where id=new.shop_id and owner_id=new.owner_id for key share;
  if not found or l.seller_id is distinct from new.owner_id or s.owner_id is distinct from l.seller_id then
    raise exception 'Inventory subject must be an owned Shop product.' using errcode='42501';
  end if;
  return new;
end;$$;

create trigger shop_inventory_subject_guard
before insert or update on marketplace_private.shop_inventory
for each row execute function marketplace_private.guard_shop_inventory_subject();

create function marketplace_private.guard_shop_inventory_adjustment_subject()
returns trigger language plpgsql security definer set search_path='' as $$
declare i marketplace_private.shop_inventory;
begin
  select * into i from marketplace_private.shop_inventory where listing_id=new.inventory_listing_id for key share;
  if not found or row(new.listing_id,new.shop_id)
    is distinct from row(i.listing_id,i.shop_id)
    or new.after_on_hand_quantity is distinct from i.on_hand_quantity
    or new.before_on_hand_quantity is distinct from i.on_hand_quantity-new.delta then
    raise exception 'Inventory adjustment does not match its inventory record.' using errcode='23514';
  end if;
  return new;
end;$$;

create trigger shop_inventory_adjustment_subject_guard
before insert on marketplace_private.shop_inventory_adjustments
for each row execute function marketplace_private.guard_shop_inventory_adjustment_subject();

create function marketplace_private.protect_shop_inventory_adjustment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'Inventory adjustments are immutable.' using errcode='42501';
end;$$;
create trigger shop_inventory_adjustments_immutable
before update or delete on marketplace_private.shop_inventory_adjustments
for each row execute function marketplace_private.protect_shop_inventory_adjustment();

-- Internal C3 hook.  It has no executable grant; it derives ownership from
-- the Listing instead of accepting shop or owner IDs from a client.
create function marketplace_private.initialize_shop_inventory(p_listing_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.listings; s public.shops; i marketplace_private.shop_inventory;
begin
  select * into l from public.listings where id=p_listing_id for update;
  if not found or l.listing_channel<>'shop' or l.status<>'available' or l.reserved_order_id is not null then
    raise exception 'Shop product required.' using errcode='23514';
  end if;
  select * into s from public.shops where owner_id=l.seller_id for key share;
  if not found then raise exception 'Owned Shop required.' using errcode='42501'; end if;
  insert into marketplace_private.shop_inventory(listing_id,shop_id,owner_id,on_hand_quantity,reserved_quantity,low_stock_threshold)
  values(l.id,s.id,l.seller_id,1,0,0)
  on conflict(listing_id) do nothing
  returning * into i;
  if i.listing_id is not null then
    insert into marketplace_private.shop_inventory_adjustments(
      inventory_listing_id,listing_id,shop_id,actor_id,action_id,reason,delta,before_on_hand_quantity,after_on_hand_quantity
    ) values(i.listing_id,i.listing_id,i.shop_id,null,gen_random_uuid(),'creation_initialization',1,0,1);
  else
    select * into i from marketplace_private.shop_inventory where listing_id=l.id;
  end if;
  return jsonb_build_object('listingId',i.listing_id,'shopId',i.shop_id,'onHandQuantity',i.on_hand_quantity,
    'reservedQuantity',i.reserved_quantity,'availableQuantity',i.available_quantity,'lowStockThreshold',i.low_stock_threshold,
    'revision',i.revision,'updatedAt',i.updated_at);
end;$$;

create function public.marketplace_shop_inventory(p_listing_id uuid, p_change jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); l public.listings; s public.shops; i marketplace_private.shop_inventory;
  prior marketplace_private.shop_inventory_adjustments; delta_value integer; expected_revision bigint;
  next_on_hand integer; v_action_id uuid;
begin
  if actor is null or not coalesce(marketplace_private.is_verified_user(),false)
    or not coalesce(marketplace_private.is_shop_operator(actor),false) then
    raise exception 'Approved Shop account required.' using errcode='42501';
  end if;
  select * into s from public.shops where owner_id=actor for key share;
  if not found then raise exception 'Owned Shop required.' using errcode='42501'; end if;
  select * into l from public.listings where id=p_listing_id for update;
  if not found or l.listing_channel<>'shop' or l.seller_id is distinct from actor then
    raise exception 'Owned Shop product required.' using errcode='42501';
  end if;
  select * into i from marketplace_private.shop_inventory
   where listing_id=l.id and shop_id=s.id and owner_id=actor for update;
  if not found then raise exception 'Inventory is not initialized for this Shop product.' using errcode='23514'; end if;
  if p_change is null then
    return jsonb_build_object('listingId',i.listing_id,'shopId',i.shop_id,'onHandQuantity',i.on_hand_quantity,
      'reservedQuantity',i.reserved_quantity,'availableQuantity',i.available_quantity,'lowStockThreshold',i.low_stock_threshold,
      'revision',i.revision,'updatedAt',i.updated_at);
  end if;
  if jsonb_typeof(p_change) is distinct from 'object' or pg_column_size(p_change)>1024
    or (select array_agg(key order by key) from jsonb_object_keys(p_change) key)
       is distinct from array['actionId','delta','expectedRevision']::text[]
    or jsonb_typeof(p_change->'actionId') is distinct from 'string'
    or jsonb_typeof(p_change->'delta') is distinct from 'number'
    or jsonb_typeof(p_change->'expectedRevision') is distinct from 'number'
    or (p_change->>'delta')::numeric<>trunc((p_change->>'delta')::numeric)
    or (p_change->>'expectedRevision')::numeric<>trunc((p_change->>'expectedRevision')::numeric)
    or (p_change->>'delta')::numeric not between -1000000 and 1000000
    or (p_change->>'delta')::numeric=0
    or (p_change->>'expectedRevision')::numeric not between 1 and 9007199254740991
    or p_change->>'actionId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then raise exception 'Valid inventory adjustment required.' using errcode='23514'; end if;
  v_action_id:=(p_change->>'actionId')::uuid;
  select adjustment.* into prior from marketplace_private.shop_inventory_adjustments adjustment
    where adjustment.inventory_listing_id=i.listing_id and adjustment.action_id=v_action_id;
  if found then
    return jsonb_build_object('listingId',i.listing_id,'shopId',i.shop_id,'onHandQuantity',i.on_hand_quantity,
      'reservedQuantity',i.reserved_quantity,'availableQuantity',i.available_quantity,
      'lowStockThreshold',i.low_stock_threshold,'revision',i.revision,'idempotent',true,'updatedAt',prior.created_at);
  end if;
  delta_value:=(p_change->>'delta')::integer;
  expected_revision:=(p_change->>'expectedRevision')::bigint;
  if i.revision<>expected_revision then raise exception 'Inventory changed. Reload before saving.' using errcode='40001'; end if;
  next_on_hand:=i.on_hand_quantity+delta_value;
  if next_on_hand<i.reserved_quantity then
    raise exception 'Inventory cannot be reduced below reserved quantity.' using errcode='23514';
  end if;
  update marketplace_private.shop_inventory
   set on_hand_quantity=next_on_hand, revision=revision+1, updated_at=clock_timestamp()
   where listing_id=i.listing_id
   returning * into i;
  insert into marketplace_private.shop_inventory_adjustments(
    inventory_listing_id,listing_id,shop_id,actor_id,action_id,reason,delta,before_on_hand_quantity,after_on_hand_quantity
  ) values(i.listing_id,i.listing_id,i.shop_id,actor,v_action_id,'manual_adjustment',delta_value,
    i.on_hand_quantity-delta_value,i.on_hand_quantity);
  return jsonb_build_object('listingId',i.listing_id,'shopId',i.shop_id,'onHandQuantity',i.on_hand_quantity,
    'reservedQuantity',i.reserved_quantity,'availableQuantity',i.available_quantity,'lowStockThreshold',i.low_stock_threshold,
    'revision',i.revision,'idempotent',false,'updatedAt',i.updated_at);
end;$$;

revoke all on function marketplace_private.guard_shop_inventory_subject(),
  marketplace_private.guard_shop_inventory_adjustment_subject(),
  marketplace_private.protect_shop_inventory_adjustment(),
  marketplace_private.initialize_shop_inventory(uuid) from public, anon, authenticated, service_role;
revoke all on function public.marketplace_shop_inventory(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.marketplace_shop_inventory(uuid,jsonb) to authenticated;

-- Only legacy Shop listings with unambiguous single-unit states receive rows.
-- pending/reserved rows are deliberately skipped: current one-listing-one-order
-- semantics cannot safely be transformed into a multi-unit reservation here.
with inserted as (
  insert into marketplace_private.shop_inventory(
    listing_id,shop_id,owner_id,on_hand_quantity,reserved_quantity,low_stock_threshold
  )
  select l.id,s.id,l.seller_id,case when l.status='sold' then 0 else 1 end,0,0
  from public.listings l join public.shops s on s.owner_id=l.seller_id
  where l.listing_channel='shop' and l.status in ('available','sold')
  on conflict(listing_id) do nothing
  returning *
)
insert into marketplace_private.shop_inventory_adjustments(
  inventory_listing_id,listing_id,shop_id,actor_id,action_id,reason,delta,before_on_hand_quantity,after_on_hand_quantity
)
select listing_id,listing_id,shop_id,null,gen_random_uuid(),'initial_backfill',on_hand_quantity,0,on_hand_quantity
from inserted
where on_hand_quantity>0;

commit;
