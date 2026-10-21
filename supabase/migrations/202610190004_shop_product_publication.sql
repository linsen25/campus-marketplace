-- B14 owner management only. No public Shop discovery, billing or new transactions.
begin;

create index listings_shop_active_owner on public.listings(seller_id)
where listing_channel='shop' and published_at is not null and status in('available','pending','reserved');

create function marketplace_private.guard_shop_product() returns trigger
language plpgsql security definer set search_path='' as $$
declare entitlement jsonb; used bigint; prior_active boolean:=false;
begin
 if new.listing_channel<>'shop' then return new;end if;
 if tg_op='UPDATE' then
  if row(new.id,new.seller_id) is distinct from row(old.id,old.seller_id) then
   raise exception 'Shop product identity is immutable.' using errcode='23514';end if;
  -- The legacy V2 pending branch returns early in the shared inventory trigger.
  -- Close its metadata-edit bypass for Shop only; Order status/release still works.
  if old.reserved_order_id is not null and
    (to_jsonb(new)-array['status','reserved_order_id','updated_at','search_text']) is distinct from
    (to_jsonb(old)-array['status','reserved_order_id','updated_at','search_text']) then
   raise exception 'Reserved inventory cannot be edited.' using errcode='23514';end if;
  prior_active:=old.published_at is not null and old.status in('available','pending','reserved');
 end if;
 if tg_op='INSERT' then
  perform 1 from public.shops where owner_id=new.seller_id for key share;
  if not found then raise exception 'Owned Shop required.' using errcode='42501';end if;
  if new.published_at is not null then raise exception 'Create an unpublished product first.' using errcode='23514';end if;
 end if;
 if new.published_at is not null and new.status in('available','pending','reserved') and not prior_active then
  -- The Listing row is already locked by UPDATE. B12 never acquires Listing locks.
  perform 1 from public.shops where owner_id=new.seller_id for key share;
  if not found then raise exception 'Owned Shop required.' using errcode='42501';end if;
  perform 1 from marketplace_private.shop_memberships where owner_id=new.seller_id for update;
  if not found then raise exception 'Shop publishing requires an operating membership.' using errcode='42501';end if;
  -- Fresh SPI statements after the serialization lock: no API snapshot/counter.
  entitlement:=marketplace_private.shop_entitlements(new.seller_id,clock_timestamp());
  if not coalesce((entitlement->>'canOperateShop')::boolean,false) then
   raise exception 'Shop publishing requires an operating membership.' using errcode='42501';end if;
  select count(*) into used from public.listings where seller_id=new.seller_id
   and listing_channel='shop' and published_at is not null and status in('available','pending','reserved');
  if used >= (entitlement->>'maxActiveProducts')::integer then
   raise exception 'Shop active product limit reached.' using errcode='23514';end if;
 end if;
 return new;
end;$$;
revoke all on function marketplace_private.guard_shop_product() from public,anon,authenticated,service_role;
create trigger listings_shop_product_guard before insert or update on public.listings
for each row execute function marketplace_private.guard_shop_product();

create function public.marketplace_create_shop_listing(p_input jsonb,p_client_action_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); v public.listings; prior public.listings; k text;
 allowed text[]:=array['title','description','price_cents','currency','category','subcategory','condition','pickup_area',
 'expected_image_count','preferred_payment_mode','preferred_fulfillment','meeting_location','meeting_location_provider',
 'meeting_place_id','estimated_delivery_fee_cents'];
begin
 if actor is null or not coalesce(marketplace_private.is_western_user(),false) then
  raise exception 'Verified Western account required.' using errcode='42501';end if;
 if p_client_action_id is null or jsonb_typeof(p_input) is distinct from 'object' then
  raise exception 'Valid Shop product fields and action ID required.' using errcode='23514';end if;
 if (p_input-allowed)<>'{}'::jsonb or not(p_input ?& array['title','description','price_cents','currency','category','subcategory',
   'expected_image_count','preferred_payment_mode','preferred_fulfillment','meeting_location','estimated_delivery_fee_cents']) then
  raise exception 'Only product metadata is accepted.' using errcode='23514';end if;
 foreach k in array array['title','description','currency','category','subcategory','preferred_payment_mode','preferred_fulfillment','meeting_location'] loop
  if jsonb_typeof(p_input->k) is distinct from 'string' then raise exception 'Product fields must be text.' using errcode='23514';end if;
 end loop;
 foreach k in array array['condition','pickup_area','meeting_location_provider','meeting_place_id'] loop
  if p_input ? k and jsonb_typeof(p_input->k) not in('string','null') then
   raise exception 'Invalid optional product field.' using errcode='23514';end if;
 end loop;
 foreach k in array array['price_cents','expected_image_count','estimated_delivery_fee_cents'] loop
  if jsonb_typeof(p_input->k) is distinct from 'number' or (p_input->>k)::numeric<>trunc((p_input->>k)::numeric)
    or (p_input->>k)::numeric not between 0 and 9007199254740991 then
   raise exception 'Product amounts/count must be valid integers.' using errcode='23514';end if;
 end loop;
 if (p_input->>'expected_image_count')::numeric not between 1 and 6 then
  raise exception 'Expected image count must be between 1 and 6.' using errcode='23514';end if;
 select * into v from jsonb_populate_record(null::public.listings,p_input);
 if marketplace_private.shop_profile_text_length(v.title) not between 1 and 120
  or marketplace_private.shop_profile_text_length(v.description)>5000 or v.currency<>'CAD'
  or v.expected_image_count not between 1 and 6 or v.meeting_location is null
  or marketplace_private.shop_profile_text_length(v.meeting_location) not between 1 and 120
  or (v.pickup_area is not null and marketplace_private.shop_profile_text_length(v.pickup_area) not between 1 and 120)
  or v.preferred_fulfillment not in('ON_CAMPUS','DELIVERY')
  or v.preferred_payment_mode not in('uu_pay','external')
  or (v.preferred_fulfillment='DELIVERY' and v.preferred_payment_mode<>'uu_pay') then
  raise exception 'Check the product fields.' using errcode='23514';end if;
 perform 1 from public.shops where owner_id=actor for key share;
 if not found then raise exception 'Owned Shop required.' using errcode='42501';end if;
 -- UUID is only a retry key, never ownership. No client channel or seller is used.
 insert into public.listings(id,seller_id,listing_channel,title,description,price_cents,currency,category,subcategory,
 condition,pickup_area,expected_image_count,preferred_payment_mode,preferred_fulfillment,meeting_location,
 meeting_location_provider,meeting_place_id,estimated_delivery_fee_cents)
 values(p_client_action_id,actor,'shop',v.title,v.description,v.price_cents,v.currency,v.category,v.subcategory,
 v.condition,v.pickup_area,v.expected_image_count,v.preferred_payment_mode,v.preferred_fulfillment,v.meeting_location,
 v.meeting_location_provider,v.meeting_place_id,v.estimated_delivery_fee_cents)
 on conflict(id) do nothing;
 select * into prior from public.listings where id=p_client_action_id for update;
 if prior.seller_id is distinct from actor or prior.listing_channel<>'shop' or not(to_jsonb(prior) @> p_input) then
  raise exception 'Conflicting product creation retry.' using errcode='23505';end if;
 return prior.id;
end;$$;
revoke all on function public.marketplace_create_shop_listing(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_create_shop_listing(jsonb,uuid) to authenticated;

create or replace function public.marketplace_finalize_listing(listing_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare target public.listings;
begin
 if not coalesce(marketplace_private.is_western_user(),false) then
  raise exception 'Verified Western account required.' using errcode='42501';end if;
 select * into target from public.listings l where l.id=listing_id for update;
 if not found or target.seller_id is distinct from auth.uid() then
  raise exception 'Listing not found or not owned by you.' using errcode='42501';end if;
 -- An expired/over-quota retry confirms the same prior publication, not a new slot.
 if target.published_at is not null then return target.id;end if;
 perform marketplace_private.assert_listing_images_complete(target);
 update public.listings set published_at=clock_timestamp() where id=target.id;
 -- Shop increase trigger performs membership + quota in this same transaction.
 return target.id;
end;$$;
revoke all on function public.marketplace_finalize_listing(uuid) from public,anon,service_role;
grant execute on function public.marketplace_finalize_listing(uuid) to authenticated;

-- New images use the existing private system; never rewrite historical sources.
create or replace function marketplace_private.assign_listing_image_bucket() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.listings where id=new.listing_id for update;
 new.storage_bucket:='listing-images-private';return new;
end;$$;
drop policy marketplace_storage_insert on storage.objects;
create policy marketplace_storage_insert on storage.objects for insert to authenticated with check (
 bucket_id='listing-images-private' and (select marketplace_private.is_western_user())
 and exists(select 1 from public.listing_images i join public.listings l on l.id=i.listing_id
 where i.path=name and i.storage_bucket=bucket_id and i.owner_id=(select auth.uid()) and not i.ready
 and l.published_at is null and l.status='available')
);
drop policy listing_private_insert_guard on storage.objects;
create policy listing_private_insert_guard on storage.objects as restrictive for insert to anon,authenticated with check (
 bucket_id<>'listing-images-private' or ((select marketplace_private.is_western_user()) and exists(
 select 1 from public.listing_images i join public.listings l on l.id=i.listing_id
 where i.path=name and i.storage_bucket=bucket_id and i.owner_id=(select auth.uid()) and not i.ready
 and l.published_at is null and l.status='available'))
);
drop policy listing_legacy_insert_guard on storage.objects;
create policy listing_legacy_insert_guard on storage.objects as restrictive for insert to anon,authenticated
with check(bucket_id<>'listing-images');

-- Even SECURITY DEFINER RPCs cannot accidentally open B15 known-ID transactions.
-- Only INSERT is gated; retained conversations, histories and Orders are untouched.
create function marketplace_private.guard_new_shop_transaction() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.listings where id=new.listing_id and listing_channel='shop') then
  raise exception 'New Shop transactions are not available.' using errcode='42501';end if;
 return new;
end;$$;
revoke all on function marketplace_private.guard_new_shop_transaction() from public,anon,authenticated,service_role;
create trigger b14_new_shop_conversation_guard before insert on public.conversations
for each row execute function marketplace_private.guard_new_shop_transaction();
create trigger b14_new_shop_offer_guard before insert on public.order_requests
for each row execute function marketplace_private.guard_new_shop_transaction();
create trigger b14_new_shop_order_guard before insert on public.orders
for each row execute function marketplace_private.guard_new_shop_transaction();
commit;
