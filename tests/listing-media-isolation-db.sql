-- All assertions run only inside the isolated native PostgreSQL fixture.
create function public.media_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end;$$;
create function public.media_reject(command text) returns void language plpgsql as $$
begin
 begin execute command; exception when insufficient_privilege or check_violation then return;end;
 raise exception 'Expected rejection: %',command;
end;$$;
grant select on public.media_legacy_evidence to anon,authenticated;
grant select on storage.objects to anon;
select public.media_assert((select public=false from storage.buckets where id='listing-images-private'),'private bucket');
select public.media_assert((select public=true from storage.buckets where id='listing-images'),'legacy bucket stays public');
select public.media_assert((select to_jsonb(i)-'storage_bucket'=e.image and i.storage_bucket='listing-images' and marketplace_private.listing_media_material_hash(i.listing_id)=e.hash from public.listing_images i cross join public.media_legacy_evidence e),'legacy row/path/hash unchanged');
select public.media_assert(not exists(select 1 from marketplace_private.order_media_batches b join public.media_legacy_batch e using(id) where b.manifest<>e.manifest or b.material_hash<>e.material_hash),'legacy batch exact');
select public.media_assert((select to_jsonb(a)-'source_bucket'=e.asset and a.source_bucket='listing-images' from marketplace_private.order_media_assets a cross join public.media_legacy_asset e),'legacy snapshot source unchanged');
select public.media_assert(not has_function_privilege('anon','public.marketplace_prepare_order_media(uuid,uuid,uuid)','EXECUTE') and not has_function_privilege('authenticated','public.marketplace_prepare_order_media(uuid,uuid,uuid)','EXECUTE') and has_function_privilege('service_role','public.marketplace_prepare_order_media(uuid,uuid,uuid)','EXECUTE'),'snapshot RPC permissions preserved');
set role authenticated;
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
insert into public.listings(id,title,description,price_cents,category,subcategory,pickup_area,expected_image_count) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Private','Private image',1200,'Electronics','Cameras','Campus',2);
select public.media_reject($q$insert into public.listing_images(listing_id,slot,storage_bucket) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',1,'listing-images')$q$);
insert into public.listing_images(id,listing_id,slot) values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',1),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',2);
select public.media_assert((select bool_and(storage_bucket='listing-images-private') from public.listing_images where listing_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),'DB chooses bucket');
select public.media_reject($q$update public.listing_images set storage_bucket='listing-images' where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'$q$);
select public.media_reject($q$select public.marketplace_finalize_listing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')$q$);
select public.media_reject($q$insert into storage.objects(bucket_id,name,metadata) select 'listing-images',path,'{"mimetype":"image/jpeg","size":100}' from public.listing_images where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'$q$);
insert into storage.objects(bucket_id,name,metadata) select storage_bucket,path,'{"mimetype":"image/jpeg","size":100}' from public.listing_images where listing_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
update public.listing_images set ready=true where listing_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
select public.media_assert((select count(*)=2 from storage.objects where bucket_id='listing-images-private'),'owner downloads own draft');
with deleted as(delete from storage.objects where bucket_id='listing-images-private' returning id) select public.media_assert(count(*)=0,'referenced objects cannot be deleted') from deleted;
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.media_assert((select count(*)=0 from storage.objects where bucket_id='listing-images-private'),'other cannot download');
select public.media_assert((select count(*)=0 from public.listing_images where listing_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),'other no manifest');
select public.media_reject($q$select public.marketplace_finalize_listing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')$q$);
with deleted as(delete from public.listings where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' returning id) select public.media_assert(count(*)=0,'other cannot discard') from deleted;
reset role;set role anon;
select public.media_assert((select count(*)=0 from storage.objects where bucket_id='listing-images-private'),'anon no private bytes');
select public.media_assert((select count(*)=0 from public.listings where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),'anon no draft');
reset role;set role authenticated;set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.marketplace_finalize_listing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
select public.marketplace_finalize_listing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
reset role;set role anon;
select public.media_assert((select count(*)=1 from public.listings where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),'published metadata public');
select public.media_assert((select count(*)=0 from storage.objects where bucket_id='listing-images-private'),'published bucket remains private');
reset role;
-- Even an unrelated permissive policy cannot open private read/update/delete.
create policy test_overbroad_read on storage.objects for select using(true);
create policy test_overbroad_update on storage.objects for update using(true) with check(true);
create policy test_overbroad_delete on storage.objects for delete using(true);
set role authenticated;set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.media_assert((select count(*)=0 from storage.objects where bucket_id='listing-images-private'),'restrictive read guards broad policy');
with changed as(update storage.objects set metadata='{}' where bucket_id='listing-images-private' returning id) select public.media_assert(count(*)=0,'no overwrite') from changed;
with gone as(delete from storage.objects where bucket_id='listing-images-private' returning id) select public.media_assert(count(*)=0,'no cross-user delete') from gone;
insert into public.listing_favorites(user_id,listing_id) values(auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
select public.media_assert((select count(*)=1 from public.listing_favorites),'Favorites persisted');
reset role;
insert into public.order_requests values('cccccccc-cccc-4ccc-8ccc-ccccccccccc2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',2,'22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','active');
select public.marketplace_prepare_order_media('cccccccc-cccc-4ccc-8ccc-ccccccccccc2','11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-ddddddddddd2');
select public.media_assert((select count(*)=2 from marketplace_private.order_media_assets a join marketplace_private.order_media_batches b on b.id=a.batch_id where b.listing_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' and a.source_bucket='listing-images-private'),'snapshot freezes private source');
set role authenticated;set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.media_reject($q$delete from public.listing_images where listing_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'$q$);
update public.listings set title='Edited' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
update public.listings set status='sold' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
reset role;set role anon;
select public.media_assert((select count(*)=0 from public.listings where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),'Sold hidden');
reset role;
-- New Shop reservations retain legacy routing and positive publication stays closed.
insert into public.listings(id,title,description,price_cents,category,subcategory,pickup_area,expected_image_count,listing_channel,seller_id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','Shop','Shop',100,'Electronics','Cameras','Campus',1,'shop','11111111-1111-4111-8111-111111111111');
set role authenticated;set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
insert into public.listing_images(listing_id,slot) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',1);
select public.media_assert((select storage_bucket='listing-images' from public.listing_images where listing_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),'Shop unchanged');
select public.media_reject($q$select public.marketplace_finalize_listing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3')$q$);
-- Discard removes manifest before object; authenticated owner can clean orphan.
insert into public.listings(id,title,description,price_cents,category,subcategory,pickup_area,expected_image_count) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','Discard','Discard',100,'Electronics','Cameras','Campus',1);
insert into public.listing_images(listing_id,slot) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',1);
insert into storage.objects(bucket_id,name,metadata) select storage_bucket,path,'{"mimetype":"image/jpeg","size":100}' from public.listing_images where listing_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
delete from public.listings where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4' and published_at is null;
delete from storage.objects where bucket_id='listing-images-private' and name like '%/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4/%';
reset role;
select public.media_assert((select count(*)=0 from storage.objects where name like '%/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4/%'),'orphan cleanup');

-- Source location cannot be changed even through a privileged table write.
select public.media_reject($q$update public.listing_images set storage_bucket='listing-images-private' where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'$q$);
create policy test_overbroad_insert on storage.objects for insert with check(true);
set role authenticated;set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.media_reject($q$insert into storage.objects(bucket_id,name,metadata) values('listing-images-private','11111111-1111-4111-8111-111111111111/forged','{}')$q$);
select public.media_reject($q$insert into storage.objects(bucket_id,name,metadata) values('listing-images','22222222-2222-4222-8222-222222222222/forged','{}')$q$);
reset role;
-- Fixture for two independent real connections racing the same finalize.
set role authenticated;set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
insert into public.listings(id,title,description,price_cents,category,subcategory,pickup_area,expected_image_count) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','Concurrent','Concurrent',100,'Electronics','Cameras','Campus',1);
insert into public.listing_images(listing_id,slot) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',1);
insert into storage.objects(bucket_id,name,metadata) select storage_bucket,path,'{"mimetype":"image/jpeg","size":100}' from public.listing_images where listing_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
update public.listing_images set ready=true where listing_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
reset role;
