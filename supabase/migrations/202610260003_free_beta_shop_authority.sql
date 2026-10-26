-- Free Beta Shop authority: approved applications authorize new Shop operations.
-- Shop Offer/Order and all payment paths remain guarded by B14.
begin;

create or replace function marketplace_private.is_shop_operator(p_owner_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select coalesce(marketplace_private.is_shop_approved(p_owner_id),false)
    or coalesce((marketplace_private.shop_entitlements(p_owner_id,statement_timestamp())->>'canOperateShop')::boolean,false);
$$;
revoke all on function marketplace_private.is_shop_operator(uuid) from public,anon,authenticated,service_role;
grant execute on function marketplace_private.is_shop_operator(uuid) to authenticated,service_role;

create or replace function marketplace_private.public_shop_eligibility(p_owner uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when marketplace_private.is_shop_operator(p_owner)
   and exists(select 1 from public.profiles p where p.id=p_owner and p.username ~ '^[A-Za-z0-9_]{3,20}$')
 then jsonb_build_object(
   'badgeTier',case when marketplace_private.is_shop_approved(p_owner) then null else e->>'effectiveTier' end,
   'refreshAfterMs',case when marketplace_private.is_shop_approved(p_owner) then 30000 else greatest(100,least(30000,
    floor(extract(epoch from ((e->>'nextBoundaryAt')::timestamptz-statement_timestamp()))*1000)))::integer end)
 else null end
 from (select marketplace_private.shop_entitlements(p_owner,statement_timestamp()) e) q;
$$;
revoke all on function marketplace_private.public_shop_eligibility(uuid) from public,anon,authenticated,service_role;

create or replace function public.marketplace_create_shop(p_input jsonb)
returns table (id uuid, owner_id uuid, name text, category text, description text, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path='' as $function$
declare v_actor uuid:=auth.uid(); v_name text; v_category text; v_description text;
  v_trim_chars constant text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
 if v_actor is null or not coalesce(marketplace_private.is_verified_user(),false)
   or not coalesce(marketplace_private.is_shop_approved(v_actor),false)
 then raise exception 'Approved Shop account required.' using errcode='42501'; end if;
 perform 1 from public.profiles p where p.id=v_actor for key share;
 if not found then raise exception 'Eligible profile required.' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or not (p_input ?& array['name','category','description'])
   or exists(select 1 from jsonb_object_keys(p_input) f(key) where f.key not in('name','category','description'))
   or jsonb_typeof(p_input->'name') is distinct from 'string'
   or jsonb_typeof(p_input->'category') is distinct from 'string'
   or jsonb_typeof(p_input->'description') is distinct from 'string'
 then raise exception 'Provide valid Shop profile fields.' using errcode='23514'; end if;
 v_name:=btrim(p_input->>'name',v_trim_chars); v_category:=p_input->>'category'; v_description:=btrim(p_input->>'description',v_trim_chars);
 if marketplace_private.shop_profile_text_length(v_name) not between 1 and 40
  or marketplace_private.shop_profile_text_length(v_description) not between 1 and 200
  or v_category not in('Clothing & Accessories','Electronics','Collectibles','Home & Living')
 then raise exception 'Check the Shop profile fields.' using errcode='23514'; end if;
 return query insert into public.shops as created(owner_id,name,category,description)
 values(v_actor,v_name,v_category,v_description)
 on conflict on constraint shops_owner_id_key do nothing
 returning created.id,created.owner_id,created.name,created.category,created.description,created.created_at,created.updated_at;
 if not found then raise exception 'Shop already exists.' using errcode='23505'; end if;
end;$function$;
revoke all on function public.marketplace_create_shop(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_create_shop(jsonb) to authenticated;

create or replace function marketplace_private.guard_shop_product() returns trigger
language plpgsql security definer set search_path='' as $$
declare used bigint; prior_active boolean:=false;
begin
 if new.listing_channel<>'shop' then return new; end if;
 if tg_op='UPDATE' then
  if row(new.id,new.seller_id) is distinct from row(old.id,old.seller_id) then raise exception 'Shop product identity is immutable.' using errcode='23514'; end if;
  if old.reserved_order_id is not null and (to_jsonb(new)-array['status','reserved_order_id','updated_at','search_text']) is distinct from (to_jsonb(old)-array['status','reserved_order_id','updated_at','search_text']) then raise exception 'Reserved inventory cannot be edited.' using errcode='23514'; end if;
  prior_active:=old.published_at is not null and old.status in('available','pending','reserved');
 end if;
 if tg_op='INSERT' then
  perform 1 from public.shops where owner_id=new.seller_id for key share;
  if not found or not coalesce(marketplace_private.is_shop_operator(new.seller_id),false) then raise exception 'Approved Shop required.' using errcode='42501'; end if;
  if new.published_at is not null then raise exception 'Create an unpublished product first.' using errcode='23514'; end if;
 end if;
 if new.published_at is not null and new.status in('available','pending','reserved') and not prior_active then
  perform 1 from public.shops where owner_id=new.seller_id for key share;
  if not found or not coalesce(marketplace_private.is_shop_operator(new.seller_id),false) then raise exception 'Approved Shop required.' using errcode='42501'; end if;
  select count(*) into used from public.listings where seller_id=new.seller_id and listing_channel='shop' and published_at is not null and status in('available','pending','reserved');
 end if;
 return new;
end;$$;
revoke all on function marketplace_private.guard_shop_product() from public,anon,authenticated,service_role;

create or replace function public.marketplace_create_shop_listing(p_input jsonb,p_client_action_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); v public.listings; prior public.listings; k text;
 allowed text[]:=array['title','description','price_cents','currency','category','subcategory','condition','pickup_area','expected_image_count','preferred_payment_mode','preferred_fulfillment','meeting_location','meeting_location_provider','meeting_place_id','estimated_delivery_fee_cents'];
begin
 if actor is null or not coalesce(marketplace_private.is_verified_user(),false) or not coalesce(marketplace_private.is_shop_operator(actor),false) then raise exception 'Approved Shop account required.' using errcode='42501'; end if;
 if p_client_action_id is null or jsonb_typeof(p_input) is distinct from 'object' or (p_input-allowed)<>'{}'::jsonb or not(p_input ?& array['title','description','price_cents','currency','category','subcategory','expected_image_count','preferred_payment_mode','preferred_fulfillment','meeting_location','estimated_delivery_fee_cents']) then raise exception 'Valid product fields and action ID required.' using errcode='23514'; end if;
 foreach k in array array['title','description','currency','category','subcategory','preferred_payment_mode','preferred_fulfillment','meeting_location'] loop if jsonb_typeof(p_input->k) is distinct from 'string' then raise exception 'Product fields must be text.' using errcode='23514'; end if; end loop;
 foreach k in array array['condition','pickup_area','meeting_location_provider','meeting_place_id'] loop if p_input ? k and jsonb_typeof(p_input->k) not in('string','null') then raise exception 'Invalid optional product field.' using errcode='23514'; end if; end loop;
 foreach k in array array['price_cents','expected_image_count','estimated_delivery_fee_cents'] loop if jsonb_typeof(p_input->k) is distinct from 'number' or (p_input->>k)::numeric<>trunc((p_input->>k)::numeric) or (p_input->>k)::numeric not between 0 and 9007199254740991 then raise exception 'Product amounts/count must be valid integers.' using errcode='23514'; end if; end loop;
 if (p_input->>'expected_image_count')::numeric not between 1 and 6 then raise exception 'Expected image count must be between 1 and 6.' using errcode='23514'; end if;
 select * into v from jsonb_populate_record(null::public.listings,p_input);
 if marketplace_private.shop_profile_text_length(v.title) not between 1 and 120 or marketplace_private.shop_profile_text_length(v.description)>5000 or v.currency<>'CAD' or v.expected_image_count not between 1 and 6 or v.meeting_location is null or marketplace_private.shop_profile_text_length(v.meeting_location) not between 1 and 120 or (v.pickup_area is not null and marketplace_private.shop_profile_text_length(v.pickup_area) not between 1 and 120) or v.preferred_fulfillment not in('ON_CAMPUS','DELIVERY') or v.preferred_payment_mode not in('uu_pay','external') or (v.preferred_fulfillment='DELIVERY' and v.preferred_payment_mode<>'uu_pay') then raise exception 'Check the product fields.' using errcode='23514'; end if;
 perform 1 from public.shops where owner_id=actor for key share; if not found then raise exception 'Owned Shop required.' using errcode='42501'; end if;
 insert into public.listings(id,seller_id,listing_channel,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,preferred_payment_mode,preferred_fulfillment,meeting_location,meeting_location_provider,meeting_place_id,estimated_delivery_fee_cents)
 values(p_client_action_id,actor,'shop',v.title,v.description,v.price_cents,v.currency,v.category,v.subcategory,v.condition,v.pickup_area,v.expected_image_count,v.preferred_payment_mode,v.preferred_fulfillment,v.meeting_location,v.meeting_location_provider,v.meeting_place_id,v.estimated_delivery_fee_cents) on conflict(id) do nothing;
 select * into prior from public.listings where id=p_client_action_id for update; if prior.seller_id is distinct from actor or prior.listing_channel<>'shop' or not(to_jsonb(prior) @> p_input) then raise exception 'Conflicting product creation retry.' using errcode='23505'; end if; return prior.id;
end;$$;
revoke all on function public.marketplace_create_shop_listing(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_create_shop_listing(jsonb,uuid) to authenticated;

create or replace function public.marketplace_shop_application_status()
returns text language sql security definer set search_path='' as $$
  select coalesce((select status from marketplace_private.shop_applications where owner_id=auth.uid()),'none');
$$;
revoke all on function public.marketplace_shop_application_status() from public,anon,authenticated,service_role;
grant execute on function public.marketplace_shop_application_status() to authenticated;

create or replace function public.marketplace_finalize_listing(listing_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare target public.listings;
begin
 if not coalesce(marketplace_private.is_verified_user(),false) then raise exception 'Verified email required.' using errcode='42501'; end if;
 select * into target from public.listings l where l.id=listing_id for update;
 if not found or target.seller_id is distinct from auth.uid() then raise exception 'Listing not found or not owned by you.' using errcode='42501'; end if;
 if target.listing_channel='shop' and not coalesce(marketplace_private.is_shop_operator(target.seller_id),false) then raise exception 'Approved Shop account required.' using errcode='42501'; end if;
 if target.published_at is not null then return target.id; end if;
 perform marketplace_private.assert_listing_images_complete(target);
 update public.listings set published_at=clock_timestamp() where id=target.id;
 return target.id;
end;$$;
revoke all on function public.marketplace_finalize_listing(uuid) from public,anon,service_role;
grant execute on function public.marketplace_finalize_listing(uuid) to authenticated;

-- Ordinary verified owners may read/update their Shop; new Shop media remains
-- listing-scoped and operator-scoped. Historical rows are not rewritten.
drop policy if exists shops_owner_read on public.shops;
create policy shops_owner_read on public.shops for select to authenticated
using (owner_id=(select auth.uid()) and (select marketplace_private.is_verified_user()));
drop policy if exists shops_owner_update on public.shops;
create policy shops_owner_update on public.shops for update to authenticated
using (owner_id=(select auth.uid()) and (select marketplace_private.is_shop_operator(owner_id)))
with check (owner_id=(select auth.uid()) and (select marketplace_private.is_shop_operator(owner_id)));

drop policy if exists marketplace_storage_insert on storage.objects;
create policy marketplace_storage_insert on storage.objects for insert to authenticated with check (
 bucket_id in ('listing-images','listing-images-private') and (select marketplace_private.is_verified_user())
 and exists(select 1 from public.listing_images i join public.listings l on l.id=i.listing_id
  where i.path=name and i.storage_bucket=bucket_id and i.owner_id=(select auth.uid()) and not i.ready
   and l.published_at is null and l.status='available'
   and (l.listing_channel='resale' or (l.listing_channel='shop' and marketplace_private.is_shop_operator(l.seller_id)))
   and (l.listing_channel<>'resale' or bucket_id='listing-images-private'))
);
drop policy if exists listing_private_insert_guard on storage.objects;
create policy listing_private_insert_guard on storage.objects as restrictive for insert to anon,authenticated with check (
 bucket_id<>'listing-images-private' or ((select marketplace_private.is_verified_user()) and exists(
  select 1 from public.listing_images i join public.listings l on l.id=i.listing_id
  where i.path=name and i.storage_bucket=bucket_id and i.owner_id=(select auth.uid()) and not i.ready
   and l.published_at is null and l.status='available'
   and (l.listing_channel='resale' or (l.listing_channel='shop' and marketplace_private.is_shop_operator(l.seller_id)))))
);
drop policy if exists listing_private_select_guard on storage.objects;
create policy listing_private_select_guard on storage.objects as restrictive for select to anon,authenticated using (
 bucket_id<>'listing-images-private' or ((storage.foldername(name))[1]=(select auth.uid())::text and (select marketplace_private.is_verified_user()))
);
drop policy if exists listing_private_owner_read on storage.objects;
create policy listing_private_owner_read on storage.objects for select to authenticated using (
 bucket_id='listing-images-private' and (storage.foldername(name))[1]=(select auth.uid())::text and (select marketplace_private.is_verified_user())
);

commit;
