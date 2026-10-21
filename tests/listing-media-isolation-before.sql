insert into auth.users(id,email,email_confirmed_at) values
 ('11111111-1111-4111-8111-111111111111','media-owner@uwo.ca',now()),
 ('22222222-2222-4222-8222-222222222222','media-other@uwo.ca',now());
set role authenticated;
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
insert into public.listings(id,title,description,price_cents,category,subcategory,pickup_area,expected_image_count)
 values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Legacy','Legacy image',1000,'Electronics','Cameras','Campus',1);
insert into public.listing_images(id,listing_id,slot) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',1);
insert into storage.objects(bucket_id,name,metadata) select 'listing-images',path,'{"mimetype":"image/jpeg","size":100}' from public.listing_images;
update public.listing_images set ready=true;
select public.marketplace_finalize_listing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
reset role;
create table public.media_legacy_evidence as select to_jsonb(i) as image,marketplace_private.listing_media_material_hash(i.listing_id) as hash from public.listing_images i;

insert into public.order_requests values('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',2,'22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','active');
select public.marketplace_prepare_order_media('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-ddddddddddd1');
create table public.media_legacy_batch as select id,manifest,material_hash from marketplace_private.order_media_batches;
create table public.media_legacy_asset as select to_jsonb(a) as asset from marketplace_private.order_media_assets a;
