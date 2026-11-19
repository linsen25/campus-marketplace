-- C4: Shop-only archival preserves C2 inventory/audit retention without
-- introducing an invalid Listing status or changing the existing Order model.
begin;

alter table public.listings add column archived_at timestamptz;
alter table public.listings add constraint listings_shop_archive_only
  check (archived_at is null or listing_channel = 'shop');
create index listings_shop_archived_owner on public.listings(seller_id, archived_at)
  where listing_channel = 'shop' and archived_at is not null;
revoke update(archived_at) on public.listings from authenticated;

-- A normal client never has UPDATE permission for archived_at. This trigger is
-- a second fence for privileged code paths: only the archive RPC below sets the
-- transaction-local marker, and an archived Shop product cannot be reopened or
-- materially edited by a generic Listing update.
create function marketplace_private.guard_shop_listing_archive()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.archived_at is distinct from old.archived_at then
    if old.listing_channel <> 'shop' or old.archived_at is not null
      or new.archived_at is null
      or current_setting('marketplace_private.shop_archive_transition', true) <> 'archive' then
      raise exception 'Shop archive lifecycle is protected.' using errcode='42501';
    end if;
  elsif old.archived_at is not null
    and (to_jsonb(new) - array['updated_at','search_text'])
      is distinct from (to_jsonb(old) - array['updated_at','search_text']) then
    raise exception 'Archived Shop products cannot be edited.' using errcode='42501';
  end if;
  return new;
end;$$;

create trigger listings_shop_archive_guard
before update on public.listings
for each row execute function marketplace_private.guard_shop_listing_archive();

create function public.marketplace_archive_shop_listing(p_listing_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); l public.listings; s public.shops;
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
  if l.archived_at is not null then
    return jsonb_build_object('listingId',l.id,'archived',true,'idempotent',true,'archivedAt',l.archived_at);
  end if;
  if l.published_at is null or l.status<>'available' or l.reserved_order_id is not null then
    raise exception 'Only a published available Shop product can be archived.' using errcode='23514';
  end if;
  perform 1 from marketplace_private.shop_inventory i
    where i.listing_id=l.id and i.shop_id=s.id and i.owner_id=actor for key share;
  if not found then raise exception 'Inventory is not initialized for this Shop product.' using errcode='23514'; end if;
  perform set_config('marketplace_private.shop_archive_transition','archive',true);
  update public.listings set archived_at=clock_timestamp() where id=l.id returning * into l;
  return jsonb_build_object('listingId',l.id,'archived',true,'idempotent',false,'archivedAt',l.archived_at);
end;$$;

-- All ordinary public reads honour the archive marker. Owner reads retain their
-- existing policy and the owner repository separately hides archived products
-- from the normal Manage Products collection.
drop policy if exists listings_public_read on public.listings;
create policy listings_public_read on public.listings for select
using (published_at is not null and status='available' and archived_at is null);
drop policy if exists images_public_read on public.listing_images;
create policy images_public_read on public.listing_images for select using (
  ready and exists(select 1 from public.listings l where l.id=listing_id
    and l.published_at is not null and l.status='available' and l.archived_at is null)
);

-- Prevent new direct transaction records after archival. This does not rewrite
-- Order/Offer state machines or existing historical conversations/orders.
create function marketplace_private.reject_archived_shop_transaction()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.listings l
    where l.id=new.listing_id and l.listing_channel='shop' and l.archived_at is not null) then
    raise exception 'Archived Shop products cannot receive new transactions.' using errcode='23514';
  end if;
  return new;
end;$$;

create trigger order_requests_reject_archived_shop_listing
before insert on public.order_requests
for each row execute function marketplace_private.reject_archived_shop_transaction();
create trigger orders_reject_archived_shop_listing
before insert on public.orders
for each row execute function marketplace_private.reject_archived_shop_transaction();

-- The current verified Shop-contact entry point and its conversation identity
-- trigger must not create a fresh conversation for an archived product.
create or replace function marketplace_private.protect_conversation_identity() returns trigger
language plpgsql security definer set search_path='' as $$
declare source public.listings;
begin
 if tg_op='INSERT' then
  if auth.uid() is null or not coalesce(marketplace_private.is_verified_user(),false)
   or new.buyer_id is distinct from auth.uid() or new.seller_id is null or new.listing_id is null
   or new.listing_origin_id is distinct from new.listing_id then
   raise exception 'Verified buyer and real listing participants required.' using errcode='42501'; end if;
  select * into source from public.listings l where l.id=new.listing_id for share;
  if not found or source.published_at is null or source.status<>'available' or source.archived_at is not null
   or source.seller_id is distinct from new.seller_id or new.buyer_id=source.seller_id then
   raise exception 'Only another seller''s published available listing can start a conversation.' using errcode='23514'; end if;
  new.listing_title_snapshot:=source.title; new.listing_price_cents_snapshot:=source.price_cents;
  new.listing_currency_snapshot:=source.currency; new.listing_category_snapshot:=source.category;
  new.listing_channel_snapshot:=source.listing_channel; new.shop_name_snapshot:=null;
  if source.listing_channel='shop' then
   select name into new.shop_name_snapshot from public.shops where owner_id=source.seller_id for share;
   if not found or marketplace_private.shop_profile_text_length(new.shop_name_snapshot) not between 1 and 40 then
    raise exception 'Shop profile required for Shop Conversation.' using errcode='23514'; end if;
  end if;
  new.created_at:=clock_timestamp(); new.updated_at:=now(); new.last_message_at:=null;
  new.last_message_sequence:=0; new.buyer_last_read_sequence:=0; new.seller_last_read_sequence:=0;
  return new;
 end if;
 if row(new.id,new.listing_origin_id,new.created_at,new.listing_title_snapshot,new.listing_price_cents_snapshot,new.listing_currency_snapshot,new.listing_category_snapshot,new.listing_channel_snapshot,new.shop_name_snapshot)
  is distinct from row(old.id,old.listing_origin_id,old.created_at,old.listing_title_snapshot,old.listing_price_cents_snapshot,old.listing_currency_snapshot,old.listing_category_snapshot,old.listing_channel_snapshot,old.shop_name_snapshot)
 then raise exception 'Conversation identity and listing snapshot are immutable.' using errcode='23514'; end if;
 if new.listing_id is distinct from old.listing_id and not (new.listing_id is null and not exists(select 1 from public.listings l where l.id=old.listing_id)) then
  raise exception 'The live listing reference cannot be reassigned.' using errcode='23514'; end if;
 if new.buyer_id is distinct from old.buyer_id and not (new.buyer_id is null and not exists(select 1 from public.profiles p where p.id=old.buyer_id)) then
  raise exception 'The buyer cannot be reassigned.' using errcode='23514'; end if;
 if new.seller_id is distinct from old.seller_id and not (new.seller_id is null and not exists(select 1 from public.profiles p where p.id=old.seller_id)) then
  raise exception 'The seller cannot be reassigned.' using errcode='23514'; end if;
 if new.buyer_last_read_sequence<old.buyer_last_read_sequence or new.seller_last_read_sequence<old.seller_last_read_sequence then
  raise exception 'Read watermarks cannot move backwards.' using errcode='23514'; end if;
 return new;
end;$$;

create or replace function public.marketplace_find_or_create_conversation(p_listing_id uuid)
returns public.conversations language plpgsql security definer set search_path='' as $$
declare source public.listings; target public.conversations; actor uuid:=auth.uid();
begin
 if actor is null or not coalesce(marketplace_private.is_verified_user(),false) then
  raise exception 'Verified email required.' using errcode='42501'; end if;
 select * into target from public.conversations where listing_origin_id=p_listing_id and buyer_id=actor;
 if found then return target; end if;
 select * into source from public.listings l where l.id=p_listing_id for share;
 if not found or source.published_at is null or source.status<>'available' or source.archived_at is not null then
  raise exception 'A published available listing is required.' using errcode='23514'; end if;
 if source.seller_id=actor then raise exception 'You cannot start a conversation with yourself.' using errcode='23514'; end if;
 insert into public.conversations(listing_origin_id,listing_id,buyer_id,seller_id,listing_title_snapshot,listing_price_cents_snapshot,listing_currency_snapshot,listing_category_snapshot)
 values(source.id,source.id,actor,source.seller_id,source.title,source.price_cents,source.currency,source.category)
 on conflict on constraint conversations_identity do nothing returning * into target;
 if not found then
  select * into target from public.conversations c where c.listing_origin_id=source.id and c.buyer_id=actor and c.seller_id=source.seller_id;
  if not found then raise exception 'Retry conversation creation after concurrent change.' using errcode='40001'; end if;
 end if;
 return target;
end;$$;

-- Public Shop and Shop-favorite SECURITY DEFINER projections bypass RLS, so
-- they explicitly apply the same marker before pagination and direct lookup.
create or replace function marketplace_private.public_shop_profile(p_shop public.shops) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object('id',p_shop.id,'sellerProfileId',p.id,'username',p.username,
 'shopName',p_shop.name,'category',p_shop.category,'description',p_shop.description,
 'badgeTier',marketplace_private.public_shop_eligibility(p.id)->>'badgeTier',
 'avatarUrl',case when p.avatar_path is not null then '/api/profile/avatar/'||p.id::text else null end,
 'imageUrl',(select '/api/listing-media/'||i.id::text from public.listings l join public.listing_images i on i.listing_id=l.id
  where l.seller_id=p.id and l.listing_channel='shop' and l.published_at is not null and l.status='available' and l.archived_at is null
   and i.ready and i.owner_id=p.id order by l.created_at desc,l.id,i.slot limit 1)))
 from public.profiles p where p.id=p_shop.owner_id and p.username is not null;
$$;

create or replace function public.marketplace_public_shop_products(p_query jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q jsonb;rows jsonb;size integer;page integer;target public.listings;shop_owner uuid;delay integer;
begin
 q:=marketplace_private.public_shop_query(p_query,array['page','pageSize','id','username','search','sort','category']);
 size:=(q->>'pageSize')::integer;page:=(q->>'page')::integer;
 if q ? 'id' then
  select * into target from public.listings where id=(q->>'id')::uuid and listing_channel='shop' and published_at is not null and archived_at is null;
  if not found then return jsonb_build_object('state','not_found');end if;
  if marketplace_private.public_shop_eligibility(target.seller_id) is null then return jsonb_build_object('state','unavailable');end if;
  if target.status<>'available' then return jsonb_build_object('state','not_found');end if;
  return jsonb_build_object('state','available','listing',marketplace_private.public_shop_product(target),
   'refreshAfterMs',marketplace_private.public_shop_eligibility(target.seller_id)->'refreshAfterMs');
 end if;
 if q ? 'username' then
  select p.id into shop_owner from public.profiles p join public.shops s on s.owner_id=p.id where p.username_normalized=lower(q->>'username');
  if shop_owner is null then return jsonb_build_object('state','not_found');end if;
  if marketplace_private.public_shop_eligibility(shop_owner) is null then return jsonb_build_object('state','unavailable');end if;
 end if;
 select coalesce(jsonb_agg(x.data order by x.position),'[]'::jsonb),coalesce(min(x.delay),30000) into rows,delay from (
  select marketplace_private.public_shop_product(l) data,(e.value->>'refreshAfterMs')::integer delay,
   row_number() over(order by case when q->>'sort'='price-low' then l.price_cents end,
    case when q->>'sort'='price-high' then l.price_cents end desc,l.created_at desc,l.id) position
  from public.listings l join public.shops s on s.owner_id=l.seller_id join public.profiles p on p.id=s.owner_id
  cross join lateral(select marketplace_private.public_shop_eligibility(s.owner_id) value) e
  where l.listing_channel='shop' and l.published_at is not null and l.status='available' and l.archived_at is null and e.value is not null and p.username is not null
   and (shop_owner is null or l.seller_id=shop_owner)
   and (not(q ? 'category') or l.category=q->>'category')
   and (not(q ? 'search') or position(lower(q->>'search') in lower(l.title||' '||l.description))>0)
  order by position offset (page-1)*size limit size+1
 ) x;
 return jsonb_build_object('state','available','listings',(select coalesce(jsonb_agg(v order by n),'[]'::jsonb) from jsonb_array_elements(rows) with ordinality a(v,n) where n<=size),
  'page',page,'hasNextPage',jsonb_array_length(rows)>size,'refreshAfterMs',delay);
end;$$;

create or replace function public.marketplace_public_shop_image(p_image_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',i.id,'listing_id',i.listing_id,'owner_id',i.owner_id,'path',i.path,'storage_bucket',i.storage_bucket,'ready',i.ready,
 'listings',jsonb_build_object('id',l.id,'seller_id',l.seller_id,'published_at',l.published_at,'status',l.status,'listing_channel',l.listing_channel))
 from public.listing_images i join public.listings l on l.id=i.listing_id join public.shops s on s.owner_id=l.seller_id
 where i.id=p_image_id and i.owner_id=l.seller_id and i.ready and l.listing_channel='shop'
 and l.published_at is not null and l.status='available' and l.archived_at is null and marketplace_private.public_shop_eligibility(l.seller_id) is not null;
$$;

create or replace function public.marketplace_favorite_shop_products(p_query jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();page integer;page_size integer;selected_shop uuid;rows jsonb;available_shops jsonb;delay integer;
begin
 if actor is null or not coalesce(marketplace_private.is_verified_user(),false) then raise exception 'Verified account required.' using errcode='42501'; end if;
 if jsonb_typeof(p_query)<>'object' or exists(select 1 from jsonb_object_keys(p_query) key where key not in('page','pageSize','shopId')) then raise exception 'Invalid Shop favorites query.' using errcode='23514'; end if;
 page:=coalesce((p_query->>'page')::integer,1);page_size:=coalesce((p_query->>'pageSize')::integer,20);
 if page<1 or page_size<1 or page_size>100 then raise exception 'Invalid Shop favorites page.' using errcode='23514'; end if;
 if p_query ? 'shopId' then
  if (p_query->>'shopId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid Shop identity.' using errcode='23514'; end if;
  selected_shop:=(p_query->>'shopId')::uuid;
 end if;
 select coalesce(jsonb_agg(shop_identity order by shop_name,username),'[]'::jsonb) into available_shops from (
  select distinct s.name shop_name,p.username username,jsonb_build_object('id',s.id,'shopName',s.name,'username',p.username) shop_identity
  from public.listing_favorites f join public.listings l on l.id=f.listing_id join public.shops s on s.owner_id=l.seller_id join public.profiles p on p.id=s.owner_id
  cross join lateral(select marketplace_private.public_shop_eligibility(s.owner_id) value) eligibility
  where f.user_id=actor and l.seller_id<>actor and l.listing_channel='shop' and l.published_at is not null and l.status='available' and l.archived_at is null and p.username is not null and eligibility.value is not null
 ) eligible_shops;
 select coalesce(jsonb_agg(payload order by position),'[]'::jsonb),coalesce(min(refresh_after_ms),30000) into rows,delay from (
  select jsonb_build_object('listing',marketplace_private.public_shop_product(l),'shop',jsonb_build_object('id',s.id,'shopName',s.name,'username',p.username)) payload,
   (eligibility.value->>'refreshAfterMs')::integer refresh_after_ms,row_number() over(order by l.created_at desc,l.id) position
  from public.listing_favorites f join public.listings l on l.id=f.listing_id join public.shops s on s.owner_id=l.seller_id join public.profiles p on p.id=s.owner_id
  cross join lateral(select marketplace_private.public_shop_eligibility(s.owner_id) value) eligibility
  where f.user_id=actor and l.seller_id<>actor and l.listing_channel='shop' and l.published_at is not null and l.status='available' and l.archived_at is null and p.username is not null and eligibility.value is not null and (selected_shop is null or s.id=selected_shop)
  order by position offset (page-1)*page_size limit page_size+1
 ) paged;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb) from jsonb_array_elements(rows) with ordinality item(value,ordinal) where ordinal<=page_size),'shops',available_shops,'page',page,'hasNextPage',jsonb_array_length(rows)>page_size,'refreshAfterMs',greatest(100,least(30000,delay)));
end;$$;

revoke all on function marketplace_private.guard_shop_listing_archive(), marketplace_private.reject_archived_shop_transaction() from public,anon,authenticated,service_role;
revoke all on function public.marketplace_archive_shop_listing(uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_archive_shop_listing(uuid) to authenticated;

commit;
