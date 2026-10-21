-- New disposable native fixtures only; no user/development/remote DB connection.
create function public.b11_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'B11 assertion: %',label;end if;end;$$;
create function public.b11_reject(statement text,expected text) returns void language plpgsql as $$
begin begin execute statement;exception when others then
 if sqlstate=expected then return;end if;raise;
end;raise exception 'B11 unexpected success, expected %: %',expected,statement;end;$$;
create function public.b11_actor(actor uuid) returns void language sql as $$
 select set_config('request.jwt.claim.sub',coalesce(actor::text,''),false);$$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'b11_local_'||i||'@uwo.ca',case when i=4 then null else clock_timestamp() end,
 jsonb_build_object('username','B11_Local_'||i) from generate_series(1,8) i;
insert into public.shops(owner_id,name,category,description,created_at,updated_at)
values('00000000-0000-4000-8000-000000000001','Existing Shop','Electronics','Preserve this pre-migration fixture','2026-01-01','2026-01-01');
create table public.b11_before as select jsonb_agg(to_jsonb(s) order by s.id) shops from public.shops s;
create table public.b11_profiles_before as select jsonb_agg(to_jsonb(p) order by p.id) profiles from public.profiles p;
create table public.b11_authority_before as select
 (select jsonb_agg(to_jsonb(p) order by p.policyname) from pg_policies p where schemaname='public' and tablename='shops') policies,
 (select c.relacl::text from pg_class c where c.oid='public.shops'::regclass) table_acl,
 (select jsonb_agg(jsonb_build_object('name',a.attname,'acl',a.attacl::text) order by a.attnum) from pg_attribute a where a.attrelid='public.shops'::regclass and a.attnum>0) column_acl,
 (select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid='public.shops'::regclass) constraints;
-- B11_APPLY_APPROVED_MIGRATION

select public.b11_assert((select shops=(select jsonb_agg(to_jsonb(s) order by s.id) from public.shops s) from public.b11_before),'migration leaves existing Shop data unchanged');
select public.b11_assert((select policies=(select jsonb_agg(to_jsonb(p) order by p.policyname) from pg_policies p where schemaname='public' and tablename='shops') from public.b11_authority_before),'existing RLS policies unchanged');
select public.b11_assert((select table_acl is not distinct from (select c.relacl::text from pg_class c where c.oid='public.shops'::regclass) from public.b11_authority_before),'table ACL unchanged');
select public.b11_assert((select column_acl=(select jsonb_agg(jsonb_build_object('name',a.attname,'acl',a.attacl::text) order by a.attnum) from pg_attribute a where a.attrelid='public.shops'::regclass and a.attnum>0) from public.b11_authority_before),'column grants unchanged');
select public.b11_assert((select constraints=(select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid='public.shops'::regclass) from public.b11_authority_before),'all constraints including owner unique unchanged');
select public.b11_assert((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.marketplace_create_shop(jsonb)'::regprocedure),'definer with empty search_path');
select public.b11_assert(has_function_privilege('authenticated','public.marketplace_create_shop(jsonb)','execute') and not has_function_privilege('anon','public.marketplace_create_shop(jsonb)','execute') and not has_function_privilege('service_role','public.marketplace_create_shop(jsonb)','execute'),'execute only intended authenticated role');
select public.b11_assert(not has_table_privilege('authenticated','public.shops','insert') and not has_table_privilege('authenticated','public.shops','delete'),'no direct insert/delete privilege');
select public.b11_assert((select relrowsecurity from pg_class where oid='public.shops'::regclass),'RLS remains enabled');

set role authenticated;
select public.b11_actor('00000000-0000-4000-8000-000000000002');
do $$declare body jsonb;bad jsonb;k text;v record;begin
 body:='{"name":"Created Shop","category":"Electronics","description":"Created description"}';
 foreach bad in array array['null'::jsonb,'[]'::jsonb,'42'::jsonb,'{}'::jsonb,body-'name',body-'category',body-'description',body||'{"name":null}',body||'{"name":42}',body||'{"description":false}',body||'{"name":" "}',body||'{"category":" Electronics "}',body||'{"category":"Furniture"}',body||'{"description":""}'] loop
  perform public.b11_reject(format('select public.marketplace_create_shop(%L::jsonb)',bad),'23514');
 end loop;
 perform public.b11_reject('select public.marketplace_create_shop(null)','23514');
 foreach k in array array['ownerId','owner_id','id','shopId','username','tier','entitlement','membership','active','payment_status','trialEligibility','expires_at','published_at','priority','revenue','quota','created_at','updated_at'] loop
  perform public.b11_reject(format('select public.marketplace_create_shop(%L::jsonb)',body||jsonb_build_object(k,'forged')),'23514');
 end loop;
 perform public.b11_reject(format('select public.marketplace_create_shop(%L::jsonb)',body||jsonb_build_object('name',repeat('n',41))),'23514');
 perform public.b11_reject(format('select public.marketplace_create_shop(%L::jsonb)',body||jsonb_build_object('description',repeat('d',201))),'23514');
 perform public.b11_reject(format('select public.marketplace_create_shop(%L::jsonb)',body||jsonb_build_object('name',repeat(U&'\+01F600',21))),'23514');
 perform public.b11_reject(format('select public.marketplace_create_shop(%L::jsonb)',body||jsonb_build_object('name',U&'\0009\00A0\FEFF')),'23514');
 select * into strict v from public.marketplace_create_shop(body||jsonb_build_object('name',U&'\0009\00A0Created Shop\FEFF','description',U&'\000ADescription\000D'));
 perform public.b11_assert(v.owner_id=auth.uid() and v.name='Created Shop' and v.description='Description' and v.id is not null and v.created_at is not null and v.updated_at is not null,'real RPC creates normalized owner profile');
 perform public.b11_assert((select count(*)=1 from public.shops),'owner SELECT sees only new own row');
 perform public.b11_reject(format('select public.marketplace_create_shop(%L::jsonb)',body||'{"name":"Overwrite"}'),'23505');
 perform public.b11_assert((select name='Created Shop' from public.shops),'duplicate never overwrites');
 update public.shops set name='Edited own Shop',category='Home & Living',description='Edited description' where owner_id=auth.uid();
 perform public.b11_assert((select name='Edited own Shop' and category='Home & Living' and description='Edited description' from public.shops),'existing PATCH columns still work');
 perform public.b11_assert((select count(*)=0 from public.shops where owner_id='00000000-0000-4000-8000-000000000001'),'existing other Shop hidden');
 update public.shops set name='Intruder' where owner_id='00000000-0000-4000-8000-000000000001';
 perform public.b11_assert(not found,'cross-owner update zero rows');
 perform public.b11_reject($q$insert into public.shops(owner_id,name,category,description) values(auth.uid(),'Bypass','Electronics','Bypass')$q$,'42501');
 perform public.b11_reject('delete from public.shops','42501');
 perform public.b11_reject('update public.shops set owner_id=gen_random_uuid()','42501');
 perform public.b11_reject('update public.shops set created_at=now()','42501');
end;$$;
select public.b11_actor('00000000-0000-4000-8000-000000000003');
select * from public.marketplace_create_shop(jsonb_build_object('name',repeat(U&'\+01F600',20),'category','Collectibles','description',repeat('d',200)));
select public.b11_assert((select count(*)=1 and bool_and(owner_id=auth.uid()) from public.shops),'second eligible owner isolated');
select public.b11_actor('00000000-0000-4000-8000-000000000004');
select public.b11_reject($q$select public.marketplace_create_shop('{"name":"Denied","category":"Electronics","description":"Denied"}')$q$,'42501');
-- The non-Western Auth fixture was inserted BEFORE installing Auth backstop triggers.
select public.b11_actor('99999999-9999-4999-8999-999999999999');
select public.b11_reject($q$select public.marketplace_create_shop('{"name":"Denied","category":"Electronics","description":"Denied"}')$q$,'42501');
select public.b11_actor(null);
select public.b11_reject($q$select public.marketplace_create_shop('{"name":"Denied","category":"Electronics","description":"Denied"}')$q$,'42501');
reset role;
set role anon;
select public.b11_reject($q$select public.marketplace_create_shop('{"name":"Denied","category":"Electronics","description":"Denied"}')$q$,'42501');
select public.b11_reject('select * from public.shops','42501');
reset role;

-- Actual failed transaction leaves no created row; never disable a guard.
begin;
set local role authenticated;
select public.b11_actor('00000000-0000-4000-8000-000000000005');
select * from public.marketplace_create_shop('{"name":"Rolled back","category":"Clothing & Accessories","description":"Rollback"}');
rollback;
select public.b11_assert(not exists(select 1 from public.shops where owner_id='00000000-0000-4000-8000-000000000005'),'rollback leaves no Shop');
set role authenticated;
select public.b11_actor('00000000-0000-4000-8000-000000000005');
select * from public.marketplace_create_shop('{"name":"Retry","category":"Clothing & Accessories","description":"Successful retry"}');
reset role;

-- Even a persisted Shop does not authorize publication of a Shop Listing.
select public.b11_actor('00000000-0000-4000-8000-000000000002');
create table public.b11_listing(id uuid);
with created as(insert into public.listings(seller_id,title,description,price_cents,category,subcategory,pickup_area,expected_image_count,meeting_location,listing_channel)
values(auth.uid(),'Local boundary fixture','Not public',1000,'Electronics','Cameras','Campus',1,'Local location','shop') returning id)
insert into public.b11_listing select id from created;
-- B14 now allows eligible publication. Keep this negative case about missing
-- membership, rather than accidentally failing first on an incomplete manifest.
insert into public.listing_images(listing_id,slot) select id,1 from public.b11_listing;
insert into storage.objects(bucket_id,name,metadata)
select storage_bucket,path,'{"mimetype":"image/png","size":100}' from public.listing_images where listing_id in(select id from public.b11_listing);
update public.listing_images set ready=true where listing_id in(select id from public.b11_listing);
grant select on public.b11_listing to authenticated;
set role authenticated;
select public.b11_reject('select public.marketplace_finalize_listing((select id from public.b11_listing))','42501');
reset role;
select public.b11_assert((select published_at is null from public.listings where id=(select id from public.b11_listing)),'provisioning never publishes a product');
select public.b11_assert((select count(*)=7 from information_schema.columns where table_schema='public' and table_name='shops'),'no added membership/trial/status/financial fields');
select public.b11_assert((select to_jsonb(s)=b.shops->0 from public.shops s cross join public.b11_before b where s.owner_id='00000000-0000-4000-8000-000000000001'),'existing Shop untouched after all tests');
select public.b11_assert((select profiles=(select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p) from public.b11_profiles_before),'existing Profile records unchanged');
select public.b11_assert(not exists(select 1 from public.orders) and not exists(select 1 from public.order_requests) and not exists(select 1 from public.notifications) and not exists(select 1 from marketplace_private.notification_events) and not exists(select 1 from marketplace_private.financial_capabilities) and not exists(select 1 from marketplace_private.stripe_setup_operations),'no transaction/notification/payment side effect');
