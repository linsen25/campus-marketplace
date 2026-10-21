-- Disposable local PostgreSQL fixtures only. No remote accounts, payment or email.
create function public.b14_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'B14: %',label;end if;end;$$;
create function public.b14_reject(statement text,expected text) returns void language plpgsql as $$
begin begin execute statement;exception when others then
 if sqlstate=expected then return;end if;raise;
end;raise exception 'B14 unexpected success: %',statement;end;$$;
create function public.b14_owner(i integer) returns uuid language sql immutable as $$
select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;$$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select public.b14_owner(i),'b14_local_'||i||'@uwo.ca',clock_timestamp(),jsonb_build_object('username','B14_Local_'||i)
from generate_series(81,90) i;
insert into public.notification_preferences(user_id,email_notifications) select public.b14_owner(i),false from generate_series(81,90) i;
insert into public.shops(owner_id,name,category,description)
select public.b14_owner(i),'B14 owner '||i,'Electronics','Private local profile' from generate_series(81,89) i;
create function public.b14_buy(i integer,tier text,at_time timestamptz) returns void language sql as $$
select marketplace_private.shop_membership_command(public.b14_owner(i),'purchase',gen_random_uuid(),jsonb_build_object(
 'expectedRevision',coalesce((select revision from marketplace_private.shop_memberships where owner_id=public.b14_owner(i)),0),
 'expectedCycle',(select cycle_id from marketplace_private.shop_memberships where owner_id=public.b14_owner(i)),
 'tier',tier,'mode','one_month','proof',gen_random_uuid()::text,'currency','CAD',
 'amountCents',marketplace_private.shop_membership_price(tier,'one_month')),at_time);$$;
select public.b14_buy(81,'plus',clock_timestamp()),public.b14_buy(82,'pro',clock_timestamp());
select marketplace_private.shop_membership_command(public.b14_owner(83),'trial',gen_random_uuid(),'{}',clock_timestamp());
select public.b14_buy(84,'plus',clock_timestamp()-interval '1 month 2 days');
select public.b14_buy(85,'plus',clock_timestamp()-interval '2 months');
select public.b14_buy(87,'pro',clock_timestamp()-interval '1 month 2 days');
-- APPLY_B14
create function public.b14_input() returns jsonb language sql immutable as $$
select jsonb_build_object('title','Product','description','Local test','price_cents',1000,'currency','CAD','category','Electronics',
 'subcategory','Cameras','condition','good','pickup_area',null,'expected_image_count',1,'preferred_payment_mode','external',
 'preferred_fulfillment','ON_CAMPUS','meeting_location','Campus','meeting_location_provider',null,'meeting_place_id',null,'estimated_delivery_fee_cents',0);$$;
create function public.b14_draft(i integer) returns uuid language plpgsql as $$
declare lid uuid;begin
 perform set_config('request.jwt.claim.sub',public.b14_owner(i)::text,false);
 lid:=public.marketplace_create_shop_listing(public.b14_input(),gen_random_uuid());
 insert into public.listing_images(listing_id,slot) values(lid,1);
 insert into storage.objects(bucket_id,name,metadata) select storage_bucket,path,'{"mimetype":"image/png","size":100}' from public.listing_images where listing_id=lid;
 update public.listing_images set ready=true where listing_id=lid;
 return lid;end;$$;
create function public.b14_fill(i integer,n integer) returns void language plpgsql as $$
begin for j in 1..n loop perform public.marketplace_finalize_listing(public.b14_draft(i));end loop;end;$$;

do $$declare lid uuid;cmd uuid:=gen_random_uuid();old_time timestamptz;bad jsonb;begin
 perform set_config('request.jwt.claim.sub',public.b14_owner(90)::text,false);
 perform public.b14_reject(format('select public.marketplace_create_shop_listing(%L,%L)',public.b14_input(),cmd),'42501');
 perform set_config('request.jwt.claim.sub',public.b14_owner(81)::text,false);
 lid:=public.marketplace_create_shop_listing(public.b14_input(),cmd);
 perform public.b14_assert(lid=cmd and public.marketplace_create_shop_listing(public.b14_input(),cmd)=lid,'duplicate creation uses same ID');
 perform public.b14_reject(format('select public.marketplace_create_shop_listing(%L,%L)',public.b14_input()||'{"title":"Different"}',cmd),'23505');
 foreach bad in array array[public.b14_input()||'{"seller_id":"forged"}',public.b14_input()||'{"listing_channel":"resale"}',
 public.b14_input()||'{"shop_id":"forged"}',public.b14_input()||'{"price_cents":"1000"}',public.b14_input()||'{"expected_image_count":0}',
 public.b14_input()||'{"subcategory":"Bad"}',public.b14_input()||'{"preferred_fulfillment":"DELIVERY"}'] loop
  perform public.b14_reject(format('select public.marketplace_create_shop_listing(%L,gen_random_uuid())',bad),'23514');
 end loop;
 perform public.b14_reject(format('select public.marketplace_finalize_listing(%L)',lid),'23514');
 perform set_config('request.jwt.claim.sub',public.b14_owner(82)::text,false);
 perform public.b14_reject(format('select public.marketplace_create_shop_listing(%L,%L)',public.b14_input(),cmd),'23505');
 perform public.b14_reject(format('select public.marketplace_finalize_listing(%L)',lid),'42501');
 perform set_config('request.jwt.claim.sub','',false);
 perform public.b14_reject(format('select public.marketplace_create_shop_listing(%L,%L)',public.b14_input(),cmd),'42501');
end;$$;

-- Real role/column and Storage RLS. No trigger disabling or public bucket rewrite.
select set_config('request.jwt.claim.sub',public.b14_owner(81)::text,false);
select public.b14_draft(81);
set role authenticated;
select public.marketplace_create_shop_listing(public.b14_input(),'81000000-0000-4000-8000-000000000001');
insert into public.listing_images(listing_id,slot) values('81000000-0000-4000-8000-000000000001',1);
insert into storage.objects(bucket_id,name,metadata)
select storage_bucket,path,'{"mimetype":"image/png","size":100}' from public.listing_images where listing_id='81000000-0000-4000-8000-000000000001';
update public.listing_images set ready=true where listing_id='81000000-0000-4000-8000-000000000001';
select public.b14_assert((select ready and storage_bucket='listing-images-private' from public.listing_images where listing_id='81000000-0000-4000-8000-000000000001'),'authenticated manifest and private upload/readiness');
select public.b14_reject($q$insert into storage.objects(bucket_id,name,metadata) select 'listing-images',path,'{"mimetype":"image/png","size":100}' from public.listing_images where listing_id='81000000-0000-4000-8000-000000000001'$q$,'42501');
with changed as(update storage.objects set metadata='{}' where bucket_id='listing-images-private' returning id)
select public.b14_assert((select count(*)=0 from changed),'private upsert/update is denied');
select public.b14_assert((select bool_and(seller_id=auth.uid()) from public.listings),'only owner Shop rows readable');
select public.b14_reject('update public.listings set listing_channel=''resale''','42501');
select public.b14_reject('update public.listings set seller_id=gen_random_uuid()','42501');
select public.b14_reject('update public.listings set published_at=clock_timestamp()','42501');
select public.b14_assert((select count(*)>0 from storage.objects where bucket_id='listing-images-private'),'owner private object read');
reset role;
select set_config('request.jwt.claim.sub',public.b14_owner(82)::text,false);
set role authenticated;
select public.b14_assert((select count(*)=0 from storage.objects where bucket_id='listing-images-private'),'cross-owner private Storage read denied');
reset role;
set role anon;
select public.b14_assert((select count(*)=0 from public.listings),'no public Shop listings');
select public.b14_reject('select * from storage.objects where bucket_id=''listing-images-private''','42501');
select public.b14_reject('select public.marketplace_create_shop_listing(public.b14_input(),gen_random_uuid())','42501');
reset role;

do $$declare lid uuid;before_count bigint;begin
 lid:=public.b14_draft(86);perform public.b14_reject(format('select public.marketplace_finalize_listing(%L)',lid),'42501');
 lid:=public.b14_draft(85);perform public.b14_reject(format('select public.marketplace_finalize_listing(%L)',lid),'42501');
 perform public.b14_assert((select published_at is null from public.listings where id=lid),'denied finalize leaves draft');
 perform public.b14_fill(81,39); -- exactly one slot left for the native race
 perform public.b14_fill(82,100);
 lid:=public.b14_draft(82);perform public.b14_reject(format('select public.marketplace_finalize_listing(%L)',lid),'23514');
 perform public.b14_fill(83,100);
 lid:=public.b14_draft(83);perform public.b14_reject(format('select public.marketplace_finalize_listing(%L)',lid),'23514');
 perform public.b14_assert(marketplace_private.shop_entitlements(public.b14_owner(84),clock_timestamp())->>'status'='grace','actual Grace fixture');
 perform public.b14_fill(84,40);
 lid:=public.b14_draft(84);perform public.b14_reject(format('select public.marketplace_finalize_listing(%L)',lid),'23514');
 -- Downgrade via existing B12 authority, never mutate its tables directly.
 perform public.b14_fill(87,70);
 perform public.b14_buy(87,'plus',clock_timestamp());
 perform public.b14_assert((select count(*)=70 from public.listings where seller_id=public.b14_owner(87) and published_at is not null),'downgrade retains every listing');
 lid:=public.b14_draft(87);perform public.b14_reject(format('select public.marketplace_finalize_listing(%L)',lid),'23514');
 -- Non-increasing owner actions remain available even over capacity.
 update public.listings set title='Safe edit' where id=(select id from public.listings where seller_id=public.b14_owner(87) and published_at is not null limit 1);
 update public.listings set status='sold' where id=(select id from public.listings where seller_id=public.b14_owner(87) and published_at is not null limit 1);
 perform public.b14_assert((select count(*)=69 from public.listings where seller_id=public.b14_owner(87) and published_at is not null and status='available'),'Sold frees one active slot');
 perform public.b14_assert((select bool_and(storage_bucket='listing-images-private') from public.listing_images where owner_id between public.b14_owner(81) and public.b14_owner(90)),'new Shop images server-derived private');
 perform public.b14_assert((select bool_and(storage_bucket='listing-images') from public.listing_images where owner_id='11111111-1111-4111-8111-111111111111'),'historical Shop sources were not rewritten');
end;$$;

-- Known-ID SECURITY DEFINER calls remain closed despite successful publication.
select set_config('request.jwt.claim.sub',public.b14_owner(87)::text,false);
set role authenticated;
with changed as(update public.listings set title='Authenticated edit' where id=(select id from public.listings where status='available' and published_at is not null limit 1) returning id)
select public.b14_assert((select count(*)=1 from changed),'owner edit while over capacity');
with changed as(update public.listings set status='sold' where id=(select id from public.listings where status='available' and published_at is not null limit 1) returning id)
select public.b14_assert((select count(*)=1 from changed),'authenticated owner Mark Sold');
with changed as(delete from public.listings where id=(select id from public.listings where status='available' and published_at is not null limit 1) returning id)
select public.b14_assert((select count(*)=1 from changed),'authenticated safe delete');
with changed as(update public.listings set title='Intruder' where seller_id=public.b14_owner(81) returning id)
select public.b14_assert((select count(*)=0 from changed),'cross-owner UPDATE denied');
reset role;
do $$declare lid uuid;begin
 select id into lid from public.listings where seller_id=public.b14_owner(81) and published_at is not null limit 1;
 perform set_config('request.jwt.claim.sub',public.b14_owner(82)::text,false);
 perform public.b14_reject(format('select public.marketplace_find_or_create_conversation(%L)',lid),'42501');
 perform public.b14_reject(format('insert into public.order_requests(listing_id) values(%L)',lid),'42501');
 perform public.b14_reject(format('insert into public.orders(listing_id) values(%L)',lid),'42501');
end;$$;
